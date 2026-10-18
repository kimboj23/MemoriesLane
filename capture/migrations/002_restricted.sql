-- The `restricted` verdict: the platform withholds the content from this viewer or region rather than
-- removing it, e.g. Meta "restricted access ... after a legal request" on a Threads post (2026-10-18).

ALTER TABLE capture.captures DROP CONSTRAINT captures_verdict_check;
ALTER TABLE capture.captures ADD CONSTRAINT captures_verdict_check
  CHECK (verdict IN ('complete', 'partial', 'walled', 'restricted', 'unavailable', 'failed'));
ALTER TABLE capture.items DROP CONSTRAINT items_status_check;
ALTER TABLE capture.items ADD CONSTRAINT items_status_check
  CHECK (status IN ('queued', 'capturing', 'complete', 'partial', 'walled', 'restricted', 'unavailable', 'failed'));
