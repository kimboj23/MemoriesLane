"use strict";
/**
 * Input validation and sanitisation for memory submissions.
 *
 * All validation is done before touching the database.
 * Text fields are stripped of HTML tags — the React frontend auto-escapes
 * output, but defence in depth means we never store raw markup.
 */
const { VALID_CATS, VALID_CITIES, VALID_MEDIA, VALID_LANGS, VALID_ATTRIBUTION } = require("../db");

// Strip every HTML/XML tag. We do not use a full HTML parser because we want
// to reject markup entirely, not sanitise it to a safe subset.
function stripTags(str) {
  return String(str).replace(/<[^>]*>/g, "").trim();
}

const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

// Remove null bytes and control characters (except newline/tab) that can
// cause issues in SQLite and downstream rendering.
function stripControl(str) {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function clean(str, maxLen) {
  if (str == null) return null;
  let s = stripTags(str);
  s = stripControl(s);
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function int(v, lo, hi) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function float(v, lo, hi) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function httpUrlOk(v) {
  if (typeof v !== "string" || !v.trim()) return false;
  try { const u = new URL(v.trim()); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

/**
 * validateSubmission(body) → { ok: true, data } | { ok: false, errors: string[] }
 *
 * Mirrors the fields the client's send() function produces, but all
 * values are re-validated and re-sanitised server-side.
 */
function validateSubmission(body) {
  const errors = [];

  const lat = float(body.lat, -90, 90);
  const lng = float(body.lng, -180, 180);
  if (lat === null) errors.push("lat must be a number between -90 and 90");
  if (lng === null) errors.push("lng must be a number between -180 and 180");

  const city = VALID_CITIES.has(body.city) ? body.city : null;
  if (!city) errors.push(`city must be one of: ${[...VALID_CITIES].join(", ")}`);

  const cat = VALID_CATS.has(body.cat) ? body.cat : null;
  if (!cat) errors.push(`cat must be one of: ${[...VALID_CATS].join(", ")}`);

  const year = int(body.year, 1900, 2100);
  if (year === null) errors.push("year must be an integer between 1900 and 2100");

  const month = body.month != null ? int(body.month, 1, 12) : null;
  if (body.month != null && month === null) errors.push("month must be 1–12 if provided");

  const day = body.day != null ? int(body.day, 1, 31) : null;
  if (body.day != null && day === null) errors.push("day must be 1–31 if provided");

  const lang = VALID_LANGS.has(body.lang) ? body.lang : "vi";

  const text_vi = clean(body.vi, 4000);
  const text_en = clean(body.en, 4000);
  if (!text_vi || text_vi.length < 2) errors.push("vi text must be at least 2 characters");

  const ward = clean(body.ward, 100) || null;
  const date_label = clean(body.date, 120) ? escapeHtml(clean(body.date, 120)) : null;
  const date_label_en = clean(body.dateEn, 120) ? escapeHtml(clean(body.dateEn, 120)) : null;

  const media_type = VALID_MEDIA.has(body.media) ? body.media : "text";

  // Uploaded file: client sends a data URL (image, mp4/webm video, or PDF).
  // We accept it here and hand off actual decoding/processing to the route
  // handler, where we have access to the file system / image library.
  // Size ceilings are on the base64 *string* (≈ 4/3 of the raw byte size),
  // matched to the per-kind raw limits enforced again in the route handler.
  let photoData = null;
  if (body.photoData) {
    if (typeof body.photoData !== "string") {
      errors.push("photoData must be a string");
    } else if (body.photoData.startsWith("data:image/")) {
      if (body.photoData.length > 2_200_000) errors.push("image too large — maximum ~1.5 MB before encoding");
      else photoData = body.photoData;
    } else if (/^data:video\/(mp4|webm);base64,/.test(body.photoData)) {
      // Oversized videos are re-encoded server-side rather than rejected
      // outright, so the ceiling here is well above the 20 MB stored limit —
      // it just bounds how large a source file we'll attempt to compress.
      if (body.photoData.length > 82_000_000) errors.push("video too large — maximum ~60 MB before encoding");
      else photoData = body.photoData;
    } else if (body.photoData.startsWith("data:application/pdf")) {
      if (body.photoData.length > 11_500_000) errors.push("document too large — maximum ~8 MB before encoding");
      else photoData = body.photoData;
    } else {
      errors.push("photoData must be an image, mp4/webm video, or PDF data URL");
    }
  }

  // Attribution choice — how the storyteller wants to be credited.
  // "anonymous" never stores a name, even if one was sent by mistake.
  const attribution = VALID_ATTRIBUTION.has(body.attribution) ? body.attribution : "anonymous";
  let author_name = null;
  if (attribution !== "anonymous") {
    author_name = clean(body.authorName, 100);
    if (!author_name) errors.push("authorName is required when attribution is not anonymous");
  }

  // Optional link to an externally hosted audio/video testimony (e.g. an
  // oral history recording the storyteller already has online).
  let media_url = null;
  if (body.mediaUrl != null && String(body.mediaUrl).trim()) {
    if (!httpUrlOk(body.mediaUrl)) errors.push("mediaUrl must be a valid http(s) URL");
    else media_url = clean(body.mediaUrl, 500);
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: { lat, lng, city, ward, cat, year, month, day, date_label, date_label_en, lang, text_vi, text_en, media_type, photoData, attribution, author_name, media_url },
  };
}

module.exports = { validateSubmission };
