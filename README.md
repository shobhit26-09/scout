# Scout

Paste a URL, get a scored SEO, performance and accessibility audit with the exact fix for each issue. Every audit is saved at a permalink (`/crawl/<id>`), and each domain has a history page (`/site/<domain>`).

No accounts, no paid services, no API keys.

## What it checks

- **SEO**: title and meta description length, h1, canonical, noindex, structured data
- **Social**: Open Graph, Twitter card, favicon
- **Performance**: response time, HTML size, compression, render-blocking scripts, redirect chains, lazy images
- **Links**: broken link detection (up to 25 links per audit)
- **Accessibility and mobile**: image alt text, heading order, `lang`, viewport tag
- **Crawlability**: robots.txt, sitemap, blanket disallow

Checks are deterministic rules in [`src/checks.js`](src/checks.js). Each has a severity (critical, warning, info, pass) and a concrete fix.

## How it works

- `src/safe-fetch.js`: server-side fetch with a 10s timeout, 2 MB body cap, manual redirects, and SSRF protection (every hop is resolved and private/loopback addresses are refused).
- `src/crawler.js`: obeys robots.txt for the audited page, parses HTML with cheerio, checks links politely (5 at a time, small delay), looks for a sitemap.
- `src/db.js`: reports stored in SQLite (`node:sqlite`, built into Node 22.13+).
- `src/server.js`: Express API plus static frontend. 6 audits per 10 minutes per IP.
- `public/`: vanilla JS, no build step.

## Run it

```bash
npm install
npm start     # http://localhost:3000
npm test
```

Set `DB_PATH` to change where the SQLite file lives. Requires Node 22.13 or newer.

## Deploy

`render.yaml` is included for Render's free tier. Note that free instances sleep when idle and have an ephemeral disk, so saved reports reset on redeploy. Point `DB_PATH` at a persistent disk or swap `src/db.js` for a hosted database to keep history long term.

## Limits

Audits a single page plus its links, not a whole-site crawl. JavaScript is not executed, so client-rendered pages are audited as crawlers without JS see them (which is usually the point).
