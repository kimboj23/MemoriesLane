#!/usr/bin/env node
"use strict";
/**
 * Assigns rights-based topic tags to every seeded memory.
 * Safe to re-run — uses ON CONFLICT DO NOTHING.
 *
 * Run inside Docker:
 *   docker compose exec backend node scripts/seed-memory-topics.js
 */
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Topic slugs each memory belongs to. Every Hanoi eviction/relocation story
// gets land-rights + nha-o. Environmental, press, labour etc. are targeted.
const ASSIGNMENTS = [
  // ── Hà Nội ────────────────────────────────────────────────────────────────
  { id: "m01", slugs: ["land-rights", "nha-o"] },
  { id: "m02", slugs: ["nha-o", "lao-dong"] },
  { id: "m03", slugs: ["land-rights", "nha-o", "tu-do-ngon-luan"] },
  { id: "m04", slugs: ["land-rights", "nha-o"] },
  { id: "m05", slugs: ["nha-o", "tu-do-ngon-luan"] },
  { id: "m06", slugs: ["land-rights", "nha-o"] },
  { id: "m07", slugs: ["nha-o"] },
  { id: "m08", slugs: ["nha-o", "moi-truong"] },
  { id: "m09", slugs: ["land-rights", "nha-o"] },
  { id: "m10", slugs: ["nha-o"] },
  { id: "m11", slugs: ["land-rights", "nha-o"] },
  { id: "m12", slugs: ["tu-do-ngon-luan", "nha-o"] },
  { id: "m13", slugs: ["tu-do-bao-chi"] },
  { id: "m14", slugs: ["land-rights", "lao-dong"] },
  { id: "m15", slugs: ["nha-o", "moi-truong"] },
  { id: "m16", slugs: ["land-rights", "nha-o", "tu-do-ngon-luan"] },
  { id: "m17", slugs: ["land-rights", "nha-o"] },
  { id: "m18", slugs: ["lao-dong", "nha-o"] },
  { id: "m19", slugs: ["nha-o", "moi-truong"] },
  { id: "m20", slugs: ["tu-do-ngon-luan", "nha-o"] },
  { id: "m21", slugs: ["nha-o"] },
  { id: "m22", slugs: ["land-rights", "nha-o"] },
  // ── TP. Hồ Chí Minh ───────────────────────────────────────────────────────
  { id: "hcmc1", slugs: ["land-rights", "nha-o"] },
  { id: "hcmc2", slugs: ["nha-o"] },
  { id: "hcmc3", slugs: ["land-rights", "nha-o"] },
  { id: "hcmc4", slugs: ["lao-dong"] },
  { id: "hcmc5", slugs: ["nha-o", "tu-do-ngon-luan"] },
  // ── Huế ───────────────────────────────────────────────────────────────────
  { id: "hue1", slugs: ["land-rights", "nha-o"] },
  { id: "hue2", slugs: ["nha-o"] },
  { id: "hue3", slugs: ["land-rights", "nha-o"] },
  { id: "hue4", slugs: ["lao-dong"] },
  // ── Đà Nẵng ───────────────────────────────────────────────────────────────
  { id: "dn1", slugs: ["land-rights", "nha-o", "lao-dong"] },
  { id: "dn2", slugs: ["nha-o", "lao-dong"] },
  { id: "dn3", slugs: ["lao-dong", "nha-o"] },
  { id: "dn4", slugs: ["moi-truong"] },
  // ── Cần Thơ ───────────────────────────────────────────────────────────────
  { id: "ct1", slugs: ["lao-dong", "moi-truong"] },
  { id: "ct2", slugs: ["moi-truong"] },
];

async function run() {
  // Load slug → id map from DB
  const { rows: topicRows } = await pool.query("SELECT id, slug FROM topics");
  const slugToId = Object.fromEntries(topicRows.map((t) => [t.slug, t.id]));

  let inserted = 0, skipped = 0, unknown = 0;

  for (const { id: memId, slugs } of ASSIGNMENTS) {
    for (const slug of slugs) {
      const topicId = slugToId[slug];
      if (!topicId) { console.warn(`  ⚠  unknown slug "${slug}" — skipped`); unknown++; continue; }

      const result = await pool.query(
        `INSERT INTO memory_topics (memory_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [memId, topicId]
      );
      if (result.rowCount > 0) inserted++;
      else skipped++;
    }
  }

  console.log(`Done — ${inserted} tags inserted, ${skipped} already existed, ${unknown} unknown slugs.`);
  await pool.end();
}

run().catch((err) => { console.error("[seed-memory-topics] fatal:", err.message); process.exit(1); });
