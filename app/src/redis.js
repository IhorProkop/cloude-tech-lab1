const { createClient } = require('redis');

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
  client.on('error', (err) => console.error('Store Redis error:', err.message));
  client.connect().catch((err) => console.error('Store Redis connect failed:', err.message));
}

function isReady() {
  return Boolean(client?.isReady);
}

async function close() {
  if (!client?.isOpen) return;
  if (client.isReady) {
    await client.close();
    return;
  }
  client.destroy();
}

module.exports = { client, isReady, close };
