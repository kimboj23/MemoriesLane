"use strict";
/**
 * Bellingcat auto-archiver adapter — local snapshot for SOCIAL media
 * (Facebook / X / Instagram / TikTok / YouTube), with screenshots + hashing.
 *
 * Run as a one-off sibling container via the Docker socket. auto-archiver is
 * config-driven: it reads an orchestration.yaml that you provide (mounted at
 * /config), feeds it a single URL via the CLI feeder, stores artifacts in the
 * shared data volume, and prints a JSON result line we parse for the links.
 *
 * Because auto-archiver setup is deployment-specific (which platforms, which
 * storage, optional API keys), this adapter is intentionally thin: it invokes
 * the tool and extracts whatever archive/screenshot URL it reports. If the
 * worker can also reach Wayback, that still provides the public link.
 *
 * Requires a config at $AUTOARCHIVER_CONFIG_DIR/orchestration.yaml.
 */
const { execFile } = require("child_process");

const IMAGE      = process.env.AUTOARCHIVER_IMAGE  || "bellingcat/auto-archiver:latest";
const VOLUME     = process.env.AUTOARCHIVER_VOLUME || "memorylane-autoarchiver-data";
const CONFIG_DIR = process.env.AUTOARCHIVER_CONFIG_DIR || "memorylane-autoarchiver-config";
const PUBLIC_URL = (process.env.AUTOARCHIVER_PUBLIC_URL || "").replace(/\/$/, "");

function docker(args, timeoutMs = 1000 * 60 * 15) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      // auto-archiver logs to stderr; keep both streams for parsing.
      if (err) return reject(new Error(((stderr || err.message) + "").trim().slice(0, 400)));
      resolve(stdout + "\n" + (stderr || ""));
    });
  });
}

// Parse the tool's output for success + links. Artifacts are stored in Supabase
// Storage (S3), so the tool prints their public cdn_url; we pick the formatted
// HTML snapshot URL (under AUTOARCHIVER_PUBLIC_URL) as the local_url.
function parseResult(output) {
  const success = /:\s*success'|SUCCESS\s+\||Processed\s+1\s+URL/i.test(output);

  let wayback_url = null;
  const ia = output.match(/https?:\/\/web\.archive\.org\/web\/\S+/);
  if (ia) wayback_url = ia[0].replace(/['")\],]+$/, "");

  let local_url = null;
  if (PUBLIC_URL) {
    const urls = (output.match(/https?:\/\/[^\s'")\]]+/g) || [])
      .map((u) => u.replace(/[)\]'"]+$/, ""))
      .filter((u) => u.startsWith(PUBLIC_URL));
    local_url = urls.find((u) => /\.html(\?|$)/i.test(u)) || urls[0] || null;
  }

  return { success, wayback_url, local_url };
}

async function archive(url) {
  // No local storage: artifacts upload straight to Supabase S3 (per the config).
  // Only the read-only config volume is mounted.
  const out = await docker([
    "run", "--rm",
    "-v", `${CONFIG_DIR}:/config:ro`,
    IMAGE,
    "--config", "/config/orchestration.yaml",
    url, // auto-archiver 1.2.7 takes the URL as a positional argument
  ]);

  const { success, wayback_url, local_url } = parseResult(out);
  if (!success && !local_url && !wayback_url) {
    // Surface the tool's own error line (e.g. login-required) for the job record.
    const err = (out.match(/ERROR[^\n]*registered users[^\n]*/i) || out.match(/ERROR[^\n]*/))?.[0];
    throw new Error(err ? err.slice(0, 200) : "auto-archiver: no successful archive");
  }
  return { wayback_url, local_url };
}

module.exports = { archive };
