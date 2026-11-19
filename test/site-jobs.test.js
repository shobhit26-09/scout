import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { sqliteJobs, restJobs } from '../src/job-store.js';
import { createSiteJobs, RETAIN_MS } from '../src/site-jobs.js';
import { siteJobRoutes } from '../src/site-job-routes.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scout-jobs-')), file = path.join(dir, 'test.db');
  const db = new DatabaseSync(file), store = sqliteJobs(db);
  return { dir, file, db, store, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
};
const job = (id = 'a'.repeat(32), at = 10_000) => ({ id, status: 'running', progress: { phase: 'Starting' }, started: at, updatedAt: at });
const defaults = { crawlSite: async () => ({ host: 'fixture.test', score: 90 }), saveCrawl: async () => 'b'.repeat(10) };
const post = (origin, url = 'https://fixture.test') => fetch(origin + '/api/site-crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
async function http(jobs, fn) {
  const app = express(); app.use(express.json()); app.use('/api/site-crawl', siteJobRoutes(jobs));
  const server = app.listen(0, '127.0.0.1'); await new Promise(ok => server.once('listening', ok));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(ok => server.close(ok)); }
}

test('HTTP submit persists before acknowledgement and completion links a saved report', async () => {
  const f = fixture(), wait = deferred(); let progress;
  const jobs = createSiteJobs({ ...defaults, store: f.store, crawlSite: async (_url, cb) => { progress = cb; await wait.promise; return { host: 'fixture.test' }; } });
  try {
    await http(jobs, async origin => {
      const r = await post(origin); assert.equal(r.status, 200); const { job: id } = await r.json();
      assert.match(id, /^[a-f0-9]{32}$/); assert.equal((await f.store.getJob(id)).status, 'running');
      progress({ phase: 'Auditing pages', done: 2, total: 3 });
      wait.resolve(); await jobs.idle();
      const poll = await fetch(origin + '/api/site-crawl/' + id); assert.equal(poll.status, 200);
      const body = await poll.json(); assert.equal(body.status, 'done'); assert.equal(body.id, 'b'.repeat(10));
      assert.equal(body.progress.done, 2);
      assert.equal((await post(origin, '')).status, 400);
      assert.equal((await fetch(origin + '/api/site-crawl/bad')).status, 404);
    });
  } finally { wait.resolve(); await jobs.idle(); f.close(); }
});

test('crawl failure persists explicit error, releases capacity and remains readable', async () => {
  const f = fixture(); const jobs = createSiteJobs({ ...defaults, store: f.store, crawlSite: async () => { throw new Error('Fixture page was unavailable.'); } });
  try {
    const id = await jobs.start('fixture'); await jobs.idle();
    const got = await jobs.get(id); assert.equal(got.status, 'error'); assert.equal(got.error, 'Fixture page was unavailable.');
    assert.equal(jobs.running, 0); assert.ok(await jobs.start('fixture')); await jobs.idle();
  } finally { f.close(); }
});

test('report-storage failure is not exposed as success', async () => {
  const f = fixture(); const jobs = createSiteJobs({ ...defaults, store: f.store, saveCrawl: async () => { throw new Error('Report storage failed.'); } });
  try {
    const id = await jobs.start('fixture'); await jobs.idle();
    const got = await jobs.get(id); assert.equal(got.status, 'error'); assert.equal(got.resultId, null);
  } finally { f.close(); }
});

test('concurrent starts reserve capacity before asynchronous storage and admission failure releases it', async () => {
  const f = fixture(), gate = deferred(), done = deferred();
  const store = { ...f.store, createJob: async j => { await gate.promise; return f.store.createJob(j); } };
  const jobs = createSiteJobs({ ...defaults, store, crawlSite: () => done.promise });
  try {
    const first = jobs.start('fixture'); assert.equal(await jobs.start('fixture'), null);
    gate.resolve(); assert.ok(await first); done.resolve({}); await jobs.idle(); assert.equal(jobs.running, 0);
    const failing = createSiteJobs({ ...defaults, store: { ...f.store, createJob: async () => { throw new Error('offline'); } } });
    await assert.rejects(failing.start('fixture')); assert.equal(failing.running, 0);
  } finally { gate.resolve(); done.resolve({}); await jobs.idle(); f.close(); }
});

