"use strict";
/**
 * Safety net for snapshots added directly through ArchiveBox's own admin UI,
 * bypassing the app's normal submit -> archives row -> worker pipeline. That
 * pipeline is the ONLY thing that calls Wayback -- ArchiveBox's own built-in
 * Wayback submission is deliberately disabled (SAVE_ARCHIVE_DOT_ORG=False in
 * docker-compose.vps.yml) to avoid double-hitting archive.org's rate-limited
 * Save-Page-Now API from both ArchiveBox itself and this worker. Without this
 * sweep, a directly-added snapshot would never get a public Wayback link.
 *
 * Runs independently of the main job queue on a slower interval, since it
 * has to list ArchiveBox's entire index each pass.
 */
const db = require("./db");
const wayback = require("./archivers/wayback");
const archivebox = require("./archivers/archivebox");

async function reconcileWayback() {
  if (!wayback.configured()) return;

  const snapshots = await archivebox.listCapturedUrls();
  for (const { url, local_url } of snapshots) {
    if (await db.hasWaybackFor(url)) continue;
    try {
      const { wayback_url } = await wayback.save(url);
      await db.insertBackfilled({ original_url: url, wayback_url, local_url });
      console.log(`[worker] [reconcile] backfilled wayback for directly-added snapshot: ${url} -> ${wayback_url}`);
    } catch (e) {
      console.warn(`[worker] [reconcile] wayback backfill failed for ${url}: ${e.message}`);
    }
  }
}

module.exports = { reconcileWayback };
