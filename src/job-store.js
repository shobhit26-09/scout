// Job metadata only. Reports remain in the existing report store.
export const JOB_SCHEMA = `CREATE TABLE IF NOT EXISTS site_jobs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, progress TEXT NOT NULL,
  result_id TEXT, error TEXT, started INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, finished INTEGER
); CREATE INDEX IF NOT EXISTS site_jobs_finished ON site_jobs(finished);`;

const fromRow = (r) => r && ({ id: r.id, status: r.status,
  progress: typeof r.progress === 'string' ? JSON.parse(r.progress) : r.progress,
  resultId: r.result_id, error: r.error, started: Number(r.started),
  updatedAt: Number(r.updated_at), finished: r.finished == null ? null : Number(r.finished) });
const values = (j) => [j.status, JSON.stringify(j.progress), j.resultId ?? null,
  j.error ?? null, j.updatedAt, j.finished ?? null];

export function sqliteJobs(db) {
  db.exec(JOB_SCHEMA);
  return {
    async createJob(j) {
      db.prepare('INSERT INTO site_jobs (id,status,progress,result_id,error,started,updated_at,finished) VALUES (?,?,?,?,?,?,?,?)')
        .run(j.id, j.status, JSON.stringify(j.progress), null, null, j.started, j.updatedAt, null);
    },
    async updateJob(j) {
      return db.prepare("UPDATE site_jobs SET status=?,progress=?,result_id=?,error=?,updated_at=?,finished=? WHERE id=? AND status='running'")
        .run(...values(j), j.id).changes === 1;
    },
    async getJob(id) { return fromRow(db.prepare('SELECT * FROM site_jobs WHERE id=?').get(id)); },
    async failStaleJob(id, cutoff, now, error) {
      db.prepare("UPDATE site_jobs SET status='error',error=?,updated_at=?,finished=? WHERE id=? AND status='running' AND updated_at<?")
        .run(error, now, now, id, cutoff);
    },
    async pruneJobs(before) { db.prepare('DELETE FROM site_jobs WHERE (finished IS NOT NULL AND finished<?) OR updated_at<?').run(before, before); },
  };
}

export function restJobs(base, headers, fetcher = fetch) {
  const call = async (qs, init = {}) => {
    const r = await fetcher(base + qs, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Job storage error (${r.status})`);
    return r.status === 204 || r.status === 201 ? null : r.json();
  };
  return {
    async createJob(j) {
      await call('', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({
        id: j.id, status: j.status, progress: j.progress, started: j.started, updated_at: j.updatedAt,
      }) });
    },
    async updateJob(j) {
      const rows = await call(`?id=eq.${j.id}&status=eq.running`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({
        status: j.status, progress: j.progress, result_id: j.resultId ?? null,
        error: j.error ?? null, updated_at: j.updatedAt, finished: j.finished ?? null,
      }) });
      return rows.length === 1;
    },
    async getJob(id) { const [row] = await call(`?id=eq.${id}&select=*`); return fromRow(row); },
    async failStaleJob(id, cutoff, now, error) {
      await call(`?id=eq.${id}&status=eq.running&updated_at=lt.${cutoff}`, { method: 'PATCH', headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'error', error, updated_at: now, finished: now }) });
    },
    async pruneJobs(before) { await call(`?or=(finished.lt.${before},updated_at.lt.${before})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }); },
  };
}
