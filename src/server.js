import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawl } from './crawler.js';
import { crawlSite } from './site-crawl.js';
import { randomBytes } from 'node:crypto';
import { saveCrawl, getCrawl, hostHistory, recent } from './db.js';

const app = express();
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});

// tiny in-memory rate limit: 6 audits / 10 min / IP
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60_000;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= 6) return true;
  arr.push(now); hits.set(ip, arr); return false;
}
let inflight = 0;

app.post('/api/crawl', async (req, res) => {
  const url = String(req.body?.url || '').slice(0, 2000);
  if (!url) return res.status(400).json({ error: 'Enter a URL to audit.' });
  if (limited(req.ip)) return res.status(429).json({ error: 'Easy there. Six audits per 10 minutes per visitor.' });
  if (inflight >= 4) return res.status(503).json({ error: 'Busy right now. Try again in a few seconds.' });
  inflight++;
  try {
    const report = await crawl(url);
    res.json({ id: await saveCrawl(report) });
  } catch (e) {
    res.status(422).json({ error: e.message || 'Audit failed.' });
  } finally { inflight--; }
});
// Whole-site crawls run as background jobs; the page polls for progress.
const jobs = new Map(), siteHits = new Map();
let siteRunning = 0;
app.post('/api/site-crawl', (req, res) => {
  const url = String(req.body?.url || '').slice(0, 2000);
  if (!url) return res.status(400).json({ error: 'Enter a URL to crawl.' });
  const now = Date.now(), arr = (siteHits.get(req.ip) || []).filter((t) => now - t < 10 * 60_000);
  if (arr.length >= 2) return res.status(429).json({ error: 'Whole-site crawls are limited to two per 10 minutes per visitor.' });
  if (siteRunning >= 1) return res.status(503).json({ error: 'Another site crawl is running. Try again in a minute.' });
  arr.push(now); siteHits.set(req.ip, arr);
  const id = randomBytes(8).toString('hex');
  const job = { status: 'running', progress: { phase: 'Starting' }, started: now };
  jobs.set(id, job); siteRunning++;
  crawlSite(url, (p) => { job.progress = p; })
    .then(async (report) => { job.resultId = await saveCrawl(report); job.status = 'done'; })
    .catch((e) => { job.status = 'error'; job.error = e.message || 'Crawl failed.'; })
    .finally(() => { siteRunning--; setTimeout(() => jobs.delete(id), 15 * 60_000).unref(); });
  res.json({ job: id });
});
app.get('/api/site-crawl/:job', (req, res) => {
  const j = jobs.get(req.params.job);
  if (!j) return res.status(404).json({ error: 'That crawl is no longer tracked. Start a new one.' });
  res.json({ status: j.status, progress: j.progress, id: j.resultId, error: j.error });
});
const wrap = (fn) => (req, res) => fn(req, res).catch(() => res.status(502).json({ error: 'Storage is unavailable right now.' }));
app.get('/api/crawl/:id', wrap(async (req, res) => {
  const r = /^[a-f0-9]{10}$/.test(req.params.id) && await getCrawl(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  let previous = null;
  try {
    const cands = (await hostHistory(r.host)).filter((h) => h.id !== r.id && h.createdAt < r.createdAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    let full = null;
    for (const c of cands) { const x = await getCrawl(c.id); if (x && (x.type === 'site') === (r.type === 'site')) { full = x; break; } }
    if (full) previous = { id: full.id, score: full.score, categories: full.categories, createdAt: full.createdAt };
  } catch { /* diff is optional */ }
  res.json({ ...r, previous });
}));
app.get('/api/site/:host', wrap(async (req, res) => {
  const host = req.params.host.toLowerCase().slice(0, 253);
  res.json({ host, history: await hostHistory(host) });
}));
app.get('/api/recent', wrap(async (_req, res) => res.json(await recent())));

app.use(express.static(pub, { extensions: ['html'] }));
app.get('/crawl/:id', (_req, res) => res.sendFile(path.join(pub, 'report.html')));
app.get('/site/:host', (_req, res) => res.sendFile(path.join(pub, 'site.html')));
app.use((_req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

const port = process.env.PORT || 3000;
if (process.argv[1] === fileURLToPath(import.meta.url)) app.listen(port, () => console.log(`Scout on :${port}`));
export default app;
