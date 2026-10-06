import * as cheerio from 'cheerio';
import { safeFetch, assertPublicUrl } from './safe-fetch.js';
import { runChecks, score, categoryScores } from './checks.js';
import { fetchSignals, trustFindings } from './trust.js';

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


const VOID = /^(img|meta|link|input|br|hr|source)$/i;
const snippet = ($, el) => {
  const html = $.html(el) || '';
  const tag = el.tagName || el.name || '';
  const out = VOID.test(tag) ? html : (html.length > 200 ? html.slice(0, 200) + '...' : html);
  return out.replace(/\s+/g, ' ').slice(0, 260);
};
const whereIs = ($, el) => {
  const bits = [];
  for (const a of $(el).parents().get()) {
    const t = a.tagName; if (!t || t === 'html') continue;
    const role = ($(a).attr('role') || '').toLowerCase();
    const label = `${$(a).attr('id') || ''} ${$(a).attr('class') || ''}`.toLowerCase();
    let name = null;
    if (['header', 'nav', 'footer', 'aside', 'main', 'form', 'head'].includes(t)) name = t;
    else if (['banner', 'navigation', 'contentinfo', 'complementary', 'main'].includes(role)) name = { banner: 'header', navigation: 'nav', contentinfo: 'footer', complementary: 'aside', main: 'main' }[role];
    else if (/(^|[\s_-])(hero|banner|masthead)([\s_-]|$)/.test(label)) name = 'hero';
    else if (/(^|[\s_-])(footer)([\s_-]|$)/.test(label)) name = 'footer';
    else if (/(^|[\s_-])(nav|menu|navbar)([\s_-]|$)/.test(label)) name = 'nav';
    if (name && !bits.includes(name)) bits.unshift(name);
  }
  return bits.slice(-2).join(' > ') || 'page body';
};

