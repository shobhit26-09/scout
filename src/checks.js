// Deterministic rule checks. Each returns findings: {id, category, severity, title, detail, fix}
// severity: critical | warning | info | pass

const f = (id, category, severity, title, detail, fix = '') => ({ id, category, severity, title, detail, fix });

export function runChecks(p) {
  const out = [];

  // --- Security / transport
  out.push(p.https
    ? f('https', 'Security', 'pass', 'Served over HTTPS', 'The page loads on an encrypted connection.')
    : f('https', 'Security', 'critical', 'Not served over HTTPS', 'Browsers flag HTTP pages as "Not secure" and Google treats HTTPS as a ranking signal.', 'Install a TLS certificate (free via Let\'s Encrypt) and 301-redirect all HTTP traffic to HTTPS.'));
  if (p.https) {
    out.push(p.headers['strict-transport-security']
      ? f('hsts', 'Security', 'pass', 'HSTS enabled', p.headers['strict-transport-security'])
      : f('hsts', 'Security', 'info', 'No Strict-Transport-Security header', 'Without HSTS, a first visit can still be downgraded to HTTP.', 'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.'));
  }

  // --- Title
  const tl = p.title.length;
  if (!tl) out.push(f('title', 'SEO', 'critical', 'Missing <title>', 'Search engines use the title as the headline of your result.', 'Add a unique <title> of 30-60 characters that leads with the page topic.'));
  else if (tl < 30) out.push(f('title', 'SEO', 'warning', `Title is short (${tl} chars)`, `"${p.title}"`, 'Expand to 30-60 characters with the main keyword and brand.'));
  else if (tl > 60) out.push(f('title', 'SEO', 'warning', `Title is long (${tl} chars)`, `"${p.title}" will likely be truncated in results.`, 'Trim to 60 characters or fewer, keeping the key phrase first.'));
  else out.push(f('title', 'SEO', 'pass', `Title length is good (${tl} chars)`, `"${p.title}"`));

  // --- Meta description
  const dl = p.description.length;
  if (!dl) out.push(f('description', 'SEO', 'critical', 'Missing meta description', 'Without one, search engines pick random page text as your snippet.', 'Add <meta name="description" content="..."> of 70-160 characters that sells the click.'));
  else if (dl < 70) out.push(f('description', 'SEO', 'warning', `Meta description is short (${dl} chars)`, p.description, 'Aim for 70-160 characters.'));
  else if (dl > 160) out.push(f('description', 'SEO', 'warning', `Meta description is long (${dl} chars)`, 'It will be cut off in search results.', 'Trim to 160 characters or fewer.'));
  else out.push(f('description', 'SEO', 'pass', `Meta description length is good (${dl} chars)`, p.description));

  // --- Headings
  if (p.h1.length === 0) out.push(f('h1', 'SEO', 'critical', 'No <h1> heading', 'The h1 tells users and crawlers what the page is about.', 'Add exactly one <h1> that describes the page.'));
  else if (p.h1.length > 1) out.push(f('h1', 'SEO', 'warning', `${p.h1.length} <h1> headings`, p.h1.slice(0, 3).map((x) => `"${x}"`).join(', '), 'Keep one <h1> and demote the others to <h2>.'));
  else out.push(f('h1', 'SEO', 'pass', 'Exactly one <h1>', `"${p.h1[0]}"`));
  if (p.headingSkips.length) out.push(f('heading-order', 'Accessibility', 'warning', 'Heading levels skip', `Found jumps like ${p.headingSkips.slice(0, 3).join(', ')}.`, 'Do not skip levels: go h1 > h2 > h3 so screen readers can build an outline.'));
  else if (p.h1.length) out.push(f('heading-order', 'Accessibility', 'pass', 'Heading hierarchy is in order', ''));

  // --- Canonical / robots meta
  out.push(p.canonical
    ? f('canonical', 'SEO', 'pass', 'Canonical URL set', p.canonical)
    : f('canonical', 'SEO', 'warning', 'No canonical link', 'Duplicate URLs (tracking params, www vs non-www) can split ranking signals.', 'Add <link rel="canonical" href="https://your-site/page"> to each page.'));
  if (/noindex/i.test(p.robotsMeta)) out.push(f('noindex', 'SEO', 'critical', 'Page is set to noindex', `robots meta: ${p.robotsMeta}`, 'Remove noindex if you want this page to appear in search.'));

  // --- Language, viewport, charset
  out.push(p.lang ? f('lang', 'Accessibility', 'pass', `Language declared (${p.lang})`, '') : f('lang', 'Accessibility', 'warning', 'No lang attribute on <html>', 'Screen readers and translation tools guess the language.', 'Add <html lang="en"> (or your language code).'));
  out.push(p.viewport ? f('viewport', 'Mobile', 'pass', 'Mobile viewport tag present', p.viewport) : f('viewport', 'Mobile', 'critical', 'Missing viewport meta tag', 'Mobile browsers will render a zoomed-out desktop layout.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'));

  // --- Social
  const og = ['og:title', 'og:description', 'og:image'].filter((k) => !p.og[k]);
  out.push(og.length === 0 ? f('og', 'Social', 'pass', 'Open Graph tags complete', '')
    : f('og', 'Social', og.length === 3 ? 'warning' : 'info', `Open Graph incomplete (missing ${og.join(', ')})`, 'Shared links on WhatsApp, LinkedIn and Slack will look bare.', 'Add the missing og: meta tags. Use a 1200x630 image for og:image.'));
  out.push(p.twitterCard ? f('twitter', 'Social', 'pass', 'Twitter/X card set', p.twitterCard) : f('twitter', 'Social', 'info', 'No twitter:card tag', '', 'Add <meta name="twitter:card" content="summary_large_image">.'));
  out.push(p.favicon ? f('favicon', 'Social', 'pass', 'Favicon declared', '') : f('favicon', 'Social', 'info', 'No favicon link', 'Tabs and bookmarks show a blank icon.', 'Add <link rel="icon" href="/favicon.ico"> or an SVG icon.'));
  out.push(p.jsonLd > 0 ? f('jsonld', 'SEO', 'pass', `Structured data found (${p.jsonLd} block${p.jsonLd > 1 ? 's' : ''})`, '') : f('jsonld', 'SEO', 'info', 'No structured data (JSON-LD)', 'Rich results (ratings, FAQs, breadcrumbs) need schema.org markup.', 'Add a <script type="application/ld+json"> block, starting with Organization or WebSite.'));

  // --- Images
  if (p.images.total) {
    const m = p.images.missingAlt;
    out.push(m === 0 ? f('img-alt', 'Accessibility', 'pass', `All ${p.images.total} images have alt text`, '')
      : f('img-alt', 'Accessibility', m / p.images.total > 0.5 ? 'critical' : 'warning', `${m} of ${p.images.total} images have no alt text`, p.images.missingSamples.slice(0, 3).join(', '), 'Add a short descriptive alt attribute. Use alt="" for purely decorative images.'));
    if (p.images.noDimensions > 3) out.push(f('img-size', 'Performance', 'info', `${p.images.noDimensions} images lack width/height`, 'Missing dimensions cause layout shift while images load.', 'Set width and height attributes (or CSS aspect-ratio) on every <img>.'));
    if (p.images.total > 8 && p.images.lazy === 0) out.push(f('img-lazy', 'Performance', 'info', 'No lazy-loaded images', `${p.images.total} images load up front.`, 'Add loading="lazy" to below-the-fold images.'));
  }

  // --- Links
  out.push(f('links-count', 'Links', 'info', `${p.links.internal} internal and ${p.links.external} external links`, p.links.empty ? `${p.links.empty} links have empty or "#" hrefs.` : ''));
  if (p.links.nonDescriptive > 0) out.push(f('link-text', 'Accessibility', 'info', `${p.links.nonDescriptive} links use vague text`, 'Text like "click here" or "read more" says nothing out of context.', 'Use link text that describes the destination.'));
  if (p.brokenLinks) {
    const b = p.brokenLinks.broken;
    out.push(b.length === 0 ? f('broken', 'Links', 'pass', `No broken links in ${p.brokenLinks.checked} checked`, '')
      : f('broken', 'Links', 'critical', `${b.length} broken link${b.length > 1 ? 's' : ''}`, b.slice(0, 5).map((x) => `${x.status || 'ERR'} ${x.url}`).join('\n'), 'Fix or remove these links, or add 301 redirects to the new locations.'));
  }

  // --- Content
  if (p.wordCount < 150) out.push(f('content', 'SEO', p.wordCount < 50 ? 'warning' : 'info', `Thin content (${p.wordCount} words)`, 'Pages with very little text rarely rank. If this is a JavaScript app, crawlers may only see an empty shell.', 'Add useful text, or prerender the page so its content is in the raw HTML.'));
  else out.push(f('content', 'SEO', 'pass', `${p.wordCount} words of text`, ''));

  // --- Performance
  const ms = p.timing.ttfbMs;
  out.push(ms < 600 ? f('ttfb', 'Performance', 'pass', `Fast response (${ms} ms)`, 'Time for the server to return the full HTML.')
    : ms < 1500 ? f('ttfb', 'Performance', 'warning', `Slow response (${ms} ms)`, 'Aim for under 600 ms.', 'Add caching or a CDN, and check slow database queries.')
    : f('ttfb', 'Performance', 'critical', `Very slow response (${ms} ms)`, 'Visitors and crawlers will give up on slow pages.', 'Add caching or a CDN in front of the origin and profile the server.'));
  const kb = Math.round(p.bytes / 1024);
  out.push(kb < 500 ? f('size', 'Performance', 'pass', `HTML size is ${kb} KB`, '') : f('size', 'Performance', kb > 1500 ? 'critical' : 'warning', `HTML is heavy (${kb} KB)`, 'Large documents delay first paint.', 'Move inline scripts and data to cached files, and paginate long lists.'));
  const comp = p.headers['content-encoding'];
  out.push(comp ? f('compression', 'Performance', 'pass', `Compression on (${comp})`, '') : f('compression', 'Performance', kb > 20 ? 'warning' : 'info', 'Response is not compressed', 'Text compresses 70-90%.', 'Enable gzip or brotli on your server or CDN.'));
  if (p.scripts.blocking > 3) out.push(f('blocking-js', 'Performance', 'warning', `${p.scripts.blocking} render-blocking scripts in <head>`, '', 'Add defer or async to scripts, or move them to the end of <body>.'));
  if (p.scripts.total > 20) out.push(f('script-count', 'Performance', 'info', `${p.scripts.total} script tags`, '', 'Bundle and remove unused third-party scripts.'));
  if (p.redirects > 1) out.push(f('redirects', 'Performance', 'warning', `${p.redirects} redirects before the page`, p.chain.map((c) => `${c.status} ${c.url}`).join('\n'), 'Link straight to the final URL to save round trips.'));

  // --- Site files
  out.push(p.robotsTxt.found ? f('robots', 'Crawlability', 'pass', 'robots.txt found', p.robotsTxt.blocksAll ? 'Warning: it disallows all crawlers.' : '') : f('robots', 'Crawlability', 'warning', 'No robots.txt', 'Crawlers expect /robots.txt to exist.', 'Add a robots.txt that links to your sitemap.'));
  if (p.robotsTxt.blocksAll) out.push(f('robots-block', 'Crawlability', 'critical', 'robots.txt blocks all crawlers', 'User-agent: * / Disallow: / hides the whole site from search.', 'Remove the blanket Disallow unless the site is meant to be private.'));
  out.push(p.sitemap.found ? f('sitemap', 'Crawlability', 'pass', `Sitemap found${p.sitemap.urls ? ` (${p.sitemap.urls} URLs)` : ''}`, p.sitemap.url) : f('sitemap', 'Crawlability', 'warning', 'No sitemap found', 'Checked robots.txt and /sitemap.xml.', 'Publish /sitemap.xml and reference it in robots.txt.'));

  return out;
}

const WEIGHT = { critical: 12, warning: 5, info: 1.5, pass: 0 };
export function score(findings) {
  const loss = findings.reduce((s, x) => s + WEIGHT[x.severity], 0);
  return Math.max(0, Math.min(100, Math.round(100 - loss)));
}
export function categoryScores(findings) {
  const cats = {};
  for (const x of findings) {
    (cats[x.category] ||= []).push(x);
  }
  return Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, score(v) ]));
}
