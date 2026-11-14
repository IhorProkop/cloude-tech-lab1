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

function write(key, value, ttl) {
  if (!client?.isReady) return;
  client
    .set(key, value, { expiration: { type: 'EX', value: ttl } })
    .catch((err) => console.error('Redis write failed:', err.message));
}

const inFlight = new Map();

async function getOrLoad(key, ttl, load) {
  const cached = await read(key);
  if (cached.status === 'HIT') return { status: 'HIT', body: cached.value, coalesced: false };

  const pending = inFlight.get(key);
  if (pending) return { status: cached.status, body: await pending, coalesced: true };

  const flight = load()
    .then((body) => {
      if (cached.status === 'MISS' && inFlight.get(key) === flight) write(key, body, ttl);
      return body;
    })
    .finally(() => {
      if (inFlight.get(key) === flight) inFlight.delete(key);
    });
  inFlight.set(key, flight);
  return { status: cached.status, body: await flight, coalesced: false };
}

async function remove(key) {
  inFlight.delete(key);
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

module.exports = { ttlSeconds, getOrLoad, remove, close };
