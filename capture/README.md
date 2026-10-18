# MemoryLane capture service

The new archiving platform (proposal: [docs/archiving-platform-proposal.md](../docs/archiving-platform-proposal.md)).
It replaces ArchiveBox + archive-worker, runs **alongside** the current stack without touching it, and is migrated to later.

```
POST /v1/inbox ─▶ capture.items (deduplicated by canonical URL) + capture.captures (queue)
                                   │
worker ── claims a capture (FOR UPDATE SKIP LOCKED) ──▶ resolve share link ─▶ classify
          runs three witnesses in parallel:
            media    yt-dlp: the video/images + sanitised metadata
            view     Chromium: as-served screenshot, cleaned full page, HTML, text, og/ld+json,
                     and for Facebook/Threads/Instagram the public embed page + the post's images
          ─▶ gate: complete | partial | walled | restricted | unavailable | failed (+ reasons)
          ─▶ seal: SHA-256 of every file, content-addressed store, manifest.json (hashed)
          ─▶ Internet Archive copy (separate job, external.py): if the project shares with IA, or on request
```

On top sits a **workspace modelled on Atlos** (projects → incidents → source material, with a feed):
projects are configured on their own Manage page (code, colour, suggested tags, custom attributes, archive);
incidents (`CODE-12`) carry Atlos's attributes (status workflow, sensitivity, tags, date, location with
precision, assignees, custom attributes), a feed of every change with an optional reason plus comments, and
their source material, i.e. saved links with all capture versions. The design is Atlos's; the code is not
(Atlos is GPLv3).

**Access is per project, with Atlos's five roles** (access.py):

| Role | Can |
|---|---|
| Data-only viewer | see incidents and source material only: no feed, comments, member or assignee names |
| Viewer | + comment, see the feed and members, export CSV |
| Editor | + create/edit incidents (not completed/cancelled ones), add and file source material |
| Manager | + complete/cancel, edit those, delete incidents, project settings and attributes, bulk import |
| Owner | + members, roles, invite links, archive the project |

A project you're not a member of doesn't exist for you (404). Instance roles sit above: `admin` acts as owner
everywhere and manages people (Admin page); `editor` may create projects; `reviewer` sees every inbox item.
New people join through **invite links** (owner creates one per role, with expiry and a use limit; the link is
shown once; opening it without an account asks only for a display name and hands out a personal token once).

**Notifications** (Atlos): you follow an incident automatically when you create, change or comment on it, or are
assigned; "@Display Name" in a comment notifies that person. In-app only (bell + Notifications page); no email.

## Why it is built this way

Each design choice answers a finding from the 2026-10-18 audit:

| Old problem | Here |
|---|---|
| Login walls and thumbnails recorded as "archived" | `gate.py` assigns a verdict from what was actually captured; walls are `walled`, never `complete` |
| Facebook videos with long Vietnamese captions failed (filename > 255 bytes) | yt-dlp output template `%(id).80B.%(ext)s` |
| Downloaded videos never linked | every file a capture makes is an artifact row; nothing is chosen and dropped |
| Threads not supported by any tool | view witness: DOM behind the login modal + `/embed` card + post images |
| Facebook posts login-walled | embed plugin (logged out) for text/author/photo; logged-in sessions later (proposal §7 T1) |
| Hash of ArchiveBox's regenerated `index.html` | SHA-256 of every file + a hashed manifest |
| Shared admin token | personal, revocable, per-device tokens with roles |
| Unpinned `:latest` images | base image, Python deps and yt-dlp pinned |
| `docker.sock` in the worker | none; everything runs in-process as a non-root user |
| Meta's legal-request restrictions recorded as "archived" (a login wall) | `restricted` verdict; the view witness opens "See why" and keeps Meta's notice (screenshot + text) as evidence |

## Run locally

