const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const queueUrl = process.env.QUEUE_URL || '';
const enabled = Boolean(queueUrl);
const sqs = enabled ? new SQSClient({ maxAttempts: 2 }) : null;

async function send(message) {
  const result = await sqs.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) })
  );
  return result.MessageId;
}

function destroy() {
  if (sqs) sqs.destroy();
}

module.exports = { enabled, send, destroy };
