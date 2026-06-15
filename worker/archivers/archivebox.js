"use strict";
/**
 * ArchiveBox adapter — local self-hosted snapshot for web pages & documents.
 *
 * The worker runs one-off ArchiveBox commands as sibling containers via the
 * mounted Docker socket, sharing the ArchiveBox data volume. It adds the URL,
 * then reads the snapshot timestamp back from `archivebox list --json` to build
 * the local snapshot link served by the (locked-down) ArchiveBox web UI.
 *
 * Targets ArchiveBox >= 0.7.
 */
const { execFile } = require("child_process");

const IMAGE       = process.env.ARCHIVEBOX_IMAGE   || "archivebox/archivebox:latest";
const VOLUME      = process.env.ARCHIVEBOX_VOLUME  || "memorylane-archivebox-data";
// Optional: when the large archive/ folder lives on a separate volume/host path,
// it must be mounted identically here so worker captures land where the server
// reads them. Leave unset for the simple single-volume default.
const ARCHIVE_VOL = process.env.ARCHIVEBOX_ARCHIVE_VOLUME || "";
const PUBLIC_URL  = (process.env.ARCHIVEBOX_PUBLIC_URL || "http://localhost:8000").replace(/\/$/, "");

function docker(args, timeoutMs = 1000 * 60 * 10) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(((stderr || err.message) + "").trim().slice(0, 400)));
      resolve(stdout);
    });
  });
}

function run(...cmd) {
  const mounts = ["-v", `${VOLUME}:/data`];
  if (ARCHIVE_VOL) mounts.push("-v", `${ARCHIVE_VOL}:/data/archive`);
  return docker(["run", "--rm", ...mounts, IMAGE, ...cmd]);
}

// ArchiveBox prints a log banner before the JSON payload — slice out the array.
function parseJsonList(out) {
  const i = out.indexOf("[");
  const j = out.lastIndexOf("]");
  if (i === -1 || j === -1) return [];
  try { return JSON.parse(out.slice(i, j + 1)); } catch { return []; }
}

// A snapshot only has viewable content if a *content* extractor succeeded.
// favicon/headers/title/archive_org are auxiliary — they can succeed while the
// actual page/document capture failed (e.g. TLS error), which would otherwise
// leave a broken snapshot that renders ArchiveBox's "resource …/None" error.
const CONTENT_EXTRACTORS = ["wget", "singlefile", "dom", "pdf", "screenshot", "media", "mercury", "readability", "htmltotext", "warc"];
function captureSucceeded(snap) {
  const h = (snap && snap.history) || {};
  const ok = (r) => r && r.status === "succeeded";
  // history ordering varies, so accept the snapshot if any run of any content
  // extractor succeeded (a successful re-capture leaves viewable content).
  return CONTENT_EXTRACTORS.some((e) => {
    const runs = h[e];
    return Array.isArray(runs) ? runs.some(ok) : ok(runs);
  });
}

async function archive(url) {
  // 1. Capture. ArchiveBox is idempotent — re-adding an existing URL re-snapshots.
  await run("add", url);

  // 2. Resolve the snapshot for this exact URL (latest if re-archived).
  const out = await run("list", "--json", "--filter-type=exact", url);
  const list = parseJsonList(out).filter((s) => s && s.timestamp);
  if (!list.length) throw new Error("ArchiveBox: no snapshot found after add");
  const snap = list.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))[0];

  // 3. Only report a local snapshot if real content was captured; otherwise let
  //    the worker mark the job partial/failed (no broken "Local ↗" link).
  if (!captureSucceeded(snap)) {
    throw new Error("ArchiveBox: no content captured (all content extractors failed)");
  }
  return { local_url: `${PUBLIC_URL}/archive/${snap.timestamp}/index.html` };
}

module.exports = { archive };