```bash
cd capture
docker compose up -d --build
docker compose exec api python -m memlane_capture.admin add-contributor "Me" --email me@example.org --role admin
docker compose exec api python -m memlane_capture.admin add-token me@example.org "laptop"   # prints mlc_... once
```

Then open **http://127.0.0.1:8700/** and paste the token (Vietnamese first, `EN` switch):

- **Dự án / Projects**: tabs Tổng quan / Quyền truy cập (members, roles, invite links) / Quản lý (name, colour,
  suggested tags, custom attributes, "Share with the Internet Archive", archive) / Nhập hàng loạt (CSV, with a
  validated preview and a template; the CSV export uses the same columns).
- **Vụ việc / Incidents**: cards, table or **map** (Leaflet; dots by status, precision halos), filter by project/status, search. **+ Vụ việc mới** creates one, with
  source links. The incident page has Attributes (each with **Cập nhật** + an optional reason), the Feed with
  comments, Source material with inline previews, Location and Metadata.
- **Hộp thư / Inbox** and **+ Lưu liên kết** (any page): the save sheet the share button and extension will open.
  Paste a link or a whole share text, optionally pick Project → Incident from the dropdowns, save.
- **An item** (a saved link): verdict and reasons, the platform's restriction notice if any, versions, and every
  file viewable in the browser: images, video, saved HTML (sandboxed, nothing external loads), text, JSON,
  manifest. Click any preview for the full viewer (← → between files, fit/actual size, new tab, download, SHA-256).
  The Internet Archive block shows the public Wayback copy (or why there is none) and **Gửi lên Internet Archive**.
- **Tiếp nhận / Intake**: submissions forwarded by the community sites (MemoryLane map, Hồ sơ Nhân quyền), per
  project. Their links were captured on arrival. Attach one to an incident, create an incident from it (fields and the
  "Nhóm hồ sơ" group prefilled), reject it, or (managers) reroute, reopen, open a sealed contact (logged).
