// Whole-site crawl: discover same-origin pages, audit each one politely, roll results up.
import { crawl, parseRobots } from './crawler.js';
import { safeFetch, assertPublicUrl } from './safe-fetch.js';

export const LIMITS = { pages: 50, ms: 110_000, delayMs: 250 };
const norm = (u) => { const x = new URL(u); x.hash = ''; if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, ''); return x.href; };
const sameSite = (a, b) => new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const LABELS = { 'img-alt': 'Images missing alt text', 'img-size': 'Images without width and height', 'link-text': 'Vague link text', 'links-count': 'Link counts', content: 'Thin content', broken: 'Broken links', title: 'Title length', description: 'Meta description length', h1: 'H1 problems', 'heading-order': 'Heading levels skipped', 'blocking-js': 'Render-blocking scripts', 'script-count': 'Many script tags', redirects: 'Redirect chains', mixed: 'Insecure (http://) resources', cookies: 'Cookies with weak flags', size: 'Heavy HTML', ttfb: 'Slow server response', 'img-lazy': 'Images not lazy-loaded' };
const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);

async function sitemapUrls(origin, robots, base) {
  const out = [];
  let info = { found: false };
  for (const s of [...robots.sitemaps, origin + '/sitemap.xml'].slice(0, 3)) {
    const r = await safeFetch(s).catch(() => null);
    if (!r || r.status !== 200 || !/<(urlset|sitemapindex)/i.test(r.body)) continue;
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
    info = { found: true, url: s, urls: locs.length };
    if (!/<sitemapindex/i.test(r.body)) for (const l of locs) { try { if (sameSite(l, base)) out.push(norm(l)); } catch { /* skip */ } }
    break;
  }
  return { urls: out.slice(0, 200), info };
}

export async function crawlSite(inputUrl, onProgress = () => {}, limits = LIMITS) {
  let raw = inputUrl.trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const start = await assertPublicUrl(raw);
  const origin = start.origin;
  const t0 = Date.now();

  onProgress({ phase: 'Reading robots.txt and sitemap' });
  const rr = await safeFetch(origin + '/robots.txt').catch(() => null);
  const robotsFound = !!rr && rr.status === 200 && !/<html/i.test(rr.body.slice(0, 300));
  const robots = robotsFound ? parseRobots(rr.body) : { allowed: () => true, sitemaps: [], blocksAll: false };
  const sm = await sitemapUrls(origin, robots, start.href);
  const shared = { robots: { robotsFound, robots }, sitemap: sm.info, fast: true };

  const queue = [norm(start.href)];
  const seen = new Set(queue);
  const enqueue = (u) => { try { const n = norm(u); if (!seen.has(n) && sameSite(n, start.href) && robots.allowed(new URL(n).pathname)) { seen.add(n); queue.push(n); } } catch { /* skip */ } };
  sm.urls.forEach(enqueue);

  const pages = [], skipped = [], issues = new Map(), titles = new Map(), descs = new Map();
  const sums = {}; let capped = null, trust = null;
  while (queue.length) {
    if (pages.length >= limits.pages) { capped = 'page limit'; break; }
    if (Date.now() - t0 > limits.ms) { capped = 'time limit'; break; }
    const url = queue.shift();
    onProgress({ phase: 'Auditing pages', done: pages.length, total: Math.min(limits.pages, pages.length + queue.length + 1), current: new URL(url).pathname || '/' });
    try {
      const r = await crawl(url, () => {}, { ...shared, trust: !trust });
      const counts = { critical: 0, warning: 0, info: 0 };
      for (const f of r.findings) {
        if (f.severity === 'pass') continue;
        counts[f.severity]++;
        const key = f.id;
        const rec = issues.get(key) || { id: f.id, category: f.category, severity: f.severity, title: LABELS[f.id] || f.title, fix: f.fix, pages: 0, sample: [] };
        if (f.severity === 'critical') rec.severity = 'critical';
        rec.pages++; if (rec.sample.length < 3) rec.sample.push(new URL(r.finalUrl).pathname || '/');
        issues.set(key, rec);
      }
      if (r.trust && !trust) trust = r.trust;
      for (const [k, v] of Object.entries(r.categories)) (sums[k] ||= []).push(v);
      const path = new URL(r.finalUrl).pathname || '/';
      pages.push({ url: r.finalUrl, path, title: r.title, score: r.score, counts, ms: r.stats.responseMs, words: r.stats.words });
      if (r.title) titles.set(r.title, [...(titles.get(r.title) || []), path]);
      const d = r.findings.find((f) => f.id === 'description');
      if (d) descs.set(d.detail, [...(descs.get(d.detail) || []), path]);
      if (pages.length === 1 || pages.length < 8) (r.internalLinks || []).forEach(enqueue); else (r.internalLinks || []).slice(0, 60).forEach(enqueue);
    } catch (e) {
      skipped.push({ path: new URL(url).pathname || '/', reason: String(e.message || 'failed').slice(0, 120) });
    }
    await sleep(limits.delayMs);
  }
  if (!capped && queue.length) capped = 'page limit';

  // duplicate titles across pages (site-level finding)
  const dupes = [...titles.entries()].filter(([, p]) => p.length > 1);
  if (dupes.length) issues.set('dup-title', { id: 'dup-title', category: 'SEO', severity: 'warning', title: 'Duplicate page titles', fix: 'Give every page its own title that describes that page.', pages: dupes.reduce((s, [, p]) => s + p.length, 0), sample: dupes[0][1].slice(0, 3) });
  if (!pages.length) throw new Error(skipped[0]?.reason || 'No pages could be crawled.');

  const totals = pages.reduce((t, p) => ({ critical: t.critical + p.counts.critical, warning: t.warning + p.counts.warning, info: t.info + p.counts.info }), { critical: 0, warning: 0, info: 0 });
  const host = new URL(pages[0].url).hostname.replace(/^www\./, '');
  const order = { critical: 0, warning: 1, info: 2 };
  return {
    type: 'site', url: pages[0].url, finalUrl: pages[0].url, host,
    title: `Site crawl: ${host} (${pages.length} page${pages.length > 1 ? 's' : ''})`,
    score: avg(pages.map((p) => p.score)),
    categories: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, avg(v)])),
    findings: [], stats: { pages: pages.length, ...totals, skipped: skipped.length, seconds: Math.round((Date.now() - t0) / 1000), sitemap: sm.info.found ? sm.info.urls : 0 },
    trust, capped, limits: { pages: limits.pages, seconds: Math.round(limits.ms / 1000) },
    pages: pages.sort((a, b) => a.score - b.score),
    issues: [...issues.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.pages - a.pages).slice(0, 60),
    skipped: skipped.slice(0, 20),
  };
}
