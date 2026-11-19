# Whole-site job tracking

## What changes

Before this patch, accepted jobs existed only in an in-memory `Map`. The saved report could survive a restart while its job ID returned 404. Job status now lives alongside reports, in local SQLite or the server's existing Supabase database. No new service or dependency is needed.

- Write the initial running row before returning a job ID. Storage failure returns 502 without starting a crawl.
- Checkpoint progress every five seconds. Progress polling can lag by that amount, plus database latency.
- After saving a report, save the completed status and its report ID. Failed crawls save an error.
- A status poll conditionally marks a running job interrupted after two minutes without a checkpoint. A concurrent fresh heartbeat or completion cannot be overwritten by that stale check.
- Keep terminal metadata for 24 hours. Later polling returns 404; new submissions prune old metadata, including abandoned old running rows. Saved reports are not pruned by this process.

This does **not** resume partially completed crawls, implement a durable work queue, or coordinate admission across multiple server processes. Existing per-process concurrency and per-visitor limits remain. The browser now saves an accepted job ID and submitted URL in sessionStorage for up to24hours. After a refresh in that tab, the notice can check the existing job without a second POST. It does not promise recovery in another tab/device or after the tab's session is closed; disabled storage leaves the current page usable but cannot preserve its pointer.

A temporary network/storage outage retains the pointer for another status check. Completion, explicit server failure, tracking404 or dismissal removes it. Dismissal does not cancel the server job. A new whole-site submission is held while a saved pointer exists so a retry cannot silently start a duplicate. The crawler itself is not restarted by this UI.

## Deploy carefully

1. Keep the patch on a review branch until it is approved. It is not deployed by the local tests.
2. For Supabase, run the additive `scout_jobs` section of `supabase/schema.sql` before deploying the application. RLS stays enabled with no public policies. Use only the existing server-side service-role credential. No production migration was run during development.
3. For SQLite, the table is created automatically. The database file must live on persistent disk; an ephemeral host disk still loses rows when replaced. Render's existing Supabase deployment path is unchanged.
4. Keep deployment to the existing single-worker topology. Multiple processes can each admit one crawl, as before. There is no distributed lock or exactly-once execution guarantee.
5. During a rolling deploy, old 16-character in-memory job IDs are not migrated. Existing saved reports are untouched. New 32-character IDs have 128 random bits.

If storage fails while the crawl is running, the client can see 502 until storage recovers. If the final status cannot be saved, the old running row eventually becomes interrupted on polling. A report may have been saved before the final metadata write failed, so these two writes are not atomic. Check report history before retrying if avoiding duplicate reports matters.

## Reproduce locally

```sh
npm ci --ignore-scripts
npm test
node scripts/restart-proof.mjs
```

The restart script uses the real Express API, a temporary SQLite file, and a deliberately rejected loopback address. It kills and restarts the server process and checks whether a completed error status survives. It does not crawl an external site or contact production storage. Its elapsed time is test-harness time, not crawl performance.

The separate unfinished-job test starts a real child process with an injected waiting crawler, accepts a durable job, terminates the child, and reads its saved row from a new manager with an advanced test clock. It verifies explicit interruption, not crawl resumption.

The test suite covers HTTP submission/polling, missing IDs, validation, rate limits, concurrent admission, heartbeat checkpoints, crawl/report-storage failures, initial-storage outages, conditional stale writes, retention, and adapter error handling. It also covers same-tab pointer validation/expiry, blocked storage, terminal cleanup and retryable polling failures. A separate browser harness exercises the actual UI with controlled status responses, including refresh without another submission. That browser proof does not establish external crawl or production Supabase behavior. SQLite is exercised against real temporary databases. Supabase tests use mocked HTTP contracts: a live Supabase/PostgREST integration and production migration are still unverified.

## Review in small pieces

1. Trace the existing POST route and why a `Map` disappears when a process ends.
2. Read one `site_jobs` row: ID, status, progress, last update, report ID.
3. Compare `createJob` with `getJob` in SQLite.
4. Only then inspect the heartbeat and conditional stale transition.

These are proposed discussion steps for an assisted change, not evidence that the account owner has already mastered them.
