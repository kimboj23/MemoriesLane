#!/usr/bin/env python3
"""Build the mirror's front page from each snapshot's index.json.

Reads only what ArchiveBox already wrote into every snapshot directory
(archive/<timestamp>/index.json), so the mirror never needs index.sqlite3 --
which is what lets its B2 key be scoped to the archive/ prefix and kept away
from everything else in the bucket.

Output is a single self-contained HTML file: no external requests, a small
inline filter script, works with JavaScript off. Written atomically so nginx
never serves a half-written page.

Usage: build_index.py <data dir containing archive/> <output index.html>
"""
import html
import json
import os
import sys
import time
from datetime import datetime, timezone

data_dir = sys.argv[1]
out_path = sys.argv[2]
archive_dir = os.path.join(data_dir, "archive")

SITE_NAME = os.environ.get("SITE_NAME", "MemoriesLane Archive — mirror")
MIRROR_LINKS = os.environ.get("MIRROR_LINKS", "")  # "Label=https://...,Label2=https://..."
ONION_FILE = "/var/lib/tor/hidden_service/hostname"

# ArchiveBox writes tags as ",bot-wall,tree55" (leading comma). Split, drop empties.
def tags_of(d):
    raw = d.get("tags") or d.get("tags_str") or ""
    return [t for t in (x.strip() for x in raw.split(",")) if t]

def last_ok(history, extractor):
    for r in reversed(history.get(extractor) or []):
        if r.get("status") == "succeeded":
            return r.get("output")
    return None

rows = []
for ts in sorted(os.listdir(archive_dir), reverse=True) if os.path.isdir(archive_dir) else []:
    d = os.path.join(archive_dir, ts)
    p = os.path.join(d, "index.json")
    if not os.path.isfile(p):
        continue  # partially synced, or not a snapshot dir
    try:
        j = json.load(open(p, encoding="utf-8"))
    except Exception:
        continue
    have = {f: os.path.isfile(os.path.join(d, f)) for f in ("singlefile.html", "output.pdf", "screenshot.png", "output.html")}
    wb = last_ok(j.get("history", {}), "archive_org")
    rows.append({
        "ts": ts,
        "url": j.get("url") or "",
        "title": (j.get("title") or j.get("url") or ts).strip(),
        "domain": j.get("domain") or "",
        "date": j.get("bookmarked_date") or "",
        "tags": tags_of(j),
        "have": have,
        "wayback": wb if isinstance(wb, str) and wb.startswith("http") else None,
    })

onion = None
try:
    onion = open(ONION_FILE).read().strip()
except Exception:
    pass

links = []
for item in MIRROR_LINKS.split(","):
    if "=" in item:
        label, url = item.split("=", 1)
        links.append((label.strip(), url.strip()))
if onion:
    links.append(("Tor", "http://%s/" % onion))

def e(s):
    return html.escape(str(s), quote=True)

parts = []
parts.append("""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title>
<style>
:root{--fg:#1d1d1b;--muted:#6b6b66;--bg:#faf8f4;--line:#e4e0d8;--warn:#b3261e;--tag:#eee8dc}
@media(prefers-color-scheme:dark){:root{--fg:#ecebe6;--muted:#a09e97;--bg:#1a1a18;--line:#333;--tag:#2c2b27}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 16px}
.mirrors{font-size:14px;margin:0 0 18px;padding:10px 12px;border:1px solid var(--line);border-radius:8px}
.mirrors a{margin-right:14px}
input{width:100%%;box-sizing:border-box;padding:10px 12px;font-size:15px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg);margin:0 0 14px}
table{width:100%%;border-collapse:collapse}
th,td{text-align:left;vertical-align:top;padding:8px 6px;border-bottom:1px solid var(--line)}
th{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
td.d{white-space:nowrap;color:var(--muted);font-size:13px}
td.l a{margin-right:8px;white-space:nowrap}
.dom{color:var(--muted);font-size:13px}
.tag{display:inline-block;font-size:12px;padding:1px 7px;border-radius:999px;background:var(--tag);margin:2px 4px 0 0}
.tag.wall{background:var(--warn);color:#fff}
.wall-note{color:var(--warn);font-size:13px}
a{color:inherit}
footer{color:var(--muted);font-size:13px;margin-top:24px}
</style></head><body><main>
""" % e(SITE_NAME))

parts.append("<h1>%s</h1>" % e(SITE_NAME))
parts.append('<p class="sub">%d ảnh chụp / snapshots · cập nhật / updated %s UTC · bản sao chỉ đọc / read-only mirror</p>'
             % (len(rows), datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")))
if links:
    parts.append('<div class="mirrors"><strong>Cũng có tại / also at:</strong> ' +
                 " ".join('<a href="%s">%s</a>' % (e(u), e(l)) for l, u in links) + "</div>")
parts.append('<input id="q" type="search" placeholder="Lọc theo tiêu đề, tên miền, thẻ… / filter by title, domain, tag…" autocomplete="off">')
parts.append("<table><thead><tr><th>Ngày / Date</th><th>Tiêu đề / Title</th><th>Tệp / Files</th></tr></thead><tbody>")

wall_count = 0
for r in rows:
    is_wall = "bot-wall" in r["tags"]
    wall_count += is_wall
    base = "archive/%s/" % e(r["ts"])
    files = ['<a href="%sindex.html">Snapshot</a>' % base]
    if r["have"]["singlefile.html"]:
        files.append('<a href="%ssinglefile.html">Trang / Page</a>' % base)
    if r["have"]["output.pdf"]:
        files.append('<a href="%soutput.pdf">PDF</a>' % base)
    if r["have"]["screenshot.png"]:
        files.append('<a href="%sscreenshot.png">Ảnh / Screenshot</a>' % base)
    if r["wayback"]:
        files.append('<a href="%s" rel="noreferrer">Wayback</a>' % e(r["wayback"]))
    tags = "".join('<span class="tag%s">%s</span>' % (" wall" if t == "bot-wall" else "", e(t)) for t in r["tags"])
    note = '<div class="wall-note">⚠ Trang chặn bot, không phải nội dung gốc / captured a bot-wall, not the real page</div>' if is_wall else ""
    search = " ".join([r["title"], r["domain"], r["url"], " ".join(r["tags"])]).lower()
    parts.append(
        '<tr data-s="%s"><td class="d">%s</td>'
        '<td><a href="%sindex.html">%s</a><div class="dom">%s</div>%s%s</td>'
        '<td class="l">%s</td></tr>'
        % (e(search), e(r["date"]), base, e(r["title"]), e(r["domain"]), note, tags, " ".join(files))
    )

parts.append("</tbody></table>")
parts.append('<footer>%d snapshot(s) tagged <span class="tag wall">bot-wall</span> — the site served a CAPTCHA/login wall instead of the page; kept as evidence of what was served. '
             'Nguồn / source: ArchiveBox snapshots synced from the project backup; this mirror holds no accounts and keeps no visitor logs.</footer>' % wall_count)
parts.append("""
<script>
(function(){var q=document.getElementById('q'),rows=[].slice.call(document.querySelectorAll('tbody tr'));
q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();rows.forEach(function(r){r.style.display=(!v||r.getAttribute('data-s').indexOf(v)>-1)?'':'none';});});})();
</script></main></body></html>
""")

tmp = out_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write("".join(parts))
os.replace(tmp, out_path)
print("index: %d snapshots (%d bot-wall) -> %s" % (len(rows), wall_count, out_path))
