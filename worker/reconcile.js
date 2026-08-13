"use strict";
/**
 * Safety net for snapshots added directly through ArchiveBox's own admin UI,
 * bypassing the app's normal submit -> archives row -> worker pipeline.
 * ArchiveBox itself submits to Wayback for every capture it makes
 * (SAVE_ARCHIVE_DOT_ORG=True in docker-compose.vps.yml), regardless of how
 * the URL was added -- so there's nothing to submit here, just an
 * `archives` row to create so the app's own UI links to that submission.
 * Without this sweep, a directly-added snapshot's Wayback link would only
 * ever be visible in ArchiveBox's own admin, never in this app.
 *
 * Runs independently of the main job queue on a slower interval, since it
 * has to list ArchiveBox's entire index each pass.
 */
const db = require("./db");
const archivebox = require("./archivers/archivebox");

async function reconcileWayback() {
  const snapshots = await archivebox.listCapturedUrls();
  for (const { url, local_url, wayback_url } of snapshots) {
    if (!wayback_url) continue; // archive_org hasn't succeeded (yet) for this one
    if (await db.hasWaybackFor(url)) continue;
    try {
      await db.insertBackfilled({ original_url: url, wayback_url, local_url });
      console.log(`[worker] [reconcile] recorded archivebox's own wayback submission for ${url} -> ${wayback_url}`);
    } catch (e) {
      console.warn(`[worker] [reconcile] failed to record wayback for ${url}: ${e.message}`);
    }
  }
}

module.exports = { reconcileWayback };
