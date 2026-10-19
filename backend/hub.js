"use strict";
/**
 * The community map as a "spoke" of the MemoryLane hub (docs/integration-design.md, docs/spoke-integration.md).
 * Everything here is off unless configured, so the live site behaves exactly as before:
 *
 *   Intake (HUB_URL + HUB_SOURCE + HUB_INTAKE_KEY): new memories are written together with an outbox row in one
 *   transaction, and a relay forwards them (text, then the file) to the hub's Intake API, with retries. Once the
 *   hub has confirmed the file's hash, the local copy is deleted (HUB_PURGE_AFTER_FORWARD, default on): the hub is
 *   the system of record and moderation happens there (decision 1), so this server keeps nothing of value.
 *
 *   Feed (HUB_FEED_URL + HUB_FEED_ROOT_KEY): the site shows what the hub published. The feed is fetched and
 *   verified (pinned root key → delegation → signed index → record hashes) every HUB_FEED_REFRESH_S seconds, or
 *   when the hub nudges POST /api/hub-feed-changed. Records are reshaped into the rows the frontend already reads.
 *
 *   PUBLIC_SOURCE: what the public API serves. "db" (default: local approved rows only, as before), "both" (the
 *   migration period: local rows plus the feed; a feed memory with the same legacy id replaces the local one), or
 *   "feed" (only what the hub published).
 */
const fs = require("fs");
const path = require("path");
const { intakeClient, newReceipt, receiptHash, feedReader } = require("./lib/hub-client");

const env = process.env;
const intakeOn = !!(env.HUB_URL && env.HUB_SOURCE && env.HUB_INTAKE_KEY);
const feedOn = !!(env.HUB_FEED_URL && env.HUB_FEED_ROOT_KEY);
const PUBLIC_SOURCE = ["db", "both", "feed"].includes(env.PUBLIC_SOURCE) ? env.PUBLIC_SOURCE : "db";
const PURGE = env.HUB_PURGE_AFTER_FORWARD !== "false";
const hub = intakeOn ? intakeClient({ baseUrl: env.HUB_URL, source: env.HUB_SOURCE, key: env.HUB_INTAKE_KEY }) : null;
const feed = feedOn ? feedReader({ feedUrl: env.HUB_FEED_URL, rootPublicKey: env.HUB_FEED_ROOT_KEY }) : null;

let pool = null;
let storage = null;
let uploadsDir = null;

