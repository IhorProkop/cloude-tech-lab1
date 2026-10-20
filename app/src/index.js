// Точка входу: створює Express-застосунок, підключає маршрути,
// створює таблицю в БД і запускає HTTP-сервер.
const express = require('express');
const { pool, createTable } = require('./db');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ name: 'Tasks API', version: '1.0' });
});

// Перевірка стану: застосунок живий і база даних відповідає
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error' });
  }
});

app.use('/tasks', routes);

createTable()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to create table:', err);
    process.exit(1);
  });
