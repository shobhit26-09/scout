import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import * as cheerio from 'cheerio';
const base = 'https://scout-kdty.onrender.com';
test('marketing pages have server-rendered navigation, canonical metadata and valid schema', async () => {
 const server = app.listen(0); const origin = `http://127.0.0.1:${server.address().port}`;
 try {
  for (const path of ['/', '/how-it-works', '/web-crawler']) {
   const r = await fetch(origin+path); assert.equal(r.status,200);
   const $ = cheerio.load(await r.text());
   assert.equal($('h1').length,1);
   assert.equal($('link[rel=canonical]').attr('href'),base+path);
   assert.ok($('meta[name=description]').attr('content').length>70);
   assert.equal($('#nav nav a[href="/how-it-works"]').length,1);
   assert.equal($('#foot footer').length,1);
   assert.ok(JSON.parse($('script[type="application/ld+json"]').text())['@context']);
   assert.equal((await fetch(origin+(path==='/'?'/index.html':path+'.html'),{redirect:'manual'})).status,301);
  }
  const robots = await (await fetch(origin+'/robots.txt')).text();assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`));
  const map = await (await fetch(origin+'/sitemap.xml')).text(); assert.equal((map.match(/<loc>/g)||[]).length,3);
  const css = await fetch(origin+'/app.css'); assert.ok(css.headers.get('cache-control').includes('max-age=3600'));
 } finally { await new Promise(ok=>server.close(ok)); }
});
