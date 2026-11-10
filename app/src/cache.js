const { createClient } = require('redis');

const enabled = process.env.CACHE_ENABLED === 'true' && Boolean(process.env.REDIS_URL);
const ttlSeconds = Number(process.env.CACHE_TTL_SECONDS) || 30;

const client = enabled
  ? createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      commandOptions: { timeout: 200 },
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => Math.min(500 * (retries + 1), 5000),
      },
    })
  : null;

if (client) {
  client.on('ready', () => console.log('Redis connected'));
  client.on('error', (err) => console.error('Redis error:', err.message));
  client.connect().catch((err) => console.error('Redis connect failed:', err.message));
}

async function read(key) {
  if (!client?.isReady) return { status: 'BYPASS' };
  try {
    const value = await client.get(key);
    return value === null ? { status: 'MISS' } : { status: 'HIT', value };
  } catch (err) {
    console.error('Redis read failed:', err.message);
    return { status: 'BYPASS' };
  }
}

function write(key, value) {
  if (!client?.isReady) return;
  client
    .set(key, value, { expiration: { type: 'EX', value: ttlSeconds } })
    .catch((err) => console.error('Redis write failed:', err.message));
}

async function remove(key) {
  if (!client?.isReady) return;
  try {
    await client.del(key);
  } catch (err) {
    console.error('Redis delete failed:', err.message);
  }
}

async function close() {
  if (!client?.isOpen) return;
  await client.close();
}

module.exports = { read, write, remove, close };