export { parseRobots };
export async function crawl(inputUrl, onStep = () => {}, opts = {}) {
  const fast = !!opts.fast; // site-crawl mode: no screenshot, no link probing, shared robots/sitemap
  let raw = inputUrl.trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const target = await assertPublicUrl(raw);
  const origin = target.origin;
  const sigP = !fast || opts.trust ? fetchSignals(target.href, target.hostname) : null; // runs alongside the audit
  // Free screenshot services render off our server (no headless browser on the free instance).
  // Warm the render now, fire and forget, so the image is ready by the time the report opens.
  const shot = `https://image.thum.io/get/width/1200/crop/800/${target.href}`;
  const shotAlt = `https://s0.wp.com/mshots/v1/${encodeURIComponent(target.href)}?w=1200`;
  if (!fast) for (const u of [shot, shotAlt]) fetch(u, { signal: AbortSignal.timeout(8000) }).then((r) => r.body?.cancel()).catch(() => {});

  onStep('Reading robots.txt');
  let robotsFound, robots;
  if (opts.robots) ({ robotsFound, robots } = opts.robots);
  else {
    const robotsRes = await safeFetch(origin + '/robots.txt').catch(() => null);
    robotsFound = !!robotsRes && robotsRes.status === 200 && !/<html/i.test(robotsRes.body.slice(0, 300));
    robots = robotsFound ? parseRobots(robotsRes.body) : { allowed: () => true, sitemaps: [], blocksAll: false };
  }
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
  let sitemap = opts.sitemap || { found: false };
  if (!opts.sitemap) for (const s of smCandidates.slice(0, 3)) {
    const r = await safeFetch(s).catch(() => null);
    if (r && r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) { sitemap = { found: true, url: s, urls: (r.body.match(/<loc>/gi) || []).length }; break; }
  }

  // broken links
  onStep('Checking links');
  const toCheck = fast ? [] : [...hrefs.keys()].filter((u) => robots.allowed(new URL(u).pathname) || new URL(u).origin !== origin).slice(0, MAX_LINK_CHECKS);
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

  const insecure = [];
  if (new URL(base).protocol === 'https:') {
    $('script[src],img[src],iframe[src],link[rel~="stylesheet"][href],source[src],video[src],audio[src]').each((_, el) => {
      const u = ($(el).attr('src') || $(el).attr('href') || '').trim();
      if (/^http:\/\//i.test(u)) insecure.push(u.slice(0, 90));
    });
  }
  const page = {
    mixedContent: insecure.length ? { count: insecure.length, samples: insecure.slice(0, 3) } : null,
    setCookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [],
    url: target.href, finalUrl: base, status: res.status, https: new URL(base).protocol === 'https:',
    headers: Object.fromEntries(res.headers.entries()), chain: res.chain, redirects: res.chain.length - 1,
    title: text($('head title').first()), description: meta('description'), lang: ($('html').attr('lang') || '').trim(),
    canonical: ($('link[rel="canonical"]').attr('href') || '').trim(), robotsMeta: meta('robots'), viewport: meta('viewport'),
    og: Object.fromEntries(['og:title', 'og:description', 'og:image'].map((k) => [k, prop(k)])),
    twitterCard: meta('twitter:card'), favicon: !!$('link[rel~="icon"]').length, jsonLd: $('script[type="application/ld+json"]').length,
    h1: $('h1').map((_, el) => text(el)).get().filter(Boolean), headings, headingSkips,
    images: { total: imgs.length, missingAlt: missing.length, missingSamples: missing.slice(0, 3).map((i) => ($(i).attr('src') || '').split('/').pop().slice(0, 40)), noDimensions: imgs.filter((i) => !($(i).attr('width') && $(i).attr('height'))).length, lazy: imgs.filter((i) => $(i).attr('loading') === 'lazy').length },
    links: { internal, external, empty, nonDescriptive: vague },
    brokenLinks: fast ? null : { checked: results.length, broken },
    scripts: { total: $('script[src]').length, blocking: headEls.filter((s) => !$(s).attr('defer') && !$(s).attr('async') && $(s).attr('type') !== 'module').length },
    wordCount: bodyText ? bodyText.split(' ').length : 0, bytes: res.bytes, timing: { ttfbMs: res.ms },
    robotsTxt: { found: robotsFound, blocksAll: robots.blocksAll }, sitemap,
  };

  // Evidence: the exact element behind a finding, plus where it sits in the page.
  const evidence = {};
  const add = (id, els, max = 3) => { const list = els.slice(0, max).map((el) => ({ html: snippet($, el), where: whereIs($, el) })); if (list.length) evidence[id] = list; };
  add('img-alt', missing);
  add('img-size', imgs.filter((i) => !($(i).attr('width') && $(i).attr('height'))));
  add('title', $('head title').get());
  add('description', $('meta[name="description"]').get());
  if ($('h1').length > 1) add('h1', $('h1').get());
  add('canonical', $('link[rel="canonical"]').get());
  add('noindex', $('meta[name="robots"]').get());
  add('viewport', $('meta[name="viewport"]').get());
  add('link-text', linkEls.filter((a) => /^(click here|read more|here|more|learn more)$/i.test(text(a))));
  add('blocking-js', headEls.filter((x) => !$(x).attr('defer') && !$(x).attr('async') && $(x).attr('type') !== 'module'));
  add('heading-order', $('h1,h2,h3,h4,h5,h6').get().filter((el, i, all) => i > 0 && +el.tagName[1] - +all[i - 1].tagName[1] > 1));
  const brokenSet = new Set(broken.map((b) => b.url));
  add('broken', linkEls.filter((a) => brokenSet.has((abs(($(a).attr('href') || '').trim()) || '').split('#')[0])));
  add('mixed', $('script[src],img[src],iframe[src],link[rel~="stylesheet"][href],source[src],video[src],audio[src]').get().filter((el) => /^http:\/\//i.test(($(el).attr('src') || $(el).attr('href') || '').trim())));
  const base0 = runChecks(page);
  let trust = null;
  if (sigP) {
    const t = trustFindings({ host: new URL(base).hostname, url: base, https: page.https, chain: res.chain, $, text: bodyText, signals: await sigP, snippet, whereIs });
    Object.assign(evidence, t.evidence); base0.push(...t.findings); trust = t.trust;
  }
  const findings = base0.map((x) => (x.severity !== 'pass' && evidence[x.id] ? { ...x, evidence: evidence[x.id] } : x));
  const internalLinks = fast ? [...hrefs.keys()].filter((u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') === baseHost && !/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|css|js|xml|ico|woff2?)$/i.test(x.pathname); } catch { return false; } }).slice(0, 300) : undefined;
  return {
    trust,
    internalLinks,
    url: page.url, finalUrl: page.finalUrl, host: new URL(page.finalUrl).hostname.replace(/^www\./, ''),
    shot, shotAlt, title: page.title, score: score(findings), categories: categoryScores(findings), findings,
    stats: { responseMs: res.ms, htmlKb: Math.round(res.bytes / 1024), words: page.wordCount, images: imgs.length, links: internal + external, linksChecked: results.length, brokenLinks: broken.length, headings: headings.length },
    outline: headings.slice(0, 40),
  };
}
