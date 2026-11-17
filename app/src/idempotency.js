const crypto = require('crypto');
const { createClient } = require('redis');

const RESULT_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 30;
const WAIT_FOR_RESULT_MS = 2000;
const WAIT_STEP_MS = 50;
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

const client = process.env.REDIS_URL
  ? createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      commandOptions: { timeout: 1000 },
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => Math.min(500 * (retries + 1), 5000),
      },
    })
  : null;

if (client) {
  client.on('error', (err) => console.error('Idempotency Redis error:', err.message));
  client.connect().catch((err) => console.error('Idempotency Redis connect failed:', err.message));
}

class IdempotencyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function fingerprint(...parts) {
  return crypto.createHash('sha256').update(canonical(parts)).digest('hex');
}

function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

function storageKey(scope, key) {
  return `idem:${scope}:${key}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureReady() {
  if (!client?.isReady) throw new IdempotencyError(503, 'Idempotency store unavailable');
}

async function redisCall(operation) {
  ensureReady();
  try {
    return await operation();
  } catch (err) {
    console.error('Idempotency Redis call failed:', err.message);
    throw new IdempotencyError(503, 'Idempotency store unavailable');
  }
}

async function readRecord(redisKey) {
  const raw = await redisCall(() => client.get(redisKey));
  return raw === null ? null : JSON.parse(raw);
}

async function waitForResult(redisKey, print) {
  const deadline = Date.now() + WAIT_FOR_RESULT_MS;
  while (Date.now() < deadline) {
    await sleep(WAIT_STEP_MS);
    const record = await readRecord(redisKey);
    if (!record) return null;
    if (record.fingerprint !== print) {
      throw new IdempotencyError(422, 'Idempotency-Key was used with a different request');
    }
    if (record.state === 'done') return record;
  }
  throw new IdempotencyError(409, 'A request with this Idempotency-Key is still in progress');
}

async function run(scope, key, print, execute) {
  const redisKey = storageKey(scope, key);
  for (;;) {
    const existing = await readRecord(redisKey);
    if (existing) {
      if (existing.fingerprint !== print) {
        throw new IdempotencyError(422, 'Idempotency-Key was used with a different request');
      }
      const record = existing.state === 'done' ? existing : await waitForResult(redisKey, print);
      if (record) return { status: record.status, body: record.body, replayed: true };
      continue;
    }

    const lock = JSON.stringify({ state: 'pending', fingerprint: print });
    const acquired = await redisCall(() =>
      client.set(redisKey, lock, { condition: 'NX', expiration: { type: 'EX', value: LOCK_TTL_SECONDS } })
    );
    if (acquired === null) continue;

    let result;
    try {
      result = await execute();
    } catch (err) {
      await client.del(redisKey).catch((delErr) => {
        console.error('Idempotency lock release failed:', delErr.message);
      });
      throw err;
    }

    const record = JSON.stringify({ state: 'done', fingerprint: print, status: result.status, body: result.body });
    await client
      .set(redisKey, record, { expiration: { type: 'EX', value: RESULT_TTL_SECONDS } })
      .catch((err) => console.error('Idempotency result save failed:', err.message));
    return { status: result.status, body: result.body, replayed: false };
  }
}

async function close() {
  if (!client?.isOpen) return;
  if (client.isReady) {
    await client.close();
    return;
  }
  client.destroy();
}

module.exports = { IdempotencyError, fingerprint, isValidKey, run, close, RESULT_TTL_SECONDS };
