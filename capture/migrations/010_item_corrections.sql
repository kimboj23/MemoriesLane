-- Human corrections to a link: its status (when the machine got it wrong, e.g. "removed" for a post that only
-- needs login) and its metadata (title, author, post date, text). The sealed captures are never touched: the
-- machine's verdict stays in capture.captures, and the corrected values sit beside it on the item.
ALTER TABLE capture.items
  ADD COLUMN status_override  text CHECK (status_override IN ('complete', 'partial', 'walled', 'restricted', 'unavailable',
                                                              'failed')),
  ADD COLUMN corrections      jsonb NOT NULL DEFAULT '{}',   -- {"title", "author", "published_at", "text"}
  ADD COLUMN corrected_by     uuid REFERENCES capture.contributors(id),
  ADD COLUMN corrected_at     timestamptz,
  ADD COLUMN correction_reason text;

-- Every correction, for the record (append-only).
CREATE TABLE capture.item_corrections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES capture.items(id) ON DELETE CASCADE,
  by_id       uuid REFERENCES capture.contributors(id),
  at          timestamptz NOT NULL DEFAULT now(),
  changes     jsonb NOT NULL,        -- {"field": {"old": ..., "new": ...}}
  reason      text
);
CREATE INDEX item_corrections_item ON capture.item_corrections (item_id, at DESC);

ALTER TABLE capture.updates DROP CONSTRAINT updates_kind_check;
ALTER TABLE capture.updates ADD CONSTRAINT updates_kind_check
  CHECK (kind IN ('created', 'attribute', 'comment', 'material_added', 'material_removed', 'capture',
                  'intake', 'publication', 'material_corrected'));
