const express = require('express');
const { pool } = require('./db');
const cache = require('./cache');

const AUTHOR_CACHE_TTL_SECONDS = Number(process.env.AUTHOR_CACHE_TTL_SECONDS) || 5;

const router = express.Router();

router.get('/:username', async (req, res) => {
  const username = req.params.username;
  const key = `author:${username}`;
  const cached = await cache.read(key);
  res.set('X-Cache', cached.status);
  if (cached.status === 'HIT') {
    return res.type('application/json').send(cached.value);
  }
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS task_count, MAX(created_at) AS last_task_at FROM tasks WHERE author = $1',
      [username]
    );
    const { task_count: taskCount, last_task_at: lastTaskAt } = result.rows[0];
    const body = JSON.stringify({ username, taskCount, lastTaskAt });
    if (cached.status === 'MISS') cache.write(key, body, AUTHOR_CACHE_TTL_SECONDS);
    res.type('application/json').send(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
