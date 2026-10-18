"""Canary: re-capture a fixed set of real links and check each platform still works.

    CAPTURE_API=http://127.0.0.1:8700 CAPTURE_TOKEN=mlc_... python tests/canary.py

Run it nightly and before deploying any dependency bump (yt-dlp, Playwright).
Exits non-zero if any link comes back worse than its expected minimum
verdict, so "did Facebook break this week?" is answered before users notice.
Uses only the standard library so it can run anywhere.

The link list is read from CANARY_FILE (default capture/secrets/canary.json,
gitignored), because the best canaries are real posts by private people and
this repository is public. tests/canary.example.json shows the format and
uses only media organisations' public pages.
"""

import json
import os
import pathlib
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_FILE = HERE.parent / "secrets" / "canary.json"


def load_canary() -> list[tuple[str, str, str]]:
    """[(url, minimum acceptable verdict, note)]: logged out, unless sessions are configured."""
    path = pathlib.Path(os.environ.get("CANARY_FILE") or DEFAULT_FILE)
    if not path.is_file():
        path = HERE / "canary.example.json"
        print(f"(no {DEFAULT_FILE.name} found, using {path.name})\n")
    return [(c["url"], c["min"], c.get("note", "")) for c in json.loads(path.read_text(encoding="utf-8"))]


RANK = {"failed": 0, "walled": 1, "unavailable": 1, "partial": 2, "complete": 3}


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        os.environ.get("CAPTURE_API", "http://127.0.0.1:8700") + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {os.environ['CAPTURE_TOKEN']}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def main() -> int:
    submitted = []
    for url, minimum, note in load_canary():
        r = call("POST", "/v1/inbox", {"url": url, "client": "api", "new_version": True, "tags": ["canary"]})
        # the capture created (or already in progress) for this run, which is what we wait for
        submitted.append((r["item"]["id"], r["item"]["latest_capture"]["id"], url, minimum, note))

    deadline = time.time() + int(os.environ.get("CANARY_TIMEOUT_S", "1800"))
    results = {}
    while time.time() < deadline and len(results) < len(submitted):
        for item_id, capture_id, url, minimum, note in submitted:
            if item_id in results:
                continue
            item = call("GET", f"/v1/items/{item_id}")
            cap = next((c for c in item["captures"] if c["id"] == capture_id), {})
            if cap.get("state") == "done":
                results[item_id] = cap
        time.sleep(10)

    bad = 0
    for item_id, _, url, minimum, note in submitted:
        c = results.get(item_id, {})
        verdict = c.get("verdict") or "timeout"
        ok = RANK.get(verdict, -1) >= RANK[minimum]
        bad += not ok
        print(f"{'OK  ' if ok else 'FAIL'} {verdict:<11} (min {minimum:<8}) {note}")
        if not ok:
            print("      ", "; ".join(c.get("verdict_reasons") or [])[:300])
    print(f"\n{len(submitted) - bad}/{len(submitted)} platforms OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
