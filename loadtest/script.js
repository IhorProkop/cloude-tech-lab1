import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_USER = __ENV.AUTH_USER || 'admin';
const AUTH_PASSWORD = __ENV.AUTH_PASSWORD || '';
const VUS = Number(__ENV.VUS || 20);
const RAMP_UP = __ENV.RAMP_UP || '3m';
const STEADY = __ENV.STEADY || '5m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '2m';
const THINK_TIME = Number(__ENV.THINK_TIME || 0.2);
const RUN_NAME = __ENV.RUN_NAME || 'local';
const SUMMARY_PATH = __ENV.SUMMARY_PATH || `results/${RUN_NAME}.json`;

const tasksListCacheHit = new Rate('tasks_list_cache_hit');
const createTaskDuration = new Trend('endpoint_post_tasks', true);
const tasksListDuration = new Trend('endpoint_get_tasks', true);
const taskByIdDuration = new Trend('endpoint_get_task_by_id', true);
const authorDuration = new Trend('endpoint_get_author', true);

export const options = {
  scenarios: {
    users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: VUS },
        { duration: STEADY, target: VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function think() {
  sleep(THINK_TIME * (0.5 + Math.random()));
}

function createTask(token) {
  const res = http.post(
    `${BASE_URL}/tasks`,
    JSON.stringify({ title: `k6 ${RUN_NAME} vu ${__VU} iteration ${__ITER}` }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { name: 'POST /tasks' },
    }
  );
  createTaskDuration.add(res.timings.duration);
  check(res, { 'POST /tasks is 201': (r) => r.status === 201 });
  think();
  return res.status === 201 ? res.json('id') : null;
}

function readTasksList() {
  const res = http.get(`${BASE_URL}/tasks`, { tags: { name: 'GET /tasks' } });
  tasksListDuration.add(res.timings.duration);
  tasksListCacheHit.add(res.headers['X-Cache'] === 'HIT');
  check(res, { 'GET /tasks is 200': (r) => r.status === 200 });
  think();
  return res.status === 200 ? res.json().map((task) => task.id) : [];
}

function readTask(id) {
  if (!id) return;
  const res = http.get(`${BASE_URL}/tasks/${id}`, { tags: { name: 'GET /tasks/:id' } });
  taskByIdDuration.add(res.timings.duration);
  check(res, { 'GET /tasks/:id is 200': (r) => r.status === 200 });
  think();
}

function readAuthor() {
  const res = http.get(`${BASE_URL}/authors/${AUTH_USER}`, {
    tags: { name: 'GET /authors/:username' },
  });
  authorDuration.add(res.timings.duration);
  check(res, { 'GET /authors/:username is 200': (r) => r.status === 200 });
  think();
}

function randomItem(items) {
  return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : null;
}

export function setup() {
  const res = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({ username: AUTH_USER, password: AUTH_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /login' } }
  );
  if (res.status !== 200) {
    throw new Error(`Login failed with status ${res.status}`);
  }
  return { token: res.json('token'), startedAt: new Date().toISOString() };
}

export default function (data) {
  const createdId = createTask(data.token);

  let visibleIds = readTasksList();
  readTask(createdId);
  readTask(randomItem(visibleIds));
  readAuthor();
  visibleIds = readTasksList();
  readTask(randomItem(visibleIds));
  readTasksList();
  readTask(randomItem(visibleIds));
  readTasksList();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function percentiles(metric) {
  if (!metric) return null;
  const v = metric.values;
  return {
    avg: round(v.avg),
    p50: round(v.med),
    p90: round(v['p(90)']),
    p95: round(v['p(95)']),
    p99: round(v['p(99)']),
    max: round(v.max),
  };
}

function parseDuration(value) {
  const unitSeconds = { h: 3600, m: 60, s: 1 };
  let seconds = 0;
  for (const [, amount, unit] of value.matchAll(/(\d+)([hms])/g)) {
    seconds += Number(amount) * unitSeconds[unit];
  }
  return seconds;
}

function phaseTimes(startedAt) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const rampUpEnd = start + parseDuration(RAMP_UP) * 1000;
  const steadyEnd = rampUpEnd + parseDuration(STEADY) * 1000;
  const end = steadyEnd + parseDuration(RAMP_DOWN) * 1000;
  return {
    rampUpStart: new Date(start).toISOString(),
    steadyStart: new Date(rampUpEnd).toISOString(),
    rampDownStart: new Date(steadyEnd).toISOString(),
    end: new Date(end).toISOString(),
  };
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const summary = {
    run: RUN_NAME,
    vus: VUS,
    stages: { rampUp: RAMP_UP, steady: STEADY, rampDown: RAMP_DOWN },
    thinkTimeSeconds: THINK_TIME,
    phasesUtc: phaseTimes(data.setup_data && data.setup_data.startedAt),
    durationSeconds: round(data.state.testRunDurationMs / 1000),
    iterations: metrics.iterations ? metrics.iterations.values.count : 0,
    requests: metrics.http_reqs.values.count,
    requestsPerSecond: round(metrics.http_reqs.values.rate),
    errorRate: metrics.http_req_failed.values.rate,
    failedRequests: metrics.http_req_failed.values.passes,
    checksPassRate: metrics.checks ? metrics.checks.values.rate : null,
    latencyMs: percentiles(metrics.http_req_duration),
    endpointsLatencyMs: {
      'POST /tasks': percentiles(metrics.endpoint_post_tasks),
      'GET /tasks': percentiles(metrics.endpoint_get_tasks),
      'GET /tasks/:id': percentiles(metrics.endpoint_get_task_by_id),
      'GET /authors/:username': percentiles(metrics.endpoint_get_author),
    },
    tasksListCacheHitRate: metrics.tasks_list_cache_hit
      ? round(metrics.tasks_list_cache_hit.values.rate * 10000) / 10000
      : null,
  };
  const json = JSON.stringify(summary, null, 2);
  return {
    stdout: `${json}\n`,
    [SUMMARY_PATH]: `${json}\n`,
  };
}
