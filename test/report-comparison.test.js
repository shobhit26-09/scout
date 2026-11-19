import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), 'scout-compare-')), 'reports.sqlite');
process.env.SUPABASE_URL = ''; process.env.SUPABASE_SERVICE_KEY = '';
const { default: app } = await import('../src/server.js');
const { saveCrawl } = await import('../src/db.js');
test('report API compares the same page, skips newer unrelated pages and audit types', async () => {
 const base = { host: 'example.com', url: 'https://example.com/a', finalUrl: 'https://example.com/a', title: 'Page A', score: 50, categories: { SEO: 50 }, findings: [{ id: 'title', category: 'SEO', severity: 'critical' }] };
 const previous = await saveCrawl(base);
 await new Promise(resolve => setTimeout(resolve, 3));
 await saveCrawl({ ...base, url: 'https://example.com/b', finalUrl: 'https://example.com/b' });
 await new Promise(resolve => setTimeout(resolve, 3));
 await saveCrawl({ ...base, type: 'site', issues: [] });
 await new Promise(resolve => setTimeout(resolve, 3));
 const current = await saveCrawl({ ...base, score: 80, findings: [{ id: 'title', category: 'SEO', severity: 'pass' }, { id: 'h1', category: 'SEO', severity: 'warning' }] });
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/crawl/${current}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.previous.id, previous); assert.deepEqual(result.previous.changes, { cleared: 1, introduced: 1, persisting: 0 });
 } finally { await new Promise(resolve => server.close(resolve)); }
});


test('disposable preview warning is explicit and absent from ordinary production pages', async () => {
 const { previewHtml } = await import('../src/server.js');
 const html = '<html><body><main>Audit</main></body></html>';
 assert.equal(previewHtml(html, false), html);
 const preview = previewHtml(html, true);
 assert.match(preview, /Temporary review preview/);
 assert.match(preview, /Reports may disappear/);
 assert.match(preview, /anyone who has them/);
 assert.match(preview, /Do not submit private or sensitive URLs/);
 assert.match(preview, /<main>Audit<\/main>/);
 assert.match(previewHtml('<html><body id="top"><main>Audit</main></body></html>', true), /<body id="top"><aside/);
});
