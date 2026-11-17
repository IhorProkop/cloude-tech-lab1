const NAMESPACE = process.env.METRICS_NAMESPACE || '';
const FLUSH_INTERVAL_MS = 10000;
const MAX_VALUES_PER_EVENT = 100;

const buffers = new Map();
let timer = null;

function bufferFor(metric, dimensionName, dimensionValue, unit) {
  const id = `${metric}|${dimensionName}|${dimensionValue}`;
  let buffer = buffers.get(id);
  if (!buffer) {
    buffer = { metric, dimensionName, dimensionValue, unit, values: [] };
    buffers.set(id, buffer);
  }
  return buffer;
}

function emit(buffer, values) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [[buffer.dimensionName]],
            Metrics: [{ Name: buffer.metric, Unit: buffer.unit }],
          },
        ],
      },
      [buffer.dimensionName]: buffer.dimensionValue,
      [buffer.metric]: values,
    })
  );
}

function flush() {
  for (const buffer of buffers.values()) {
    while (buffer.values.length > 0) {
      emit(buffer, buffer.values.splice(0, MAX_VALUES_PER_EVENT));
    }
  }
}

function record(metric, dimensionName, dimensionValue, value, unit = 'Milliseconds') {
  if (!NAMESPACE) return;
  bufferFor(metric, dimensionName, dimensionValue, unit).values.push(Math.round(value * 100) / 100);
  if (!timer) {
    timer = setInterval(flush, FLUSH_INTERVAL_MS);
    timer.unref();
  }
}

function trackLatency(route) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      record('Latency', 'Route', route, ms);
    });
    next();
  };
}

module.exports = { record, trackLatency, flush };
