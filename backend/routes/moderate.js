"use strict";
/**
 * Moderation API — authenticated, not public-facing.
 *
 * GET  /api/moderate/queue          — list up to 50 pending memories
 * POST /api/moderate/:id/approve    — approve a pending memory
 * POST /api/moderate/:id/reject     — reject with a reason
 *
 * All routes require Authorization: Bearer <admin_token>.
 * Rate limited independently from public routes (lower ceiling for
 * brute-force resistance on the token, although the sha256 hash makes
 * guessing effectively impossible).
 */
const express = require("express");
const { queries } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

// Apply auth check and a conservative rate limit to every moderation route.
router.use(requireAdmin);
router.use(rateLimit(60, "moderate")); // 60 moderation actions per hour, separate namespace

// ---------------------------------------------------------------------------
// GET /api/moderate/queue
// ---------------------------------------------------------------------------
router.get("/queue", (req, res, next) => {
  try {
    const rows = queries.pending();
    res.json({ pending: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/moderate/:id/approve
// ---------------------------------------------------------------------------
router.post("/:id([A-Za-z0-9_-]{1,24})/approve", (req, res, next) => {
  try {
    const result = queries.approve(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Not found or already moderated" });
    }
    res.json({ ok: true, id: req.params.id, action: "approved" });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/moderate/:id/reject
// ---------------------------------------------------------------------------
router.post("/:id([A-Za-z0-9_-]{1,24})/reject", (req, res, next) => {
  try {
    // Reason is optional but useful for audit trails; sanitise it.
    const reason = typeof req.body.reason === "string"
      ? req.body.reason.replace(/<[^>]*>/g, "").trim().slice(0, 500)
      : null;
    const result = queries.reject(req.params.id, reason);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Not found or already moderated" });
    }
    res.json({ ok: true, id: req.params.id, action: "rejected" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