async function init(pg, store, dir) {
  pool = pg; storage = store; uploadsDir = dir;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_outbox (
      id           BIGSERIAL PRIMARY KEY,
      kind         TEXT NOT NULL CHECK (kind IN ('memory','legacy_memory','legacy_case','legacy_archive')),
      ref_id       TEXT NOT NULL,
      receipt_sha  TEXT,
      state        TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
      attempts     INTEGER NOT NULL DEFAULT 0,
      next_try_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error   TEXT,
      intake_id    TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at      TIMESTAMPTZ,
      UNIQUE (kind, ref_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_hub_outbox_due ON hub_outbox(next_try_at) WHERE state = 'pending'`);
  if (intakeOn) setInterval(() => relay().catch((e) => console.warn("[hub] relay:", e.message)), 10_000).unref();
  if (feedOn) {
    refreshFeed().catch((e) => console.warn("[hub] feed:", e.message));
    setInterval(() => refreshFeed().catch((e) => console.warn("[hub] feed:", e.message)),
      Math.max(30, parseInt(env.HUB_FEED_REFRESH_S, 10) || 300) * 1000).unref();
  }
  console.log(`[hub] intake ${intakeOn ? "on" : "off"}, feed ${feedOn ? "on" : "off"}, public source: ${PUBLIC_SOURCE}`);
}

// ---------------------------------------------------------------------------
// Intake: transactional outbox + relay
// ---------------------------------------------------------------------------
/** Insert a memory and its outbox row atomically. Returns the receipt code to show the submitter (or null). */
async function insertMemory(insertFn, row) {
  if (!intakeOn) { await insertFn(pool, row); return null; }
  const receipt = newReceipt();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertFn(client, row);
    await client.query("INSERT INTO hub_outbox (kind, ref_id, receipt_sha) VALUES ('memory', $1, $2)", [row.id, receipt.sha256]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  setImmediate(() => relay().catch(() => {}));
  return receipt.code;
}

async function enqueue(kind, refId) {
  const r = await pool.query("INSERT INTO hub_outbox (kind, ref_id) VALUES ($1, $2) ON CONFLICT (kind, ref_id) DO NOTHING", [kind, refId]);
  return r.rowCount;
}

function memoryEnvelope(m, kind, receiptSha) {
  const legacy = kind === "legacy_memory";
  const named = m.attribution === "pseudonym" || m.attribution === "real-name";
  return {
    external_id: `${legacy ? "legacy-memory" : "memory"}-${m.id}`,
    kind: "memory",
    lang: m.lang || "vi",
    submitted_at: m.submit_date ? new Date(m.submit_date + "T00:00:00Z").toISOString() : undefined,
    legacy_public: legacy,
    receipt_sha256: receiptSha || undefined,
    payload: {
      text: m.text_vi, text_en: m.text_en || undefined, category: m.cat,
      date: { year: m.year, month: m.month || undefined, day: m.day || undefined, label: m.date_label || undefined },
      // Legacy memories were public with their exact point; new ones are approximate unless the submitter allowed it.
      location: { lat: m.lat, lng: m.lng, ward: m.ward && m.ward !== "—" ? m.ward : undefined, city: m.city,
                  allow_exact: legacy || !!m.allow_exact, precision_wish: legacy || m.allow_exact ? undefined : "ward" },
      case_ref: m.case_id || undefined,
      pseudonym: named && m.author_name ? m.author_name : undefined,
    },
    links: m.media_url ? [m.media_url] : [],
    consents: { may_publish: true },
  };
}

async function readFile(photoPath) {
  if (storage.storageEnabled()) return storage.downloadPhoto(photoPath);
  const abs = path.resolve(uploadsDir, photoPath);
  if (!abs.startsWith(path.resolve(uploadsDir) + path.sep)) throw new Error("bad path");
  return fs.promises.readFile(abs);
}

async function deleteFile(photoPath) {
  try {
    if (storage.storageEnabled()) { if (storage.deletePhoto) await storage.deletePhoto(photoPath); }
    else await fs.promises.unlink(path.resolve(uploadsDir, photoPath));
  } catch (e) { console.warn("[hub] could not delete forwarded file:", e.message); }
}

async function buildEnvelope(o) {
  if (o.kind === "memory" || o.kind === "legacy_memory") {
    const { rows } = await pool.query("SELECT * FROM memories WHERE id = $1", [o.ref_id]);
    if (!rows[0]) return null;
    const m = rows[0];
    const env_ = memoryEnvelope(m, o.kind, o.receipt_sha);
    let file = null;
    if (m.has_photo && m.photo_path) {
      file = { buf: await readFile(m.photo_path), mime: m.file_mime || "image/webp", path: m.photo_path };
      env_.files = [{ n: 1, mime: file.mime, bytes: file.buf.length }];
    }
    return { envelope: env_, file, memory: m };
  }
  if (o.kind === "legacy_case") {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [o.ref_id]);
    if (!rows[0]) return null;
    const c = rows[0];
    // Old case pages had no group; the reviewers file it (the hub's incident from a "document" carries title + text).
    return { envelope: { external_id: `legacy-case-${c.id}`, kind: "document", lang: "vi",
      payload: { doc_type: "Hồ sơ trên bản đồ cũ", title: c.title_vi, context: [c.summary_vi, c.title_en, c.summary_en].filter(Boolean).join("\n\n").slice(0, 10000),
                 case_ref: c.id }, consents: { may_publish: true } } };
  }
  if (o.kind === "legacy_archive") {
    const { rows } = await pool.query("SELECT a.*, c.title_vi AS case_title FROM archives a LEFT JOIN cases c ON c.id = a.case_id WHERE a.id = $1", [o.ref_id]);
    if (!rows[0] || !rows[0].original_url) return null;
    const a = rows[0];
    const note = [a.title_vi, a.case_title ? `Hồ sơ cũ: ${a.case_title} (${a.case_id})` : null, a.notes,
                  a.wayback_url ? `Wayback: ${a.wayback_url}` : null].filter(Boolean).join("\n");
    return { envelope: { external_id: `legacy-archive-${a.id}`, kind: "link", payload: { url: a.original_url, note: note.slice(0, 5000) || undefined },
      consents: { may_publish: true } } };
  }
  return null;
}

let relaying = false;
async function relay() {
  if (!intakeOn || relaying) return;
  relaying = true;
  try {
    for (;;) {
      const { rows } = await pool.query(
        `UPDATE hub_outbox SET next_try_at = now() + interval '5 minutes'
          WHERE id = (SELECT id FROM hub_outbox WHERE state = 'pending' AND next_try_at <= now()
                      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING *`);
      const o = rows[0];
      if (!o) return;
      try {
        const built = await buildEnvelope(o);
        if (!built) { await pool.query("UPDATE hub_outbox SET state = 'failed', last_error = 'source row gone' WHERE id = $1", [o.id]); continue; }
        const res = await hub.submit(built.envelope);
        if (built.file) {
          const up = await hub.uploadFile(res.intake_id, 1, built.file.buf, built.file.mime);
          const local = require("crypto").createHash("sha256").update(built.file.buf).digest("hex");
          if (up.sha256 !== local) throw Object.assign(new Error("hub stored a different file"), { retryable: true });
        }
        await pool.query("UPDATE hub_outbox SET state = 'sent', sent_at = now(), intake_id = $2, last_error = NULL WHERE id = $1", [o.id, res.intake_id]);
        // The hub has it (text and file hash confirmed): drop the local copy of new submissions.
        if (o.kind === "memory" && PURGE && built.memory) {
          if (built.file) await deleteFile(built.file.path);
          await pool.query("DELETE FROM memories WHERE id = $1 AND approved = 0", [o.ref_id]);
        }
      } catch (e) {
        const attempts = o.attempts + 1;
        const fatal = e.retryable === false || (e.status && e.status >= 400 && e.status < 500 && ![401, 409, 429].includes(e.status));
        const waitMin = Math.min(360, 2 ** attempts);
        await pool.query(
          `UPDATE hub_outbox SET attempts = $2, last_error = $3, state = $4, next_try_at = now() + make_interval(mins => $5) WHERE id = $1`,
          [o.id, attempts, String(e.message).slice(0, 500), fatal ? "failed" : "pending", waitMin]);
        console.warn(`[hub] outbox ${o.id} (${o.kind} ${o.ref_id}) ${fatal ? "failed" : "will retry"}: ${e.message}`);
        if (!fatal) return;   // the hub is unreachable or busy: try the rest later
      }
    }
  } finally {
    relaying = false;
  }
}

async function receiptStatus(code) {
  if (!intakeOn) return null;
  try { return (await hub.receipt(receiptHash(code))).status; }
  catch (e) { if (e.status === 404) return "unknown"; throw e; }
}

// ---------------------------------------------------------------------------
// Feed: verified, cached, reshaped for the existing API
// ---------------------------------------------------------------------------
const CITIES = { hanoi: [21.0285, 105.8542], hcmc: [10.7769, 106.7009], hue: [16.4637, 107.5909],
                 danang: [16.0544, 108.2022], cantho: [10.0452, 105.7469] };
function nearestCity(lat, lng) {
  if (lat == null || lng == null) return null;
  let best = null, bd = Infinity;
  for (const [k, [a, b]] of Object.entries(CITIES)) {
    const d = (a - lat) ** 2 + (b - lng) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

let cache = new Map();       // public_id -> {version, sha256, record}
let state = { memories: [], memById: new Map(), cases: [], caseById: new Map(), loadedAt: null, error: null };

function dateParts(d) {
  if (!d || !d.value) return { year: null, month: null, day: null };
  const [y, m, dd] = String(d.value).split("-").map((x) => parseInt(x, 10));
  return { year: y || null, month: m || null, day: dd || null };
}

function memoryRow(r) {
  const loc = r.location || {};
  const { year, month, day } = dateParts(r.date);
  const file = (r.files || [])[0];
  return {
    // A migrated memory keeps its old id (legacy_id is the external id this site sent: "legacy-memory-<id>").
    id: (r.legacy_id && String(r.legacy_id).replace(/^legacy-memory-/, "")) || r.public_id, public_id: r.public_id,
    lat: loc.lat ?? null, lng: loc.lng ?? null, precision: loc.precision || null, radius_m: loc.radius_m || 0,
    city: nearestCity(loc.lat, loc.lng), ward: loc.label || null,
    cat: r.category || "personal", year, month, day,
    date_label: r.date && r.date.precision !== "day" ? r.date.value : null, date_label_en: null,
    lang: "vi", text_vi: r.text && r.text.vi, text_en: r.text && r.text.en,
    has_photo: file ? 1 : 0, media_type: file ? (file.kind === "video" ? "video" : "photo") : "text",
    case_id: r.case || null, attribution: r.credit ? "pseudonym" : "anonymous", author_name: r.credit || null,
    media_url: null, topics: [], _file: file || null,
  };
}

const PUBLIC_STATUS = { archived: "archived", partially_archived: "partial", restricted: "partial", login_wall: "partial", unavailable: "partial" };
function materialCard(m, caseRow) {
  const file = (m.files || [])[0];
  return {
    id: m.public_id, tool: "memorylane", mediaType: ["facebook", "threads", "instagram", "tiktok", "youtube", "x"].includes(m.platform) ? "social" : "web",
    collection: null, titleVi: (m.summary && m.summary.vi) || m.title || null, titleEn: (m.summary && m.summary.en) || null,
    source: m.platform, account: null, date: m.captured_at ? m.captured_at.slice(0, 10) : null, notes: null,
    lat: caseRow.lat, lng: caseRow.lng, city: caseRow.city, cat: null,
    originalUrl: m.original_url || null,
    archivedUrl: file ? feed.fileUrl(file.url) : (m.wayback_url || null), waybackUrl: m.wayback_url || null,
    localUrl: file ? feed.fileUrl(file.url) : null, waczUrl: null,
    sha256: (m.verification && m.verification.manifest_sha256) || null, toolVersion: null,
    status: PUBLIC_STATUS[m.public_status] || "partial", publicStatus: m.public_status,
    files: (m.files || []).map((f) => ({ ...f, url: feed.fileUrl(f.url) })),
    caseId: caseRow.id, caseTitleVi: caseRow.title_vi, caseTitleEn: caseRow.title_en, topics: [],
  };
}

function caseRow(r) {
  const loc = r.location || {};
  const row = {
    id: r.public_id, title_vi: r.title && r.title.vi, title_en: r.title && r.title.en,
    summary_vi: r.summary && r.summary.vi, summary_en: r.summary && r.summary.en,
    city: nearestCity(loc.lat, loc.lng), lat: loc.lat ?? null, lng: loc.lng ?? null,
    precision: loc.precision || null, radius_m: loc.radius_m || 0, place_label: loc.label || null,
    status: "active", public_status: r.public_status, group: r.group || null,
    created_at: (r.published_at || "").slice(0, 10), sections: [], topics: [],
  };
  row.archives = (r.materials || []).map((m) => materialCard(m, row));
  row.community_files = (r.community_files || []).map((f) => ({ ...f, url: feed.fileUrl(f.url) }));
  return row;
}

// A community note of a published case: a dot on the map, in the submitter's words, opening the case.
function noteRow(n, c) {
  const loc = n.location || {};
  const { year, month, day } = dateParts(n.date);
  return {
    id: n.public_id, public_id: n.public_id,
    lat: loc.lat ?? null, lng: loc.lng ?? null, precision: loc.precision || null, radius_m: loc.radius_m || 0,
    city: nearestCity(loc.lat, loc.lng), ward: loc.label || null,
    cat: n.category || "community", year, month, day,
    date_label: n.date && n.date.precision !== "day" ? n.date.value : null, date_label_en: null,
    lang: "vi", text_vi: n.text && n.text.vi, text_en: n.text && n.text.en,
    has_photo: 0, media_type: "text", case_id: c.id,
    attribution: n.credit ? "pseudonym" : "anonymous", author_name: n.credit || null, media_url: null, topics: [], _file: null,
  };
}

let refreshing = null;
async function refreshFeed() {
  if (!feedOn) return state;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { records } = await feed.load(cache);
      cache = records;
      const memories = [], cases = [];
      for (const { record } of records.values()) {
        if (record.type === "memory") memories.push(memoryRow(record));
        else if (record.type === "incident") {
          const c = caseRow(record);
          cases.push(c);
          for (const n of record.notes || []) memories.push(noteRow(n, c));
        }
      }
      state = { memories, memById: new Map(memories.flatMap((m) => [[m.id, m], [m.public_id, m]])),
                cases, caseById: new Map(cases.map((c) => [c.id, c])), loadedAt: new Date(), error: null };
    } catch (e) {
      // Keep serving the last verified copy; never serve unverified data.
      state = { ...state, error: e.message };
      throw e;
    } finally {
      refreshing = null;
    }
    return state;
  })();
  return refreshing;
}

const useFeed = () => feedOn && PUBLIC_SOURCE !== "db";
const useDb = () => PUBLIC_SOURCE !== "feed";

/** Public memory rows from the feed, filtered like queries.publicList. */
function feedMemories(city, minY, maxY) {
  if (!useFeed()) return [];
  return state.memories.filter((m) => m.lat != null && (!city || m.city === city) && (m.year == null || (m.year >= minY && m.year <= maxY)))
    .map(({ _file, ...m }) => m);
}

/** Merge local rows and feed rows: a feed memory that is the published version of a local one replaces it. */
function mergeMemories(dbRows, feedRows) {
  const ids = new Set(feedRows.map((m) => m.id));
  return [...dbRows.filter((r) => !ids.has(r.id)), ...feedRows];
}

async function feedPhoto(id) {
  const m = useFeed() && state.memById.get(id);
  if (!m || !m._file) return null;
  return { buf: await feed.fetchFile(m._file.url, m._file.sha256), mime: m._file.mime || "application/octet-stream" };
}

module.exports = {
  init, insertMemory, enqueue, relay, receiptStatus, refreshFeed,
  intakeOn: () => intakeOn, feedOn: () => feedOn, useFeed, useDb, publicSource: () => PUBLIC_SOURCE,
  feedMemories, mergeMemories, feedPhoto,
  feedMemory: (id) => { const m = useFeed() && state.memById.get(id); if (!m) return null; const { _file, ...rest } = m; return rest; },
  feedCase: (id) => (useFeed() ? state.caseById.get(id) || null : null),
  feedCases: (city) => (useFeed() ? state.cases.filter((c) => !city || c.city === city) : []),
  /** Published materials (from the hub's cases), filtered like queries.materialsList. */
  feedMaterials: ({ q, mediaType, city } = {}) => (useFeed() ? state.cases.flatMap((c) => c.archives)
    .filter((m) => (!city || m.city === city) && (!mediaType || m.mediaType === mediaType)
      && (!q || [m.titleVi, m.titleEn, m.source, m.originalUrl, m.caseTitleVi].some((x) => x && x.toLowerCase().includes(q.toLowerCase()))))
    : []),
  feedMaterial: (id) => (useFeed() ? state.cases.flatMap((c) => c.archives).find((m) => m.id === id) || null : null),
  feedCaseMemories: (id) => (useFeed() ? state.memories.filter((m) => m.case_id === id).map(({ _file, ...m }) => m) : []),
  status: () => ({ intake: intakeOn, feed: feedOn, publicSource: PUBLIC_SOURCE, loadedAt: state.loadedAt, error: state.error,
                   memories: state.memories.length, cases: state.cases.length }),
  _test: { memoryRow, caseRow, nearestCity, memoryEnvelope },
};
