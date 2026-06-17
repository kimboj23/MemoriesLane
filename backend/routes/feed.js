"use strict";
/**
 * Feed API — documented cases (containers) for the List View. Memory cards in
 * that view are filtered client-side (the same Advanced Search result set the
 * map uses), so this endpoint only needs to supply cases.
 *
 * GET /api/feed
 *   ?city=hanoi               (optional — omit for all cities)
 *   &topics=land-rights,nha-o (optional — comma-separated slugs)
 *
 * Response: { items: [{type:'case',...}], casesCount }
 */
const express = require("express");
const { queries } = require("../db");
const { rateLimit } = require("../middleware/rate-limit");

const VALID_CITIES = new Set(["hanoi", "hcmc", "hue", "danang", "cantho"]);

const router = express.Router();

router.get("/", rateLimit(60, "read"), async (req, res, next) => {
  try {
    const city = VALID_CITIES.has(req.query.city) ? req.query.city : null;

    const topicSlugs = req.query.topics
      ? req.query.topics.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const result = await queries.feedCases(city, topicSlugs);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
