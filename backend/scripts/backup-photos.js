"use strict";
/**
 * Download every object in the Supabase Storage photo bucket to a local folder.
 * Used by the scheduled local backup. Usage:
 *
 *   node scripts/backup-photos.js /output/dir
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (loaded from .env).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const URL    = process.env.SUPABASE_URL;
const KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "memory-photos";
const OUT    = process.argv[2] || "./photos";

if (!URL || !KEY) {
  console.error("[backup-photos] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

(async () => {
  const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
  fs.mkdirSync(OUT, { recursive: true });

  // List all objects (paginate in case the bucket grows large).
  let offset = 0;
  const pageSize = 100;
  let total = 0;
  for (;;) {
    const { data: items, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.error("[backup-photos] list failed:", error.message);
      process.exit(1);
    }
    if (!items.length) break;

    for (const item of items) {
      if (item.id === null) continue; // skip nested folders, if any
      const { data, error: dErr } = await supabase.storage.from(BUCKET).download(item.name);
      if (dErr) {
        console.warn(`[backup-photos] skip ${item.name}: ${dErr.message}`);
        continue;
      }
      const buf = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(path.join(OUT, item.name), buf);
      total++;
    }

    if (items.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`[backup-photos] downloaded ${total} object(s) to ${OUT}`);
})();
