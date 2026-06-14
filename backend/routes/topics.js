"use strict";
/**
 * Topics API — public, read-only.
 *
 * GET /api/topics  — list all rights-based topics (global taxonomy)
 */
const express = require("express");
const { queries } = require("../db");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

router.get("/", rateLimit(120, "read"), async (req, res, next) => {
  try {
    const topics = await queries.allTopics();
    res.json({ topics });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
