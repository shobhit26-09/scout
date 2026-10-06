import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, score } from '../src/checks.js';
import { assertPublicUrl } from '../src/safe-fetch.js';

const base = () => ({ https: true, headers: { 'content-encoding': 'br', 'strict-transport-security': 'max-age=1', 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=()' }, title: 'A perfectly reasonable page title here', description: 'x'.repeat(100), h1: ['Hi'], headingSkips: [], canonical: 'https://a.test/', robotsMeta: '', lang: 'en', viewport: 'width=device-width', og: { 'og:title': 'a', 'og:description': 'b', 'og:image': 'c' }, twitterCard: 'summary', favicon: true, jsonLd: 1, images: { total: 0 }, links: { internal: 3, external: 1, empty: 0, nonDescriptive: 0 }, brokenLinks: { checked: 4, broken: [] }, wordCount: 400, timing: { ttfbMs: 200 }, bytes: 20000, scripts: { total: 2, blocking: 0 }, redirects: 0, chain: [], robotsTxt: { found: true, blocksAll: false }, sitemap: { found: true, urls: 5, url: 'x' } });

test('clean page scores 95+', () => assert.ok(score(runChecks(base())) >= 95));
test('missing title and description are critical', () => {
  const f = runChecks({ ...base(), title: '', description: '' });
  assert.equal(f.find((x) => x.id === 'title').severity, 'critical');
  assert.equal(f.find((x) => x.id === 'description').severity, 'critical');
  assert.ok(score(f) < 80);
});
test('broken links are reported', () => {
  const f = runChecks({ ...base(), brokenLinks: { checked: 2, broken: [{ url: 'https://a.test/x', status: 404 }] } });
  assert.equal(f.find((x) => x.id === 'broken').severity, 'critical');
});
test('private addresses are rejected', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1/'));
  await assert.rejects(assertPublicUrl('http://192.168.1.1/'));
  await assert.rejects(assertPublicUrl('ftp://example.com/'));
});

test('flags missing security headers, mixed content and weak cookies', () => {
  const p = base(); p.headers = {}; p.mixedContent = { count: 2, samples: ['http://a.test/x.js'] };
  p.setCookies = ['sid=1; Path=/'];
  const ids = runChecks(p).filter((x) => x.category === 'Security' && x.severity !== 'pass').map((x) => x.id);
  for (const id of ['hsts', 'csp', 'xfo', 'xcto', 'referrer', 'permissions', 'mixed', 'cookies']) assert.ok(ids.includes(id), id);
});
