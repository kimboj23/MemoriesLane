"use strict";
/**
 * Case profile API — public, read-only.
 *
 * GET /api/cases/:id  — fetch a single case with its linked memories
 */
const express = require("express");
const { queries } = require("../db");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

router.get("/:id([A-Za-z0-9_-]{1,64})", rateLimit(120, "read"), (req, res, next) => {
  try {
    const row = queries.caseById(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });

    // Parse sections JSON stored in DB; fall back to empty array on malformed data.
    let sections;
    try {
      sections = JSON.parse(row.sections);
    } catch {
      sections = [];
    }

    const memories = queries.caseMemories(req.params.id);

    res.json({
      case: { ...row, sections },
      memories,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
