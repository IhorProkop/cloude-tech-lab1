const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./auth');
const cache = require('./cache');
const idempotency = require('./idempotency');
const { RECENT_TASKS_KEY, createTask } = require('./tasks');

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

router.post('/', requireAuth, async (req, res) => {
  const title = req.body?.title;
  if (typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required' });
  }
  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey !== undefined && !idempotency.isValidKey(idempotencyKey)) {
    return res.status(400).json({ error: 'Idempotency-Key must be 1-255 visible ASCII characters' });
  }

  const create = async () => {
    const task = await createTask(title, req.user.sub);
    return { status: 201, body: task };
  };

  try {
    if (idempotencyKey === undefined) {
      const result = await create();
      return res.status(result.status).json(result.body);
    }
    const result = await idempotency.run(
      `user:${req.user.sub}`,
      idempotencyKey,
      idempotency.fingerprint('POST /tasks', req.body),
      create
    );
    res.set('Idempotency-Replayed', String(result.replayed));
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof idempotency.IdempotencyError) {
      if (err.status === 503) res.set('Retry-After', '1');
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
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
