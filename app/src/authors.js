const express = require('express');
const { pool } = require('./db');
const cache = require('./cache');

const AUTHOR_CACHE_TTL_SECONDS = Number(process.env.AUTHOR_CACHE_TTL_SECONDS) || 5;

const router = express.Router();

async function loadAuthor(username) {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS task_count, MAX(created_at) AS last_task_at FROM tasks WHERE author = $1',
    [username]
  );
  const { task_count: taskCount, last_task_at: lastTaskAt } = result.rows[0];
  return JSON.stringify({ username, taskCount, lastTaskAt });
}

router.get('/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const result = await cache.getOrLoad(`author:${username}`, AUTHOR_CACHE_TTL_SECONDS, () =>
      loadAuthor(username)
    );
    res.set('X-Cache', result.status);
    if (result.coalesced) res.set('X-Cache-Coalesced', 'true');
    res.type('application/json').send(result.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
