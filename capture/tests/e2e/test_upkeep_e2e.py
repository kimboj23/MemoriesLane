"""End-to-end: admin health endpoints, and duplicate community photos found by their fingerprint (upkeep.py).

Runs inside the worker container (it calls upkeep.fingerprint directly instead of waiting for the loop).
No external requests: timestamping and the canary are off unless a deployment turns them on.
"""

import asyncio
import io
import os
import random
import string
import sys

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from test_intake_e2e import Site, api  # noqa: E402

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")


def test_admin_health_endpoints():
    s, stats = api("GET", "/v1/admin/capture-stats?days=7")
    assert s == 200 and "platforms" in stats and "waiting_rate_limited" in stats
    for p in stats["platforms"]:
        for d in p["days"]:
            assert d["blocked"] <= d["total"] == sum(d["counts"].values())
    s, canary = api("GET", "/v1/admin/canary")
    assert s == 200 and {"links", "interval_h", "runs", "latest"} <= set(canary)
    s, health = api("GET", "/v1/admin/health")
    assert s == 200 and isinstance(health["alerts"], list)
    s, viewer = api("POST", "/v1/admin/contributors", {"name": "Health check viewer"})
    assert api("GET", "/v1/admin/health", token=viewer["token"])[0] == 403       # admins only


def _jpeg(size, quality, seed) -> bytes:
    im = Image.new("RGB", (800, 600), (40, 90, 150))
    d = ImageDraw.Draw(im)
    rnd = random.Random(seed)
    for _ in range(14):
        x, y = rnd.randrange(700), rnd.randrange(500)
        d.ellipse([x, y, x + rnd.randrange(60, 160), y + rnd.randrange(60, 120)], fill=tuple(rnd.randrange(256) for _ in range(3)))
    b = io.BytesIO()
    im.resize(size).save(b, "JPEG", quality=quality)
    return b.getvalue()


def test_duplicate_community_photo_is_found():
    s, cfg = api("GET", "/v1/admin/sources")
    if not cfg["configured"]:
        pytest.skip("INTAKE_KEY_SECRET not set")
    tag = "".join(random.choices(string.ascii_uppercase, k=4))
    s, proj = api("POST", "/v1/projects", {"code": "P" + tag[:3], "name": f"Ảnh {tag}"})
    s, src = api("POST", "/v1/admin/sources", {"slug": f"e2e-ph-{tag.lower()}", "name": f"E2E photos {tag}",
                                               "routing": {"memory": proj["id"]}})
    site = Site(src["slug"], src["key"])
    seed = random.randrange(10 ** 9)                       # a picture no earlier run has stored
    photos = {"a": _jpeg((800, 600), 92, seed), "b": _jpeg((400, 300), 55, seed), "c": _jpeg((800, 600), 92, seed + 1)}
    ids = {}
    for name, data in photos.items():
        r = site.submit({"external_id": f"{name}-{tag}", "kind": "memory", "files": [{"n": 1, "mime": "image/jpeg", "bytes": len(data)}],
                         "payload": {"text": f"Ký ức kiểm tra ảnh {name} {tag}"}}).json()
        ids[name] = r["intake_id"]
        assert site.call("PUT", f"/intake/v1/submissions/{ids[name]}/files/1", data, "image/jpeg").json()["kind"] == "image"

    from memlane_capture import upkeep
    from memlane_capture.db import make_pool

    async def run():
        pool = make_pool(max_size=2)
        await pool.open()
        try:
            while await upkeep.fingerprint(pool):
                pass
        finally:
            await pool.close()
    asyncio.run(run())

    s, r = api("GET", f"/v1/similar-images?intake_id={ids['a']}")
    found = {x["id"]: x for x in r["similar"]}
    assert ids["b"] in found and found[ids["b"]]["distance"] <= 6       # same photo, smaller and recompressed
    assert ids["c"] not in found                                        # a different photo
    assert api("GET", "/v1/similar-images")[0] == 422
    # Someone who can't read the submissions doesn't learn about them.
    s, outsider = api("POST", "/v1/admin/contributors", {"name": f"Outsider {tag}"})
    assert api("GET", f"/v1/similar-images?intake_id={ids['a']}", token=outsider["token"])[0] == 404
