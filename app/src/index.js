const express = require('express');
const { pool, createTable } = require('./db');
const routes = require('./routes');
const authors = require('./authors');
const jobRoutes = require('./jobRoutes');
const queue = require('./queue');
const metrics = require('./metrics');
const cache = require('./cache');
const store = require('./redis');
const { login } = require('./auth');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi.json');

const app = express();
const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = 10000;
const IDLE_SWEEP_INTERVAL_MS = 500;

let server = null;
let shuttingDown = false;

app.use((req, res, next) => {
  if (shuttingDown) res.set('Connection', 'close');
  next();
});

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
app.use('/authors', authors);
app.use('/jobs', jobRoutes);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

async function closeConnections() {
  metrics.flush();
  queue.destroy();
  const results = await Promise.allSettled([pool.end(), cache.close(), store.close()]);
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => console.error('Shutdown error:', result.reason));
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  if (!server) {
    closeConnections().then(() => process.exit(0));
    return;
  }
  server.close(async () => {
    await closeConnections();
    console.log('Shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections();
  setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_INTERVAL_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

createTable()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  })
  .catch((err) => {
    console.error('Failed to create table:', err);
    process.exit(1);
  });
