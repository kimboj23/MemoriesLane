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
// Local tool is implied by media type: social → auto-archiver, else ArchiveBox.
// Wayback (public Internet Archive link) is attempted for every job by the worker.
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

    const case_id = clean(b.caseId, 64);
    if (!case_id) errors.push("caseId is required");

    const original_url = typeof b.originalUrl === "string" ? b.originalUrl.trim() : "";
    if (!original_url || !validUrl(original_url)) errors.push("originalUrl must be a valid http(s) URL");

    const media_type = VALID_MEDIA.has(b.mediaType) ? b.mediaType : null;
    if (!media_type) errors.push(`mediaType must be one of: ${[...VALID_MEDIA].join(", ")}`);

    if (errors.length) return res.status(400).json({ error: "Validation failed", details: errors });

    // Confirm the case exists before queueing (FK would reject anyway, but a
    // clean 404 is friendlier than a 500).
    const theCase = await queries.caseById(case_id);
    if (!theCase) return res.status(404).json({ error: "Case not found" });

    const id = genId();
    await queries.archiveInsert({
      id,
      case_id,
      tool: TOOL_FOR_MEDIA[media_type],
      media_type,
      title_vi: clean(b.titleVi, 300),
      title_en: clean(b.titleEn, 300),
      source: clean(b.source, 200),
      account: clean(b.account, 200),
      doc_date: clean(b.date, 40),
      notes: clean(b.notes, 1000),
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

module.exports = router;