test('HTTP storage outages return 502 rather than accepting untracked work', async () => {
  let crawled = false;
  const jobs = createSiteJobs({ ...defaults, store: { pruneJobs: async () => { throw new Error('offline'); }, getJob: async () => { throw new Error('offline'); } }, crawlSite: async () => { crawled = true; } });
  await http(jobs, async origin => {
    assert.equal((await post(origin)).status, 502); assert.equal(crawled, false);
    assert.equal((await fetch(origin + '/api/site-crawl/' + 'a'.repeat(32))).status, 502);
  });
});

test('heartbeat saves a checkpoint while a long-running crawl is pending', async () => {
  const f = fixture(), done = deferred(), checkpoint = deferred(); let notify;
  const store = { ...f.store, updateJob: async j => { const changed = await f.store.updateJob(j); if (j.status === 'running' && j.progress.done === 2) checkpoint.resolve(); return changed; } };
  const jobs = createSiteJobs({ ...defaults, store, heartbeatMs: 5, crawlSite: async (_url, cb) => { notify = cb; return done.promise; } });
  try {
    const id = await jobs.start('fixture'); notify({ phase: 'Auditing pages', done: 2 });
    await Promise.race([checkpoint.promise, new Promise((_ok, no) => setTimeout(() => no(new Error('checkpoint timeout')), 1000))]);
    assert.equal((await f.store.getJob(id)).progress.done, 2);
  } finally { done.resolve({}); await jobs.idle(); f.close(); }
});

