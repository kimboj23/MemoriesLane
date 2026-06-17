"use strict";
/**
 * Minimal Postgres access for the archive-worker. Connects to the SAME Supabase
 * database the API uses (DATABASE_URL), and treats the `archives` table as a
 * job queue: claim a pending row, run the archivers, write results back.
 */
const { Pool } = require("pg");

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

module.exports = { claimNext, complete, fail, recoverStuck };
