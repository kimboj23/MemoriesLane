"use strict";
/**
 * Public endpoints for the hub connection (hub.js).
 *
 * GET  /api/receipts/:code      status of a submission, by the receipt code shown after submitting:
 *                               received | in_review | published | not_published | unknown. Nothing else.
 * POST /api/hub-feed-changed    the hub's nudge after a feed rebuild. Carries no data: the site re-fetches and
 *                               verifies the signed feed itself, so anyone may call it (rate-limited).
 * GET  /api/hub-status          what is configured, and when the feed was last verified (admin).
 */
const express = require("express");
const hub = require("../hub");
const { rateLimit } = require("../middleware/rate-limit");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/receipts/:code([A-Za-z0-9-]{10,40})", rateLimit(30, "receipt"), async (req, res, next) => {
  try {
    if (!hub.intakeOn()) return res.status(404).json({ error: "Not found" });
    res.json({ status: await hub.receiptStatus(req.params.code) });
  } catch (err) {
    err.public = "The archive could not be reached; try again later.";
    err.status = 502;
    next(err);
  }
});

router.post("/hub-feed-changed", rateLimit(20, "hubnudge"), (req, res) => {
  if (!hub.feedOn()) return res.status(404).json({ error: "Not found" });
  hub.refreshFeed().catch(() => {});
  res.status(202).json({ ok: true });
});

router.get("/hub-status", requireAdmin, (req, res) => res.json(hub.status()));

module.exports = router;
