"use strict";
/**
 * Evidentiary integrity helper — hashes the artifact the worker just produced
 * so the public material can show a verifiable SHA-256 fingerprint, the same
 * way Bellingcat-style chain-of-custody tooling does.
 *
 * We hash our own served copy (local_url, falling back to the public Wayback
 * link) rather than trust a hash reported by an external tool's log output,
 * since that keeps the fingerprint meaningful regardless of which archiver
 * produced it.
 */
const crypto = require("crypto");

const MAX_BYTES = 50 * 1024 * 1024; // cap what we'll hash inline — large media isn't worth blocking the queue over

async function sha256OfUrl(url, timeoutMs = 30000) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const len = parseInt(res.headers.get("content-length") || "0", 10);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sha256OfUrl };
