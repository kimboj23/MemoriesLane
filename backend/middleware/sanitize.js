"use strict";
/**
 * Input validation and sanitisation for memory submissions.
 *
 * All validation is done before touching the database.
 * Text fields are stripped of HTML tags — the React frontend auto-escapes
 * output, but defence in depth means we never store raw markup.
 */
const { VALID_CATS, VALID_CITIES, VALID_MEDIA, VALID_LANGS } = require("../db");

// Strip every HTML/XML tag. We do not use a full HTML parser because we want
// to reject markup entirely, not sanitise it to a safe subset.
function stripTags(str) {
  return String(str).replace(/<[^>]*>/g, "").trim();
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
  const date_label = clean(body.date, 120) || null;
  const date_label_en = clean(body.dateEn, 120) || null;

  const media_type = VALID_MEDIA.has(body.media) ? body.media : "text";

  // Photo: client sends a data URL. We accept it here and handle EXIF
  // stripping in the route handler where we have access to the file system.
  // Enforce a rough size ceiling (base64 of 1.5 MB JPEG ≈ 2 MB string).
  let photoData = null;
  if (body.photoData) {
    if (typeof body.photoData !== "string")
      errors.push("photoData must be a string");
    else if (!body.photoData.startsWith("data:image/"))
      errors.push("photoData must be a base64 image data URL");
    else if (body.photoData.length > 2_200_000)
      errors.push("image too large — maximum ~1.5 MB before encoding");
    else
      photoData = body.photoData;
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: { lat, lng, city, ward, cat, year, month, day, date_label, date_label_en, lang, text_vi, text_en, media_type, photoData },
  };
}

module.exports = { validateSubmission };
