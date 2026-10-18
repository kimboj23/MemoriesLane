-- Community intake and publication (docs/integration-design.md).
--
--   sources ─< intake ─< intake_files       submissions forwarded by the public sites ("spokes")
--               intake ─< intake_items      links found in a submission, captured as ordinary items
--   publications                            reviewed public versions, written to the signed feed
--   public_files                            cleaned copies of the media a publication shows
--
-- The public sites can only create intake rows (Intake API, signed per source). Nothing here is public until
-- a publication is approved by a manager and a different member with publication access.

-- The publication-access grant ("Quyền công bố"), per project member.
ALTER TABLE capture.project_members ADD COLUMN can_publish boolean NOT NULL DEFAULT false;

-- Feed entries for triage and publication.
ALTER TABLE capture.updates DROP CONSTRAINT updates_kind_check;
ALTER TABLE capture.updates ADD CONSTRAINT updates_kind_check
  CHECK (kind IN ('created', 'attribute', 'comment', 'material_added', 'material_removed', 'capture',
                  'intake', 'publication'));

-- A public site allowed to forward submissions. Its key is derived from INTAKE_KEY_SECRET and key_version
-- (intake.py), so the database never holds it; bumping key_version revokes the old key.
CREATE TABLE capture.sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name            text NOT NULL,
  key_version     integer NOT NULL DEFAULT 1,
  -- {"memory": project_id, "case_report": project_id, "document": project_id, "link": project_id}
  routing         jsonb NOT NULL DEFAULT '{}',
  rate_per_hour   integer NOT NULL DEFAULT 300 CHECK (rate_per_hour > 0),
  -- the contributor that links from this source are saved as ("Nguồn: <name>")
  contributor_id  uuid NOT NULL REFERENCES capture.contributors(id),
  created_by      uuid REFERENCES capture.contributors(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz
);

-- Replay protection: a request nonce is accepted once (requests older than 5 minutes are refused anyway).
CREATE TABLE capture.intake_nonces (
  sig_sha256  text PRIMARY KEY,
  seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE capture.intake (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES capture.sources(id),
  external_id     text NOT NULL,                     -- the spoke's own id: retries are idempotent
  kind            text NOT NULL CHECK (kind IN ('memory', 'case_report', 'document', 'link')),
  lang            text,
  submitted_at    timestamptz,
  payload         jsonb NOT NULL DEFAULT '{}',       -- kind-specific fields, as text only (never rendered as HTML)
  links           text[] NOT NULL DEFAULT '{}',
  files_declared  jsonb NOT NULL DEFAULT '[]',       -- [{n, mime, bytes}] announced before upload
  contact_sealed  text,                              -- libsodium sealed box to the hub's contact key, or NULL
  consents        jsonb NOT NULL DEFAULT '{}',
  receipt_sha256  text UNIQUE,                       -- the submitter's receipt code, hashed
  legacy_public   boolean NOT NULL DEFAULT false,    -- imported record that was already public on the spoke
  project_id      uuid REFERENCES capture.projects(id),   -- routed here (NULL = needs routing by an admin)
  state           text NOT NULL DEFAULT 'new'
                  CHECK (state IN ('new', 'attached', 'created', 'published', 'rejected')),
  incident_id     uuid REFERENCES capture.incidents(id) ON DELETE SET NULL,
  reviewed_by     uuid REFERENCES capture.contributors(id),
  reason          text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  UNIQUE (source_id, external_id)
);
CREATE INDEX intake_queue ON capture.intake (project_id, state, received_at DESC);
CREATE INDEX intake_incident ON capture.intake (incident_id) WHERE incident_id IS NOT NULL;

CREATE TABLE capture.intake_items (
  intake_id  uuid NOT NULL REFERENCES capture.intake(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES capture.items(id) ON DELETE CASCADE,
  PRIMARY KEY (intake_id, item_id)
);
CREATE INDEX intake_items_item ON capture.intake_items (item_id);

-- A contributor-provided file: stored content-addressed and hashed exactly as received ("provided by a
-- contributor", never presented as our own capture). Served internally only, sandboxed.
CREATE TABLE capture.intake_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id    uuid NOT NULL REFERENCES capture.intake(id) ON DELETE CASCADE,
  n            integer NOT NULL,
  kind         text CHECK (kind IN ('image', 'video', 'pdf', 'text')),
  mime         text,
  bytes        bigint,
  sha256       text,
  storage_key  text,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'stored', 'rejected')),
  error        text,
  received_at  timestamptz,
  UNIQUE (intake_id, n)
);

