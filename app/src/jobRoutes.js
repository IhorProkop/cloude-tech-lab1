const express = require('express');
const jobs = require('./jobs');

const router = express.Router();

router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!jobs.isValidId(id)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const job = await jobs.get(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'done' && job.taskId) job.task = `/tasks/${job.taskId}`;
    res.set('Cache-Control', 'no-store');
    res.json(job);
  } catch (err) {
    if (err instanceof jobs.JobStoreError) {
      console.error(err.message);
      res.set('Retry-After', '1');
      return res.status(503).json({ error: 'Job store unavailable' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
