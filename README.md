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
- `src/db.js`: reports stored in Supabase (Postgres over REST) when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set, otherwise in local SQLite (`node:sqlite`, Node 22.13+).
- `src/server.js`: Express API plus static frontend. 6 audits per 10 minutes per IP.
- `public/`: vanilla JS, no build step.

## Trust verdict

Every report shows Safe, Suspicious or High risk, with the evidence behind each flag. Signals: Google Safe Browsing (needs the optional `SAFE_BROWSING_KEY` env var, free Lookup API; skipped and noted when missing), domain age from RDAP, URL heuristics (risky TLDs, raw IPs, punycode, shorteners), and page heuristics (password forms, brand-name mismatch, urgency language, missing contact or privacy links). Whole-site crawls run Trust on the root page only.

## Whole-site crawl

Choose "Whole site" on the home page. Scout reads robots.txt and sitemap.xml, follows same-origin links, and audits up to 50 pages one at a time (250 ms apart, 110 s cap). It saves one site report with an overall score, per-category scores, an issue roll-up and a per-page table. Crawls run as background jobs (two per visitor per 10 minutes, one at a time per server).

## Run it

```bash
npm install
npm start     # http://localhost:3000
npm test
```

Without Supabase env vars, reports go to a local SQLite file; set `DB_PATH` to change where it lives. Requires Node 22.13 or newer.

## Deploy

`render.yaml` is included for Render's free tier. Free instances sleep when idle and have an ephemeral disk, so production uses Supabase to keep permalinks and history across restarts. Create the table with `supabase/schema.sql`, keep RLS on with no public policies, and set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (service role, server only) in the Render dashboard. Never commit the key.

## Limits

Audits a single page plus its links, not a whole-site crawl. JavaScript is not executed, so client-rendered pages are audited as crawlers without JS see them (which is usually the point).
