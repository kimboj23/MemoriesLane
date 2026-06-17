"use strict";
/**
 * Materials API — public, read-only.
 *
 * GET /api/materials              — list approved, archived materials (q/collection/mediaType/tool/limit/offset)
 * GET /api/materials/collections  — collection facet counts, for browse nav
 * GET /api/materials/:id          — single material
 *
 * Mirrors the gating already applied in queries.archivesForCase: only rows
 * with approved = 1 AND status IN ('archived','partial') are ever returned.
 */
const express = require("express");
const { queries } = require("../db");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();
router.use(rateLimit(120, "read"));

function clean(v, max) {
  if (typeof v !== "string") return null;
  return v.replace(/<[^>]*>/g, "").trim().slice(0, max) || null;
}

const VALID_MEDIA = new Set(["web", "document", "social"]);
const VALID_TOOL = new Set(["archive-box", "auto-archiver"]);

router.get("/collections", async (req, res, next) => {
  try {
    const collections = await queries.materialCollections();
    res.json({ collections });
  } catch (err) {
    next(err);
  }
});

router.get("/:id([A-Za-z0-9_-]{1,24})", async (req, res, next) => {
  try {
    const material = await queries.materialById(req.params.id);
    if (!material) return res.status(404).json({ error: "Not found" });
    res.json(material);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const q = clean(req.query.q, 200);
    const collection = clean(req.query.collection, 80);
    const mediaType = VALID_MEDIA.has(req.query.mediaType) ? req.query.mediaType : null;
    const tool = VALID_TOOL.has(req.query.tool) ? req.query.tool : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 60, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const materials = await queries.materialsList({ q, collection, mediaType, tool, limit, offset });
    res.json({ materials, count: materials.length, limit, offset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
