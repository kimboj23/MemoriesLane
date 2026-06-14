"use strict";
/**
 * Moderation API — authenticated, not public-facing.
 *
 * GET  /api/moderate/queue          — list up to 50 pending memories
 * POST /api/moderate/:id/approve    — approve a pending memory
 * POST /api/moderate/:id/reject     — reject with a reason
 *
 * All routes require Authorization: Bearer <admin_token>.
 */
const express = require("express");
const { queries } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

router.use(requireAdmin);
router.use(rateLimit(60, "moderate"));

// ---------------------------------------------------------------------------
// GET /api/moderate/queue
// ---------------------------------------------------------------------------
router.get("/queue", async (req, res, next) => {
  try {
    const rows = await queries.pending();
    res.json({ pending: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/moderate/:id/approve
// ---------------------------------------------------------------------------
router.post("/:id([A-Za-z0-9_-]{1,24})/approve", async (req, res, next) => {
  try {
    const result = await queries.approve(req.params.id);
    if (result.rowCount === 0) {
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
router.post("/:id([A-Za-z0-9_-]{1,24})/reject", async (req, res, next) => {
  try {
    const reason = typeof req.body.reason === "string"
      ? req.body.reason.replace(/<[^>]*>/g, "").trim().slice(0, 500)
      : null;
    const result = await queries.reject(req.params.id, reason);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not found or already moderated" });
    }
    res.json({ ok: true, id: req.params.id, action: "rejected" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
