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
            wayback  Internet Archive SPN2 (context only; skipped for Meta platforms)
          ─▶ gate: complete | partial | walled | unavailable | failed (+ reasons)
          ─▶ seal: SHA-256 of every file, content-addressed store, manifest.json (hashed)
```

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

## Run locally

```bash
cd capture
docker compose up -d --build
docker compose exec api python -m memlane_capture.admin add-contributor "Me" --email me@example.org --role admin
docker compose exec api python -m memlane_capture.admin add-token me@example.org "laptop"   # prints mlc_... once
```

Then open **http://127.0.0.1:8700/** and paste the token. The test UI (Vietnamese first, `EN` switch) is the
same save sheet the phone share button and browser extension will open: paste a link or a whole share text,
save, watch the status chip change, open an item to see screenshots, video, extracted text, versions and hashes.
`/app/?url=...` or `?text=...` prefills the sheet (that is how the share target will call it).

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
| End-to-end: the UI in Chromium, desktop + 375 px phone | `docker compose exec -e E2E_BASE_URL=http://api:8700 -e E2E_TOKEN=mlc_... worker python -m pytest tests/e2e` | running stack, network |
| Canary: real links per platform still reach their expected verdict | `CAPTURE_TOKEN=mlc_... python tests/canary.py` (from the host) | running stack, network |

Run the canary before and after any dependency bump (yt-dlp, Playwright, base image).

## API (v1)

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/v1/inbox` | contributor+ | Save a link: `{url}` or share-sheet `{text}`, optional `title, note, case_ref, tags, sensitive, client, new_version`. Replies at once. Already-saved links (double taps included) return `duplicate: true` with the existing item (HTTP 200); `new_version: true` captures it again, unless a capture of it is already queued or running. |
| GET | `/v1/items?mine=&status=&limit=&before=` | contributor+ | Own saves (reviewers can pass `mine=false`) |
| GET | `/v1/items/{id}` | owner / reviewer+ | Item, every capture (versions), verdicts, reasons, artifacts |
| PATCH | `/v1/items/{id}` | owner / editor+ | Edit title, note, case, tags, sensitive |
| POST | `/v1/items/{id}/recapture` | owner / reviewer+ | Capture again (new version) |
| GET | `/v1/artifacts/{id}` | owner / reviewer+ | The file, with `X-Content-SHA256`; captured HTML is served with `CSP: sandbox` |
| GET | `/v1/me`, `/healthz` | | |

## Layout

```
migrations/001_init.sql     capture.{contributors,tokens,items,captures,artifacts}
memlane_capture/
  urls.py                   extract link from shared text, canonicalise (dedupe key), classify, login-URL detection
  resolve.py                follow share links / shorteners
  witnesses/media.py        yt-dlp
  witnesses/view.py         Playwright/Chromium + platform embeds
  witnesses/wayback.py      SPN2
  gate.py                   verdicts (wall / unavailable phrase lists, EN + VI)
  seal.py, storage.py       hashing, manifest, content-addressed local/S3 storage
  pipeline.py, worker.py    one capture end to end; the queue loop
  api.py, auth.py, admin.py HTTP API, tokens/roles, admin CLI
  web/                      test UI (static, no build): save sheet, list, detail; served at /app
tests/                      unit tests; e2e/ (Playwright, needs the stack); canary.py
```

## Known limitations

- Reasons in verdicts are English strings from `gate.py`; the UI translates statuses but not reasons yet.
- Threads (and other sites that scroll inside their own container) get a one-screen "full page" shot; the embed
  card and extracted text hold the whole post, but long reply threads are cut off.
- YouTube sometimes returns HTTP 403 on the video stream (its PO-token experiment); the capture retries with
  backoff. The `bgutil-ytdlp-pot-provider` sidecar is the fix (not added yet).
- Results above come from a residential connection; from a datacenter VPS, Meta and YouTube will be harsher.

## Not built yet (next steps, proposal §9)

- browsertrix-crawler WACZ witness (replayable archive) and a replay viewer
- logged-in sessions per platform (throwaway-account profiles), carousel walk, OCR guard, circuit breaker
- RFC 3161 / OpenTimestamps on the manifest hash
- scheduled canary; PWA share target + iOS Shortcut + browser extension on top of this UI; review workflow
- deployment (B2 storage, VPS) and migration of the old `archives` rows
