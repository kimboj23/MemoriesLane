"use strict";
/**
 * Supabase Storage helper — primary photo store.
 *
 * The bucket is PRIVATE. Photos are uploaded with the service_role key and
 * served back through the API (which enforces the approved=1 moderation gate),
 * so unapproved images are never publicly reachable.
 *
 * If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset, the helper reports
 * disabled and callers fall back to local disk (dev convenience).
 */
const { createClient } = require("@supabase/supabase-js");

const URL    = process.env.SUPABASE_URL || "";
const KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = process.env.SUPABASE_BUCKET || "memory-photos";

let client = null;

function getClient() {
  if (!URL || !KEY) return null;
  if (!client) {
    client = createClient(URL, KEY, { auth: { persistSession: false } });
  }
  return client;
}

function storageEnabled() {
  return !!getClient();
}

// Photos (webp), short testimony videos (mp4/webm), and scanned/typed
// documents (pdf) all share this one private bucket.
const BUCKET_OPTS = {
  public: false,
  fileSizeLimit: "20MB",
  allowedMimeTypes: ["image/webp", "video/mp4", "video/webm", "application/pdf"],
};

/**
 * Ensure the photo bucket exists (private) with the current size/mime limits.
 * Idempotent — safe to call on every boot, mirroring db.js's
 * "CREATE TABLE IF NOT EXISTS". Returns true if it had to create the bucket,
 * false if it already existed (in which case its config is refreshed in
 * place, so loosening BUCKET_OPTS above takes effect without manual steps).
 * Throws on API errors.
 */
async function ensureBucket() {
  const c = getClient();
  if (!c) return false; // Storage not configured — caller handles the fallback.

  const { data: buckets, error } = await c.storage.listBuckets();
  if (error) throw error;

  if (buckets.some((b) => b.name === BUCKET)) {
    const { error: updateErr } = await c.storage.updateBucket(BUCKET, BUCKET_OPTS);
    if (updateErr) throw updateErr;
    return false;
  }

  const { error: createErr } = await c.storage.createBucket(BUCKET, BUCKET_OPTS);
  if (createErr) throw createErr;
  return true;
}

async function uploadPhoto(key, buffer, contentType = "image/webp") {
  const c = getClient();
  if (!c) throw new Error("Supabase Storage not configured");
  const { error } = await c.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType, upsert: true });
  if (error) throw error;
  return key;
}

async function downloadPhoto(key) {
  const c = getClient();
  if (!c) throw new Error("Supabase Storage not configured");
  const { data, error } = await c.storage.from(BUCKET).download(key);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

module.exports = { storageEnabled, ensureBucket, uploadPhoto, downloadPhoto, BUCKET };
