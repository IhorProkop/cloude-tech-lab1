const express = require('express');
const { pool, createTable } = require('./db');
const routes = require('./routes');
const { login } = require('./auth');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi.json');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ name: 'Tasks API', version: '1.0' });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error' });
  }
});

app.post('/login', login);

app.use('/tasks', routes);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

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
