"use strict";
/**
 * Client for the MemoryLane hub (the internal capture platform), for any public site ("spoke"):
 * the community map's backend uses it, and Hồ sơ Nhân quyền can copy it as is. Node 20+, no dependencies.
 * Design: docs/integration-design.md. Guide: docs/spoke-integration.md.
 *
 *   Intake (write-only): forward submissions and files, check receipts.
 *     const hub = intakeClient({ baseUrl, source: "memorylane-map", key: process.env.HUB_INTAKE_KEY });
 *     const r = newReceipt();                          // show r.code to the submitter; send only r.sha256
 *     const { intake_id } = await hub.submit({ external_id, kind: "memory", payload, files, receipt_sha256: r.sha256 });
 *     await hub.uploadFile(intake_id, 1, buffer, "image/jpeg");
 *     await hub.receipt(r.sha256);                     // { status: received | in_review | published | not_published }
 *
 *   Feed (read-only, verified): what the hub has published.
 *     const feed = feedReader({ feedUrl, rootPublicKey: process.env.HUB_FEED_ROOT_KEY });
 *     const { records, tombstones } = await feed.load();   // throws if anything fails verification
 *
 * Keep the intake key on the server. Never put it in a browser.
 */
const crypto = require("crypto");

const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------
function signHeaders({ source, key, method, path, body }) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(18).toString("base64url");   // fresh per request, so retries aren't replays
  const msg = `${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${sha256hex(body || Buffer.alloc(0))}`;
  return {
    "X-ML-Source": source,
    "X-ML-Timestamp": ts,
    "X-ML-Nonce": nonce,
    "X-ML-Signature": crypto.createHmac("sha256", key).update(msg).digest("hex"),
  };
}

function intakeClient({ baseUrl, source, key, timeoutMs = 60000 }) {
  if (!baseUrl || !source || !key) throw new Error("hub intake: baseUrl, source and key are required");
  const base = baseUrl.replace(/\/+$/, "");

  async function call(method, path, body, contentType) {
    const url = new URL(base + path);
    const headers = signHeaders({ source, key, method, path: url.pathname, body });
    if (contentType) headers["Content-Type"] = contentType;
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`hub ${method} ${path}: HTTP ${res.status} ${JSON.stringify(data.detail ?? data).slice(0, 300)}`);
      err.status = res.status;
      err.retryable = res.status >= 500 || res.status === 429 || res.status === 401; // 401: clock skew, or key rotated
      throw err;
    }
    return data;
  }

  return {
    /** envelope: { external_id, kind, payload, links?, files?: [{n, mime, bytes}], contact?, consents?, receipt_sha256?, lang?, submitted_at?, legacy_public? } */
    submit: (envelope) => call("POST", "/intake/v1/submissions", Buffer.from(JSON.stringify(envelope), "utf8"), "application/json"),
    uploadFile: (intakeId, n, buffer, mime) =>
      call("PUT", `/intake/v1/submissions/${encodeURIComponent(intakeId)}/files/${n}`, buffer, mime || "application/octet-stream"),
    receipt: (receiptSha256) => call("GET", `/intake/v1/receipts/${receiptSha256}`),
    contactKey: () => call("GET", "/intake/v1/contact-key"),
  };
}

/** A receipt code for the submitter (shown once) and the hash the hub stores. */
function newReceipt() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(15);
  let code = "";
  for (let i = 0; i < 15; i++) code += alphabet[bytes[i] % alphabet.length] + (i % 5 === 4 && i < 14 ? "-" : "");
  return { code, sha256: receiptHash(code) };
}

function receiptHash(code) {
  return sha256hex(Buffer.from(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ""), "utf8"));
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
function ed25519Key(b64) {
  const x = Buffer.from(b64, "base64").toString("base64url");
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

function ed25519Verify(pubB64, data, sigB64) {
  try {
    return crypto.verify(null, Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"), ed25519Key(pubB64),
      Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}

/** Same rules as feedkeys.check_delegation in the hub. Returns null if ok, else the reason. */
function checkDelegation(keysDoc, rootPublicKey, onlinePublic, now = new Date()) {
  const d = keysDoc && keysDoc.delegation;
  if (!d || d.root_public !== rootPublicKey || !ed25519Verify(rootPublicKey, d.statement, d.signature))
    return "delegation not signed by the pinned root key";
  const s = JSON.parse(d.statement);
  if (s.schema !== "memlane-feed-delegation/1" || s.online_public !== onlinePublic) return "delegation is for another key";
  if (!(new Date(s.not_before) <= now && now <= new Date(s.not_after))) return "delegation expired or not yet valid";
  for (const r of keysDoc.revocations || []) {
    if (!ed25519Verify(rootPublicKey, r.statement, r.signature)) continue;
    const rs = JSON.parse(r.statement);
    if (rs.schema === "memlane-feed-revocation/1" && rs.online_public === onlinePublic) return "online key revoked";
  }
  return null;
}

function feedReader({ feedUrl, rootPublicKey, timeoutMs = 30000, concurrency = 8 }) {
  if (!feedUrl || !rootPublicKey) throw new Error("hub feed: feedUrl and rootPublicKey are required");
  const base = feedUrl.replace(/\/+$/, "") + "/";

  async function get(path, asBuffer) {
    const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) throw new Error(`feed ${path}: HTTP ${res.status}`);
    return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.text();
  }

  /**
   * Fetch and verify the whole feed. `cache` (optional): Map public_id -> {version, record} from the last load;
   * records whose version didn't change are reused instead of re-fetched.
   */
  async function load(cache = new Map()) {
    const [keysText, indexBuf, sigText] = await Promise.all([get("keys.json"), get("index.json", true), get("index.json.sig")]);
    const keysDoc = JSON.parse(keysText);
    const sig = JSON.parse(sigText);
    const problem = checkDelegation(keysDoc, rootPublicKey, sig.online_public);
    if (problem) throw new Error(`feed not trusted: ${problem}`);
    if (!ed25519Verify(sig.online_public, indexBuf, sig.signature)) throw new Error("feed not trusted: bad index signature");
    const index = JSON.parse(indexBuf.toString("utf8"));
    if (index.schema !== "memlane-feed-index/1") throw new Error(`feed: unknown schema ${index.schema}`);

    const records = new Map();
    const queue = [...index.records];
    async function worker() {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const hit = cache.get(e.public_id);
        if (hit && hit.sha256 === e.sha256) { records.set(e.public_id, hit); continue; }
        const buf = await get(e.path, true);
        if (sha256hex(buf) !== e.sha256) throw new Error(`feed: ${e.path} does not match its hash in the signed index`);
        records.set(e.public_id, { version: e.version, sha256: e.sha256, record: JSON.parse(buf.toString("utf8")) });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { generatedAt: index.generated_at, records, tombstones: index.tombstones || [], onlinePublic: sig.online_public };
  }

  return {
    load,
    /** Absolute URL of a feed file (records list paths relative to the feed root). */
    fileUrl: (path) => new URL(path, base).toString(),
    /** Fetch a file and check it against the sha256 its (verified) record gives. */
    async fetchFile(path, sha256) {
      const buf = await get(path, true);
      if (sha256hex(buf) !== sha256) throw new Error(`feed: ${path} does not match its hash`);
      return buf;
    },
  };
}

module.exports = { intakeClient, newReceipt, receiptHash, feedReader, checkDelegation, ed25519Verify, signHeaders };
