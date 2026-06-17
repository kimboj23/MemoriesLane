"use strict";
/**
 * Archive API — authenticated, not public-facing.
 *
 * POST /api/archive            — queue a source URL for archiving against a case
 * GET  /api/archive/queue      — list archive jobs (optionally ?caseId=)
 * GET  /api/archive/:id        — single job status
 * POST /api/archive/:id/retry  — requeue a failed/partial job
 *
 * Archiving itself runs on the local archive-worker, which polls Supabase for
 * pending rows. This API only enqueues and reports status — it does no heavy
 * work, so it is safe to run on a serverless/cloud host.
 *
 * All routes require Authorization: Bearer <admin_token>.
 */
const express = require("express");
const crypto = require("crypto");
const { queries } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();
router.use(requireAdmin);
router.use(rateLimit(60, "archive"));

const VALID_MEDIA = new Set(["web", "document", "social"]);
const VALID_TOOL = new Set(["archive-box", "auto-archiver"]);
const VALID_CAT = new Set(["news", "event"]);
// Fallback tool when the client doesn't send one (older clients). Wayback (public
// Internet Archive link) is attempted for every job by the worker regardless.
const TOOL_FOR_MEDIA = { web: "archive-box", document: "archive-box", social: "auto-archiver" };

function genId() { return crypto.randomBytes(9).toString("base64url"); }
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function clean(v, max) {
  if (v == null) return null;
  return String(v).replace(/<[^>]*>/g, "").trim().slice(0, max) || null;
}
function validUrl(u) {
  try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// POST /api/archive
// ---------------------------------------------------------------------------
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = [];

    // caseId is optional — materials are first-class and may stand alone
    // (e.g. submitted into a thematic collection before any case exists).
    const case_id = clean(b.caseId, 64);

    const original_url = typeof b.originalUrl === "string" ? b.originalUrl.trim() : "";
    if (!original_url || !validUrl(original_url)) errors.push("originalUrl must be a valid http(s) URL");

    const media_type = VALID_MEDIA.has(b.mediaType) ? b.mediaType : null;
    if (!media_type) errors.push(`mediaType must be one of: ${[...VALID_MEDIA].join(", ")}`);

    const collection = clean(b.collection, 80);
    const lat = Number.isFinite(b.lat) ? b.lat : null;
    const lng = Number.isFinite(b.lng) ? b.lng : null;
    const city = clean(b.city, 100);
    const cat = VALID_CAT.has(b.cat) ? b.cat : null;
    if (b.cat && !cat) errors.push(`cat must be one of: ${[...VALID_CAT].join(", ")}`);

    if (errors.length) return res.status(400).json({ error: "Validation failed", details: errors });

    // Confirm the case exists before queueing, when one was given (FK would
    // reject anyway, but a clean 404 is friendlier than a 500).
    if (case_id) {
      const theCase = await queries.caseById(case_id);
      if (!theCase) return res.status(404).json({ error: "Case not found" });
    }

    // Tool is chosen independently of media type; fall back by media type.
    const tool = VALID_TOOL.has(b.tool) ? b.tool : TOOL_FOR_MEDIA[media_type];

    const id = genId();
    await queries.archiveInsert({
      id,
      case_id,
      collection,
      tool,
      media_type,
      title_vi: clean(b.titleVi, 300),
      title_en: clean(b.titleEn, 300),
      source: clean(b.source, 200),
      account: clean(b.account, 200),
      doc_date: clean(b.date, 40),
      notes: clean(b.notes, 1000),
      lat,
      lng,
      city,
      cat,
      original_url,
      created_at: todayUTC(),
    });

    res.status(202).json({ id, status: "pending", message: "Queued for archiving." });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/archive/queue
// ---------------------------------------------------------------------------
router.get("/queue", async (req, res, next) => {
  try {
    const caseId = clean(req.query.caseId, 64);
    const rows = await queries.archiveQueue(caseId);
    res.json({ archives: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/archive/:id
// ---------------------------------------------------------------------------
router.get("/:id([A-Za-z0-9_-]{1,24})", async (req, res, next) => {
  try {
    const row = await queries.archiveById(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/archive/:id — reassign case and/or set topic tags
// ---------------------------------------------------------------------------
router.patch("/:id([A-Za-z0-9_-]{1,24})", async (req, res, next) => {
  try {
    const b = req.body || {};
    const existing = await queries.archiveById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (typeof b.caseId === "string" && b.caseId.trim()) {
      const theCase = await queries.caseById(b.caseId.trim());
      if (!theCase) return res.status(404).json({ error: "Target case not found" });
      await queries.archiveSetCase(req.params.id, b.caseId.trim());
    }
    if (Array.isArray(b.topics)) {
      await queries.setArchiveTopics(req.params.id, b.topics.map((s) => String(s)));
    }
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/archive/:id/approve — editorial gate: publish a captured material
// ---------------------------------------------------------------------------
router.post("/:id([A-Za-z0-9_-]{1,24})/approve", async (req, res, next) => {
  try {
    const result = await queries.archiveApprove(req.params.id);
    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Not found, or not in a publishable (archived/partial) state" });
    }
    res.json({ ok: true, id: req.params.id, approved: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/archive/:id/reject — editorial gate: keep a material out of public view
// ---------------------------------------------------------------------------
router.post("/:id([A-Za-z0-9_-]{1,24})/reject", async (req, res, next) => {
  try {
    const reason = clean((req.body || {}).reason, 500);
    const existing = await queries.archiveById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    await queries.archiveReject(req.params.id, reason);
    res.json({ ok: true, id: req.params.id, rejected: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/archive/:id/retry
// ---------------------------------------------------------------------------
router.post("/:id([A-Za-z0-9_-]{1,24})/retry", async (req, res, next) => {
  try {
    const result = await queries.archiveRetry(req.params.id);
    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Not found, or not in a retryable (failed/partial) state" });
    }
    res.json({ ok: true, id: req.params.id, status: "pending" });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/archive/:id — remove an archive record from the queue/index
// ---------------------------------------------------------------------------
router.delete("/:id([A-Za-z0-9_-]{1,24})", async (req, res, next) => {
  try {
    const result = await queries.archiveDelete(req.params.id);
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, id: req.params.id, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
