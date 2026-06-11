"use strict";
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

let db;

const VALID_CATS = new Set(["personal", "news", "community", "event"]);
const VALID_CITIES = new Set(["hanoi", "hcmc", "hue", "danang", "cantho"]);
const VALID_MEDIA = new Set(["text", "photo", "video"]);
const VALID_LANGS = new Set(["vi", "en"]);

function initDb() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, "memories.db");
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");   // concurrent reads
  db.pragma("synchronous = NORMAL"); // safe but faster than FULL
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id            TEXT PRIMARY KEY,
      lat           REAL NOT NULL CHECK(lat  BETWEEN -90  AND 90),
      lng           REAL NOT NULL CHECK(lng  BETWEEN -180 AND 180),
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

      -- moderation state
      approved      INTEGER NOT NULL DEFAULT 0,
      rejected      INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT,

      -- temporal fingerprinting mitigation: day precision only, never hour:min:sec
      submit_date   TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
      moderated_at  INTEGER          -- unix seconds, set on approve/reject
    ) STRICT;

    CREATE TABLE IF NOT EXISTS cases (
      id          TEXT PRIMARY KEY,
      title_vi    TEXT NOT NULL,
      title_en    TEXT,
      summary_vi  TEXT NOT NULL,
      summary_en  TEXT,
      city        TEXT NOT NULL DEFAULT 'hanoi'
                       CHECK(city IN ('hanoi','hcmc','hue','danang','cantho')),
      lat         REAL,
      lng         REAL,
      status      TEXT NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','resolved','historical')),
      sections    TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      approved    INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_mem_city_approved
      ON memories(city, approved);
    CREATE INDEX IF NOT EXISTS idx_mem_year
      ON memories(year);
    CREATE INDEX IF NOT EXISTS idx_mem_pending
      ON memories(approved, rejected, submit_date)
      WHERE approved = 0 AND rejected = 0;

    CREATE INDEX IF NOT EXISTS idx_mem_approved_year
      ON memories(approved, year);
    CREATE INDEX IF NOT EXISTS idx_mem_lang
      ON memories(lang);
    CREATE INDEX IF NOT EXISTS idx_mem_cat
      ON memories(cat);
    CREATE INDEX IF NOT EXISTS idx_mem_media
      ON memories(media_type);
    CREATE INDEX IF NOT EXISTS idx_cases_city
      ON cases(city, approved);
  `);

  // Idempotent migration: add case_id column if this DB predates the feature.
  const memCols = db.pragma("table_info(memories)").map((r) => r.name);
  if (!memCols.includes("case_id")) {
    db.exec("ALTER TABLE memories ADD COLUMN case_id TEXT");
  }

  return db;
}

function getDb() {
  if (!db) throw new Error("DB not initialised — call initDb() first");
  return db;
}

// ---------------------------------------------------------------------------
// Prepared-statement accessors (created lazily, bound to the db instance)
// ---------------------------------------------------------------------------
let stmts = null;

function stmts_() {
  if (stmts) return stmts;
  const d = getDb();
  stmts = {
    insert: d.prepare(`
      INSERT INTO memories
        (id, lat, lng, city, ward, cat, year, month, day, date_label, date_label_en,
         lang, text_vi, text_en, has_photo, photo_path, media_type, submit_date)
      VALUES
        (@id, @lat, @lng, @city, @ward, @cat, @year, @month, @day, @date_label, @date_label_en,
         @lang, @text_vi, @text_en, @has_photo, @photo_path, @media_type, @submit_date)
    `),

    // Public read — approved only, no photo_path (served via separate route)
    publicList: d.prepare(`
      SELECT id, lat, lng, city, ward, cat, year, month, day,
             date_label, date_label_en, lang, text_vi, text_en, has_photo, media_type, case_id
      FROM memories
      WHERE approved = 1
        AND (:city IS NULL OR city = :city)
        AND year >= :min_year
        AND year <= :max_year
      ORDER BY year DESC
      LIMIT :limit OFFSET :offset
    `),

    publicById: d.prepare(`
      SELECT id, lat, lng, city, ward, cat, year, month, day,
             date_label, date_label_en, lang, text_vi, text_en, has_photo, media_type, case_id
      FROM memories WHERE id = ? AND approved = 1
    `),

    caseById: d.prepare(`
      SELECT id, title_vi, title_en, summary_vi, summary_en, city, lat, lng, status, sections, created_at
      FROM cases WHERE id = ? AND approved = 1
    `),

    caseMemories: d.prepare(`
      SELECT id, lat, lng, city, ward, cat, year, month, day,
             date_label, date_label_en, lang, text_vi, text_en, has_photo, media_type, case_id
      FROM memories WHERE case_id = ? AND approved = 1
      ORDER BY year DESC, month DESC, day DESC
    `),

    // Photo path — only for serving images, only for approved memories
    photoPath: d.prepare(`
      SELECT photo_path FROM memories WHERE id = ? AND approved = 1 AND has_photo = 1
    `),

    // Moderation queue
    pending: d.prepare(`
      SELECT id, lat, lng, city, ward, cat, year, month, day,
             date_label, date_label_en, lang, text_vi, text_en, has_photo, media_type,
             submit_date
      FROM memories
      WHERE approved = 0 AND rejected = 0
      ORDER BY submit_date ASC
      LIMIT 50
    `),

    approve: d.prepare(`
      UPDATE memories SET approved = 1, moderated_at = unixepoch()
      WHERE id = ? AND approved = 0 AND rejected = 0
    `),

    reject: d.prepare(`
      UPDATE memories SET rejected = 1, reject_reason = ?, moderated_at = unixepoch()
      WHERE id = ? AND approved = 0 AND rejected = 0
    `),
  };
  return stmts;
}

// Public API used by route handlers
const queries = {
  insert:       (row)             => stmts_().insert.run(row),
  publicList:   (city, minY, maxY, limit = 500, offset = 0) => stmts_().publicList.all({ city: city || null, min_year: minY, max_year: maxY, limit, offset }),
  publicById:   (id)              => stmts_().publicById.get(id),
  photoPath:    (id)              => stmts_().photoPath.get(id),
  pending:      ()                => stmts_().pending.all(),
  approve:      (id)              => stmts_().approve.run(id),
  reject:       (id, reason)      => stmts_().reject.run(reason, id),
  caseById:     (id)              => stmts_().caseById.get(id),
  caseMemories: (caseId)          => stmts_().caseMemories.all(caseId),
};

module.exports = { initDb, getDb, queries, VALID_CATS, VALID_CITIES, VALID_MEDIA, VALID_LANGS };
