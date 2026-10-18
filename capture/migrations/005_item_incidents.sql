-- A saved link can be source material of several incidents (in any projects). The link and its captures
-- exist once; item_incidents says where it is used. Replaces items.incident_id (one incident per link).

CREATE TABLE capture.item_incidents (
  item_id      uuid NOT NULL REFERENCES capture.items(id) ON DELETE CASCADE,
  incident_id  uuid NOT NULL REFERENCES capture.incidents(id) ON DELETE CASCADE,
  added_by     uuid REFERENCES capture.contributors(id),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, incident_id)
);
CREATE INDEX item_incidents_incident ON capture.item_incidents (incident_id, added_at);

INSERT INTO capture.item_incidents (item_id, incident_id, added_by, added_at)
SELECT id, incident_id, submitted_by, updated_at FROM capture.items WHERE incident_id IS NOT NULL;

DROP INDEX IF EXISTS capture.items_incident;
ALTER TABLE capture.items DROP COLUMN incident_id;
