-- Publication: one approval by someone entitled to publish (a manager, or a member with publication access),
-- with an optional "second opinion" request instead of a mandatory second approver (decision 2026-10-19: the team
-- is small; agility with a safety valve). approved_by_manager / approved_by_publisher are no longer used.

ALTER TABLE capture.publications ADD COLUMN published_by uuid REFERENCES capture.contributors(id);
ALTER TABLE capture.publications ADD COLUMN review_requested_by uuid REFERENCES capture.contributors(id);
ALTER TABLE capture.publications ADD COLUMN review_requested_at timestamptz;
ALTER TABLE capture.publications ADD COLUMN review_request_note text;
ALTER TABLE capture.publications ADD COLUMN review_request_to text[] NOT NULL DEFAULT '{}';  -- "@reviewer", names
ALTER TABLE capture.publication_batches ADD COLUMN published_by uuid REFERENCES capture.contributors(id);

-- Feed entries and notifications about a publication that has no incident (a community memory).
ALTER TABLE capture.updates ADD COLUMN publication_id uuid REFERENCES capture.publications(id) ON DELETE CASCADE;

ALTER TABLE capture.notifications DROP CONSTRAINT notifications_reason_check;
ALTER TABLE capture.notifications ADD CONSTRAINT notifications_reason_check
  CHECK (reason IN ('subscribed', 'mentioned', 'assigned', 'review_requested'));
