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
const sharp = require("sharp");

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
      // capture. Never lets a failure here undo the db.insertBackfilled row
      // above.
      //
      // auto-archiver returns whichever image format the platform handed it
      // (Threads -> .png, Facebook -> .jpg, both confirmed live 2026-08-21),
      // so anything image-shaped is accepted and converted below rather than
      // skipped. This used to be a PNG-only test, which silently dropped the
      // .jpg captures and left those snapshots showing ArchiveBox's own
      // weaker screenshot with no indication anything had been passed over.
      if (result.local_url && /\.(png|jpe?g|webp)(\?|$)/i.test(result.local_url)) {
        try {
          const res = await fetch(result.local_url);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          let buf = Buffer.from(await res.arrayBuffer());
          if (!/\.png(\?|$)/i.test(result.local_url)) {
            // The bytes have to actually BE a PNG, not just land at a .png
            // path: ArchiveBox hardcodes `screenshot.png` in
            // index/schema.py's canonical_outputs() for the snapshot's 📷
            // link, so writing JPEG bytes under that name renders broken.
            buf = await sharp(buf).png().toBuffer();
          }
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
