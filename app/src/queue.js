const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');

const queueUrl = process.env.QUEUE_URL || '';
const enabled = Boolean(queueUrl);
const sqs = enabled ? new SQSClient({ maxAttempts: 2 }) : null;
const MAX_BATCH_SIZE = 10;
const BATCH_WAIT_MS = Number(process.env.QUEUE_BATCH_WAIT_MS ?? 10);

const pending = [];
let timer = null;

async function sendBatch(batch) {
  try {
    const result = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((item, index) => ({ Id: String(index), MessageBody: item.body })),
      })
    );
    const failed = new Map((result.Failed || []).map((entry) => [entry.Id, entry]));
    const succeeded = new Map((result.Successful || []).map((entry) => [entry.Id, entry]));
    batch.forEach((item, index) => {
      const failure = failed.get(String(index));
      if (failure) item.reject(new Error(`SendMessageBatch entry failed: ${failure.Code}`));
      else item.resolve(succeeded.get(String(index))?.MessageId);
    });
  } catch (err) {
    batch.forEach((item) => item.reject(err));
  }
}

function flush() {
  clearTimeout(timer);
  timer = null;
  while (pending.length > 0) {
    sendBatch(pending.splice(0, MAX_BATCH_SIZE));
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    pending.push({ body: JSON.stringify(message), resolve, reject });
    if (pending.length >= MAX_BATCH_SIZE) flush();
    else if (!timer) timer = setTimeout(flush, BATCH_WAIT_MS);
  });
}

function destroy() {
  flush();
  if (sqs) sqs.destroy();
}

module.exports = { enabled, send, destroy };
