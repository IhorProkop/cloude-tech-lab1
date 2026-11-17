const crypto = require('crypto');
const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./auth');
const cache = require('./cache');
const idempotency = require('./idempotency');
const { RECENT_TASKS_KEY, createTask } = require('./tasks');
const jobs = require('./jobs');
const queue = require('./queue');
const metrics = require('./metrics');

const RECENT_TASKS_LIMIT = 50;

const router = express.Router();

async function loadRecentTasks() {
  const result = await pool.query('SELECT * FROM tasks ORDER BY id DESC LIMIT $1', [
    RECENT_TASKS_LIMIT,
  ]);
  return JSON.stringify(result.rows);
}

router.get('/', async (req, res) => {
  try {
    const result = await cache.getOrLoad(RECENT_TASKS_KEY, cache.ttlSeconds, loadRecentTasks);
    res.set('X-Cache', result.status);
    if (result.coalesced) res.set('X-Cache-Coalesced', 'true');
    res.type('application/json').send(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

function readTitle(req, res) {
  const title = req.body?.title;
  if (typeof title !== 'string' || title.trim() === '') {
    res.status(400).json({ error: 'Title is required' });
    return null;
  }
  return title;
}

function readIdempotencyKey(req, res) {
  const key = req.get('Idempotency-Key');
  if (key !== undefined && !idempotency.isValidKey(key)) {
    res.status(400).json({ error: 'Idempotency-Key must be 1-255 visible ASCII characters' });
    return null;
  }
  return key;
}

async function execute(req, operation, key, action) {
  if (key === undefined) return { ...(await action()), replayed: null };
  return idempotency.run(`user:${req.user.sub}`, key, idempotency.fingerprint(operation, req.body), action);
}

function sendResult(res, result) {
  if (result.replayed !== null) res.set('Idempotency-Replayed', String(result.replayed));
  if (result.body?.location) res.set('Location', result.body.location);
  res.status(result.status).json(result.body);
}

function sendError(res, err) {
  if (err instanceof idempotency.IdempotencyError) {
    if (err.status === 503) res.set('Retry-After', '1');
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof jobs.JobStoreError || err.name === 'QueueSendError') {
    console.error(err.message);
    res.set('Retry-After', '1');
    return res.status(503).json({ error: 'Queue or job store unavailable' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

router.post('/', metrics.trackLatency('POST /tasks'), requireAuth, async (req, res) => {
  const title = readTitle(req, res);
  if (title === null) return;
  const key = readIdempotencyKey(req, res);
  if (key === null) return;

  try {
    const result = await execute(req, 'POST /tasks', key, async () => ({
      status: 201,
      body: await createTask(title, req.user.sub),
    }));
    sendResult(res, result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/async', metrics.trackLatency('POST /tasks/async'), requireAuth, async (req, res) => {
  const title = readTitle(req, res);
  if (title === null) return;
  const key = readIdempotencyKey(req, res);
  if (key === null) return;
  if (!queue.enabled) {
    return res.status(503).json({ error: 'Queue is not configured' });
  }

  const enqueue = async () => {
    const jobId = crypto.randomUUID();
    await jobs.create(jobId);
    try {
      await queue.send({ jobId, title: title.trim(), author: req.user.sub });
    } catch (err) {
      await jobs.remove(jobId).catch(() => {});
      err.name = 'QueueSendError';
      throw err;
    }
    return { status: 202, body: { jobId, status: 'queued', location: `/jobs/${jobId}` } };
  };

  try {
    sendResult(res, await execute(req, 'POST /tasks/async', key, enqueue));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await cache.remove(RECENT_TASKS_KEY);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
