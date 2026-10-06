import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'scout.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`CREATE TABLE IF NOT EXISTS crawls (
  id TEXT PRIMARY KEY, host TEXT NOT NULL, url TEXT NOT NULL, title TEXT,
  score INTEGER NOT NULL, created_at INTEGER NOT NULL, report TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS crawls_host ON crawls(host, created_at DESC);`);

export function saveCrawl(report) {
  const id = randomBytes(5).toString('hex');
  db.prepare('INSERT INTO crawls VALUES (?,?,?,?,?,?,?)').run(id, report.host, report.url, report.title, report.score, Date.now(), JSON.stringify(report));
  return id;
}
export function getCrawl(id) {
  const r = db.prepare('SELECT id, created_at, report FROM crawls WHERE id = ?').get(id);
  return r && { id: r.id, createdAt: r.created_at, ...JSON.parse(r.report) };
}
export function hostHistory(host) {
  return db.prepare('SELECT id, url, title, score, created_at AS createdAt FROM crawls WHERE host = ? ORDER BY created_at DESC LIMIT 50').all(host);
}
export function recent(n = 8) {
  return db.prepare('SELECT id, host, title, score, created_at AS createdAt FROM crawls ORDER BY created_at DESC LIMIT ?').all(n);
}
