import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_USER = __ENV.AUTH_USER || 'admin';
const AUTH_PASSWORD = __ENV.AUTH_PASSWORD || '';
const RATE = Number(__ENV.RATE || 50);
const RAMP_UP = __ENV.RAMP_UP || '2m';
const STEADY = __ENV.STEADY || '5m';
const DRAIN = __ENV.DRAIN || __ENV.RAMP_DOWN || '3m';
const OBSERVERS = Number(__ENV.OBSERVERS || 2);
const POLL_INTERVAL = Number(__ENV.POLL_INTERVAL || 1);
const JOB_TIMEOUT_SECONDS = Number(__ENV.JOB_TIMEOUT_SECONDS || 900);
const RUN_NAME = __ENV.RUN_NAME || 'queue-local';
const SUMMARY_PATH = __ENV.SUMMARY_PATH || `results/${RUN_NAME}.json`;

const PHASES = ['ramp-up', 'steady', 'drain'];

const accepted = new Rate('post_async_accepted');
const sentWrites = new Counter('post_async_sent');
const postAsync = new Trend('endpoint_post_tasks_async', true);
const postAsyncByPhase = Object.fromEntries(
  PHASES.map((phase) => [phase, new Trend(`endpoint_post_tasks_async_${phase.replace('-', '_')}`, true)])
);
const jobCompletion = new Trend('job_completion', true);
const jobCompletionByPhase = Object.fromEntries(
  PHASES.map((phase) => [phase, new Trend(`job_completion_${phase.replace('-', '_')}`, true)])
);
const jobsDone = new Counter('jobs_done');
const jobsFailed = new Counter('jobs_failed');
const jobsTimedOut = new Counter('jobs_timed_out');
const jobDuplicates = new Counter('jobs_duplicate_delivery');

function parseDuration(value) {
  const unitSeconds = { h: 3600, m: 60, s: 1 };
  let seconds = 0;
  for (const [, amount, unit] of value.matchAll(/(\d+)([hms])/g)) {
    seconds += Number(amount) * unitSeconds[unit];
  }
  return seconds;
}

const rampUpSeconds = parseDuration(RAMP_UP);
const steadySeconds = parseDuration(STEADY);
const drainSeconds = parseDuration(DRAIN);
const totalSeconds = rampUpSeconds + steadySeconds + drainSeconds;

export const options = {
  scenarios: {
    writers: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(20, RATE),
      maxVUs: Math.max(100, RATE * 4),
      stages: [
        { duration: RAMP_UP, target: RATE },
        { duration: STEADY, target: RATE },
        { duration: '1s', target: 0 },
        { duration: DRAIN, target: 0 },
      ],
      exec: 'write',
    },
    observers: {
      executor: 'constant-vus',
      vus: OBSERVERS,
      duration: `${totalSeconds}s`,
      exec: 'observe',
    },
  },
  thresholds: {
    post_async_accepted: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function phaseAt(startedAt) {
  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
  if (elapsed < rampUpSeconds) return 'ramp-up';
  if (elapsed < rampUpSeconds + steadySeconds) return 'steady';
  return 'drain';
}

function postAsyncTask(data, title) {
  const phase = phaseAt(data.startedAt);
  const res = http.post(`${BASE_URL}/tasks/async`, JSON.stringify({ title }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
    tags: { name: 'POST /tasks/async', phase },
  });
  sentWrites.add(1);
  postAsync.add(res.timings.duration);
  postAsyncByPhase[phase].add(res.timings.duration);
  const ok = res.status === 202;
  accepted.add(ok);
  check(res, {
    'POST /tasks/async is 202': () => ok,
    'POST /tasks/async has Location': (r) => ok && String(r.headers.Location || '').startsWith('/jobs/'),
  });
  return { ok, phase, jobId: ok ? res.json('jobId') : null };
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

export function write(data) {
  postAsyncTask(data, `k6 ${RUN_NAME} writer vu ${__VU} iteration ${__ITER}`);
}

export function observe(data) {
  const sent = postAsyncTask(data, `k6 ${RUN_NAME} observer vu ${__VU} iteration ${__ITER}`);
  if (!sent.ok) {
    sleep(POLL_INTERVAL);
    return;
  }
  const started = Date.now();
  while ((Date.now() - started) / 1000 < JOB_TIMEOUT_SECONDS) {
    sleep(POLL_INTERVAL);
    const res = http.get(`${BASE_URL}/jobs/${sent.jobId}`, { tags: { name: 'GET /jobs/:id' } });
    if (res.status !== 200) continue;
    const job = res.json();
    if (job.status === 'done') {
      const elapsed = Date.now() - started;
      jobCompletion.add(elapsed);
      jobCompletionByPhase[sent.phase].add(elapsed);
      jobsDone.add(1);
      if (job.duplicate) jobDuplicates.add(1);
      check(job, { 'job done has taskId': (j) => Number.isInteger(j.taskId) });
      return;
    }
    if (job.status === 'failed') {
      jobsFailed.add(1);
      return;
    }
  }
  jobsTimedOut.add(1);
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

function count(metric) {
  return metric ? metric.values.count : 0;
}

function phaseTimes(startedAt) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const steadyStart = start + rampUpSeconds * 1000;
  const drainStart = steadyStart + steadySeconds * 1000;
  return {
    rampUpStart: new Date(start).toISOString(),
    steadyStart: new Date(steadyStart).toISOString(),
    drainStart: new Date(drainStart).toISOString(),
    end: new Date(drainStart + drainSeconds * 1000).toISOString(),
  };
}

export function handleSummary(data) {
  const m = data.metrics;
  const metricName = (prefix, phase) => `${prefix}_${phase.replace('-', '_')}`;
  const summary = {
    run: RUN_NAME,
    ratePerSecond: RATE,
    stages: { rampUp: RAMP_UP, steady: STEADY, drain: DRAIN },
    observers: OBSERVERS,
    phasesUtc: phaseTimes(data.setup_data && data.setup_data.startedAt),
    durationSeconds: round(data.state.testRunDurationMs / 1000),
    requests: m.http_reqs.values.count,
    requestsPerSecond: round(m.http_reqs.values.rate),
    asyncWrites: count(m.post_async_sent),
    asyncAcceptedRate: m.post_async_accepted ? m.post_async_accepted.values.rate : null,
    httpErrorRate: m.http_req_failed.values.rate,
    checksPassRate: m.checks ? m.checks.values.rate : null,
    postAsyncLatencyMs: percentiles(m.endpoint_post_tasks_async),
    postAsyncLatencyByPhaseMs: Object.fromEntries(
      PHASES.map((phase) => [phase, percentiles(m[metricName('endpoint_post_tasks_async', phase)])])
    ),
    jobCompletionMs: percentiles(m.job_completion),
    jobCompletionByPhaseMs: Object.fromEntries(
      PHASES.map((phase) => [phase, percentiles(m[metricName('job_completion', phase)])])
    ),
    observedJobs: {
      done: count(m.jobs_done),
      failed: count(m.jobs_failed),
      timedOut: count(m.jobs_timed_out),
      duplicateDeliveries: count(m.jobs_duplicate_delivery),
    },
  };
  const json = JSON.stringify(summary, null, 2);
  return {
    stdout: `${json}\n`,
    [SUMMARY_PATH]: `${json}\n`,
  };
}
