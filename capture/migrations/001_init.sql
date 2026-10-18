-- MemoryLane capture platform: initial schema.
--
-- Lives in its own `capture` schema so it can share a Postgres (Supabase)
-- with the current app's tables without touching them; migration from the
-- old `archives` table is a separate, later step.
--
--   contributors ─< tokens          who can submit (personal, revocable tokens)
--   contributors ─< items           one saved link ("bookmark"), deduplicated by canonical URL
--   items        ─< captures        each capture attempt/version of that link; also the work queue
--   captures     ─< artifacts       every file/link a capture produced, content-addressed by SHA-256

CREATE SCHEMA IF NOT EXISTS capture;

CREATE TABLE capture.contributors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  email         text UNIQUE,
  role          text NOT NULL DEFAULT 'contributor'
                CHECK (role IN ('contributor', 'reviewer', 'editor', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);

-- Only the SHA-256 of a token is stored; the token itself is shown once.
CREATE TABLE capture.tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id  uuid NOT NULL REFERENCES capture.contributors(id) ON DELETE CASCADE,
  label           text NOT NULL,
  token_sha256    text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

CREATE TABLE capture.items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_url      text NOT NULL,          -- exactly as received, kept as evidence
  submitted_text     text,                   -- the full shared text, when it came from a share sheet
  canonical_url      text NOT NULL,          -- tracking stripped, host/path normalised: the dedupe key
  resolved_url       text,                   -- canonical form of where a share/short link actually led
  platform           text NOT NULL,
  kind               text NOT NULL,
  status             text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'capturing', 'complete', 'partial', 'walled', 'unavailable', 'failed')),
  title              text,
  note               text,
  case_ref           text,
  tags               text[] NOT NULL DEFAULT '{}',
  sensitive          boolean NOT NULL DEFAULT false,
  client             text,                   -- which entry point: web, android-share, ios-shortcut, extension, telegram, api
  submitted_by       uuid REFERENCES capture.contributors(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  latest_capture_id  uuid
);
CREATE INDEX items_canonical_url ON capture.items (canonical_url);
CREATE INDEX items_resolved_url  ON capture.items (resolved_url) WHERE resolved_url IS NOT NULL;
CREATE INDEX items_submitted_by  ON capture.items (submitted_by, created_at DESC);

CREATE TABLE capture.captures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          uuid NOT NULL REFERENCES capture.items(id) ON DELETE CASCADE,
  state            text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'error')),
  verdict          text CHECK (verdict IN ('complete', 'partial', 'walled', 'unavailable', 'failed')),
  verdict_reasons  jsonb NOT NULL DEFAULT '[]',
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 3,
  run_after        timestamptz NOT NULL DEFAULT now(),
  claimed_by       text,
  requested_by     uuid REFERENCES capture.contributors(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  final_url        text,
  extracted        jsonb NOT NULL DEFAULT '{}',   -- author, text, published_at, counts...
  witnesses        jsonb NOT NULL DEFAULT '[]',   -- per-witness outcome summary
  tool_versions    jsonb NOT NULL DEFAULT '{}',
  egress           text NOT NULL DEFAULT 'direct',
  session          text NOT NULL DEFAULT 'none',
  manifest_key     text,
  manifest_sha256  text,
  error            text
);
CREATE INDEX captures_queue ON capture.captures (run_after) WHERE state = 'queued';
CREATE INDEX captures_item  ON capture.captures (item_id, created_at DESC);

ALTER TABLE capture.items
  ADD CONSTRAINT items_latest_capture_fk
  FOREIGN KEY (latest_capture_id) REFERENCES capture.captures(id) ON DELETE SET NULL;

CREATE TABLE capture.artifacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id   uuid NOT NULL REFERENCES capture.captures(id) ON DELETE CASCADE,
  witness      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('video', 'audio', 'image', 'screenshot', 'html', 'text',
                                             'metadata', 'wacz', 'pdf', 'manifest', 'link')),
  role         text NOT NULL CHECK (role IN ('primary', 'context')),
  label        text,
  sha256       text,                 -- NULL only for kind='link' (e.g. a Wayback URL: nothing stored)
  bytes        bigint,
  mime         text,
  storage_key  text,
  source_url   text,
  width        integer,
  height       integer,
  duration_s   double precision,
  meta         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_capture ON capture.artifacts (capture_id);
CREATE INDEX artifacts_sha256  ON capture.artifacts (sha256) WHERE sha256 IS NOT NULL;
