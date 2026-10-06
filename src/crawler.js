import * as cheerio from 'cheerio';
import { safeFetch, assertPublicUrl } from './safe-fetch.js';
import { runChecks, score, categoryScores } from './checks.js';

const MAX_LINK_CHECKS = 25;

function parseRobots(txt) {
  const groups = [];
  let cur = null, sitemaps = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'disallow' || k === 'allow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
    else if (k === 'sitemap') sitemaps.push(v);
  }
  const pick = groups.find((g) => g.agents.some((a) => a !== '*' && 'scoutbot'.includes(a))) || groups.find((g) => g.agents.includes('*'));
  const allowed = (path) => {
    if (!pick) return true;
    let best = null;
    for (const r of pick.rules) {
      if (!r.path) continue;
      if (path.startsWith(r.path.replace(/\*$/, '')) && (!best || r.path.length >= best.path.length)) best = r;
    }
    return best ? best.allow : true;
  };
  const blocksAll = groups.some((g) => g.agents.includes('*') && g.rules.some((r) => !r.allow && r.path === '/'));
  return { allowed, sitemaps, blocksAll };
}

export async function crawl(inputUrl, onStep = () => {}) {
  let raw = inputUrl.trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const target = await assertPublicUrl(raw);
  const origin = target.origin;

  onStep('Reading robots.txt');
  const robotsRes = await safeFetch(origin + '/robots.txt').catch(() => null);
  const robotsFound = !!robotsRes && robotsRes.status === 200 && !/<html/i.test(robotsRes.body.slice(0, 300));
  const robots = robotsFound ? parseRobots(robotsRes.body) : { allowed: () => true, sitemaps: [], blocksAll: false };
  if (!robots.allowed(target.pathname)) throw new Error('This site\'s robots.txt asks crawlers like ScoutBot not to fetch that page, so we left it alone.');

  onStep('Fetching the page');
  const res = await safeFetch(target.href);
  if (res.status >= 400) throw new Error(`The page returned HTTP ${res.status}.`);
  const ctype = res.headers.get('content-type') || '';
  if (!/html/i.test(ctype)) throw new Error(`That URL is not an HTML page (${ctype || 'unknown type'}).`);

  onStep('Analyzing markup');
  const $ = cheerio.load(res.body);
  const base = res.finalUrl;
  const abs = (h) => { try { return new URL(h, base).href; } catch { return null; } };
  const text = (el) => $(el).text().replace(/\s+/g, ' ').trim();

  const headings = $('h1,h2,h3,h4,h5,h6').map((_, el) => ({ level: +el.tagName[1], text: text(el).slice(0, 120) })).get();
  const headingSkips = [];
  for (let i = 1; i < headings.length; i++) if (headings[i].level - headings[i - 1].level > 1) headingSkips.push(`h${headings[i - 1].level} to h${headings[i].level}`);

  const meta = (n) => ($(`meta[name="${n}"]`).attr('content') || '').trim();
  const prop = (n) => ($(`meta[property="${n}"]`).attr('content') || '').trim();
  const imgs = $('img').get();
  const missing = imgs.filter((i) => $(i).attr('alt') === undefined);
  const baseHost = new URL(base).hostname.replace(/^www\./, '');
  const linkEls = $('a[href]').get();
  const hrefs = new Map();
  let internal = 0, external = 0, empty = 0, vague = 0;
  for (const a of linkEls) {
    const h = ($(a).attr('href') || '').trim();
    if (!h || h === '#' || /^javascript:/i.test(h)) { empty++; continue; }
    if (/^(mailto|tel|sms):/i.test(h) || h.startsWith('#')) continue;
    const u = abs(h);
    if (!u || !/^https?:/.test(u)) continue;
    const host = new URL(u).hostname.replace(/^www\./, '');
    host === baseHost ? internal++ : external++;
    if (/^(click here|read more|here|more|learn more)$/i.test(text(a))) vague++;
    hrefs.set(u.split('#')[0], true);
  }
  const bodyText = (() => { const c = $.root().clone(); const b = cheerio.load(c.html()); b('script,style,noscript,template').remove(); return b('body').text().replace(/\s+/g, ' ').trim(); })();
  const headEls = $('head script[src]').get();

  // sitemap
  onStep('Looking for a sitemap');
  const smCandidates = [...robots.sitemaps, origin + '/sitemap.xml'];
  let sitemap = { found: false };
  for (const s of smCandidates.slice(0, 3)) {
    const r = await safeFetch(s).catch(() => null);
    if (r && r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) { sitemap = { found: true, url: s, urls: (r.body.match(/<loc>/gi) || []).length }; break; }
  }

  // broken links
  onStep('Checking links');
  const toCheck = [...hrefs.keys()].filter((u) => robots.allowed(new URL(u).pathname) || new URL(u).origin !== origin).slice(0, MAX_LINK_CHECKS);
  const results = [];
  const queue = [...toCheck];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      let r = await safeFetch(u, { method: 'HEAD' }).catch(() => null);
      if (!r || r.status === 405 || r.status === 403 || r.status === 501) r = await safeFetch(u, { readBody: false }).catch(() => r);
      results.push({ url: u, status: r ? r.status : 0 });
      await new Promise((ok) => setTimeout(ok, 120));
    }
  }));
  const broken = results.filter((r) => r.status === 0 || r.status === 404 || r.status === 410 || r.status >= 500);

  const page = {
    url: target.href, finalUrl: base, status: res.status, https: new URL(base).protocol === 'https:',
    headers: Object.fromEntries(res.headers.entries()), chain: res.chain, redirects: res.chain.length - 1,
    title: text($('head title').first()), description: meta('description'), lang: ($('html').attr('lang') || '').trim(),
    canonical: ($('link[rel="canonical"]').attr('href') || '').trim(), robotsMeta: meta('robots'), viewport: meta('viewport'),
    og: Object.fromEntries(['og:title', 'og:description', 'og:image'].map((k) => [k, prop(k)])),
    twitterCard: meta('twitter:card'), favicon: !!$('link[rel~="icon"]').length, jsonLd: $('script[type="application/ld+json"]').length,
    h1: $('h1').map((_, el) => text(el)).get().filter(Boolean), headings, headingSkips,
    images: { total: imgs.length, missingAlt: missing.length, missingSamples: missing.slice(0, 3).map((i) => ($(i).attr('src') || '').split('/').pop().slice(0, 40)), noDimensions: imgs.filter((i) => !($(i).attr('width') && $(i).attr('height'))).length, lazy: imgs.filter((i) => $(i).attr('loading') === 'lazy').length },
    links: { internal, external, empty, nonDescriptive: vague },
    brokenLinks: { checked: results.length, broken },
    scripts: { total: $('script[src]').length, blocking: headEls.filter((s) => !$(s).attr('defer') && !$(s).attr('async') && $(s).attr('type') !== 'module').length },
    wordCount: bodyText ? bodyText.split(' ').length : 0, bytes: res.bytes, timing: { ttfbMs: res.ms },
    robotsTxt: { found: robotsFound, blocksAll: robots.blocksAll }, sitemap,
  };
  const findings = runChecks(page);
  return {
    url: page.url, finalUrl: page.finalUrl, host: new URL(page.finalUrl).hostname.replace(/^www\./, ''),
    title: page.title, score: score(findings), categories: categoryScores(findings), findings,
    stats: { responseMs: res.ms, htmlKb: Math.round(res.bytes / 1024), words: page.wordCount, images: imgs.length, links: internal + external, linksChecked: results.length, brokenLinks: broken.length, headings: headings.length },
    outline: headings.slice(0, 40),
  };
}
