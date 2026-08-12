"use strict";
/**
 * Minimal Postgres access for the archive-worker. Connects to the SAME Supabase
 * database the API uses (DATABASE_URL), and treats the `archives` table as a
 * job queue: claim a pending row, run the archivers, write results back.
 */
const { Pool } = require("pg");
const crypto = require("crypto");

const dbUrl = process.env.DATABASE_URL || "";
const needsSsl =
  /supabase\.(co|com)/.test(dbUrl) ||
  /[?&]sslmode=require/.test(dbUrl) ||
  process.env.PGSSLMODE === "require";

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 4,
});

// Atomically claim the oldest pending job. FOR UPDATE SKIP LOCKED makes this
// safe even if several workers run at once.
async function claimNext() {
  const { rows } = await pool.query(
    `UPDATE archives SET status = 'running', attempts = attempts + 1
     WHERE id = (
       SELECT id FROM archives
       WHERE status = 'pending' AND original_url IS NOT NULL
       ORDER BY created_at ASC LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, case_id, tool, media_type, original_url, attempts`
  );
  return rows[0] || null;
}

function complete(id, { wayback_url, local_url, status, sha256, tool_version, wacz_url }) {
  return pool.query(
    `UPDATE archives
     SET wayback_url = $2, local_url = $3, status = $4, error = NULL,
         sha256 = COALESCE($5, sha256),
         tool_version = COALESCE($6, tool_version),
         wacz_url = COALESCE($7, wacz_url),
         archived_at = EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id = $1`,
    [id, wayback_url || null, local_url || null, status, sha256 || null, tool_version || null, wacz_url || null]
  );
}

function fail(id, error) {
  return pool.query(
    `UPDATE archives SET status = 'failed', error = $2 WHERE id = $1`,
    [id, String(error).slice(0, 500)]
  );
}

// On startup, reset rows stuck in 'running' (e.g. worker crashed mid-job) back
// to pending, but only if they haven't exhausted their retry budget.
function recoverStuck(maxAttempts) {
  return pool.query(
    `UPDATE archives SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'pending' END,
                         error  = CASE WHEN attempts >= $1 THEN 'exceeded max attempts' ELSE error END
     WHERE status = 'running'`,
    [maxAttempts]
  );
}

// Has this URL already got a Wayback link recorded anywhere (any job, any
// case)? Used by the reconcile sweep to avoid re-submitting the same URL.
async function hasWaybackFor(url) {
  const { rows } = await pool.query(
    `SELECT 1 FROM archives WHERE original_url = $1 AND wayback_url IS NOT NULL LIMIT 1`,
    [url]
  );
  return rows.length > 0;
}

// Record a Wayback link for a URL that was captured directly through
// ArchiveBox's own admin (so it never went through POST /api/archive and has
// no case_id). Kept as a standalone row -- case_id is nullable precisely for
// materials that aren't tied to a specific case (see routes/archive.js).
function insertBackfilled({ original_url, wayback_url, local_url }) {
  const id = crypto.randomBytes(9).toString("base64url");
  const created_at = new Date().toISOString().slice(0, 10);
  return pool.query(
    `INSERT INTO archives (id, tool, media_type, original_url, wayback_url, local_url, status, notes, created_at, archived_at)
     VALUES ($1, 'archive-box', 'web', $2, $3, $4, 'archived',
             'Auto-backfilled by archive-worker: snapshot was added directly in ArchiveBox''s admin, not submitted through a case.',
             $5, EXTRACT(EPOCH FROM NOW())::BIGINT)`,
    [id, original_url, wayback_url || null, local_url || null, created_at]
  );
}

module.exports = { claimNext, complete, fail, recoverStuck, hasWaybackFor, insertBackfilled };
