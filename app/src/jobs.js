const { client, isReady } = require('./redis');

const JOB_TTL_SECONDS = 24 * 60 * 60;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class JobStoreError extends Error {}

function jobKey(id) {
  return `job:${id}`;
}

function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

async function call(operation) {
  if (!isReady()) throw new JobStoreError('Job store unavailable');
  try {
    return await operation();
  } catch (err) {
    throw new JobStoreError(`Job store call failed: ${err.message}`);
  }
}

async function save(job) {
  await call(() => client.set(jobKey(job.id), JSON.stringify(job), { expiration: { type: 'EX', value: JOB_TTL_SECONDS } }));
  return job;
}

async function get(id) {
  const raw = await call(() => client.get(jobKey(id)));
  return raw === null ? null : JSON.parse(raw);
}

async function create(id) {
  const now = new Date().toISOString();
  return save({ id, status: 'queued', createdAt: now, updatedAt: now });
}

async function update(id, fields) {
  const current = (await get(id)) || { id, createdAt: new Date().toISOString() };
  return save({ ...current, ...fields, updatedAt: new Date().toISOString() });
}

async function remove(id) {
  await call(() => client.del(jobKey(id)));
}

module.exports = { JobStoreError, isValidId, create, get, update, remove };
