"use strict";
/**
 * Sweeps ArchiveBox's index for social-media URLs added directly through
 * ArchiveBox's own admin/browser-extension, and runs auto-archiver against
 * them. ArchiveBox's own media/yt-dlp extractor is much weaker for these
 * platforms -- confirmed by testing: a directly-added YouTube/Facebook/
 * Threads URL typically gets an empty or login-walled page shell, not the
 * actual video/post content, while auto-archiver (built specifically for
 * these platforms) succeeds at the same URLs.
 *
 * This reuses archive-worker's EXISTING Docker-socket access and
 * auto-archiver integration (archivers/autoarchiver.js) rather than giving
 * the public-facing archivebox container Docker socket access itself, which
 * would be a much bigger attack-surface increase (root-equivalent host
 * control for comparatively little benefit) -- see README "Archiving".
 *
 * Runs on its own cadence alongside reconcile.js's Wayback sweep, since it
 * also has to list ArchiveBox's whole index each pass.
 */
const db = require("./db");
const wayback = require("./archivers/wayback");
const autoarchiver = require("./archivers/autoarchiver");
const archivebox = require("./archivers/archivebox");

const SOCIAL_DOMAIN_PATTERNS = [
  /(^|\.)facebook\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)x\.com$/,
  /(^|\.)threads\.(com|net)$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)youtu\.be$/,
];

function isSocialUrl(url) {
  try {
    return SOCIAL_DOMAIN_PATTERNS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

async function socialSweep() {
  const snapshots = await archivebox.listCapturedUrls();
  for (const { url } of snapshots) {
    if (!isSocialUrl(url)) continue;
    if (await db.hasBeenArchivedBy(url, "auto-archiver")) continue;
    try {
      const result = await autoarchiver.archive(url);
      let wayback_url = result.wayback_url;
      // auto-archiver sometimes already returns its own Wayback link (it has
      // a built-in Wayback enricher) -- only make a separate submission if it
      // didn't, same reasoning as avoiding a redundant second submission
      // that motivated the ArchiveBox-side archive_org.py rewrite.
      if (!wayback_url) {
        try {
          wayback_url = (await wayback.save(url)).wayback_url;
        } catch (e) {
          console.warn(`[worker] [social-sweep] wayback failed for ${url}: ${e.message}`);
        }
      }
      await db.insertBackfilled({
        original_url: url,
        wayback_url,
        local_url: result.local_url,
        tool: "auto-archiver",
        media_type: "social",
        notes: "Auto-archived by archive-worker's social sweep: social-media URL added directly in ArchiveBox's admin (whose own media extractor is too weak for this platform), not submitted through a case.",
      });
      console.log(`[worker] [social-sweep] captured ${url} -> ${result.local_url || wayback_url}`);

      // Best-effort: also make this show up natively in ArchiveBox's own
      // index/UI, not just this app's separate archives table -- overwrite
      // the existing (weak/empty) snapshot's screenshot.png with the real
      // capture. PNG only (see archivebox.js's injectScreenshot doc) --
      // auto-archiver's priority order usually returns one, but skip
      // anything else rather than write a mislabeled file. Never lets a
      // failure here undo the db.insertBackfilled row above.
      if (result.local_url && /\.png(\?|$)/i.test(result.local_url)) {
        try {
          const res = await fetch(result.local_url);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          const timestamp = await archivebox.injectScreenshot(url, buf);
          console.log(`[worker] [social-sweep] injected real screenshot into ArchiveBox snapshot ${timestamp}`);
        } catch (e) {
          console.warn(`[worker] [social-sweep] screenshot injection failed for ${url}: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`[worker] [social-sweep] auto-archiver failed for ${url}: ${e.message}`);
    }
  }
}

module.exports = { socialSweep, isSocialUrl };
