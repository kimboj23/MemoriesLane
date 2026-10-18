-- Per-project access (Atlos roles), invite links, notifications, and external copies (Internet Archive).
--
-- Project roles, lowest to highest (Atlos):
--   data_only_viewer  incidents only: no feed/comments, no member or assignee names
--   viewer            + comments, feed, member list, CSV export
--   editor            + edit incidents (not completed ones), add source material
--   manager           + completed/cancelled, delete incidents, project settings/attributes, bulk import
--   owner             + members, roles and invite links
-- Instance admins (contributors.role = 'admin') act as owner everywhere.

CREATE TABLE capture.project_members (
  project_id      uuid NOT NULL REFERENCES capture.projects(id) ON DELETE CASCADE,
  contributor_id  uuid NOT NULL REFERENCES capture.contributors(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('data_only_viewer', 'viewer', 'editor', 'manager', 'owner')),
  added_by        uuid REFERENCES capture.contributors(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contributor_id)
);
CREATE INDEX project_members_contributor ON capture.project_members (contributor_id);

-- Existing projects: their creator becomes the owner.
INSERT INTO capture.project_members (project_id, contributor_id, role)
SELECT id, created_by, 'owner' FROM capture.projects WHERE created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- An invite link joins a project with a fixed role. Only the code's SHA-256 is stored; the link is shown once.
CREATE TABLE capture.project_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES capture.projects(id) ON DELETE CASCADE,
  code_sha256   text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('data_only_viewer', 'viewer', 'editor', 'manager')),
  note          text,
  max_uses      integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses          integer NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by    uuid REFERENCES capture.contributors(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE capture.subscriptions (
  contributor_id  uuid NOT NULL REFERENCES capture.contributors(id) ON DELETE CASCADE,
  incident_id     uuid NOT NULL REFERENCES capture.incidents(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contributor_id, incident_id)
);

CREATE TABLE capture.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id  uuid NOT NULL REFERENCES capture.contributors(id) ON DELETE CASCADE,
  update_id       uuid NOT NULL REFERENCES capture.updates(id) ON DELETE CASCADE,
  reason          text NOT NULL CHECK (reason IN ('subscribed', 'mentioned', 'assigned')),
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contributor_id, update_id)
);
CREATE INDEX notifications_inbox ON capture.notifications (contributor_id, created_at DESC);

-- Copies held by third parties (the Internet Archive's Wayback Machine). Not part of a sealed capture:
-- they are submitted afterwards, can be retried or re-requested on their own, and are never evidence of
-- what we captured, only an independent public copy.
CREATE TABLE capture.external_copies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES capture.items(id) ON DELETE CASCADE,
  service       text NOT NULL DEFAULT 'wayback' CHECK (service IN ('wayback')),
  submitted_url text NOT NULL,                    -- what was sent (for Facebook: the public embed URL)
  state         text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'error', 'skipped')),
  copy_url      text,
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  run_after     timestamptz NOT NULL DEFAULT now(),
  requested_by  uuid REFERENCES capture.contributors(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX external_copies_queue ON capture.external_copies (run_after) WHERE state = 'queued';
CREATE INDEX external_copies_item ON capture.external_copies (item_id, created_at DESC);

-- Atlos "Share with the Internet Archive": per project, off by default (submissions are public).
ALTER TABLE capture.projects ADD COLUMN wayback_enabled boolean NOT NULL DEFAULT false;