test('job metadata survives actual process termination; stale work becomes an explicit interruption', async () => {
  const f = fixture();
  try {
    const writer = `import { DatabaseSync } from 'node:sqlite'; import { sqliteJobs } from './src/job-store.js';
      import { createSiteJobs } from './src/site-jobs.js';
      const db = new DatabaseSync(process.argv[1]); const store = sqliteJobs(db);
      const jobs = createSiteJobs({store,now:()=>1000,crawlSite:()=>new Promise(()=>{}),saveCrawl:async()=>''});
      console.log(await jobs.start('fixture')); process.exit(0);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', writer, f.file], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); const id = child.stdout.trim(); assert.match(id, /^[a-f0-9]{32}$/);
    const restored = createSiteJobs({ ...defaults, store: f.store, now: () => 122_000 });
    const got = await restored.get(id); assert.equal(got.status, 'error');
    assert.match(got.error, /server may have restarted/); assert.equal(got.progress.phase, 'Starting');
    assert.equal(await f.store.updateJob({ ...got, status: 'done', updatedAt: 123_000 }), false);
    assert.equal((await f.store.getJob(got.id)).status, 'error');
  } finally { f.close(); }
});

test('fresh jobs and completed reports survive a new manager without being marked interrupted', async () => {
  const f = fixture();
  try {
    await f.store.createJob(job());
    const jobs = createSiteJobs({ ...defaults, store: f.store, now: () => 20_000 });
    assert.equal((await jobs.get('a'.repeat(32))).status, 'running');
    const complete = { ...job(), status: 'done', resultId: 'c'.repeat(10), updatedAt: 11_000, finished: 11_000 };
    await f.store.updateJob(complete);
    const after = createSiteJobs({ ...defaults, store: f.store, now: () => 300_000 });
    assert.equal((await after.get(complete.id)).resultId, complete.resultId);
  } finally { f.close(); }
});

test('conditional stale update cannot overwrite a concurrent heartbeat or completed result', async () => {
  const f = fixture();
  try {
    await f.store.createJob(job());
    await f.store.updateJob({ ...job(), updatedAt: 200_000 });
    await f.store.failStaleJob('a'.repeat(32), 100_000, 220_000, 'interrupted');
    assert.equal((await f.store.getJob('a'.repeat(32))).status, 'running');
    await f.store.updateJob({ ...job(), status: 'done', resultId: 'b'.repeat(10), updatedAt: 230_000, finished: 230_000 });
    await f.store.failStaleJob('a'.repeat(32), 300_000, 400_000, 'interrupted');
    assert.equal((await f.store.getJob('a'.repeat(32))).status, 'done');
  } finally { f.close(); }
});

test('expired terminal metadata returns 404 semantics and is pruned without deleting reports', async () => {
  const f = fixture();
  try {
    await f.store.createJob(job()); await f.store.updateJob({ ...job(), status: 'done', updatedAt: 11_000, finished: 11_000 });
    const jobs = createSiteJobs({ ...defaults, store: f.store, now: () => RETAIN_MS + 20_000 });
    assert.equal(await jobs.get('a'.repeat(32)), null);
    await f.store.pruneJobs(RETAIN_MS); assert.equal(await f.store.getJob('a'.repeat(32)), undefined);
  } finally { f.close(); }
});

test('a failed checkpoint never produces a claimed successful job', async () => {
  const f = fixture(), done = deferred(), failed = deferred(); let broken = true;
  const store = { ...f.store, updateJob: async j => { if (broken) { broken = false; failed.resolve(); throw new Error('fixture outage'); } return f.store.updateJob(j); } };
  const jobs = createSiteJobs({ ...defaults, store, heartbeatMs: 5, crawlSite: () => done.promise });
  try {
    const id = await jobs.start('fixture'); await Promise.race([failed.promise, new Promise((_ok, no) => setTimeout(() => no(new Error('checkpoint timeout')), 1000))]); done.resolve({}); await jobs.idle();
    assert.equal((await jobs.get(id)).status, 'error'); assert.equal(jobs.running, 0);
  } finally { done.resolve({}); await jobs.idle(); f.close(); }
});

test('REST adapter uses conditional writes, normalizes rows, and reports backend errors', async () => {
  const requests = [], row = { id: 'a'.repeat(32), status: 'running', progress: { phase: 'Starting' }, result_id: null, error: null, started: 10_000, updated_at: 10_000, finished: null };
  const store = restJobs('https://storage.fixture/rest/v1/scout_jobs', { apikey: 'test-only' }, async (url, init) => {
    requests.push({ url, ...init });
    if (!init.method) return Response.json([row]);
    if (init.headers.prefer === 'return=representation') return Response.json([row]);
    return new Response(null, { status: 204 });
  });
  await store.createJob(job()); assert.equal((await store.getJob(row.id)).started, 10_000);
  assert.equal(await store.updateJob({ ...job(), status: 'done' }), true);
  await store.failStaleJob(row.id, 1000, 20_000, 'interrupted'); await store.pruneJobs(1000);
  assert.match(requests[2].url, /status=eq.running/);
  assert.match(requests[3].url, /status=eq.running&updated_at=lt.1000/);
  assert.equal(requests[4].method, 'DELETE');
  const offline = restJobs('https://storage.fixture', {}, async () => new Response(null, { status: 503 }));
  await assert.rejects(offline.getJob(row.id), /503/);
});


test('HTTP admission preserves busy and per-visitor rate limits', async () => {
  const f = fixture(), wait = deferred(); let blocked = true;
  const jobs = createSiteJobs({ ...defaults, store: f.store, crawlSite: async () => { if (blocked) await wait.promise; return {}; } });
  try {
    await http(jobs, async origin => {
      assert.equal((await post(origin)).status, 200);
      assert.equal((await post(origin)).status, 503);
      blocked = false; wait.resolve(); await jobs.idle();
      assert.equal((await post(origin)).status, 200); await jobs.idle();
      assert.equal((await post(origin)).status, 429);
    });
  } finally { wait.resolve(); await jobs.idle(); f.close(); }
});
