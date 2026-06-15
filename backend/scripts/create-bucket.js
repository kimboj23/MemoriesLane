"use strict";
/**
 * Manually create the private Supabase Storage bucket for memory photos.
 * The backend also does this automatically at startup (storage.ensureBucket),
 * so this script is only needed for explicit/out-of-band provisioning.
 *
 *   node scripts/create-bucket.js
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (loaded from .env).
 */
require("dotenv").config();
const storage = require("../storage");

if (!storage.storageEnabled()) {
  console.error("[create-bucket] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

storage
  .ensureBucket()
  .then((created) =>
    console.log(
      created
        ? `[create-bucket] created private bucket "${storage.BUCKET}"`
        : `[create-bucket] bucket "${storage.BUCKET}" already exists — nothing to do`
    )
  )
  .catch((err) => {
    console.error("[create-bucket] failed:", err.message);
    process.exit(1);
  });
