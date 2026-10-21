-- `rate_limited`: the platform answered HTTP 429 (too many requests from this server). Not a result: the capture
-- waits in the queue with a long backoff and is tried again (worker.retry_plan).
ALTER TABLE capture.items DROP CONSTRAINT items_status_check;
ALTER TABLE capture.items ADD CONSTRAINT items_status_check
  CHECK (status IN ('queued', 'capturing', 'rate_limited', 'complete', 'partial', 'walled', 'restricted', 'unavailable',
                    'failed'));
