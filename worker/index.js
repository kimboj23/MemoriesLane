"use strict";
/**
 * MemoryLane archive-worker.
 *
 * Polls the shared Supabase `archives` table for pending jobs and runs them on
 * the local machine (where ArchiveBox / auto-archiver / a browser can run):
 *
 *   web | document  ->  ArchiveBox (local snapshot)  +  Wayback (public link)
 *   social          ->  auto-archiver (local)        +  Wayback (public link)
 *
 * A job is 'archived' if every attempted archiver succeeded, 'partial' if at
 * least one did, 'failed' if none did. The API and UI read the results back
 * from the same table.
 *
 * Set DRY_RUN=1 to exercise the queue/state machine without external tools.
 */
require("dotenv").config();
const db = require("./db");
const wayback = require("./archivers/wayback");
const archivebox = require("./archivers/archivebox");
const autoarchiver = require("./archivers/autoarchiver");
const integrity = require("./integrity");

const POLL_MS      = parseInt(process.env.POLL_INTERVAL_MS, 10) || 15000;
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS, 10) || 3;
const DRY_RUN      = process.env.DRY_RUN === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryStep(label, fn, out) {
  out.tried++;
  try {
    const r = await fn();
    if (r.wayback_url) out.wayback_url = out.wayback_url || r.wayback_url;
    if (r.local_url) out.local_url = out.local_url || r.local_url;
    out.ok++;
  } catch (e) {
    console.warn(`[worker]   ${label} failed: ${e.message}`);
  }
}

async function processJob(job) {
  const out = { tried: 0, ok: 0, wayback_url: null, local_url: null };
  let tool_version = null;

  if (DRY_RUN) {
    out.tried = out.ok = 1;
    out.wayback_url = `https://web.archive.org/web/DRYRUN/${job.original_url}`;
    out.local_url = `http://localhost:8000/archive/DRYRUN/${job.id}/index.html`;
    tool_version = "dry-run";
  } else if (job.tool === "auto-archiver") {
    await tryStep("auto-archiver", () => autoarchiver.archive(job.original_url), out);
    await tryStep("wayback", () => wayback.save(job.original_url), out);
    tool_version = autoarchiver.version();
  } else {
    await tryStep("archivebox", () => archivebox.archive(job.original_url), out);
    await tryStep("wayback", () => wayback.save(job.original_url), out);
    tool_version = await archivebox.version();
  }

  if (out.ok === 0) throw new Error("all archivers failed");
  const status = out.ok === out.tried ? "archived" : "partial";
  // Hash our own served copy (local snapshot first, public Wayback link as
  // fallback) so the fingerprint reflects what readers can actually verify.
  const sha256 = DRY_RUN ? "dryrun" : await integrity.sha256OfUrl(out.local_url || out.wayback_url);
  await db.complete(job.id, { wayback_url: out.wayback_url, local_url: out.local_url, status, sha256, tool_version });
  console.log(`[worker]   -> ${status} (wayback=${!!out.wayback_url} local=${!!out.local_url} sha256=${!!sha256})`);
}

async function drainQueue() {
  let job;
  while ((job = await db.claimNext())) {
    console.log(`[worker] job ${job.id} [${job.media_type}] ${job.original_url}`);
    try {
      await processJob(job);
    } catch (e) {
      console.error(`[worker] job ${job.id} failed: ${e.message}`);
      await db.fail(job.id, e.message);
    }
  }
}

async function main() {
  console.log(`[worker] started (poll ${POLL_MS}ms, dryRun=${DRY_RUN}, wayback=${wayback.configured()})`);
  await db.recoverStuck(MAX_ATTEMPTS).catch((e) => console.warn("[worker] recover:", e.message));
  for (;;) {
    try {
      await drainQueue();
    } catch (e) {
      console.error("[worker] loop error:", e.message);
    }
    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error("[worker] fatal:", e.message);
  process.exit(1);
});
