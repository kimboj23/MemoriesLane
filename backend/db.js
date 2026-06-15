"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");

let pool;

const VALID_CATS   = new Set(["personal", "news", "community", "event"]);
const VALID_CITIES = new Set(["hanoi", "hcmc", "hue", "danang", "cantho"]);
const VALID_MEDIA  = new Set(["text", "photo", "video"]);
const VALID_LANGS  = new Set(["vi", "en"]);

async function initDb() {
  const dbUrl = process.env.DATABASE_URL || "";
  // Managed Postgres (Supabase, etc.) requires TLS; local docker Postgres does not.
  const needsSsl =
    /supabase\.(co|com)/.test(dbUrl) ||
    /[?&]sslmode=require/.test(dbUrl) ||
    process.env.PGSSLMODE === "require";

  pool = new Pool({
    connectionString: dbUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });
  await pool.query("SELECT 1"); // verify connection

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id            TEXT PRIMARY KEY,
      lat           DOUBLE PRECISION NOT NULL CHECK(lat  BETWEEN -90  AND 90),
      lng           DOUBLE PRECISION NOT NULL CHECK(lng  BETWEEN -180 AND 180),
      city          TEXT NOT NULL DEFAULT 'hanoi'
                         CHECK(city IN ('hanoi','hcmc','hue','danang','cantho')),
      ward          TEXT,
      cat           TEXT NOT NULL DEFAULT 'personal'
                         CHECK(cat IN ('personal','news','community','event')),
      year          INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2100),
      month         INTEGER          CHECK(month BETWEEN 1 AND 12),
      day           INTEGER          CHECK(day   BETWEEN 1 AND 31),
      date_label    TEXT,
      date_label_en TEXT,
      lang          TEXT NOT NULL DEFAULT 'vi' CHECK(lang IN ('vi','en')),
      text_vi       TEXT NOT NULL,
      text_en       TEXT,
      has_photo     INTEGER NOT NULL DEFAULT 0,
      photo_path    TEXT,
      media_type    TEXT NOT NULL DEFAULT 'text'
                         CHECK(media_type IN ('text','photo','video')),
      case_id       TEXT,
      approved      INTEGER NOT NULL DEFAULT 0,
      rejected      INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT,
      submit_date   TEXT NOT NULL,
      moderated_at  BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      id          TEXT PRIMARY KEY,
      title_vi    TEXT NOT NULL,
      title_en    TEXT,
      summary_vi  TEXT NOT NULL,
      summary_en  TEXT,
      city        TEXT NOT NULL DEFAULT 'hanoi'
                       CHECK(city IN ('hanoi','hcmc','hue','danang','cantho')),
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      status      TEXT NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','resolved','historical')),
      sections    TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      approved    INTEGER NOT NULL DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS topics (
      id       TEXT PRIMARY KEY,
      slug     TEXT NOT NULL UNIQUE,
      name_vi  TEXT NOT NULL,
      name_en  TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_topics (
      memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      topic_id   TEXT NOT NULL REFERENCES topics(id)   ON DELETE CASCADE,
      PRIMARY KEY (memory_id, topic_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_topics (
      case_id   TEXT NOT NULL REFERENCES cases(id)  ON DELETE CASCADE,
      topic_id  TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (case_id, topic_id)
    )
  `);

  // Indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_city_approved  ON memories(city, approved)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_year           ON memories(year)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_approved_year  ON memories(approved, year)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_lang           ON memories(lang)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_cat            ON memories(cat)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_media          ON memories(media_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cases_city         ON cases(city, approved)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mem_topics         ON memory_topics(topic_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_case_topics        ON case_topics(topic_id)`);
  // Migration: add archives column if it doesn't exist (safe to re-run)
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS archives TEXT DEFAULT '[]'`);
  // Partial index: pending moderation queue
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mem_pending
      ON memories(approved, rejected, submit_date)
      WHERE approved = 0 AND rejected = 0
  `);

  // Seed topics if the table is empty
  const { rows: existing } = await pool.query("SELECT id FROM topics LIMIT 1");
  if (existing.length === 0) {
    const seed = [
      { slug: "land-rights",      name_vi: "Quyền đất đai",     name_en: "Land Rights"           },
      { slug: "education",         name_vi: "Giáo dục",           name_en: "Education Access"       },
      { slug: "an-oan-sai",        name_vi: "Án oan sai",         name_en: "Wrongful Conviction"    },
      { slug: "tu-hinh",           name_vi: "Án tử hình",         name_en: "Death Penalty"          },
      { slug: "tu-do-bao-chi",     name_vi: "Tự do báo chí",     name_en: "Press Freedom"          },
      { slug: "tu-do-ngon-luan",   name_vi: "Tự do ngôn luận",   name_en: "Freedom of Expression"  },
      { slug: "nha-o",             name_vi: "Nhà ở",              name_en: "Housing Rights"         },
      { slug: "moi-truong",        name_vi: "Môi trường",         name_en: "Environmental Rights"   },
      { slug: "lao-dong",          name_vi: "Lao động",           name_en: "Labor Rights"           },
    ];
    for (const t of seed) {
      const id = crypto.randomBytes(9).toString("base64url");
      await pool.query(
        `INSERT INTO topics (id, slug, name_vi, name_en)
         VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
        [id, t.slug, t.name_vi, t.name_en]
      );
    }
    console.log("[db] seeded", seed.length, "topics");
  }

  return pool;
}

function getPool() {
  if (!pool) throw new Error("DB not initialised — call initDb() first");
  return pool;
}

// ---------------------------------------------------------------------------
// Query helpers — all async, return plain values (not Statement objects)
// ---------------------------------------------------------------------------
const queries = {
  insert: (row) => getPool().query(
    `INSERT INTO memories
       (id, lat, lng, city, ward, cat, year, month, day, date_label, date_label_en,
        lang, text_vi, text_en, has_photo, photo_path, media_type, submit_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [row.id, row.lat, row.lng, row.city, row.ward, row.cat,
     row.year, row.month, row.day, row.date_label, row.date_label_en,
     row.lang, row.text_vi, row.text_en,
     row.has_photo, row.photo_path, row.media_type, row.submit_date]
  ),

  publicList: async (city, minY, maxY, limit = 500, offset = 0) => {
    const { rows } = await getPool().query(
      `SELECT m.id, m.lat, m.lng, m.city, m.ward, m.cat, m.year, m.month, m.day,
              m.date_label, m.date_label_en, m.lang, m.text_vi, m.text_en,
              m.has_photo, m.media_type, m.case_id,
              COALESCE(
                json_agg(
                  json_build_object('id', t.id, 'slug', t.slug, 'name_vi', t.name_vi, 'name_en', t.name_en)
                  ORDER BY t.name_en
                ) FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS topics
       FROM memories m
       LEFT JOIN memory_topics mt ON mt.memory_id = m.id
       LEFT JOIN topics t ON t.id = mt.topic_id
       WHERE m.approved = 1
         AND ($1::text IS NULL OR m.city = $1)
         AND m.year >= $2 AND m.year <= $3
       GROUP BY m.id
       ORDER BY m.year DESC
       LIMIT $4 OFFSET $5`,
      [city || null, minY, maxY, limit, offset]
    );
    return rows;
  },

  publicById: async (id) => {
    const { rows } = await getPool().query(
      `SELECT m.id, m.lat, m.lng, m.city, m.ward, m.cat, m.year, m.month, m.day,
              m.date_label, m.date_label_en, m.lang, m.text_vi, m.text_en,
              m.has_photo, m.media_type, m.case_id,
              COALESCE(
                json_agg(
                  json_build_object('id', t.id, 'slug', t.slug, 'name_vi', t.name_vi, 'name_en', t.name_en)
                  ORDER BY t.name_en
                ) FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS topics
       FROM memories m
       LEFT JOIN memory_topics mt ON mt.memory_id = m.id
       LEFT JOIN topics t ON t.id = mt.topic_id
       WHERE m.id = $1 AND m.approved = 1
       GROUP BY m.id`,
      [id]
    );
    return rows[0] || null;
  },

  photoPath: async (id) => {
    const { rows } = await getPool().query(
      `SELECT photo_path FROM memories
       WHERE id = $1 AND approved = 1 AND has_photo = 1`,
      [id]
    );
    return rows[0] || null;
  },

  pending: async () => {
    const { rows } = await getPool().query(
      `SELECT id, lat, lng, city, ward, cat, year, month, day,
              date_label, date_label_en, lang, text_vi, text_en, has_photo, media_type, submit_date
       FROM memories
       WHERE approved = 0 AND rejected = 0
       ORDER BY submit_date ASC
       LIMIT 50`
    );
    return rows;
  },

  approve: (id) => getPool().query(
    `UPDATE memories
     SET approved = 1, moderated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id = $1 AND approved = 0 AND rejected = 0`,
    [id]
  ),

  reject: (id, reason) => getPool().query(
    `UPDATE memories
     SET rejected = 1, reject_reason = $1,
         moderated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id = $2 AND approved = 0 AND rejected = 0`,
    [reason, id]
  ),

  caseById: async (id) => {
    const { rows } = await getPool().query(
      `SELECT id, title_vi, title_en, summary_vi, summary_en,
              city, lat, lng, status, sections, archives, created_at
       FROM cases WHERE id = $1 AND approved = 1`,
      [id]
    );
    return rows[0] || null;
  },

  caseMemories: async (caseId) => {
    const { rows } = await getPool().query(
      `SELECT id, lat, lng, city, ward, cat, year, month, day,
              date_label, date_label_en, lang, text_vi, text_en, has_photo, media_type, case_id
       FROM memories WHERE case_id = $1 AND approved = 1
       ORDER BY year DESC, month DESC NULLS LAST, day DESC NULLS LAST`,
      [caseId]
    );
    return rows;
  },

  // ── Unified Feed (cases + memories, topic-filtered) ──────────────────────
  unifiedFeed: async (city, topicSlugs, catKeys, minY, maxY) => {
    const p = getPool();
    const tParam = topicSlugs && topicSlugs.length ? topicSlugs : null;
    const cParam = catKeys    && catKeys.length    ? catKeys    : null;

    const { rows: cases } = await p.query(
      `SELECT c.id, c.title_vi, c.title_en, c.summary_vi, c.summary_en,
              c.city, c.lat, c.lng, c.status, c.created_at,
              (SELECT COUNT(*) FROM memories m WHERE m.case_id = c.id AND m.approved = 1)
                AS memory_count,
              COALESCE(
                (SELECT json_agg(
                          json_build_object('id',t.id,'slug',t.slug,'name_vi',t.name_vi,'name_en',t.name_en)
                          ORDER BY t.name_en
                        )
                 FROM case_topics ct JOIN topics t ON t.id = ct.topic_id
                 WHERE ct.case_id = c.id),
                '[]'::json
              ) AS topics
       FROM cases c
       WHERE c.approved = 1
         AND ($1::text IS NULL OR c.city = $1)
         AND ($2::text[] IS NULL OR EXISTS(
           SELECT 1 FROM case_topics ct2 JOIN topics t2 ON t2.id = ct2.topic_id
           WHERE ct2.case_id = c.id AND t2.slug = ANY($2::text[])
         ))
       ORDER BY c.created_at DESC`,
      [city || null, tParam]
    );

    const { rows: memories } = await p.query(
      `SELECT m.id, m.lat, m.lng, m.city, m.ward, m.cat, m.year, m.month, m.day,
              m.date_label, m.date_label_en, m.lang, m.text_vi, m.text_en,
              m.has_photo, m.media_type, m.case_id,
              COALESCE(
                json_agg(
                  json_build_object('id',t.id,'slug',t.slug,'name_vi',t.name_vi,'name_en',t.name_en)
                  ORDER BY t.name_en
                ) FILTER (WHERE t.id IS NOT NULL), '[]'::json
              ) AS topics
       FROM memories m
       LEFT JOIN memory_topics mt ON mt.memory_id = m.id
       LEFT JOIN topics t         ON t.id = mt.topic_id
       WHERE m.approved = 1
         AND ($1::text IS NULL OR m.city = $1)
         AND m.year >= $3 AND m.year <= $4
         AND ($2::text[] IS NULL OR EXISTS(
           SELECT 1 FROM memory_topics mt2 JOIN topics t2 ON t2.id = mt2.topic_id
           WHERE mt2.memory_id = m.id AND t2.slug = ANY($2::text[])
         ))
         AND ($5::text[] IS NULL OR m.cat = ANY($5::text[]))
       GROUP BY m.id
       ORDER BY m.year DESC
       LIMIT 100`,
      [city || null, tParam, minY, maxY, cParam]
    );

    return {
      items: [
        ...cases.map((c) => ({ type: "case", ...c, memory_count: Number(c.memory_count) })),
        ...memories.map((m) => ({ type: "memory", ...m })),
      ],
      casesCount: cases.length,
      memoriesCount: memories.length,
    };
  },

  // ── Topics ────────────────────────────────────────────────────────────────
  allTopics: async () => {
    const { rows } = await getPool().query(
      `SELECT id, slug, name_vi, name_en FROM topics ORDER BY name_en`
    );
    return rows;
  },

  topicsByMemory: async (memoryId) => {
    const { rows } = await getPool().query(
      `SELECT t.id, t.slug, t.name_vi, t.name_en
       FROM topics t
       JOIN memory_topics mt ON mt.topic_id = t.id
       WHERE mt.memory_id = $1`,
      [memoryId]
    );
    return rows;
  },

  topicsByCase: async (caseId) => {
    const { rows } = await getPool().query(
      `SELECT t.id, t.slug, t.name_vi, t.name_en
       FROM topics t
       JOIN case_topics ct ON ct.topic_id = t.id
       WHERE ct.case_id = $1`,
      [caseId]
    );
    return rows;
  },

  setMemoryTopics: async (memoryId, topicSlugs) => {
    const p = getPool();
    await p.query(`DELETE FROM memory_topics WHERE memory_id = $1`, [memoryId]);
    if (!topicSlugs.length) return;
    const { rows: topics } = await p.query(
      `SELECT id FROM topics WHERE slug = ANY($1)`, [topicSlugs]
    );
    for (const t of topics) {
      await p.query(
        `INSERT INTO memory_topics (memory_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [memoryId, t.id]
      );
    }
  },

  setCaseTopics: async (caseId, topicSlugs) => {
    const p = getPool();
    await p.query(`DELETE FROM case_topics WHERE case_id = $1`, [caseId]);
    if (!topicSlugs.length) return;
    const { rows: topics } = await p.query(
      `SELECT id FROM topics WHERE slug = ANY($1)`, [topicSlugs]
    );
    for (const t of topics) {
      await p.query(
        `INSERT INTO case_topics (case_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [caseId, t.id]
      );
    }
  },
};

module.exports = { initDb, getPool, queries, VALID_CATS, VALID_CITIES, VALID_MEDIA, VALID_LANGS };
