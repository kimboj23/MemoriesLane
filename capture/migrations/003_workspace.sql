-- Workspace: projects, incidents and an activity feed, modelled on Atlos
-- (projects -> incidents -> source material, with every change in a feed).
--
--   projects  ─< incidents ─< items (source material, each with its capture versions)
--   incidents ─< updates   (feed: creation, attribute changes with an optional reason, comments,
--                           material added/removed, capture results)

CREATE TABLE capture.projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,6}$'),   -- incident ids read CODE-12
  name         text NOT NULL,
  description  text,
  color        text NOT NULL DEFAULT '#2563eb' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  tag_options  text[] NOT NULL DEFAULT '{}',          -- suggested tags; free tags are still allowed
  attributes   jsonb NOT NULL DEFAULT '[]',           -- custom attribute definitions [{id,name,type,options,description}]
  next_number  integer NOT NULL DEFAULT 1,
  archived     boolean NOT NULL DEFAULT false,        -- archived projects are read-only
  created_by   uuid REFERENCES capture.contributors(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE capture.incidents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES capture.projects(id) ON DELETE RESTRICT,
  number         integer NOT NULL,
  description    text NOT NULL,
  status         text NOT NULL DEFAULT 'to_do'
                 CHECK (status IN ('to_do', 'in_progress', 'help_needed', 'ready_for_review', 'completed', 'cancelled')),
  sensitive      text[] NOT NULL DEFAULT '{not_sensitive}',
  tags           text[] NOT NULL DEFAULT '{}',
  event_date     date,
  place          text,                                -- "reported near"
  lat            double precision CHECK (lat BETWEEN -90 AND 90),
  lng            double precision CHECK (lng BETWEEN -180 AND 180),
  geo_precision  text CHECK (geo_precision IN ('exact', 'vicinity', 'locality')),
  assignees      uuid[] NOT NULL DEFAULT '{}',
  custom         jsonb NOT NULL DEFAULT '{}',         -- values of the project's custom attributes, by attribute id
  deleted        boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES capture.contributors(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE INDEX incidents_project ON capture.incidents (project_id, updated_at DESC);

ALTER TABLE capture.items ADD COLUMN incident_id uuid REFERENCES capture.incidents(id) ON DELETE SET NULL;
CREATE INDEX items_incident ON capture.items (incident_id) WHERE incident_id IS NOT NULL;

CREATE TABLE capture.updates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     uuid REFERENCES capture.incidents(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES capture.items(id) ON DELETE SET NULL,
  contributor_id  uuid REFERENCES capture.contributors(id),   -- NULL = the system (e.g. a capture finished)
  kind            text NOT NULL CHECK (kind IN ('created', 'attribute', 'comment', 'material_added',
                                                'material_removed', 'capture')),
  field           text,
  old_value       jsonb,
  new_value       jsonb,
  body            text,                                         -- the comment, or the reason for a change
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX updates_incident ON capture.updates (incident_id, created_at);
