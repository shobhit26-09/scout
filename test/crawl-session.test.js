import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRAWL_SESSION_KEY, CRAWL_SESSION_TTL, rememberCrawl, pendingCrawl, forgetCrawl, pollCrawl } from '../public/crawl-session.js';
const id = 'a'.repeat(32), report = 'b'.repeat(10);
const store = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
const response = (status, body) => ({ ok: status === 200, status, json: async () => body });
test('crawl pointer survives reload in the same tab', () => {
  const s = store(); assert.equal(rememberCrawl(s, id, 'https://example.com', 100), true);
  assert.deepEqual(pendingCrawl(s, 200), { job: id, url: 'https://example.com', createdAt: 100 });
});
test('old or future pointers expire without starting work', () => {
  for (const now of [99, 100 + CRAWL_SESSION_TTL]) { const s = store(); rememberCrawl(s, id, 'example.com', 100); assert.equal(pendingCrawl(s, now), null); assert.equal(s.getItem(CRAWL_SESSION_KEY), null); }
});
test('invalid pointers cannot select arbitrary status endpoints', () => {
  const s = store(); assert.equal(rememberCrawl(s, '../other', 'example.com'), false);
  s.setItem(CRAWL_SESSION_KEY, '{broken'); assert.equal(pendingCrawl(s), null);
});
test('storage refusal never breaks form initialization', () => {
  const s = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(rememberCrawl(s, id, 'example.com'), false); assert.equal(pendingCrawl(s), null); assert.doesNotThrow(() => forgetCrawl(s));
});
test('poll resumes progress, returns report ID and clears only on completion', async () => {
  const replies = [response(200, { status: 'running', progress: { done: 2 } }), response(200, { status: 'done', id: report })];
  const progress = []; let terminal = 0;
  assert.equal(await pollCrawl(id, { fetchStatus: async () => replies.shift(), onProgress: p => progress.push(p), wait: async () => {}, onTerminal: () => terminal++ }), report);
  assert.deepEqual(progress, [{ done: 2 }]); assert.equal(terminal, 1);
});
test('terminal server error and missing tracking clear the pointer', async () => {
  for (const reply of [response(200, { status: 'error', error: 'Interrupted' }), response(404, { error: 'Expired' })]) {
    let terminal = 0; await assert.rejects(pollCrawl(id, { fetchStatus: async () => reply, onTerminal: () => terminal++ })); assert.equal(terminal, 1);
  }
});
test('network, storage outage and malformed result keep pointer for retry', async () => {
  for (const fetchStatus of [async () => { throw new Error('Offline'); }, async () => response(502, { error: 'Storage unavailable' }), async () => response(200, { status: 'done', id: '../wrong' }), async () => response(200, { status: 'unknown' })]) {
    let terminal = 0; await assert.rejects(pollCrawl(id, { fetchStatus, onTerminal: () => terminal++ })); assert.equal(terminal, 0);
  }
});
test('dismiss removes only the tab pointer', () => { const s = store(); rememberCrawl(s, id, 'example.com'); forgetCrawl(s); assert.equal(pendingCrawl(s), null); });
