"use strict";
/**
 * Case profile API — public, read-only.
 *
 * GET /api/cases/:id  — fetch a single case with its linked memories and topics
 */
const express = require("express");
const crypto = require("crypto");
const { queries, VALID_CITIES } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

const VALID_STATUS = new Set(["active", "resolved", "historical"]);
function clean(v, max) { return v == null ? null : String(v).replace(/<[^>]*>/g, "").trim().slice(0, max) || null; }
function num(v, lo, hi) { const n = parseFloat(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; }

// ---------------------------------------------------------------------------
// POST /api/cases  (admin) — create a case
// ---------------------------------------------------------------------------
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = [];
    const title_vi = clean(b.titleVi, 300);
    const summary_vi = clean(b.summaryVi, 4000);
    const city = VALID_CITIES.has(b.city) ? b.city : null;
    const status = VALID_STATUS.has(b.status) ? b.status : "active";
    if (!title_vi) errors.push("titleVi is required");
    if (!summary_vi) errors.push("summaryVi is required");
    if (!city) errors.push(`city must be one of: ${[...VALID_CITIES].join(", ")}`);
    if (errors.length) return res.status(400).json({ error: "Validation failed", details: errors });

    const id = "case-" + crypto.randomBytes(6).toString("base64url");
    await queries.caseCreate({
      id, title_vi, title_en: clean(b.titleEn, 300),
      summary_vi, summary_en: clean(b.summaryEn, 4000),
      city, lat: num(b.lat, -90, 90), lng: num(b.lng, -180, 180),
      status, created_at: new Date().toISOString().slice(0, 10),
    });
    if (Array.isArray(b.topics) && b.topics.length) await queries.setCaseTopics(id, b.topics);

    res.status(201).json({ id, status: "created" });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/cases  (admin) — list cases for management
// ---------------------------------------------------------------------------
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const rows = await queries.caseList();
    res.json({ cases: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
});

router.get("/:id([A-Za-z0-9_-]{1,64})", rateLimit(120, "read"), async (req, res, next) => {
  try {
    const row = await queries.caseById(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });

    let sections;
    try { sections = JSON.parse(row.sections); } catch { sections = []; }

    // archives now come from the normalized table (only successfully-archived
    // rows are returned); the legacy cases.archives JSON column is ignored.
    const [memories, topics, archives] = await Promise.all([
      queries.caseMemories(req.params.id),
      queries.topicsByCase(req.params.id),
      queries.archivesForCase(req.params.id),
    ]);

    res.json({
      case: { ...row, sections, archives, topics },
      memories,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
