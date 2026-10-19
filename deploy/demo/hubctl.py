"""Small hub API helper for setup.sh (python3 standard library only).

    python3 hubctl.py <hub_url> <admin_token> source <slug> <name> <project_code> <project_name>
        → prints KEY=<source key> (creating or rotating it) and ROOT=<feed root public key>
    python3 hubctl.py <hub_url> <admin_token> seed-map <site_api_url> <project_code>
        → sends three FICTIONAL memories through the community map's backend, then reviews and publishes them
"""
import json
import sys
import time
import urllib.request

HUB, TOKEN, CMD = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]


def hub(method, path, body=None):
    req = urllib.request.Request(HUB + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read()
        return json.loads(t) if t else None


def project(code, name, attributes=None):
    for p in hub("GET", "/v1/projects?include_archived=true")["projects"]:
        if p["code"] == code:
            return p
    return hub("POST", "/v1/projects", {"code": code, "name": name, "attributes": attributes or []})


if CMD == "source":
    slug, name, code, pname = sys.argv[4:8]
    attrs = [{"name": "Nhóm hồ sơ", "type": "select", "options": ["Vi phạm", "Tố tụng", "Hạn chế mạng xã hội", "Phong trào xã hội"]}] \
        if code == "HSNQ" else []
    p = project(code, pname, attrs)
    me = hub("GET", "/v1/me")
    try:
        hub("PUT", f"/v1/projects/{p['id']}/members/{me['id']}/publish", {"can_publish": True})
    except Exception:  # noqa: BLE001 - admins can publish anyway
        pass
    routing = {k: p["id"] for k in ("memory", "case_report", "document", "link")}
    existing = next((s for s in hub("GET", "/v1/admin/sources")["sources"] if s["slug"] == slug), None)
    if existing:
        hub("PATCH", f"/v1/admin/sources/{existing['id']}", {"routing": routing})
        key = hub("POST", f"/v1/admin/sources/{existing['id']}/rotate")["key"]
    else:
        key = hub("POST", "/v1/admin/sources", {"slug": slug, "name": name, "routing": routing})["key"]
    with urllib.request.urlopen(HUB + "/feed/keys.json", timeout=30) as r:
        root = json.loads(r.read())["root_public"]
    print(f"KEY={key}")
    print(f"ROOT={root}")

elif CMD == "seed-map":
    site, code = sys.argv[4].rstrip("/"), sys.argv[5]
    memories = [
        {"lat": 21.0333, "lng": 105.8500, "city": "hanoi", "cat": "community", "year": 2016, "month": 9,
         "vi": "Dữ liệu mẫu. Con hẻm sau chợ từng là nơi cả xóm phơi đồ chung; mỗi chiều bọn trẻ đá bóng tới khi đèn đường bật.",
         "attribution": "anonymous", "allowExact": False},
        {"lat": 21.0290, "lng": 105.8560, "city": "hanoi", "cat": "personal", "year": 2009,
         "vi": "Dữ liệu mẫu. Quán nước đầu ngõ của bà tôi mở suốt ba mươi năm, đến khi có thông báo giải toả.",
         "attribution": "pseudonym", "authorName": "Người kể A", "allowExact": False},
        {"lat": 21.0368, "lng": 105.8342, "city": "hanoi", "cat": "event", "year": 2026, "month": 4,
         "vi": "Dữ liệu mẫu. Buổi gặp gỡ công khai bên hàng cây cổ thụ, mọi người ký kiến nghị giữ lại hàng cây.",
         "attribution": "anonymous", "allowExact": True},
    ]
    for m in memories:
        req = urllib.request.Request(site + "/api/memories", method="POST", data=json.dumps(m).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=60).read()
    p = project(code, "Bản đồ ký ức")
    deadline, found = time.time() + 120, []
    while time.time() < deadline and len(found) < len(memories):
        found = [k for k in hub("GET", f"/v1/intake?project_id={p['id']}&state=new&limit=50")["intake"]
                 if k["summary"].startswith("Dữ liệu mẫu.")]
        time.sleep(3)
    for k in found:
        pub = hub("POST", f"/v1/intake/{k['id']}/publication")
        d = pub["draft"]
        kind = "public_gathering" if d.get("submitter_allows_exact") else "memory"
        hub("PATCH", f"/v1/publications/{pub['id']}", {"place_kind": kind, "precision": "street" if kind == "public_gathering" else "ward"})
        print("published", hub("POST", f"/v1/publications/{pub['id']}/approve")["public_id"])
