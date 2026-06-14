"use strict";
/**
 * Public memory API — read and submit.
 *
 * POST /api/memories       — submit a new memory (goes to pending queue)
 * GET  /api/memories       — list approved memories (?city=hanoi&minYear=2020&maxYear=2026)
 * GET  /api/memories/:id   — single approved memory
 * GET  /api/memories/:id/photo — serve the approved memory's photo (EXIF-stripped WebP)
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { queries } = require("../db");
const { validateSubmission } = require("../middleware/sanitize");
const { rateLimit } = require("../middleware/rate-limit");

let sharp;
try {
  sharp = require("sharp");
} catch {
  console.warn(
    "[warn] sharp not installed — photo uploads are disabled.\n" +
    "       Run: npm install sharp"
  );
}

const router = express.Router();

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "../uploads"));
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function serverGeneratedId() {
  return crypto.randomBytes(9).toString("base64url");
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function processAndStoreImage(dataUrl, memoryId) {
  if (!sharp) throw new Error("Image processing unavailable — sharp not installed");

  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/s);
  if (!match) throw new Error("Invalid image data URL");

  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length > 1_500_000) throw new Error("Image exceeds 1.5 MB after decoding");

  const webpBuffer = await sharp(buffer)
    .rotate()
    .withMetadata(false)
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const filename = `${memoryId}.webp`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), webpBuffer);
  return filename;
}

// ---------------------------------------------------------------------------
// POST /api/memories
// ---------------------------------------------------------------------------
router.post("/", rateLimit(5, "submit"), async (req, res, next) => {
  try {
    const validation = validateSubmission(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: "Validation failed", details: validation.errors });
    }

    const { photoData, media_type, ...fields } = validation.data;
    const id = serverGeneratedId();

    let photo_path = null;
    let has_photo = 0;
    let final_media_type = media_type === "photo" && !photoData ? "text" : media_type;

    if (photoData) {
      try {
        photo_path = await processAndStoreImage(photoData, id);
        has_photo = 1;
        final_media_type = "photo";
      } catch (imgErr) {
        console.warn("[warn] image processing failed:", imgErr.message);
        final_media_type = "text";
      }
    }

    await queries.insert({
      id, ...fields,
      media_type: final_media_type,
      has_photo,
      photo_path,
      submit_date: todayUTC(),
    });

    return res.status(202).json({
      id,
      status: "pending",
      message: "Memory received — it will appear after review.",
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/memories
// ---------------------------------------------------------------------------
const PAGE_SIZE = 500;

router.get("/", rateLimit(120, "read"), async (req, res, next) => {
  try {
    const city    = req.query.city || null;
    const minYear = parseInt(req.query.minYear, 10) || 1985;
    const maxYear = parseInt(req.query.maxYear, 10) || 2045;
    const offset  = Math.max(0, parseInt(req.query.offset, 10) || 0);

    if (minYear > maxYear) return res.status(400).json({ error: "minYear must be ≤ maxYear" });

    const rows = await queries.publicList(city, minYear, maxYear, PAGE_SIZE, offset);
    res.json({ memories: rows, offset, limit: PAGE_SIZE, hasMore: rows.length === PAGE_SIZE });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/memories/:id
// ---------------------------------------------------------------------------
router.get("/:id([A-Za-z0-9_-]{1,24})", async (req, res, next) => {
  try {
    const row = await queries.publicById(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/memories/:id/photo
// ---------------------------------------------------------------------------
router.get("/:id([A-Za-z0-9_-]{1,24})/photo", async (req, res, next) => {
  try {
    const row = await queries.photoPath(req.params.id);
    if (!row || !row.photo_path) return res.status(404).json({ error: "Not found" });

    const abs = path.resolve(UPLOADS_DIR, row.photo_path);
    if (!abs.startsWith(UPLOADS_DIR + path.sep)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
