-- "Run the canary now" from Admin (health.py): the API records the request, the worker's upkeep loop runs it
-- (only the worker has the browser). One at a time.
CREATE TABLE capture.canary_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by  uuid REFERENCES capture.contributors(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  links         integer,
  error         text
);
CREATE UNIQUE INDEX canary_requests_one_open ON capture.canary_requests ((true)) WHERE finished_at IS NULL;
