import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawl } from './crawler.js';
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
    res.json({ id: saveCrawl(report) });
  } catch (e) {
    res.status(422).json({ error: e.message || 'Audit failed.' });
  } finally { inflight--; }
});
app.get('/api/crawl/:id', (req, res) => {
  const r = /^[a-f0-9]{10}$/.test(req.params.id) && getCrawl(req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'Report not found.' });
});
app.get('/api/site/:host', (req, res) => res.json({ host: req.params.host, history: hostHistory(req.params.host.toLowerCase().slice(0, 253)) }));
app.get('/api/recent', (_req, res) => res.json(recent()));

app.use(express.static(pub, { extensions: ['html'] }));
app.get('/crawl/:id', (_req, res) => res.sendFile(path.join(pub, 'report.html')));
app.get('/site/:host', (_req, res) => res.sendFile(path.join(pub, 'site.html')));
app.use((_req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

const port = process.env.PORT || 3000;
if (process.argv[1] === fileURLToPath(import.meta.url)) app.listen(port, () => console.log(`Scout on :${port}`));
export default app;
