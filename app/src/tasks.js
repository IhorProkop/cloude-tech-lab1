const { pool } = require('./db');
const cache = require('./cache');

const RECENT_TASKS_KEY = 'tasks:recent';

async function createTask(title, author) {
  const result = await pool.query('INSERT INTO tasks (title, author) VALUES ($1, $2) RETURNING *', [
    title.trim(),
    author,
  ]);
  await cache.remove(RECENT_TASKS_KEY);
  return result.rows[0];
}

module.exports = { RECENT_TASKS_KEY, createTask };
