import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_USER = __ENV.AUTH_USER || 'admin';
const AUTH_PASSWORD = __ENV.AUTH_PASSWORD || '';
const RUN_NAME = __ENV.RUN_NAME || 'idempotency-local';
const SUMMARY_PATH = __ENV.SUMMARY_PATH || `results/${RUN_NAME}.json`;

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1'],
  },
};

function login() {
  const res = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ username: AUTH_USER, password: AUTH_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (res.status !== 200) throw new Error(`Login failed with status ${res.status}`);
  return res.json('token');
}

function postParams(token, key) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  return { headers, tags: { name: 'POST /tasks' } };
}

function describe(res) {
  return {
    status: res.status,
    replayed: res.headers['Idempotency-Replayed'] || null,
    durationMs: Math.round(res.timings.duration * 100) / 100,
    body: res.body,
  };
}

function countByTitle(title) {
  const res = http.get(`${BASE_URL}/tasks`, { tags: { name: 'GET /tasks' } });
  return res.json().filter((task) => task.title === title).length;
}

function record(report, name, responses, rowsInDb, ok) {
  report.cases.push({ name, responses: responses.map(describe), rowsInDb, passed: ok });
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function setup() {
  const report = { run: RUN_NAME, startedAt: new Date().toISOString(), cases: [] };
  const token = login();
  const suffix = uniqueSuffix();

  const sequentialKey = `seq-${suffix}`;
  const sequentialBody = JSON.stringify({ title: `idempotency sequential ${suffix}` });
  const first = http.post(`${BASE_URL}/tasks`, sequentialBody, postParams(token, sequentialKey));
  const second = http.post(`${BASE_URL}/tasks`, sequentialBody, postParams(token, sequentialKey));
  const sequentialRows = countByTitle(`idempotency sequential ${suffix}`);
  record(
    report,
    'two sequential POST with one key',
    [first, second],
    sequentialRows,
    check(null, {
      'sequential: both 201': () => first.status === 201 && second.status === 201,
      'sequential: identical bodies': () => first.body === second.body,
      'sequential: second is replayed': () =>
        first.headers['Idempotency-Replayed'] === 'false' && second.headers['Idempotency-Replayed'] === 'true',
      'sequential: one row in database': () => sequentialRows === 1,
    })
  );

  const parallelKey = `par-${suffix}`;
  const parallelBody = JSON.stringify({ title: `idempotency parallel ${suffix}` });
  const [a, b] = http.batch([
    ['POST', `${BASE_URL}/tasks`, parallelBody, postParams(token, parallelKey)],
    ['POST', `${BASE_URL}/tasks`, parallelBody, postParams(token, parallelKey)],
  ]);
  const parallelRows = countByTitle(`idempotency parallel ${suffix}`);
  const winners = [a, b].filter((r) => r.status === 201);
  record(
    report,
    'two concurrent POST with one key',
    [a, b],
    parallelRows,
    check(null, {
      'parallel: each response is 201 or 409': () => [a, b].every((r) => r.status === 201 || r.status === 409),
      'parallel: all 201 bodies identical': () => winners.length > 0 && winners.every((r) => r.body === winners[0].body),
      'parallel: one row in database': () => parallelRows === 1,
    })
  );

  const mismatch = http.post(
    `${BASE_URL}/tasks`,
    JSON.stringify({ title: `idempotency other body ${suffix}` }),
    postParams(token, sequentialKey)
  );
  const mismatchRows = countByTitle(`idempotency other body ${suffix}`);
  record(
    report,
    'same key, different body',
    [mismatch],
    mismatchRows,
    check(null, {
      'mismatch: 422': () => mismatch.status === 422,
      'mismatch: nothing inserted': () => mismatchRows === 0,
    })
  );

  const plainBody = JSON.stringify({ title: `idempotency no key ${suffix}` });
  const plainFirst = http.post(`${BASE_URL}/tasks`, plainBody, postParams(token));
  const plainSecond = http.post(`${BASE_URL}/tasks`, plainBody, postParams(token));
  const plainRows = countByTitle(`idempotency no key ${suffix}`);
  record(
    report,
    'two POST without key',
    [plainFirst, plainSecond],
    plainRows,
    check(null, {
      'no key: both 201': () => plainFirst.status === 201 && plainSecond.status === 201,
      'no key: no replay header': () => !plainFirst.headers['Idempotency-Replayed'],
      'no key: two rows in database': () => plainRows === 2,
    })
  );

  const invalid = http.post(
    `${BASE_URL}/tasks`,
    JSON.stringify({ title: `idempotency invalid key ${suffix}` }),
    postParams(token, 'bad key with spaces')
  );
  record(
    report,
    'invalid key',
    [invalid],
    countByTitle(`idempotency invalid key ${suffix}`),
    check(null, { 'invalid key: 400': () => invalid.status === 400 })
  );
  return report;
}

export default function () {}

export function handleSummary(data) {
  const setupData = data.setup_data || { run: RUN_NAME, cases: [] };
  const checks = data.metrics.checks;
  const report = {
    run: setupData.run,
    startedAt: setupData.startedAt,
    checksPassRate: checks ? checks.values.rate : null,
    checksPassed: checks ? checks.values.passes : 0,
    checksFailed: checks ? checks.values.fails : 0,
    cases: setupData.cases.map((item) => ({
      name: item.name,
      passed: item.passed,
      rowsInDb: item.rowsInDb,
      responses: item.responses.map((r) => ({
        status: r.status,
        replayed: r.replayed,
        durationMs: r.durationMs,
        body: r.body,
      })),
    })),
  };
  const json = JSON.stringify(report, null, 2);
  return {
    stdout: `${json}\n`,
    [SUMMARY_PATH]: `${json}\n`,
  };
}
