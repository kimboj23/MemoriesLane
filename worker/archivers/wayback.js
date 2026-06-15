"use strict";
/**
 * Internet Archive "Save Page Now" (SPN2) adapter — produces the public,
 * durable web.archive.org snapshot link.
 *
 * Auth uses your archive.org S3-style keys (https://archive.org/account/s3.php):
 *   IA_ACCESS_KEY / IA_SECRET_KEY  ->  Authorization: LOW <access>:<secret>
 *
 * Flow: POST /save (returns job_id) -> poll /save/status/<job_id> until
 * success, then build the snapshot URL from the returned timestamp.
 */
const ACCESS = process.env.IA_ACCESS_KEY || "";
const SECRET = process.env.IA_SECRET_KEY || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeader() {
  return `LOW ${ACCESS}:${SECRET}`;
}

function configured() {
  return !!(ACCESS && SECRET);
}

async function save(url) {
  if (!configured()) throw new Error("IA_ACCESS_KEY/IA_SECRET_KEY not set");

  const submit = await fetch("https://web.archive.org/save", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader(),
    },
    body: new URLSearchParams({ url, skip_first_archive: "1", capture_all: "1" }),
  });
  const job = await submit.json().catch(() => ({}));
  if (!job.job_id) {
    throw new Error("SPN: no job_id (" + JSON.stringify(job).slice(0, 200) + ")");
  }

  // Poll up to ~3 minutes.
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const s = await fetch(`https://web.archive.org/save/status/${job.job_id}`, {
      headers: { Accept: "application/json", Authorization: authHeader() },
    }).then((r) => r.json()).catch(() => ({}));

    if (s.status === "success") {
      return {
        wayback_url: `https://web.archive.org/web/${s.timestamp}/${s.original_url}`,
      };
    }
    if (s.status === "error") {
      throw new Error("SPN error: " + (s.message || s.status_ext || "unknown"));
    }
    // status === "pending" -> keep polling
  }
  throw new Error("SPN timed out waiting for snapshot");
}

module.exports = { save, configured };
