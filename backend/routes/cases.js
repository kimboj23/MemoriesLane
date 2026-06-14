"use strict";
/**
 * Case profile API — public, read-only.
 *
 * GET /api/cases/:id  — fetch a single case with its linked memories and topics
 */
const express = require("express");
const { queries } = require("../db");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

router.get("/:id([A-Za-z0-9_-]{1,64})", rateLimit(120, "read"), async (req, res, next) => {
  try {
    const row = await queries.caseById(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });

    let sections, archives;
    try { sections = JSON.parse(row.sections); } catch { sections = []; }
    try { archives = JSON.parse(row.archives || '[]'); } catch { archives = []; }

    const [memories, topics] = await Promise.all([
      queries.caseMemories(req.params.id),
      queries.topicsByCase(req.params.id),
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
