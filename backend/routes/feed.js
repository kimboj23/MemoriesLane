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
const hub = require("../hub");

const VALID_CITIES = new Set(["hanoi", "hcmc", "hue", "danang", "cantho"]);

const router = express.Router();

router.get("/", rateLimit(60, "read"), async (req, res, next) => {
  try {
    const city = VALID_CITIES.has(req.query.city) ? req.query.city : null;

    const topicSlugs = req.query.topics
      ? req.query.topics.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const result = hub.useDb() ? await queries.feedCases(city, topicSlugs) : { items: [], casesCount: 0 };
    // Published hub cases have no topics yet, so a topic filter leaves them out.
    const published = topicSlugs.length ? [] : hub.feedCases(city).map((c) => ({
      type: "case", id: c.id, title_vi: c.title_vi, title_en: c.title_en, summary_vi: c.summary_vi, summary_en: c.summary_en,
      city: c.city, lat: c.lat, lng: c.lng, status: c.status, created_at: c.created_at, topics: [],
      memory_count: hub.feedCaseMemories(c.id).length, precision: c.precision, radius_m: c.radius_m }));
    res.json({ items: [...result.items, ...published], casesCount: result.casesCount + published.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
