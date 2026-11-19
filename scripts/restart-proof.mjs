// Local-only API regression: no public websites or production databases.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const dir = mkdtempSync(path.join(tmpdir(), 'scout-restart-'));
const serverPath = path.resolve(process.argv[2] || 'src/server.js');
const children = new Set();
async function start() {
  const source = `import app from ${JSON.stringify(pathToFileURL(serverPath).href)}; const s=app.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', DB_PATH: path.join(dir, 'test.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(p); let errors = ''; p.stderr.on('data', x => { errors += x; });
  const port = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(new Error('Server startup timed out: ' + errors)), 10_000);
    p.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) { clearTimeout(timer); resolve(Number(text.trim())); } });
    p.on('exit', code => { clearTimeout(timer); reject(new Error('Server exit ' + code + ': ' + errors)); });
  });
  return { p, origin: `http://127.0.0.1:${port}` };
}
async function stop(p) { p.kill('SIGKILL'); await once(p, 'exit'); children.delete(p); }
const t0 = performance.now();
try {
  const first = await start();
  const accepted = await fetch(first.origin + '/api/site-crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/' }) });
  const { job } = await accepted.json();
  if (!job) throw new Error('Local fixture was not accepted');
  let before;
  for (let i = 0; i < 100; i++) {
    before = await (await fetch(first.origin + '/api/site-crawl/' + job)).json();
    if (before.status === 'error') break;
    await new Promise(ok => setTimeout(ok, 10));
  }
  if (before.status !== 'error') throw new Error('Expected local-address rejection, no external request');
  await stop(first.p);
  const second = await start();
  const after = await fetch(second.origin + '/api/site-crawl/' + job);
  const result = await after.json();
  console.log(JSON.stringify({ accepted: accepted.status, beforeRestart: before.status, afterRestartHttp: after.status, afterRestartStatus: result.status ?? null, elapsedMs: Math.round(performance.now() - t0), note: 'Local rejected-address fixture; not a crawl-throughput benchmark.' }));
  await stop(second.p);
} finally {
  for (const p of children) p.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
}
