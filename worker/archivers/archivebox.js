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

async function archive(url) {
  // 1. Capture. ArchiveBox is idempotent — re-adding an existing URL re-snapshots.
  await run("add", url);

  // 2. Resolve the snapshot timestamp for this exact URL (latest if re-archived).
  const out = await run("list", "--json", "--filter-type=exact", url);
  const list = parseJsonList(out).filter((s) => s && s.timestamp);
  if (!list.length) throw new Error("ArchiveBox: no snapshot found after add");
  const snap = list.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp))[0];
  return { local_url: `${PUBLIC_URL}/archive/${snap.timestamp}/index.html` };
}

module.exports = { archive };
