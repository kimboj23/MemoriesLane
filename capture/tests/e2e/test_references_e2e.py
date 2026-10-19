"""End-to-end: a community submission used as a reference in another project's incident.

Its home (project and incident) keeps the sealed contact and alone decides publication. People in the other
project see the text, never the contact, and the reference never enters that incident's public version.
Same setup as test_intake_e2e.py; makes no external requests.
"""

import base64
import os
import random
import secrets
import string

import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from test_intake_e2e import Site, api  # noqa: E402  (the same signed-site client and API helper)

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")


def test_submission_as_reference_in_another_project():
    s, cfg = api("GET", "/v1/admin/sources")
    if not cfg["configured"]:
        pytest.skip("INTAKE_KEY_SECRET not set")
    tag = "".join(random.choices(string.ascii_uppercase, k=4))
    s, home = api("POST", "/v1/projects", {"code": "H" + tag[:3], "name": f"Nhà {tag}"})
    s, other = api("POST", "/v1/projects", {"code": "R" + tag[:3], "name": f"Tham chiếu {tag}"})
    s, src = api("POST", "/v1/admin/sources", {"slug": f"e2e-ref-{tag.lower()}", "name": f"E2E ref {tag}",
                                               "routing": {"case_report": home["id"]}})
    site = Site(src["slug"], src["key"])
    sub = site.submit({"external_id": f"c-{tag}", "kind": "case_report",
                       "contact": {"sealed": base64.b64encode(secrets.token_bytes(64)).decode()},
                       "payload": {"group": "violation", "title": f"Trình báo {tag}",
                                   "description": "Nội dung kiểm tra."}}).json()
    kid = sub["intake_id"]

    # Someone only in the other project, as a viewer.
    s, viewer = api("POST", "/v1/admin/contributors", {"name": f"Người xem {tag}"})
    api("POST", f"/v1/projects/{other['id']}/members", {"contributor_id": viewer["id"], "role": "viewer"})
    assert api("GET", f"/v1/intake/{kid}", token=viewer["token"])[0] == 404

    s, there = api("POST", "/v1/incidents", {"project_id": other["id"], "description": f"Vụ việc khác {tag}"})
    assert api("POST", f"/v1/intake/{kid}/references", {"incident_id": there["id"]})[0] == 409   # not filed yet
    s, r = api("POST", f"/v1/intake/{kid}/create", {})
    home_incident = r["created_incident_id"]
    assert api("POST", f"/v1/intake/{kid}/references", {"incident_id": home_incident})[0] == 409  # its own incident
    s, k = api("POST", f"/v1/intake/{kid}/references", {"incident_id": there["id"]})
    assert s == 200 and [x["id"] for x in k["references"]["incidents"]] == [there["id"]]
    assert api("POST", f"/v1/intake/{kid}/references", {"incident_id": there["id"]})[0] == 200      # idempotent

    # The viewer now reads it through the reference: text yes; contact, reviewer and home incident no.
    s, kv = api("GET", f"/v1/intake/{kid}", token=viewer["token"])
    assert s == 200 and kv["my_role"] == "reference" and kv["payload"]["title"] == f"Trình báo {tag}"
    assert kv["has_contact"] is False and kv["incident"] is None and kv["reviewed_by"] is None
    assert api("POST", f"/v1/intake/{kid}/contact", token=viewer["token"])[0] == 404
    assert api("POST", f"/v1/intake/{kid}/references", {"incident_id": there["id"]}, token=viewer["token"])[0] == 404
    s, inc = api("GET", f"/v1/incidents/{there['id']}", token=viewer["token"])
    ref = [x for x in inc["intake"] if x["id"] == kid]
    assert ref and ref[0]["reference"] and ref[0]["home_project"].startswith(home["code"])
    assert api("DELETE", f"/v1/intake/{kid}/references/{there['id']}", token=viewer["token"])[0] == 403  # viewers can't

    # It never enters the other incident's public version; the home incident's version has it.
    s, pub = api("POST", f"/v1/incidents/{there['id']}/publication")
    assert kid not in [n["intake_id"] for n in pub["draft"].get("community_notes") or []]
    s, hpub = api("POST", f"/v1/incidents/{home_incident}/publication")
    assert kid in [n["intake_id"] for n in hpub["draft"].get("community_notes") or []]

    # Removing the reference ends the viewer's access.
    assert api("DELETE", f"/v1/intake/{kid}/references/{there['id']}")[0] == 204
    assert api("GET", f"/v1/intake/{kid}", token=viewer["token"])[0] == 404
