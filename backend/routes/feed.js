"use strict";
/**
 * Unified Feed API — merges documented cases (containers) with individual
 * memories into one ordered list, both filtered by topic and/or category.
 *
 * GET /api/feed
 *   ?city=hanoi               (optional — omit for all cities)
 *   &topics=land-rights,nha-o (optional — comma-separated slugs)
 *   &cats=event,personal      (optional — comma-separated cat keys)
 *   &minYear=2010             (optional, default MIN_YEAR from db)
 *   &maxYear=2026             (optional)
 *
 * Response: { items: [{type:'case',...},{type:'memory',...}], casesCount, memoriesCount }
 * Cases are always listed first; memories follow, sorted by year DESC.
 */
const express = require("express");
const { queries } = require("../db");
const { rateLimit } = require("../middleware/rate-limit");

const VALID_CITIES = new Set(["hanoi", "hcmc", "hue", "danang", "cantho"]);
const MIN_YEAR = 1986;
const MAX_YEAR = 2060;

const router = express.Router();

router.get("/", rateLimit(60, "read"), async (req, res, next) => {
  try {
    const city = VALID_CITIES.has(req.query.city) ? req.query.city : null;

    const topicSlugs = req.query.topics
      ? req.query.topics.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const catKeys = req.query.cats
      ? req.query.cats.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const minY = Math.max(MIN_YEAR, Math.min(MAX_YEAR, parseInt(req.query.minYear, 10) || MIN_YEAR));
    const maxY = Math.max(minY,     Math.min(MAX_YEAR, parseInt(req.query.maxYear, 10) || MAX_YEAR));

    const result = await queries.unifiedFeed(city, topicSlugs, catKeys, minY, maxY);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
