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

// sharp is required for EXIF stripping. If it fails to load we reject photos
// rather than risk storing images with metadata.
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

// Uploads directory is created on startup; never trust user input for paths.
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "../uploads"));
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serverGeneratedId() {
  // We discard the client's id entirely — never trust client-generated IDs.
  return crypto.randomBytes(9).toString("base64url"); // 12-char URL-safe string
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD only
}

/**
 * Strip EXIF and re-encode as WebP.
 * Returns the saved file path relative to UPLOADS_DIR, or throws.
 */
async function processAndStoreImage(dataUrl, memoryId) {
  if (!sharp) throw new Error("Image processing unavailable — sharp not installed");

  // Parse data URL: "data:image/jpeg;base64,<payload>"
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/s);
  if (!match) throw new Error("Invalid image data URL");

  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length > 1_500_000) throw new Error("Image exceeds 1.5 MB after decoding");

  // withMetadata(false) — strips ALL EXIF/IPTC/ICC/XMP metadata.
  // Re-encoding to WebP also removes any steganographic data embedded in
  // JPEG quantisation tables.
  const webpBuffer = await sharp(buffer)
    .rotate()              // apply EXIF orientation, then strip EXIF
    .withMetadata(false)   // drop all metadata
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const filename = `${memoryId}.webp`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, webpBuffer);
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
        // Image processing failure is non-fatal for the submission — the text
        // is preserved. We log the error type but NOT the image content.
        console.warn("[warn] image processing failed:", imgErr.message);
        final_media_type = "text";
      }
    }

    const row = {
      id,
      ...fields,
      media_type: final_media_type,
      has_photo,
      photo_path,
      submit_date: todayUTC(),
    };

    queries.insert(row);

    // Return only the server-assigned ID so the client can reference the
    // submission. Never echo back the full row — it's in the moderation queue.
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
const PAGE_SIZE = 500; // max memories returned per request

router.get("/", rateLimit(120, "read"), (req, res, next) => {
  try {
    const city = req.query.city || null;
    const minYear = parseInt(req.query.minYear, 10) || 1985;
    const maxYear = parseInt(req.query.maxYear, 10) || 2045;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    if (minYear > maxYear) return res.status(400).json({ error: "minYear must be ≤ maxYear" });

    const rows = queries.publicList(city, minYear, maxYear, PAGE_SIZE, offset);
    res.json({ memories: rows, offset, limit: PAGE_SIZE, hasMore: rows.length === PAGE_SIZE });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/memories/:id
// ---------------------------------------------------------------------------
router.get("/:id([A-Za-z0-9_-]{1,24})", (req, res, next) => {
  try {
    const row = queries.publicById(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/memories/:id/photo
// ---------------------------------------------------------------------------
router.get("/:id([A-Za-z0-9_-]{1,24})/photo", (req, res, next) => {
  try {
    const row = queries.photoPath(req.params.id);
    if (!row || !row.photo_path) return res.status(404).json({ error: "Not found" });

    // Resolve the path and verify it stays within UPLOADS_DIR — prevents
    // path traversal even though photo_path is server-generated.
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
