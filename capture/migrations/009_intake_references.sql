-- A community submission has one home: its project and the incident it was filed in (intake.project_id /
-- incident_id). Only the home decides publication and can open the sealed contact. Other incidents, in any
-- project, may use it as a reference: their members see the text and files, never the contact, and nothing is
-- published from there.
CREATE TABLE capture.intake_references (
  intake_id    uuid NOT NULL REFERENCES capture.intake(id) ON DELETE CASCADE,
  incident_id  uuid NOT NULL REFERENCES capture.incidents(id) ON DELETE CASCADE,
  added_by     uuid REFERENCES capture.contributors(id),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intake_id, incident_id)
);
CREATE INDEX intake_references_incident ON capture.intake_references (incident_id);
