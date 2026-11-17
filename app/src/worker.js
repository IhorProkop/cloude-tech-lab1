const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand,
} = require('@aws-sdk/client-sqs');
const { pool } = require('./db');
const cache = require('./cache');
const store = require('./redis');
const jobs = require('./jobs');
const idempotency = require('./idempotency');
const metrics = require('./metrics');
const { createTask } = require('./tasks');

const QUEUE_URL = process.env.QUEUE_URL;
const BATCH_SIZE = Math.min(Math.max(Number(process.env.WORKER_BATCH_SIZE) || 10, 1), 10);
const CONCURRENCY = Math.max(Number(process.env.WORKER_CONCURRENCY) || BATCH_SIZE, 1);
const MAX_RECEIVE_COUNT = Number(process.env.QUEUE_MAX_RECEIVE_COUNT) || 5;
const WAIT_TIME_SECONDS = 20;
const RETRY_BASE_SECONDS = 5;
const RETRY_MAX_SECONDS = 300;
const SHUTDOWN_TIMEOUT_MS = 25000;

if (!QUEUE_URL) {
  console.error('QUEUE_URL is required');
  process.exit(1);
}

const sqs = new SQSClient({});
const pollAbort = new AbortController();
let running = true;
let loopDone = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parse(message) {
  const payload = JSON.parse(message.Body);
  if (
    !jobs.isValidId(payload.jobId) ||
    typeof payload.title !== 'string' ||
    payload.title.trim() === '' ||
    typeof payload.author !== 'string'
  ) {
    throw new Error('Invalid message payload');
  }
  return payload;
}

function retryDelaySeconds(receiveCount) {
  return Math.min(RETRY_BASE_SECONDS * 2 ** (receiveCount - 1), RETRY_MAX_SECONDS);
}

async function processMessage(message) {
  const receiveCount = Number(message.Attributes?.ApproximateReceiveCount) || 1;
  let payload = null;
  try {
    payload = parse(message);
    const result = await idempotency.run(
      'job',
      payload.jobId,
      idempotency.fingerprint('job', payload),
      async () => ({ status: 201, body: await createTask(payload.title, payload.author) })
    );
    await jobs.update(payload.jobId, {
      status: 'done',
      taskId: result.body.id,
      attempts: receiveCount,
      duplicate: result.replayed,
    });
    if (result.replayed) {
      console.log(`Job ${payload.jobId} already processed, task ${result.body.id}, attempt ${receiveCount}`);
    }
    const sentAt = Number(message.Attributes?.SentTimestamp);
    if (sentAt) metrics.record('JobLatency', 'Service', 'worker', Date.now() - sentAt);
    metrics.record('JobsProcessed', 'Service', 'worker', 1, 'Count');
    return true;
  } catch (err) {
    console.error(`Message ${message.MessageId} attempt ${receiveCount} failed: ${err.message}`);
    if (payload && receiveCount >= MAX_RECEIVE_COUNT) {
      await jobs
        .update(payload.jobId, { status: 'failed', error: err.message, attempts: receiveCount })
        .catch((updateErr) => console.error('Job status update failed:', updateErr.message));
    }
    await sqs
      .send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: retryDelaySeconds(receiveCount),
        })
      )
      .catch((visErr) => console.error('ChangeMessageVisibility failed:', visErr.message));
    metrics.record('JobsFailed', 'Service', 'worker', 1, 'Count');
    return false;
  }
}

async function processBatch(messages) {
  const succeeded = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(CONCURRENCY, messages.length) }, async () => {
    while (next < messages.length) {
      const message = messages[next];
      next += 1;
      if (await processMessage(message)) succeeded.push(message);
    }
  });
  await Promise.all(lanes);
  if (succeeded.length === 0) return;

  const result = await sqs.send(
    new DeleteMessageBatchCommand({
      QueueUrl: QUEUE_URL,
      Entries: succeeded.map((message, index) => ({
        Id: String(index),
        ReceiptHandle: message.ReceiptHandle,
      })),
    })
  );
  for (const failure of result.Failed || []) {
    console.error(`Delete failed for entry ${failure.Id}: ${failure.Code} ${failure.Message}`);
  }
}

async function pollLoop() {
  console.log(`Worker started: batch ${BATCH_SIZE}, concurrency ${CONCURRENCY}`);
  while (running) {
    let messages;
    try {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: QUEUE_URL,
          MaxNumberOfMessages: BATCH_SIZE,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          MessageSystemAttributeNames: ['ApproximateReceiveCount', 'SentTimestamp'],
        }),
        { abortSignal: pollAbort.signal }
      );
      messages = result.Messages || [];
    } catch (err) {
      if (!running) break;
      console.error('ReceiveMessage failed:', err.message);
      await sleep(1000);
      continue;
    }
    if (messages.length === 0) continue;
    try {
      await processBatch(messages);
    } catch (err) {
      console.error('Batch processing failed:', err.message);
    }
  }
}

async function closeConnections() {
  metrics.flush();
  const results = await Promise.allSettled([pool.end(), cache.close(), store.close()]);
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => console.error('Shutdown error:', result.reason));
  sqs.destroy();
}

async function shutdown(signal) {
  if (!running) return;
  running = false;
  console.log(`${signal} received, finishing in-flight messages`);
  setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  pollAbort.abort();
  await loopDone;
  await closeConnections();
  console.log('Worker stopped');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

loopDone = pollLoop();
