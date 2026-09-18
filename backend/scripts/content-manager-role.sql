-- Dedicated Postgres role for the content manager's NocoDB workspace.
--
-- NocoDB (docker-compose.vps.yml `nocodb` service, README "Content manager
-- UI — NocoDB") connects to Supabase Postgres as THIS role, never as the
-- `postgres` superuser the backend uses. Postgres enforces the grants below
-- on every query regardless of what the UI allows, so even a fully
-- compromised NocoDB login can't touch anything not listed here.
--
-- Principles:
--   * SELECT on every content table (the grid is for browsing too).
--   * UPDATE only on editorial columns (column-level grants). Never on the
--     columns archive-worker owns: archives.status/error/attempts/*_url/
--     sha256/tool*/archived_at -- flipping `status` back to 'pending' would
--     re-queue a capture, and the URL/hash columns are the evidentiary
--     record. Never on storage columns (memories.photo_path/file_mime/
--     has_photo) or ids/submission dates.
--   * INSERT only where the app itself treats the row as editorial content
--     created by staff: cases, topics, and the three *_topics join tables.
--     Memories come from public submissions and archives from
--     POST /api/archive (which is what queues the worker); no INSERT there.
--   * DELETE only on join tables (un-tagging). Hide a memory/case/archive by
--     setting approved=0 / rejected=1 instead -- this is an evidentiary
--     archive, rows are not deleted from a spreadsheet.
--   * No CREATE anywhere: NocoDB's "add table"/"add column" UI fails
--     loudly instead of altering the schema. Schema changes belong in
--     backend/db.js.
--
-- Run as the `postgres` role (Supabase SQL editor, or psql on DATABASE_URL):
--   psql "$DATABASE_URL" -f backend/scripts/content-manager-role.sql
-- then set the password separately so it never lands in a file/history:
--   psql "$DATABASE_URL" -c "\password content_manager"
--
-- Idempotent: re-running resets the role's grants to exactly this file.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'content_manager') THEN
    -- LOGIN only. No CREATEDB/CREATEROLE/SUPERUSER/BYPASSRLS, and not a
    -- member of any Supabase role (anon/authenticated/service_role).
    CREATE ROLE content_manager LOGIN NOINHERIT
      CONNECTION LIMIT 5;   -- NocoDB holds a small pool; the free-tier pooler is tight
  END IF;
END
$$;

-- Start from zero every run so a removed grant below actually goes away.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM content_manager;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM content_manager;
REVOKE CREATE ON SCHEMA public FROM content_manager;
GRANT  USAGE  ON SCHEMA public TO   content_manager;

-- Browsing --------------------------------------------------------------
GRANT SELECT ON memories, cases, topics, archives,
                memory_topics, case_topics, archive_topics
  TO content_manager;

-- memories: public submissions. Edit text/metadata/placement + moderate.
GRANT UPDATE (
  text_vi, text_en, lang,
  date_label, date_label_en, year, month, day,
  city, ward, lat, lng, cat,
  case_id, media_url,
  attribution, author_name,
  approved, rejected, reject_reason, moderated_at
) ON memories TO content_manager;

-- cases: editorial. Create + edit everything except the id.
GRANT INSERT ON cases TO content_manager;
GRANT UPDATE (
  title_vi, title_en, summary_vi, summary_en,
  city, lat, lng, status, sections, archives, approved
) ON cases TO content_manager;

-- topics: taxonomy. Create + rename; no DELETE (ON DELETE CASCADE would
-- silently strip the tag from every memory/case/archive).
GRANT INSERT ON topics TO content_manager;
GRANT UPDATE (slug, name_vi, name_en) ON topics TO content_manager;

-- tagging: join tables are the one place DELETE is allowed.
GRANT INSERT, DELETE ON memory_topics, case_topics, archive_topics TO content_manager;

-- archives: describe + moderate only. Worker-owned columns are read-only.
GRANT UPDATE (
  title_vi, title_en, source, account, doc_date, notes,
  collection, case_id, city, cat, lat, lng,
  approved, rejected, reject_reason
) ON archives TO content_manager;

-- Row creation from a grid needs server-side defaults for the NOT NULL
-- columns the backend normally fills in code (routes/cases.js). Same shape
-- the routes accept (`[A-Za-z0-9_-]{1,64}` ids, YYYY-MM-DD dates); a
-- different random alphabet than crypto.randomBytes().base64url, which
-- nothing depends on. gen_random_uuid() is core Postgres (13+), so this
-- also works on the local docker Postgres, not just Supabase.
ALTER TABLE cases  ALTER COLUMN id         SET DEFAULT 'case-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
ALTER TABLE cases  ALTER COLUMN created_at SET DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD');
ALTER TABLE topics ALTER COLUMN id         SET DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

COMMIT;

-- Verify (as postgres):
--   SELECT table_name, privilege_type, column_name
--     FROM information_schema.column_privileges
--    WHERE grantee = 'content_manager' AND privilege_type = 'UPDATE'
--    ORDER BY 1, 3;
-- Smoke-test the fence (as content_manager -- expect "permission denied"):
--   UPDATE archives SET status = 'pending' WHERE false;
--   DELETE FROM memories WHERE false;
