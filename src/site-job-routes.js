import { Router } from 'express';

export function siteJobRoutes(jobs) {
  const router = Router(), hits = new Map();
  router.post('/', async (req, res) => {
    const url = String(req.body?.url || '').slice(0, 2000);
    if (!url) return res.status(400).json({ error: 'Enter a URL to crawl.' });
    const now = Date.now(), arr = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60_000);
    if (arr.length >= 2) return res.status(429).json({ error: 'Whole-site crawls are limited to two per 10 minutes per visitor.' });
    try {
      const id = await jobs.start(url);
      if (!id) return res.status(503).json({ error: 'Another site crawl is running. Try again in a minute.' });
      arr.push(now); hits.set(req.ip, arr);
      res.json({ job: id });
    } catch { res.status(502).json({ error: 'Storage is unavailable right now.' }); }
  });
  router.get('/:job', async (req, res) => {
    try {
      const j = await jobs.get(req.params.job);
      if (!j) return res.status(404).json({ error: 'That crawl is no longer tracked. Start a new one.' });
      res.json({ status: j.status, progress: j.progress, id: j.resultId, error: j.error });
    } catch { res.status(502).json({ error: 'Storage is unavailable right now.' }); }
  });
  return router;
}
