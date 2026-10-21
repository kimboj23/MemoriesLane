-- Upkeep (upkeep.py): trusted timestamps of sealed captures, the scheduled canary, and photo fingerprints.

-- RFC 3161 timestamps of a capture's manifest hash, from independent timestamping authorities. Outside the sealed
-- capture (the manifest exists before it can be timestamped); the token itself is stored content-addressed.
CREATE TABLE capture.capture_timestamps (
  capture_id    uuid NOT NULL REFERENCES capture.captures(id) ON DELETE CASCADE,
  tsa           text NOT NULL,                 -- the authority's URL
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'error')),
  attempts      integer NOT NULL DEFAULT 0,
  token_key     text,                          -- storage key of the DER TimeStampResp
  token_sha256  text,
  gen_time      timestamptz,                   -- the time the authority signed
  error         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capture_id, tsa)
);
CREATE INDEX capture_timestamps_todo ON capture.capture_timestamps (state, updated_at) WHERE state = 'pending';

-- The scheduled canary: known links captured without storing anything; their verdict against the expected one.
CREATE TABLE capture.canary_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at       timestamptz NOT NULL DEFAULT now(),
  link_sha256  text NOT NULL,                  -- the link itself stays in the canary file
  note         text,
  platform     text,
  expected     text NOT NULL,
  verdict      text,
  ok           boolean NOT NULL,
  reasons      jsonb NOT NULL DEFAULT '[]',
  egress       text,
  seconds      real
);
CREATE INDEX canary_runs_recent ON capture.canary_runs (run_at DESC);

-- 64-bit difference hash of photos (phash.py), to spot the same picture saved twice (resized, recompressed).
ALTER TABLE capture.artifacts ADD COLUMN phash bigint;
ALTER TABLE capture.intake_files ADD COLUMN phash bigint;
CREATE INDEX artifacts_phash ON capture.artifacts (phash) WHERE phash IS NOT NULL;
CREATE INDEX intake_files_phash ON capture.intake_files (phash) WHERE phash IS NOT NULL;
