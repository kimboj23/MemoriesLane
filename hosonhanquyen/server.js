"use strict";
/**
 * Hồ sơ Nhân quyền: a public site of the MemoryLane hub (docs/integration-design.md, docs/spoke-integration.md).
 *
 * It holds no database and no review power:
 *   - what it shows is the hub's signed publication feed, verified against the pinned root key
 *     (lib/hub-client.js feedReader), refreshed every FEED_REFRESH_S or when the hub nudges POST /api/feed-changed;
 *   - what people send (/report-case, /submit) is forwarded at once to the hub's Intake API (signed, write-only),
 *     and the submitter gets a receipt code; nothing is kept here.
 *
 * No IP addresses are logged or stored; rate limits use an HMAC of the address that changes every hour.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { intakeClient, newReceipt, receiptHash, feedReader } = require("./lib/hub-client");

const env = process.env;
const PORT = parseInt(env.PORT, 10) || 3903;
const BIND = env.BIND_ADDR || "127.0.0.1";
const REFRESH_S = Math.max(20, parseInt(env.FEED_REFRESH_S, 10) || 60);
const TILE_URL = env.TILE_URL || "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const RATE_SECRET = env.RATE_HMAC_SECRET || crypto.randomBytes(32).toString("hex");
// Which of the hub's collections (project codes) this site shows.
const COLLECTIONS = new Set((env.FEED_COLLECTIONS || "HSNQ").split(",").map((s) => s.trim()).filter(Boolean));

for (const k of ["HUB_URL", "HUB_SOURCE", "HUB_INTAKE_KEY", "HUB_FEED_URL", "HUB_FEED_ROOT_KEY"]) {
  if (!env[k]) { console.error(`[config] ${k} is not set (see .env.example)`); process.exit(1); }
}
const hub = intakeClient({ baseUrl: env.HUB_URL, source: env.HUB_SOURCE, key: env.HUB_INTAKE_KEY });
const feed = feedReader({ feedUrl: env.HUB_FEED_URL, rootPublicKey: env.HUB_FEED_ROOT_KEY });

// ---------------------------------------------------------------------------
// The verified feed, reshaped for the pages
// ---------------------------------------------------------------------------
const GROUPS = { "Vi phạm": "vi-pham", "Tố tụng": "to-tung", "Hạn chế mạng xã hội": "han-che-mang-xa-hoi",
                 "Phong trào xã hội": "phong-trao-xa-hoi" };
let cache = new Map();
let state = { cases: [], byId: new Map(), files: new Map(), verifiedAt: null, onlineKey: null, error: null, generatedAt: null };

function groupSlug(g) { return GROUPS[g] || (g ? "khac" : null); }

function shapeCase(r) {
  const materials = (r.materials || []).map((m) => ({
    id: m.public_id, platform: m.platform, kind: m.kind, status: m.public_status, captured_at: m.captured_at,
    title: m.title, summary: m.summary, original_url: m.original_url, wayback_url: m.wayback_url,
    manifest_sha256: m.verification && m.verification.manifest_sha256,
    files: (m.files || []).map((f) => ({ ...f, url: "/files/" + f.url })),
  }));
  return {
    id: r.public_id, version: r.version, published_at: r.published_at, title: r.title, summary: r.summary,
    group: r.group || null, group_slug: groupSlug(r.group), tags: r.tags || [], status: r.public_status,
    date: r.date, location: r.location, credit: r.credit, materials,
    community_files: (r.community_files || []).map((f) => ({ ...f, url: "/files/" + f.url })),
    notes: (r.notes || []).map((n) => ({ id: n.public_id, text: n.text, date: n.date, location: n.location, credit: n.credit })),
  };
}

async function refresh() {
  try {
    const f = await feed.load(cache);
    cache = f.records;
    const cases = [];
    const files = new Map();
    for (const { record } of f.records.values()) {
      if (record.type !== "incident") continue;   // this site shows cases; memories belong to the community map
      if (!COLLECTIONS.has(record.collection)) continue;
      const c = shapeCase(record);
      cases.push(c);
      for (const x of [...c.community_files, ...c.materials.flatMap((m) => m.files)]) files.set(x.url.slice(7), x.sha256);
    }
    cases.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    state = { cases, byId: new Map(cases.map((c) => [c.id, c])), files, verifiedAt: new Date().toISOString(),
              onlineKey: f.onlineKey, error: null, generatedAt: f.generatedAt };
  } catch (e) {
    state = { ...state, error: e.message };   // keep serving the last verified copy, never unverified data
    console.warn("[feed]", e.message);
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : false);
const tileOrigin = (() => { try { return new URL(TILE_URL.replace("{s}", "a")).origin.replace("//a.", "//*."); } catch { return ""; } })();
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'",
    `img-src 'self' data: blob: ${tileOrigin}`, "media-src 'self' blob:", "connect-src 'self'", "frame-ancestors 'none'",
    "base-uri 'none'", "form-action 'self'"].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  next();
});

// IP-free rate limit (same idea as the community map's backend)
const hits = new Map();
let hitWindow = 0;
function limit(n) {
  return (req, res, next) => {
    const w = Math.floor(Date.now() / 3600e3);
    if (w !== hitWindow) { hits.clear(); hitWindow = w; }
    const k = crypto.createHmac("sha256", RATE_SECRET + w).update(String(req.ip || "")).digest("hex").slice(0, 24) + req.path;
    const c = (hits.get(k) || 0) + 1;
    hits.set(k, c);
    if (c > n) return res.status(429).json({ error: "Quá nhiều yêu cầu, hãy thử lại sau." });
    next();
  };
}

app.use(express.json({ limit: "30mb" }));

// libsodium for sealing contact details in the browser: the ESM build, with its bare import made a local path
const sodiumDir = path.join(__dirname, "node_modules", "libsodium-wrappers");   // packages without ./package.json export
const libDir = path.join(__dirname, "node_modules", "libsodium");
app.get("/vendor/sodium.mjs", (req, res) => {
  res.type("text/javascript").setHeader("Cache-Control", "public, max-age=86400");
  res.send(fs.readFileSync(path.join(sodiumDir, "dist/modules-esm/libsodium-wrappers.mjs"), "utf8")
    .replace(/from\s*"libsodium"/, 'from"/vendor/libsodium.mjs"'));
});
app.get("/vendor/libsodium.mjs", (req, res) => {
  res.type("text/javascript").setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(libDir, "dist/modules-esm/libsodium.mjs"));
});

// ---- read API (from the verified feed) ----
const text = (x) => (x && (x.vi || x.en)) || "";
app.get("/api/config", (req, res) => res.json({ tile_url: TILE_URL, groups: Object.keys(GROUPS) }));
app.get("/api/status", (req, res) => res.json({
  verified_at: state.verifiedAt, feed_generated_at: state.generatedAt, online_key: state.onlineKey,
  root_key: env.HUB_FEED_ROOT_KEY, error: state.error, cases: state.cases.length,
  materials: state.cases.reduce((n, c) => n + c.materials.length, 0),
  notes: state.cases.reduce((n, c) => n + c.notes.length, 0),
}));
app.get("/api/cases", limit(600), (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const g = String(req.query.group || "");
  const list = state.cases.filter((c) => (!g || c.group_slug === g) &&
    (!q || [text(c.title), text(c.summary), ...(c.tags || []), c.group || ""].some((x) => x.toLowerCase().includes(q))));
  const counts = {};
  for (const c of state.cases) counts[c.group_slug || "khac"] = (counts[c.group_slug || "khac"] || 0) + 1;
  res.json({ cases: list.map(({ materials, notes, community_files, ...c }) => ({ ...c, material_count: materials.length,
    note_count: notes.length })), counts, total: state.cases.length });
});
app.get("/api/cases/:id", limit(600), (req, res) => {
  const c = state.byId.get(req.params.id);
  return c ? res.json(c) : res.status(404).json({ error: "Không tìm thấy hồ sơ." });
});
app.get("/api/evidence", limit(600), (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const out = [];
  for (const c of state.cases) for (const m of c.materials) {
    if (q && ![m.title, text(m.summary), m.platform, text(c.title), m.original_url].some((x) => (x || "").toLowerCase().includes(q))) continue;
    out.push({ ...m, case: { id: c.id, title: c.title, group: c.group } });
  }
  out.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  res.json({ evidence: out });
});

// Published files, fetched from the feed and checked against the hash in the signed record before serving.
app.get(/^\/files\/(files\/[0-9a-f]{64}\.[a-z0-9]{2,5})$/, limit(2000), async (req, res) => {
  const p = req.params[0];
  const sha = state.files.get(p);
  if (!sha) return res.status(404).end();
  try {
    const buf = await feed.fetchFile(p, sha);
    const ext = path.extname(p).slice(1);
    res.type({ webp: "image/webp", mp4: "video/mp4", webm: "video/webm", m4a: "audio/mp4", mp3: "audio/mpeg" }[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("X-Content-SHA256", sha);
    res.send(buf);
  } catch { res.status(502).end(); }
});

app.post("/api/feed-changed", limit(30), (req, res) => { refresh(); res.status(202).json({ ok: true }); });

// ---- write API (forwarded to the hub's Intake API) ----
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "") || undefined;
const GROUP_KEYS = { "vi-pham": "violation", "to-tung": "proceeding", "han-che-mang-xa-hoi": "platform_restriction", "phong-trao-xa-hoi": "movement" };
const DATA_URL = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;
const MAX_FILE = 20 * 1024 * 1024;

function decodeFile(f) {
  if (!f) return null;
  const m = DATA_URL.exec(f.data || "");
  if (!m) throw Object.assign(new Error("Tệp không hợp lệ."), { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_FILE) throw Object.assign(new Error("Tệp quá 20 MB."), { status: 413 });
  return { buf, mime: m[1] };
}

async function forward(envelope, file) {
  const r = newReceipt();
  envelope.receipt_sha256 = r.sha256;
  if (file) envelope.files = [{ n: 1, mime: file.mime, bytes: file.buf.length }];
  const res = await hub.submit(envelope);
  if (file) {
    const up = await hub.uploadFile(res.intake_id, 1, file.buf, file.mime);
    if (up.sha256 !== crypto.createHash("sha256").update(file.buf).digest("hex")) throw new Error("file mismatch");
  }
  return r.code;
}

function sendError(res, e) {
  console.warn("[intake]", e.status || "", e.message);
  if (e.status === 413 || e.status === 400) return res.status(e.status).json({ error: e.message });
  if (e.status === 422) return res.status(400).json({ error: "Tệp hoặc thông tin không được chấp nhận (kiểm tra định dạng tệp)." });
  res.status(503).json({ error: "Không gửi được tới kho lưu trữ lúc này. Nội dung chưa được lưu; hãy thử lại sau ít phút." });
}

app.post("/api/report", limit(10), async (req, res) => {
  const b = req.body || {};
  const group = GROUP_KEYS[b.group];
  const title = clean(b.title, 300);
  const description = clean(b.description, 10000);
  if (!group || !title || !description || !b.consent) return res.status(400).json({ error: "Hãy điền các mục bắt buộc (*)." });
  try {
    const file = decodeFile(b.file);
    const fields = {};
    for (const [k, v] of Object.entries(b.fields || {}).slice(0, 30)) { const c = clean(v, 2000); if (c) fields[clean(k, 60)] = c; }
    const lat = Number(b.lat), lng = Number(b.lng);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? { year: +b.date.slice(0, 4), month: +b.date.slice(5, 7), day: +b.date.slice(8, 10) } : undefined;
    const code = await forward({
      external_id: "report-" + crypto.randomBytes(9).toString("base64url"), kind: "case_report", lang: "vi",
      submitted_at: new Date().toISOString(),
      payload: { group, title, description, timeline: clean(b.timeline, 10000), date, fields, pseudonym: clean(b.alias, 80),
        location: Number.isFinite(lat) && Number.isFinite(lng) && b.lat !== "" ? { lat, lng, precision_wish: "ward", label: clean(b.place, 200) }
          : (clean(b.place, 200) ? { label: clean(b.place, 200) } : undefined) },
      links: [clean(b.link, 2000)].filter((u) => u && /^https:\/\//i.test(u)),
      contact: b.contact_sealed ? { sealed: String(b.contact_sealed).slice(0, 4000) } : undefined,
      consents: { has_basis: true, anonymous: !!b.anonymous },
    }, file);
    res.status(202).json({ receipt: code });
  } catch (e) { sendError(res, e); }
});

app.post("/api/submit", limit(10), async (req, res) => {
  const b = req.body || {};
  const title = clean(b.title, 300);
  if (!title || !clean(b.doc_type, 80) || !b.consent) return res.status(400).json({ error: "Hãy điền các mục bắt buộc (*)." });
  const alt = clean(b.alt_link, 2000);
  if (alt && !/^https:\/\//i.test(alt)) return res.status(400).json({ error: "Liên kết thay thế phải bắt đầu bằng https://" });
  try {
    const file = decodeFile(b.file);
    if (!file && !alt) return res.status(400).json({ error: "Hãy chọn một tệp hoặc nhập liên kết HTTPS." });
    const caseRef = state.byId.has(b.case_ref) ? b.case_ref : undefined;
    const code = await forward({
      external_id: "doc-" + crypto.randomBytes(9).toString("base64url"), kind: "document", lang: "vi",
      submitted_at: new Date().toISOString(),
      payload: { doc_type: clean(b.doc_type, 80), title, context: clean(b.context, 10000), case_ref: caseRef, alt_link: alt,
        pseudonym: clean(b.alias, 80) },
      links: alt ? [alt] : [],
      contact: b.contact_sealed ? { sealed: String(b.contact_sealed).slice(0, 4000) } : undefined,
      consents: { has_rights: true, anonymous: !!b.anonymous },
    }, file);
    res.status(202).json({ receipt: code });
  } catch (e) { sendError(res, e); }
});

app.get("/api/receipts/:code([A-Za-z0-9-]{10,40})", limit(60), async (req, res) => {
  try { res.json(await hub.receipt(receiptHash(req.params.code))); }
  catch (e) { res.status(e.status === 404 ? 404 : 503).json({ status: e.status === 404 ? "unknown" : "unavailable" }); }
});

let contactKey = null;
app.get("/api/contact-key", limit(120), async (req, res) => {
  try {
    if (!contactKey) contactKey = (await hub.contactKey()).public_key;
    res.json({ public_key: contactKey });
  } catch { res.status(503).json({ public_key: null }); }
});

// ---- pages: one HTML shell, routed in the browser ----
app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: "1h" }));
app.get(/^\/(?!api\/|files\/|vendor\/).*/, (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

refresh();
setInterval(refresh, REFRESH_S * 1000).unref();
app.listen(PORT, BIND, () => console.log(`[hsnq] listening on ${BIND}:${PORT}; feed ${env.HUB_FEED_URL}`));