- **Bản công khai / Public version** (incident page, a memory in the intake, a project's "Bản công khai" tab): the
  separate public record. Wording, kind of place → public precision (policy §12.4 enforced), date detail, which
  material and files (published as cleaned copies), original links shown by default. A manager and a different
  member with **Quyền công bố** (granted on the Access tab) approve; editing clears approvals; withdrawing is
  immediate. The preview is exactly the record the feed will carry. Legacy memories are approved as one batch.
- **🔔 / Thông báo**: notifications, mark read/unread, incidents you follow. **Quản trị / Admin** (admins): people,
  instance roles, issue/revoke tokens, disable accounts; community sites (sources: routing, keys shown once,
  rotate); the public feed's status and "rebuild".

### Community intake and the public feed (docs/integration-design.md)

Dev setup, once (keys go in the gitignored `secrets/` and `.env`; the root key here is a **dev** key, production's
is generated offline by the designated maintainer, see `memlane_capture/feedkeys.py` and design §13):

```bash
R="docker compose run --rm --no-deps -v $PWD/secrets:/w api python -m memlane_capture.feedkeys"
$R root-init --out /w/dev-feed-root.key                     # prints the ROOT public key: sites pin it
ONLINE=$($R online-init --out /w/dev-feed-online.key)
$R delegate --root /w/dev-feed-root.key --online-public "$ONLINE" --days 120 --out /w/dev-feed-delegation.json
docker compose run --rm --no-deps api python -m memlane_capture.admin contact-key-init   # CONTACT_SECRET_KEY=...
# .env: INTAKE_KEY_SECRET=<random hex>, CONTACT_SECRET_KEY=..., FEED_ONLINE_KEY=/secrets/dev-feed-online.key,
#       FEED_DELEGATION=/secrets/dev-feed-delegation.json, FEED_SERVE_LOCAL=true, FEED_PUBLIC_URL=http://127.0.0.1:8700/feed
```

Then add a source on the Admin page (its key is shown once) and point a site's backend at the hub with
`backend/lib/hub-client.js` (docs/spoke-integration.md). The worker rebuilds the feed after every approval or
withdrawal; locally it is at http://127.0.0.1:8700/feed/index.json.

`/app/?url=...` or `?text=...` prefills the save sheet (that is how the share target will call it).

Other ways in: interactive API docs at http://127.0.0.1:8700/docs ("Authorize" with the token), or curl:

```bash
curl -H "Authorization: Bearer mlc_..." -H "Content-Type: application/json"      -d '{"url":"https://www.threads.com/@user/post/XYZ"}' http://127.0.0.1:8700/v1/inbox
docker compose logs -f worker          # what each capture did, and its verdict
```

Stop with `docker compose down` (`down -v` also wipes the local DB and stored files).

## Tests

| What | Command | Needs |
|---|---|---|
| Unit (URLs, gate, embeds): offline, fast | `docker compose run --rm --no-deps api python -m pytest` | nothing |
| End-to-end: signed intake (replay/wrong key refused) → triage in the UI → public version (policy, two people) → signed feed verified like a site would, GPS stripped → withdrawal | same command (`tests/e2e/test_intake_e2e.py`) | running stack with the intake + feed keys above |
| End-to-end: project → incident → capture → update → comment → viewers → inbox filing; invite link → new account → roles → @mention notification; CSV import → map → Internet Archive → admin; desktop + phone (admin token) | `docker compose exec -e E2E_BASE_URL=http://api:8700 -e E2E_TOKEN=mlc_... worker python -m pytest tests/e2e` | running stack, network |
| Canary: real links per platform still reach their expected verdict | `CAPTURE_TOKEN=mlc_... python tests/canary.py` (from the host) | running stack, network |

Run the canary before and after any dependency bump (yt-dlp, Playwright, base image).

## API (v1)

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/v1/inbox` | contributor+ | Save a link: `{url}` or share-sheet `{text}`, optional `incident_id, title, note, tags, sensitive, client, new_version`. Replies at once. Already-saved links (double taps included) return `duplicate: true` with the existing item (HTTP 200); `new_version: true` captures it again, unless a capture is already queued or running. |
| GET | `/v1/items?mine=&status=&unfiled=&limit=&before=` | contributor+ | Own saves (reviewers can pass `mine=false`) |
| GET | `/v1/items/{id}` | owner, reviewer+, or anyone once it is filed under an incident | Item, every capture (versions), verdicts, reasons, artifacts with signed URLs |
| PATCH | `/v1/items/{id}` | owner / editor+ (filing via `incident_id`: anyone who can see it) | Edit note, tags, sensitive; file under / remove from an incident (both logged in the feed) |
| POST | `/v1/items/{id}/recapture` | as GET | Capture again (new version) |
| GET | `/v1/artifacts/{id}` | Bearer token, or the signed URL from an item response | The file, with `X-Content-SHA256` and byte ranges; always `CSP: sandbox; default-src 'none'` |
| GET/POST | `/v1/projects`, GET/PATCH `/v1/projects/{id}` | read: all; write: editor+ | Projects: code, name, description, colour, `tag_options`, custom `attributes`, `archived` |
| GET/POST | `/v1/incidents`, GET/PATCH `/v1/incidents/{id}` | contributor+ (Completed/Cancelled: reviewer+) | Incidents; PATCH takes any attribute plus an optional `reason`; GET includes material and the feed |
| POST | `/v1/incidents/{id}/comments`, `/v1/incidents/{id}/material` | contributor+ | Comment; add source material (same as the inbox, filed) |
| GET | `/v1/incidents.csv?project_id=` | contributor+ | Export (Atlos-style) |
| GET/POST/PATCH/DELETE | `/v1/projects/{id}/members[/{cid}]` | read: viewer+; write: owner | Members and roles (a project keeps at least one owner) |
| GET/POST/DELETE | `/v1/projects/{id}/invites[/{iid}]` | owner | Invite links (role up to manager, expiry, max uses); the code is returned once |
| GET / POST | `/v1/invites/{code}`, `/v1/invites/{code}/accept` | public | What a link grants; join with your token, or `{name}` to create an account (token returned once) |
| POST | `/v1/projects/{id}/import` | manager+ | `{csv, commit}`: validate and preview, or create every row (all or nothing) |
| POST/DELETE | `/v1/incidents/{id}/subscription` | viewer+ | Follow / unfollow |
| GET/POST | `/v1/notifications`, `/v1/notifications/unread_count`, `/v1/notifications/read`, `/v1/me/subscriptions` | everyone | Notifications |
| POST | `/v1/items/{id}/wayback` | submitter / project editor+ | Request an Internet Archive copy now (the UI asks to confirm: it is public) |
| POST / DELETE | `/v1/items/{id}/incidents`, `/v1/items/{id}/incidents/{incident_id}` | editor of that incident's project | File a link under another incident / remove it from one (a link can be in several) |
| GET/POST/PATCH | `/v1/admin/contributors[/{id}[/token, /revoke-tokens]]` | admin | People, instance roles, tokens |
| GET | `/v1/contributors?project_id=`, `/v1/config`, `/v1/me`, `/healthz` | | Assignable members; tile settings |
| PUT | `/v1/projects/{id}/members/{cid}/publish` | manager+ | `{can_publish}`: the publication-access grant (editors and up) |
| POST / PUT / GET | `/intake/v1/submissions`, `/intake/v1/submissions/{id}/files/{n}`, `/intake/v1/receipts/{sha256}`, `/intake/v1/contact-key` | a source's backend, HMAC-signed (no token) | Forward a submission (idempotent on `external_id`), its files, a receipt's coarse status. Nothing else is readable with a source key |
| GET / POST | `/v1/intake[?project_id=&state=]`, `/v1/intake/{id}`, `…/attach`, `…/create`, `…/reject`, `…/reopen`, `…/route`, `…/contact` | viewer+ of the routed project (act: editor+; route/reopen/contact: manager+) | Triage |
| GET | `/v1/intake-files/{id}` | as the submission, or its signed URL | A community file, sandboxed like artifacts |
| POST | `/v1/incidents/{id}/publication`, `/v1/intake/{id}/publication` | editor+ | Start (or get) the public version |
| GET / PATCH / POST | `/v1/publications[?project_id=]`, `/v1/publications/{id}`, `…/approve {role}`, `…/withdraw {reason}`, `…/republish` | read: viewer+; edit: editor+; approve: manager / publication access (two people); withdraw: either | Public versions; GET includes `problems` and the exact `preview` |
| GET / POST | `/v1/projects/{id}/publication-batches`, `/v1/publication-batches/{id}/approve` | as above | Legacy (already public) memories, approved once per batch |
| GET / POST | `/v1/feed/status`, `/v1/feed/rebuild`; `/v1/admin/sources[/{id}[/rotate]]` | members / admin | Feed status; community sources (key shown on create and rotate only) |

## Layout

```
migrations/001_init.sql     capture.{contributors,tokens,items,captures,artifacts}
migrations/002_restricted.sql the `restricted` verdict
migrations/003_workspace.sql capture.{projects,incidents,updates}, items.incident_id
migrations/004_access_notifications.sql project_members, project_invites, subscriptions, notifications, external_copies
migrations/005_item_incidents.sql a link can be source material of several incidents (replaces items.incident_id)
migrations/006_intake_publication.sql sources, intake (+ files, items), publications, batches, public_files, feed_state, can_publish
memlane_capture/
  urls.py                   extract link from shared text, canonicalise (dedupe key), classify, login-URL detection
  resolve.py                follow share links / shorteners
  witnesses/media.py        yt-dlp
  witnesses/view.py         Playwright/Chromium + platform embeds
  gate.py                   verdicts (wall / unavailable phrase lists, EN + VI)
  seal.py, storage.py       hashing, manifest, content-addressed local/S3 storage
  pipeline.py, worker.py    one capture end to end; the queue loop
  api.py, auth.py, admin.py HTTP API, tokens/roles, admin CLI
  workspace.py              projects, incidents, feed, comments, subscriptions, CSV export/import (Atlos model)
  access.py                 project roles and checks
  people.py                 members, invite links, admin, notifications endpoints
  notify.py                 who gets notified (followers, @mentions, assignees)
  importer.py               CSV parsing/validation for bulk import
  external.py               Internet Archive copies: policy, SPN2 client, job queue
  inbox_core.py             saving a link (shared by the inbox and incidents)
  signing.py                short-lived signed artifact URLs for <img>/<video>/<iframe>
  serve.py                  serving stored files, always sandboxed, with byte ranges
  intake.py                 Intake API for the community sites (signed), triage, sources admin
  publish.py                public versions: drafts, policy problems, two approvals, withdrawal, batches
  geo.py                    the public location policy (§12.4), deterministic snapping, date coarsening
  derive.py                 upload type sniffing; metadata-free public copies (Pillow re-encode, ffmpeg remux)
  feed.py                   the public record format and the signed static feed (local dir or B2)
  feedkeys.py               offline root / online key / delegation / revocation (CLI)
  web/                      the workspace UI (static ES modules, no build), served at /app:
                              js/core.js (API, i18n, helpers), inbox.js, incidents.js, item.js, viewer.js, projects.js,
                              people.js, notifications.js, map.js, intake.js, publish.js, main.js; vendor/leaflet (1.9.4, BSD-2)
tests/                      unit tests; e2e/ (Playwright, needs the stack); canary.py
```

## Known limitations

- Reasons in verdicts are English strings from `gate.py`; the UI translates statuses but not reasons yet.
- Import error messages, like verdict reasons, are English only.
- Notifications are in-app only (no email/Telegram push yet).
- **Map tiles reveal the viewed area to the tile server** (default: CARTO basemaps, like the public map; OpenStreetMap's
  own tile servers refuse apps outside their usage policy with HTTP 403). For sensitive work, self-host tiles via `TILE_URL`.
- Saved HTML renders without its external CSS/images (deliberately: nothing external may load), so it looks unstyled; the screenshots are the visual record.
- Set `ARTIFACT_URL_SECRET` when running more than one API process (signed URLs otherwise only verify on the process that issued them).
- Threads (and other sites that scroll inside their own container) get a one-screen "full page" shot; the embed
  card and extracted text hold the whole post, but long reply threads are cut off.
- YouTube sometimes returns HTTP 403 on the video stream (its PO-token experiment); the capture retries with
  backoff. The `bgutil-ytdlp-pot-provider` sidecar is the fix (not added yet).
- Public locations snap to fixed grid cells sized like the units (ward ≈ 2.8 km, province ≈ 55 km), not to real
  ward/province boundaries yet; a boundary dataset can replace the grid without changing the policy.
- Uploads are type-checked and re-encoded for publication, but not virus-scanned (no ClamAV yet); PDFs and text are
  never published, only viewed internally (sandboxed).
- Duplicate community photos aren't detected yet (no perceptual hash); duplicate links are, by canonical URL.
- Results above come from a residential connection; from a datacenter VPS, Meta and YouTube will be harsher.

## Not built yet (next steps, proposal §9)

- browsertrix-crawler WACZ witness (replayable archive) and a replay viewer
- logged-in sessions per platform (throwaway-account profiles), carousel walk, OCR guard, circuit breaker
- RFC 3161 / OpenTimestamps on the manifest hash
- email/Telegram notifications; Atlos API tokens per project
- scheduled canary; PWA share target + iOS Shortcut + browser extension on top of the save sheet
- deployment (B2 storage, VPS) and migration of the old `archives` rows
