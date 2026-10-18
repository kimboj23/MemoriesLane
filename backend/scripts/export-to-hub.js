"use strict";
/**
 * One-time migration of the community map's existing data into the hub (docs/integration-design.md §9).
 * It only queues outbox rows; the backend's relay (hub.js) sends them with retries, like new submissions.
 *
 *   node scripts/export-to-hub.js            # count what would be queued
 *   node scripts/export-to-hub.js --commit   # queue it (idempotent: re-running queues nothing twice)
 *
 *   approved memories → "legacy" memories (already public): the hub publishes them as-is, as one batch that a
 *                       manager and a member with publication access approve once. Their old ids keep working.
 *   cases             → submissions for review (they become incidents in the hub)
 *   archives          → links for review: the hub re-captures them; the old "archived" status is not trusted
 *                       (the audit found many were login walls). Wayback links travel in the note.
 *
 * Needs DATABASE_URL and HUB_URL / HUB_SOURCE / HUB_INTAKE_KEY (the relay must be running to send them).
 */
require("dotenv").config();
const { initDb, getPool } = require("../db");
const hub = require("../hub");

(async () => {
  const commit = process.argv.includes("--commit");
  await initDb();
  const pool = getPool();
  if (commit && !hub.intakeOn()) throw new Error("HUB_URL, HUB_SOURCE and HUB_INTAKE_KEY must be set");
  await hub.init(pool, require("../storage"), require("path").join(__dirname, "../uploads"));
  const sets = {
    legacy_memory: (await pool.query("SELECT id FROM memories WHERE approved = 1 ORDER BY submit_date")).rows,
    legacy_case: (await pool.query("SELECT id FROM cases WHERE approved = 1 ORDER BY created_at")).rows,
    legacy_archive: (await pool.query("SELECT id FROM archives WHERE original_url IS NOT NULL AND rejected = 0 ORDER BY created_at")).rows,
  };
  for (const [kind, rows] of Object.entries(sets)) {
    let queued = 0;
    if (commit) for (const r of rows) queued += await hub.enqueue(kind, r.id);
    console.log(`${kind}: ${rows.length} found${commit ? `, ${queued} newly queued` : " (dry run: --commit to queue)"}`);
  }
  const { rows } = await pool.query("SELECT kind, state, count(*)::int AS n FROM hub_outbox GROUP BY 1, 2 ORDER BY 1, 2");
  console.table(rows);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
