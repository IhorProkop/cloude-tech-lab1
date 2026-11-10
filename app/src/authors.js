const express = require('express');
const { pool } = require('./db');

const router = express.Router();

router.get('/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS task_count, MAX(created_at) AS last_task_at FROM tasks WHERE author = $1',
      [username]
    );
    const { task_count: taskCount, last_task_at: lastTaskAt } = result.rows[0];
    res.json({ username, taskCount, lastTaskAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
