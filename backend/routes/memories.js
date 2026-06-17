"use strict";
/**
 * Public memory API — read and submit.
 *
 * POST /api/memories       — submit a new memory (goes to pending queue)
 * GET  /api/memories       — list approved memories (?city=hanoi&minYear=2020&maxYear=2026)
 * GET  /api/memories/:id   — single approved memory
 * GET  /api/memories/:id/photo — serve the approved memory's uploaded file
 *      (photo, video, or document — Content-Type reflects whichever it is)
 */
const express = require("express");
const path = require("path");
const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { queries } = require("../db");
const storage = require("../storage");
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

let ffmpeg;
try {
  ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
} catch {
  console.warn(
    "[warn] ffmpeg-static/fluent-ffmpeg not installed — oversized videos will be rejected instead of compressed.\n" +
    "       Run: npm install ffmpeg-static fluent-ffmpeg"
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

async function storeBuffer(buffer, filename, mime) {
  // Primary store: Supabase Storage (private bucket). Fall back to local disk
  // only when Storage is not configured (e.g. local dev without keys).
  if (storage.storageEnabled()) {
    await storage.uploadPhoto(filename, buffer, mime);
  } else {
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  }
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
  await storeBuffer(webpBuffer, filename, "image/webp");
  return { path: filename, mime: "image/webp" };
}

const MAX_VIDEO_BYTES = 20_000_000;

// Progressively more aggressive re-encode settings, tried in order — we stop
// at the first one that fits, so quality is only sacrificed as far as needed.
const VIDEO_COMPRESS_STEPS = [
  { crf: 26, maxWidth: 1280 },
  { crf: 30, maxWidth: 1280 },
  { crf: 30, maxWidth: 854 },
  { crf: 34, maxWidth: 854 },
];

function transcodeVideo(inputPath, outputPath, { crf, maxWidth }) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .videoFilters(`scale='min(${maxWidth},iw)':-2`)
      .outputOptions([`-crf ${crf}`, "-preset veryfast", "-movflags +faststart"])
      .audioCodec("aac")
      .audioBitrate("128k")
      .format("mp4")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

// Re-encodes a too-large video down toward MAX_VIDEO_BYTES, trying the least
// lossy settings first. Always emits mp4 regardless of the input container.
async function compressVideo(buffer, mime) {
  if (!ffmpeg) throw new Error("Video exceeds 20 MB and compression is unavailable");

  const tag = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpIn = path.join(os.tmpdir(), `ml-in-${tag}.${mime === "video/webm" ? "webm" : "mp4"}`);
  const tmpOut = path.join(os.tmpdir(), `ml-out-${tag}.mp4`);
  await fsp.writeFile(tmpIn, buffer);
  try {
    let last = null;
    for (const step of VIDEO_COMPRESS_STEPS) {
      await transcodeVideo(tmpIn, tmpOut, step);
      last = await fsp.readFile(tmpOut);
      if (last.length <= MAX_VIDEO_BYTES) return last;
    }
    return last; // smallest we could get — caller checks and rejects if still too big
  } finally {
    await fsp.unlink(tmpIn).catch(() => {});
    await fsp.unlink(tmpOut).catch(() => {});
  }
}

async function processAndStoreVideo(dataUrl, memoryId) {
  const match = dataUrl.match(/^data:(video\/(?:mp4|webm));base64,(.+)$/s);
  if (!match) throw new Error("Invalid video data URL");

  let mime = match[1];
  let buffer = Buffer.from(match[2], "base64");

  if (buffer.length > MAX_VIDEO_BYTES) {
    buffer = await compressVideo(buffer, mime);
    mime = "video/mp4";
    if (buffer.length > MAX_VIDEO_BYTES) throw new Error("Video still exceeds 20 MB after compression");
  }

  const filename = `${memoryId}.${mime === "video/webm" ? "webm" : "mp4"}`;
  await storeBuffer(buffer, filename, mime);
  return { path: filename, mime };
}

async function processAndStoreDocument(dataUrl, memoryId) {
  const match = dataUrl.match(/^data:(application\/pdf);base64,(.+)$/s);
  if (!match) throw new Error("Invalid document data URL");

  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 8_000_000) throw new Error("Document exceeds 8 MB after decoding");

  const filename = `${memoryId}.pdf`;
  await storeBuffer(buffer, filename, mime);
  return { path: filename, mime };
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
    let file_mime = null;
    let has_photo = 0;
    let final_media_type = media_type !== "text" && !photoData ? "text" : media_type;

    if (photoData) {
      try {
        const processor = media_type === "video" ? processAndStoreVideo
          : media_type === "document" ? processAndStoreDocument
          : processAndStoreImage;
        const result = await processor(photoData, id);
        photo_path = result.path;
        file_mime = result.mime;
        has_photo = 1;
      } catch (fileErr) {
        console.warn(`[warn] ${media_type} processing failed:`, fileErr.message);
        final_media_type = "text";
      }
    }

    await queries.insert({
      id, ...fields,
      media_type: final_media_type,
      has_photo,
      photo_path,
      file_mime,
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

    // Pre-migration rows have no file_mime stored — they're always images.
    res.setHeader("Content-Type", row.file_mime || "image/webp");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Primary store: Supabase Storage (private bucket). The approved=1 gate is
    // already enforced by queries.photoPath above, so streaming here is safe.
    if (storage.storageEnabled()) {
      try {
        const buf = await storage.downloadPhoto(row.photo_path);
        return res.send(buf);
      } catch {
        return res.status(404).json({ error: "Not found" });
      }
    }

    // Fallback: local disk (dev without Storage configured).
    const abs = path.resolve(UPLOADS_DIR, row.photo_path);
    if (!abs.startsWith(UPLOADS_DIR + path.sep)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
