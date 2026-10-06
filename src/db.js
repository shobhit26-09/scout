// Storage: Supabase (REST, no extra dependency) when SUPABASE_URL + SUPABASE_SERVICE_KEY are set,
// otherwise a local SQLite file. Same async interface either way. The key is server-side only.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
export const driver = SUPABASE_URL && SUPABASE_SERVICE_KEY ? 'supabase' : 'sqlite';
const newId = () => randomBytes(5).toString('hex');

let impl;
if (driver === 'supabase') {
  const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/scout_reports`;
  const headers = { apikey: SUPABASE_SERVICE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json' };
  const call = async (qs, init = {}) => {
    const r = await fetch(base + qs, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Storage error (${r.status})`);
    return r.status === 201 ? null : r.json();
  };
  const camel = (r) => ({ id: r.id, host: r.host, url: r.url, title: r.title, score: r.score, createdAt: Number(r.created_at) });
  impl = {
    async saveCrawl(report) {
      const id = newId();
      await call('', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ id, host: report.host, url: report.url, title: report.title, score: report.score, created_at: Date.now(), report }) });
      return id;
    },
    async getCrawl(id) {
      const [r] = await call(`?id=eq.${id}&select=id,created_at,report`);
      return r && { id: r.id, createdAt: Number(r.created_at), ...r.report };
    },
    async hostHistory(host) {
      return (await call(`?host=eq.${encodeURIComponent(host)}&select=id,host,url,title,score,created_at&order=created_at.desc&limit=50`)).map(camel);
    },
    async recent(n = 8) {
      return (await call(`?select=id,host,url,title,score,created_at&order=created_at.desc&limit=${n}`)).map(camel);
    },
  };
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'scout.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS crawls (id TEXT PRIMARY KEY, host TEXT NOT NULL, url TEXT NOT NULL, title TEXT, score INTEGER NOT NULL, created_at INTEGER NOT NULL, report TEXT NOT NULL); CREATE INDEX IF NOT EXISTS crawls_host ON crawls(host, created_at DESC);`);
  impl = {
    async saveCrawl(report) {
      const id = newId();
      db.prepare('INSERT INTO crawls VALUES (?,?,?,?,?,?,?)').run(id, report.host, report.url, report.title, report.score, Date.now(), JSON.stringify(report));
      return id;
    },
    async getCrawl(id) {
      const r = db.prepare('SELECT id, created_at, report FROM crawls WHERE id = ?').get(id);
      return r && { id: r.id, createdAt: r.created_at, ...JSON.parse(r.report) };
    },
    async hostHistory(host) {
      return db.prepare('SELECT id, url, title, score, created_at AS createdAt FROM crawls WHERE host = ? ORDER BY created_at DESC LIMIT 50').all(host);
    },
    async recent(n = 8) {
      return db.prepare('SELECT id, host, title, score, created_at AS createdAt FROM crawls ORDER BY created_at DESC LIMIT ?').all(n);
    },
  };
}
export const { saveCrawl, getCrawl, hostHistory, recent } = impl;