-- A reviewed public version. `draft` is edited; approving it twice (manager + publisher, two people) copies
-- it to `published` and bumps `version`. Withdrawing leaves a tombstone in the feed.
CREATE TABLE capture.publications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id              text NOT NULL UNIQUE,
  type                   text NOT NULL CHECK (type IN ('incident', 'memory')),
  project_id             uuid NOT NULL REFERENCES capture.projects(id),
  incident_id            uuid REFERENCES capture.incidents(id) ON DELETE SET NULL,
  intake_id              uuid REFERENCES capture.intake(id) ON DELETE SET NULL,
  batch_id               uuid,
  state                  text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'withdrawn')),
  draft                  jsonb NOT NULL DEFAULT '{}',
  published              jsonb,
  version                integer NOT NULL DEFAULT 0,
  dirty                  boolean NOT NULL DEFAULT false,   -- draft differs from what is published
  approved_by_manager    uuid REFERENCES capture.contributors(id),
  approved_by_publisher  uuid REFERENCES capture.contributors(id),
  drafted_by             uuid REFERENCES capture.contributors(id),
  published_at           timestamptz,
  withdrawn_at           timestamptz,
  withdrawn_reason       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by_manager IS NULL OR approved_by_publisher IS NULL OR approved_by_manager <> approved_by_publisher)
);
CREATE UNIQUE INDEX publications_incident ON capture.publications (incident_id) WHERE incident_id IS NOT NULL;
CREATE UNIQUE INDEX publications_intake ON capture.publications (intake_id) WHERE intake_id IS NOT NULL;

-- Approve many already-public legacy records at once (integration-design §9).
CREATE TABLE capture.publication_batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES capture.projects(id),
  label                  text NOT NULL,
  drafted_by             uuid REFERENCES capture.contributors(id),
  approved_by_manager    uuid REFERENCES capture.contributors(id),
  approved_by_publisher  uuid REFERENCES capture.contributors(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  published_at           timestamptz,
  CHECK (approved_by_manager IS NULL OR approved_by_publisher IS NULL OR approved_by_manager <> approved_by_publisher)
);
ALTER TABLE capture.publications ADD CONSTRAINT publications_batch_fk
  FOREIGN KEY (batch_id) REFERENCES capture.publication_batches(id) ON DELETE SET NULL;

-- Public files: a cleaned derivative (metadata stripped, re-encoded) of a capture artifact or a contributor
-- file, content-addressed by its own SHA-256. The original's hash is published too, for verification.
CREATE TABLE capture.public_files (
  sha256           text PRIMARY KEY,
  storage_key      text NOT NULL,
  mime             text NOT NULL,
  bytes            bigint NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  source_sha256    text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_files_source ON capture.public_files (source_sha256);

-- One row: whether the feed must be rebuilt, and what was last written.
CREATE TABLE capture.feed_state (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dirty            boolean NOT NULL DEFAULT true,
  built_at         timestamptz,
  index_sha256     text,
  error            text
);
INSERT INTO capture.feed_state (id) VALUES (1);

-- Revealing a sealed contact is logged (who, when, which submission).
CREATE TABLE capture.contact_reveals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id       uuid NOT NULL REFERENCES capture.intake(id) ON DELETE CASCADE,
  contributor_id  uuid NOT NULL REFERENCES capture.contributors(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
