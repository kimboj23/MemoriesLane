-- The feed keeps the previous generation's record and file paths for one build, so a site that read the old
-- index a moment before a rebuild can still fetch what it names (records are now content-addressed). Paths of
-- withdrawn records are never kept: a withdrawal still deletes at once.
ALTER TABLE capture.feed_state ADD COLUMN live_paths jsonb NOT NULL DEFAULT '{}';   -- {public_id: [paths]}
