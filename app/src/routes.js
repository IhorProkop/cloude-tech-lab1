const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./auth');
const cache = require('./cache');

const RECENT_TASKS_KEY = 'tasks:recent';
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
  try {
    const result = await pool.query(
      'INSERT INTO tasks (title, author) VALUES ($1, $2) RETURNING *',
      [title.trim(), req.user.sub]
    );
    await cache.remove(RECENT_TASKS_KEY);
    res.status(201).json(result.rows[0]);
  } catch (err) {
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
