# Miền Ký Ức — MemoryLane

**Live site:** https://memorylane101.pages.dev

A collective, anonymous civic memory archive. People pin stories to a map of Vietnamese cities, documenting lived experience around urban restructuring and displacement. No account, no name, no email — submissions are moderated before they appear.

## Architecture

```
Cloudflare Pages (static UI)
   └─ /api/* ─▶ Pages Function (functions/api/[[route]].js)
                  └─▶ BACKEND_URL ─▶ Express backend (VPS, always-on)
                         ├─ Supabase Postgres  (memories, cases, topics, archives)
                         └─ Supabase Storage   (private "memory-photos" + public "memory-archive" buckets)

VPS (always-on, Docker) — backend + archiving:
   backend        ─▶ archivebox-api.heomay.xyz → localhost:3001
   archive-worker ─ polls the shared `archives` table in Supabase
                  ├─▶ ArchiveBox (container, S3-backed via rclone)
                  ├─▶ auto-archiver (social posts, uploads straight to S3)
                  └─▶ Internet Archive / Wayback (public link)
   cloudflared (named tunnel, systemd service) ─▶ archivebox.heomay.xyz     → localhost:8000
                                                 ─▶ archivebox-api.heomay.xyz → localhost:3001
```

- **Frontend** — static React (in-browser JSX, no build step): `index.html` + `app/*.jsx`, deployed on **Cloudflare Pages**.
- **Backend** — Express on Node 22 (`pg` → Supabase Postgres over the IPv4 session pooler, TLS), runs on the same **VPS** as archiving, deployed via `docker-compose.vps.yml`, reached at `https://archivebox-api.heomay.xyz` through the Cloudflare named tunnel. (Previously on Railway — moved off after the Railway trial ended.)
- **Database/Storage** — **Supabase**: Postgres (memories, cases, topics, archives) + Storage (private `memory-photos` bucket for submitted photos/videos/docs, public `memory-archive` bucket for archived source materials).
- **Archiving** — runs on the same **VPS** (needs a browser/yt-dlp and the Docker socket): ArchiveBox + auto-archiver + Internet Archive, driven by `archive-worker`, deployed via `docker-compose.vps.yml` with `restart: unless-stopped`.
- **Backups** — daily local `pg_dump` + bucket sync via a Windows Scheduled Task (runs from the maintainer's machine, separate from the VPS).

### Does the live site depend on any local machine being on?

**No.** Every part of the stack — the frontend (Cloudflare Pages), the backend + archiving (VPS), and the database/storage (Supabase) — is cloud-hosted and independent of any laptop. The only thing that can go down is the VPS itself: if it's unreachable, both `archivebox-api.heomay.xyz` (the API) and `archivebox.heomay.xyz` (ArchiveBox) stop responding — the frontend shows "API down" and falls back gracefully, and **new** archive jobs (`POST /api/archive`) just sit in the queue as `status=pending`. Nothing is lost either way; the affected services simply aren't there to process requests until the VPS is back online. (Backend and archiving previously ran on Railway and a laptop respectively; both have since moved to the VPS.)

`backend`/`archivebox`/`archive-worker` (`restart: unless-stopped`) and the `cloudflared` systemd service all auto-start on boot, so the VPS recovers on its own after a reboot without manual intervention.

### Restarting the VPS environment after a reboot

Normally nothing to do — see above. To check or force it:

```bash
# From the VPS, in the directory holding docker-compose.vps.yml:
docker compose -f docker-compose.vps.yml ps
docker compose -f docker-compose.vps.yml up -d   # bring anything missing back up

systemctl status cloudflared                      # tunnel service
curl https://archivebox.heomay.xyz                # tunnel + ArchiveBox container, end to end
```

If the tunnel is down: `sudo systemctl restart cloudflared` (tail logs with `journalctl -u cloudflared -f`). If it's broken (Cloudflare error **1033** — "Cloudflare is currently unable to resolve" the host) the service has likely lost its config; re-run `cloudflared service install` per [Cloudflare's systemd guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/local-management/as-a-service/) to reinstall it.

For local dev only (a laptop running `docker-compose.yml`, not the production VPS), see "Run locally" below.

## Project structure

```
index.html                 entry point; all CSS inline
app/                        UI (in-browser JSX, Babel-built to app/*.js via `npm run build`):
                               app, map, compose, memory, case-profile, materials,
                               research, export, feed, archive-admin, tweaks-panel, data
backend/
  server.js                Express app + startup (initDb, ensureBucket)
  db.js                    Postgres schema + queries (auto-migrates, seeds topics)
  storage.js               Supabase Storage helper (ensureBucket/upload/download)
  middleware/               auth (admin Bearer), rate-limit (IP-free HMAC), sanitize
  routes/                   memories, moderate, cases, topics, feed, archive, materials
  scripts/                  setup-admin, seed-*, create-bucket, backup-photos
worker/                    archive-worker: poll Supabase + drive ArchiveBox/auto-archiver/Wayback
functions/api/[[route]].js Cloudflare Pages proxy → BACKEND_URL
docker-compose.yml         local dev: frontend (nginx) + backend + postgres (local fallback) + adminer + archivebox + archive-worker
docker-compose.vps.yml     production: backend + archivebox + archive-worker, deployed on the VPS (restart: unless-stopped)
deploy-vps.sh              run on the VPS: build/start the stack + wire up the Cloudflare Tunnel ingress rule
migrate-archivebox-data.sh one-time: migrate a standalone local-disk ArchiveBox instance's data into the S3-backed setup
nginx.conf                 proxies /api/* → backend
backup/                    backup.ps1, register-task.ps1
cloudflared-config.yml     named-tunnel config (gitignored — real tunnel ID + local path); exposes ArchiveBox only
```

## Run locally

Prereq: Docker Desktop running.

```bash
# 1. Generate admin secrets (one time)
cd backend && npm install && node scripts/setup-admin.js   # save the printed Bearer token

# 2. Create env file and paste in the two generated values + Supabase creds (see below)
cp .env.example .env

# 3. Start everything (from repo root)
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:3001 |
| Adminer (DB UI) | http://localhost:8081 |

Seed data (one time, idempotent):

```bash
docker exec memorieslane-backend-1 node scripts/seed-memories.js
docker exec memorieslane-backend-1 node scripts/seed-cases.js
docker exec memorieslane-backend-1 node scripts/seed-memory-topics.js
```

Stop / reset:

```bash
docker compose down       # stop, keep data
docker compose down -v    # stop + wipe local postgres volume (Supabase data untouched)
```

## Environment (`backend/.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | yes | Supabase session pooler: `postgresql://postgres.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:5432/postgres` (URL-encode `&`→`%26`) |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service_role JWT (`eyJ…`) — secret, bypasses RLS |
| `SUPABASE_BUCKET` | no | default `memory-photos` |
| `RATE_HMAC_SECRET` | yes | 32-byte hex (from `setup-admin.js`) |
| `ADMIN_TOKEN_HASH` | yes | SHA-256 of the admin Bearer token (from `setup-admin.js`) |
| `ALLOWED_ORIGINS` | yes (prod) | CORS allowlist, e.g. your `*.pages.dev` URL; `null` for local `file://` |
| `IA_ACCESS_KEY` / `IA_SECRET_KEY` | no | [archive.org S3 keys](https://archive.org/account/s3.php), for Wayback uploads from `archive-worker` |
| `ARCHIVEBOX_ADMIN_USER` / `ARCHIVEBOX_ADMIN_PASSWORD` | no | auto-creates the ArchiveBox superuser |
| `ARCHIVEBOX_PUBLIC_URL` | no | public URL shown for local snapshots. **Must be set to `https://archivebox.heomay.xyz` in production** — it defaults to `http://localhost:8000` (the local-dev value), which silently ships broken snapshot links to real users if left unset on the VPS. Check via `GET /api/config` → `archiveboxUrl`. |
| `RATE_LIMIT_MULT` / `RATE_LIMIT_DISABLED` | no | testing-phase rate-limit overrides (multiply / bypass) |
| `PORT` / `BIND_ADDR` / `NODE_ENV` | no | `3001` / `127.0.0.1` (`0.0.0.0` in Docker) / `development` |
| `UPLOADS_DIR` | no | local-disk photo fallback when `SUPABASE_*` unset |

Leaving `SUPABASE_*` unset makes the backend store photos on local disk instead — dev convenience only.

## API

Public:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/memories` | Submit a memory — text + optional photo/video/PDF (→ pending queue) |
| GET | `/api/memories?city=&minYear=&maxYear=&offset=` | List approved memories |
| GET | `/api/memories/:id` | Single approved memory |
| GET | `/api/memories/:id/photo` | Approved memory's photo/video/document file |
| GET | `/api/feed?city=&topics=` | Documented cases for the list view |
| GET | `/api/topics` | All topics |
| GET | `/api/cases/:id` | Case profile + linked memories |
| GET | `/api/materials?q=&collection=&mediaType=&tool=&city=&limit=&offset=` | Browse approved, archived source materials |
| GET | `/api/materials/collections` | Collection facet counts (for browse nav) |
| GET | `/api/materials/:id` | Single archived material |
| GET | `/api/config` | Public config (e.g. `archiveboxUrl`) |
| GET | `/health` | Health check |

Uploads accepted by `POST /api/memories`: images and PDFs up to 8 MB, video up to 60 MB — **oversized images and video are compressed server-side** (down to ~1.5 MB / 20 MB respectively) rather than rejected; oversized PDFs are rejected outright.

Moderation — memories (require `Authorization: Bearer <token>`):

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/moderate/queue
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/moderate/<id>/approve
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"off-topic"}' http://localhost:3001/api/moderate/<id>/reject
```

Moderation/admin — archiving + cases (require `Authorization: Bearer <token>`):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/cases` | Create a case |
| GET | `/api/cases` | List all cases |
| POST | `/api/archive` | Queue a source URL for archiving against a case |
| GET | `/api/archive/queue?caseId=` | List archive jobs |
| GET | `/api/archive/:id` | Single archive job status |
| PATCH | `/api/archive/:id` | Edit an archive job's metadata |
| POST | `/api/archive/:id/approve` / `/reject` | Approve/reject an archived material for public listing |
| POST | `/api/archive/:id/retry` | Requeue a failed/partial job |
| DELETE | `/api/archive/:id` | Delete an archive job |

The admin **Queue** tab in the UI (`app/archive-admin.jsx`) merges both pending memories and pending archive jobs into one filterable/sortable list — filter by type (`memory` / `web` / `document` / `social`) or status, search, and approve/reject either kind from the same screen.

## Admin UI — Adminer

http://localhost:8081 (server pre-filled). Log in to the Supabase DB:

| Field | Value |
|-------|-------|
| System | PostgreSQL |
| Server | `aws-1-<region>.pooler.supabase.com` |
| Username | `postgres.<ref>` |
| Password | Supabase DB password |
| Database | `postgres` |

Approve a row by setting `approved = 1`. To manage the local fallback DB instead, set Server to `postgres`. Prefer the in-app admin Queue tab for day-to-day moderation — Adminer is for one-off fixes.

## Storage bucket

The backend self-heals the private bucket on every boot (`storage.ensureBucket`). To provision manually:

```bash
docker exec memorieslane-backend-1 node scripts/create-bucket.js
```

## Backups (local, scheduled)

Daily Windows Scheduled Task `MemoryLane Backup` (03:00) writes to `backup/`:
`db/memorylane-<timestamp>.sql` (full `pg_dump` via `postgres:17`) + `photos-<timestamp>/` (bucket sync). 14-day retention. Runs in Docker — no local `psql`/`node` needed.

```powershell
powershell -ExecutionPolicy Bypass -File backup\backup.ps1                 # run now
powershell -ExecutionPolicy Bypass -File backup\register-task.ps1 -At 02:30 # (re)schedule
Start-ScheduledTask -TaskName "MemoryLane Backup"                           # trigger task
```

Restore a dump into Supabase (via the session pooler, no local psql):

```powershell
docker run --rm -v "${PWD}:/work" -w /work postgres:17 `
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backup/db/<dump>.sql
```

Note: this scheduled task runs on your local machine too — it does not run while your machine is off. A missed night's backup just means the next run captures two days of changes; nothing is lost since the data itself lives in Supabase.

## Archiving

Case source materials (gov pages, news, social posts) are preserved two ways: a **public, durable Internet Archive link** + a **self-hosted snapshot stored in Supabase Storage (S3)** — ArchiveBox for web/documents, auto-archiver for social. The capture **tools** run on the VPS (they need a browser/yt-dlp), but write **nothing to local disk beyond ArchiveBox's own index** — snapshot content itself goes to the cloud bucket. They're driven by **archive-worker** on that same VPS, which coordinates through the shared `archives` table in Supabase. Since the VPS is always-on (`restart: unless-stopped` + a systemd `cloudflared` service), archiving no longer depends on any laptop being on — see "Does the live site depend on any local machine being on?" above.

```
Moderator ─▶ POST /api/archive {caseId,url,mediaType}  → inserts archives row (status=pending)
archive-worker (VPS) ─ polls Supabase ─▶ web/document: ArchiveBox (snapshot + its own Wayback submission)
                                          social:       auto-archiver (snapshot) + Wayback (worker's own call)
                                          └▶ writes wayback_url/local_url, status=archived
Materials/Case API ─▶ returns status=archived rows → public "Materials" list + case profile
```

**Flow:** `web`/`document` → ArchiveBox (which also submits to Wayback itself — see below); `social` → auto-archiver + Wayback (worker's own call, since social posts never go through ArchiveBox). A job is `archived` (all succeeded), `partial` (some), or `failed`. Only `archived`/`partial` rows are public; the local snapshot link stays behind ArchiveBox login.

**Wayback submission is made by ArchiveBox itself, not archive-worker, for `web`/`document` jobs** (reversed 2026-08-13 — archive-worker used to make its own separate authenticated call via `worker/archivers/wayback.js`, same as it still does for `social`). The app just reads back and links to whatever ArchiveBox itself submitted (`worker/archivers/archivebox.js`'s `archiveOrgUrl()` reads it from `history.archive_org` in `archivebox list --json`). Two real problems had to be fixed to make this reliable, both documented at the top of `archivebox/archive_org.py`:
- Stock ArchiveBox 0.7.4's `archive_org` extractor submits via a bare, **unauthenticated** `curl --head` to a legacy endpoint (`web.archive.org/save/<url>`) that returns **HTTP 498** for this project regardless of credentials — confirmed by direct testing, this endpoint appears blocked/deprecated on archive.org's side, not an auth problem.
- `archivebox/archive_org.py` replaces it with the same authenticated SPN2 job-submit-and-poll flow `wayback.js` already used successfully (needs `IA_ACCESS_KEY`/`IA_SECRET_KEY`, pulled into the `archivebox` container from `backend/.env` via `docker-compose.vps.yml`'s `env_file` list). Applied as a Dockerfile `COPY` overlaying the vendored file — **if ArchiveBox is ever upgraded, re-check this patch against the new stock `extractors/archive_org.py`** (imports, `ArchiveResult`/`ArchiveError` shape) before assuming it still applies cleanly.
- Two more bugs surfaced only by testing against the real API, both fixed in that same file: (1) `dataclasses.asdict()` deepcopies every `ArchiveResult` field for JSON serialization, and raw `urllib.error.HTTPError`/`URLError` objects aren't deepcopy-safe — crashed `archivebox add` entirely rather than just failing the one extractor, until every exception path was wrapped in a plain `ArchiveError`. (2) Sending a browser-spoofed `User-Agent` (`CURL_USER_AGENT`, used elsewhere in this project specifically to *avoid* looking like a bot to the *target* VN sites) on the request *to archive.org's own API* got it flagged and blocked with the same HTTP 498 — dropping that header for this one call fixed it. Confirmed working end-to-end against real captures (both a normal queued job and the reconcile sweep) before calling it done.

`worker/reconcile.js` (the safety net for anything added directly in ArchiveBox's admin, bypassing `archive-worker`) changed the same way: it used to submit to Wayback itself for these; now it just copies whatever `wayback_url` ArchiveBox's own `archive_org` extractor already produced into this app's `archives` table, so it shows up in this app's UI too and not just ArchiveBox's own admin.

**Social/video URLs added directly in ArchiveBox's admin get a second pass from auto-archiver** (`worker/social-sweep.js`, same `RECONCILE_INTERVAL_MS` cadence as reconcile.js, added 2026-08-14). ArchiveBox's own `media`/`yt-dlp` extractor is much weaker than Bellingcat's auto-archiver for Facebook/Instagram/TikTok/Twitter/Threads/YouTube — confirmed by testing, a directly-added YouTube/Facebook URL typically got an empty or login-walled page shell, not the actual content. The sweep watches ArchiveBox's index for URLs on those domains, runs `auto-archiver` against any that don't already have an `auto-archiver` row in `archives` (`db.hasBeenArchivedBy`), and records the result the same way reconcile.js does. Deliberately reuses `archive-worker`'s existing Docker-socket access and `autoarchiver.js` integration rather than giving the public-facing `archivebox` container Docker socket access itself, which would be a much bigger attack-surface increase (root-equivalent host control) for comparatively little benefit.

Building this surfaced a real, unrelated, ~2-month-old bug: **`memorylane-autoarchiver-config` was completely empty on the VPS** — the one-time `orchestration.yaml` setup (see "One-time setup" below) was done on the old laptop-hosted setup and never repeated after the move to the VPS (`79a056c`, 2026-08-02-ish). Every `tool: auto-archiver` job since then — from the app too, not just this new sweep — was silently failing with "configuration file not found." The only successful `auto-archiver` captures in the database predate the VPS move. Fixed by writing a real `orchestration.yaml` (using the same Supabase S3 credentials as `archivebox/rclone.env`) directly into the volume on the VPS — not committed to git, same secret-handling as `rclone.env`/`cookies.txt`.

**One-time setup**

1. In `backend/.env` set `IA_ACCESS_KEY`/`IA_SECRET_KEY` ([archive.org S3 keys](https://archive.org/account/s3.php)) and `ARCHIVEBOX_ADMIN_USER`/`ARCHIVEBOX_ADMIN_PASSWORD`.
2. For social: copy the auto-archiver config into its volume and tune it:
   ```powershell
   docker run --rm -v memorylane-autoarchiver-config:/config -v "${PWD}/worker/auto-archiver:/src" `
     alpine sh -c "cp /src/orchestration.sample.yaml /config/orchestration.yaml"
   ```
3. Start the stack — local dev: `docker compose up -d archivebox archive-worker`; on the VPS (production): `docker compose -f docker-compose.vps.yml up -d --build`.
4. ArchiveBox is locked down (`PUBLIC_INDEX/SNAPSHOTS/ADD_VIEW=False`); a superuser is auto-created from the env above (or `docker compose exec archivebox archivebox manage createsuperuser`, using `-f docker-compose.vps.yml` on the VPS). Log in at http://localhost:8000 on whichever host is running the container, or https://archivebox.heomay.xyz via the named tunnel (production, VPS).

**Queue a URL** (admin token):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"caseId":"case-phuc-tan","originalUrl":"https://example.gov/notice","mediaType":"document","titleEn":"Eviction notice"}' \
  http://localhost:3001/api/archive
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/archive/queue?caseId=case-phuc-tan"
```

`POST /api/archive/<id>/retry` requeues a failed/partial job. Set `ARCHIVE_DRY_RUN=1` to exercise the queue without external tools.

**Cloud storage — no local snapshots.** Snapshot content lives in **Supabase Storage** (the public `memory-archive` bucket, S3-compatible), not on disk:
- **auto-archiver** uploads directly via its native `s3_storage` (in `worker/auto-archiver/orchestration.yaml`); `local_url` is a Supabase public-object URL.
- **ArchiveBox** uses a custom image ([archivebox/Dockerfile](archivebox/Dockerfile)) whose entrypoint `rclone mount`s the bucket as `/data/archive` (FUSE — the container needs `cap_add: SYS_ADMIN` + `devices: /dev/fuse`). The worker captures via **`docker exec`** into that running container (not throwaway `docker run`), so writes land on the mount → S3. Only `index.sqlite3` + the rclone VFS cache stay on the local `memorylane-archivebox-data` volume.

S3 credentials live in `archivebox/rclone.env` (gitignored, `RCLONE_CONFIG_SB_*`) and the auto-archiver `orchestration.yaml`. After editing those: `docker compose build archivebox && docker compose up -d archivebox archive-worker` locally, or `docker compose -f docker-compose.vps.yml build archivebox && docker compose -f docker-compose.vps.yml up -d archivebox archive-worker` on the VPS.

**TLS verification disabled (deliberate):** ArchiveBox runs with `CHECK_SSL_VALIDITY=False` (in `docker-compose.yml` + persisted in `ArchiveBox.conf`). Many Vietnamese gov/edu sources — the primary material here — serve broken/incomplete certificate chains, which otherwise fail the local capture with `CERTIFICATE_VERIFY_FAILED` (the Internet Archive copy still succeeds, but the local snapshot is empty). **Trade-off:** fetched content isn't authenticated against a verified cert, so a MITM'd connection can't be detected. We accept this for a public-document archiver; the WARC + content hashes still record exactly what was fetched. To re-enable verification, set `CHECK_SSL_VALIDITY=True` and `archivebox config --set CHECK_SSL_VALIDITY=True`. A capture that produces no content (e.g. a genuinely dead link) is reported `partial`/`failed` with no broken local link — only the public Wayback link is offered.

> `archive-worker` mounts the Docker socket to run the tools as sibling containers — it must run on the same Docker host as ArchiveBox (the VPS), never bundled into a serverless/edge API host.

**Cookie-consent banners in captures — solved via `COOKIES_FILE` + `CHROME_USER_DATA_DIR`.** ArchiveBox used to capture every site with a fresh, cookie-less session, so consent banners on Vietnamese news sites got baked directly into screenshots/SingleFile/PDF snapshots. Fixed and verified working (2026-08-12) against a real capture — see "Regenerating the cookies/profile" below for the exact commands.

**How it works:** a script (`archivebox/generate-profile.js`, run with Playwright in a disposable container, not part of the deployed image) does what a human doing this by hand would — launches a real headless browser, visits each site this project archives from, and clicks the real "Accept" button on whatever consent banner appears. That real, genuinely-issued browser state becomes two things:
- `archivebox/cookies.txt` (Netscape format) → mounted at `/data/cookies.txt`, `COOKIES_FILE` env var → covers `wget`'s capture (the core HTML/WARC).
- `archivebox/chrome_profile/` (a full Chrome profile dir — cookies, **and** localStorage/IndexedDB, which some sites use for consent instead of cookies and which `cookies.txt` can never reach) → mounted at `/data/chrome_profile`, `CHROME_USER_DATA_DIR` env var → covers the `singlefile`/`pdf`/`screenshot`/`dom` extractors (all four share one `chrome_args()` helper in ArchiveBox's `util.py`).

This isn't fabricated cookie data — LLMs can't know a site's real per-visit consent tokens (they're dynamically issued, often signed/random), and guessing plausible-looking values wouldn't dismiss the banner and would look like garbage to anti-bot detection. This is a real browser genuinely interacting with the real site, just scripted instead of clicked by hand.

**Two sharp edges hit during setup, both now handled by the generation script / compose config — know about them before you touch this again:**
1. **The profile must be generated with ArchiveBox's exact Chromium build**, not Playwright's bundled one. Mixing builds corrupts the profile's IndexedDB (`ERROR:...backing_store.cc: Got corruption`, chromium falls back to a hang instead of a clean failure) — confirmed by testing. `archivebox/generate-profile.js` takes a `CHROME_EXECUTABLE` env var for exactly this; the regeneration steps below copy the container's own binary out first.
2. **ArchiveBox's entrypoint only `chown`s top-level `/data` entries** (`chown $PUID:$PGID "$DATA_DIR"/*` in `/app/bin/docker_entrypoint.sh` — no `-R`), not recursively. A flat file like `cookies.txt` gets fixed automatically; a directory tree like `chrome_profile/` does not — its *contents* stay owned by whatever generated them, invisible to the `archivebox` user (uid 911) at runtime, and every extractor silently can't read the profile. `chown -R` the whole tree to `911:911` yourself before (or after) mounting it.

**Regenerating the cookies/profile** (e.g. to add a site, or refresh stale consent state) — run from the VPS:
```bash
# 1. Copy ArchiveBox's exact chromium build out (must match -- see sharp edge #1)
docker cp memorieslane-archivebox-1:/browsers/chromium-1217 ~/profile-gen/chromium-1217

# 2. Edit the TARGETS list in archivebox/generate-profile.js if needed, then run it
#    against a clean profile dir using that exact binary (matches the npm playwright
#    version to whatever mcr.microsoft.com/playwright tag you use -- check the error
#    message if it complains about a version mismatch, it tells you the right tag).
docker run --rm \
  -v ~/profile-gen:/work -v ~/profile-gen/output:/output \
  -v ~/profile-gen/chromium-1217:/chromium-1217:ro -w /work \
  -e CHROME_EXECUTABLE=/chromium-1217/chrome-linux64/chrome \
  mcr.microsoft.com/playwright:v1.62.1-jammy node generate-profile.js

# 3. Convert cookies to Netscape format, strip Chrome's stale lock files, deploy
docker run --rm -v ~/profile-gen:/work -v ~/profile-gen/output:/output -w /work \
  mcr.microsoft.com/playwright:v1.62.1-jammy node cookies-to-netscape.js
sudo rm -f ~/profile-gen/output/chrome_profile/Singleton*
sudo cp ~/profile-gen/output/cookies.txt ~/MemoriesLane/archivebox/cookies.txt
sudo rm -rf ~/MemoriesLane/archivebox/chrome_profile
sudo cp -a ~/profile-gen/output/chrome_profile ~/MemoriesLane/archivebox/chrome_profile
sudo chown -R debian:debian ~/MemoriesLane/archivebox/cookies.txt ~/MemoriesLane/archivebox/chrome_profile

# 4. Apply with `up -d`, NOT `restart` (env_file-reload gotcha below), then fix
#    ownership (sharp edge #2 -- the container's own chown won't recurse)
cd ~/MemoriesLane && docker compose -f docker-compose.vps.yml up -d archivebox
docker exec -u root memorieslane-archivebox-1 chown -R archivebox:archivebox /data/chrome_profile

# 5. Verify: container didn't crash-loop, both configs picked up
docker inspect memorieslane-archivebox-1 --format 'RestartCount={{.RestartCount}}'   # must be 0
docker exec --user=archivebox memorieslane-archivebox-1 archivebox config | grep -E 'COOKIES_FILE|CHROME_USER_DATA_DIR'
```
Before trusting a freshly-generated profile against the live container, sanity-check it the same way this was validated: `docker cp` (or `sudo docker cp`, since the profile is uid 911-owned) it to a scratch path, `chown` it, and run `chromium-browser --headless=new --no-sandbox --no-zygote --disable-dev-shm-usage --user-data-dir=<scratch path> --screenshot=/tmp/t.png --window-size=1440,2000 <a target URL>` inside the container by hand first — wrap it in `timeout 90` (a real VN news homepage can take a while; without ArchiveBox's own `TIMEOUT` supervision around it a hung capture will otherwise just sit there).

Both `archivebox/cookies.txt` and `archivebox/chrome_profile/` are gitignored (real browser state, not code) — copy them to a new VPS the same way as `rclone.env`.

**Rate limiting (testing phase):** the API limiter is tunable via env — `RATE_LIMIT_MULT=50` multiplies every limit, `RATE_LIMIT_DISABLED=true` bypasses it entirely. Set in `backend/.env` on the VPS during testing; default is production limits. Note the admin Queue tab auto-refreshes (every 20s) and consumes the `archive` namespace budget.

**Adding/re-crawling a URL directly in ArchiveBox's own admin bypasses archive-worker entirely.** The only supported way to archive a URL is `POST /api/archive` (queues an `archives` row → `archive-worker` polls it → captures). Using ArchiveBox's own "Add" form or its snapshot changelist's "Re-Snapshot" bulk action instead:
- **Can 524 through Cloudflare.** ArchiveBox runs that crawl synchronously inside the admin HTTP request. A JS-heavy page can burn the full `TIMEOUT=180` (e.g. the `singlefile`/Chromium extractor alone), which is well past Cloudflare's fixed ~100s edge timeout (not raisable on a free/pro plan). The browser gets a 524 "A timeout occurred," but the capture keeps running server-side and normally finishes fine a few minutes later — check `/admin/core/snapshot/` again rather than retrying immediately (retrying just starts a second synchronous crawl and doubles the wait).
- **Used to mean the Wayback link never showed up in this app** (though it was always visible in ArchiveBox's own admin) — before `SAVE_ARCHIVE_DOT_ORG` got flipped back on (see "Archiving" above), only `archive-worker`-processed jobs got a Wayback submission at all.
  - **Fixed by a reconcile sweep** (`worker/reconcile.js`, runs every `RECONCILE_INTERVAL_MS` — default 5 min): it lists every successfully-captured URL in ArchiveBox's index, and for any URL with no `wayback_url` recorded anywhere in `archives`, copies over whatever ArchiveBox's own `archive_org` extractor already produced and inserts a `case_id: NULL` row (nullable by design — see `POST /api/archive` — for materials not tied to a specific case) so it shows up in this app's UI too. This is a safety net, not a replacement for submitting through the app — prefer `POST /api/archive` so materials get linked to their case.
- ArchiveBox 0.7.4's "Re-Snapshot" admin action also has an upstream race bug (`Snapshot.DoesNotExist` in `index/schema.py`'s `_asdict()`, surfaces as a `500` on `/admin/core/snapshot/`) — not something to patch here since it's vendored third-party code; just another reason to avoid using it.

**A literal `%` in a page-requisite's filename can never upload to Supabase Storage — no client-side fix exists.** Occasionally a captured page has a script/asset URL whose query string itself contains a URL-encoded value (e.g. `...?s=xxx%3Fc=yyy`), and wget preserves that literal `%` in the local filename. Confirmed by direct testing: Supabase's S3-compatible gateway rejects any object key containing `%` with `InvalidKey`/`400 Bad Request` — and rclone's usual workaround (`--s3-encoding` substituting a look-alike Unicode character for `%`) does **not** help, because Supabase's key validator still rejects the substitute (it appears to Unicode-normalize before validating). The rclone VFS write-back cache will retry an upload like this forever (every `--vfs-write-back` cycle) since it never succeeds — harmless (the file is a non-essential page-requisite; the actual article capture — html/warc/pdf/screenshot — is unaffected) but noisy. If `docker logs memorieslane-archivebox-1` is spammed with repeating `InvalidKey`/`BadRequest` for the same path, that's this — recreating the `archivebox` container (`docker compose -f docker-compose.vps.yml up -d archivebox`) clears the local retry cache (that file was never in S3 to begin with, so nothing is lost).

**VPS region vs. Supabase Storage region — known latency trade-off, not fixed.** The VPS is in Frankfurt (OVH); the Supabase project's Postgres and Storage are genuinely in AWS `ap-northeast-1` (Tokyo) — confirmed via the DB pooler hostname (`aws-1-ap-northeast-1.pooler.supabase.com`), not just the `RCLONE_CONFIG_SB_REGION` label. Measured ~800ms time-to-first-byte from the VPS to Supabase Storage for a single small request; a snapshot with 100+ page-requisites pays that on every asset not already in ArchiveBox's local rclone read-cache (`--vfs-cache-mode full`, effectively unbounded — a snapshot viewed once stays fast on repeat views). Moving the VPS to OVH's Singapore region would meaningfully cut this (closer to both Tokyo and Vietnam) with no risk to archived data (unlike migrating the Supabase project itself, which has no in-place region move and would mean a full Postgres+Storage data migration). Evaluated 2026-08-12 and deliberately left as-is — revisit if load/latency becomes a real problem.

## Deploy

**Frontend (Cloudflare Pages)** — static, no build. Connect the repo: build command empty, output dir `/`. Set env var `BACKEND_URL` to `https://archivebox-api.heomay.xyz`. `functions/api/[[route]].js` proxies `/api/*` there automatically.

**Backend + ArchiveBox + archive-worker (VPS, permanent)** — all three deployed together via `docker-compose.vps.yml`, each with `restart: unless-stopped` so they survive a VPS reboot unattended. (The backend previously ran on Railway; it moved here after the Railway trial ended — no code changes were needed, since all data already lived in Supabase and the Dockerfile/env vars carried straight over.)

`deploy-vps.sh` in this repo automates steps 3–4 below (build/start the stack, wait for the backend health check, validate + wire up the Cloudflare Tunnel ingress rule, restart `cloudflared`, verify end-to-end) — run `TUNNEL=archivebox-vps ./deploy-vps.sh` from the repo root on the VPS after step 1–2. It pauses and opens `$EDITOR` for the one manual edit (adding the ingress block to `cloudflared`'s `config.yml`) rather than rewriting that file programmatically, since a round-tripped YAML dump would strip your comments and risks breaking the live tunnel.

1. Copy `backend/`, `archivebox/`, `worker/`, `backend/.env`, and `archivebox/rclone.env` to the VPS (same relative layout as this repo).
2. In `backend/.env`, make sure `ALLOWED_ORIGINS` is set to the real frontend origin (`https://memorylane101.pages.dev`, **no trailing slash** — browsers never send one in the `Origin` header, so a trailing slash here silently breaks CORS for every real request), not `null`. The backend also refuses to start in production if it's `null`.
3. `docker compose -f docker-compose.vps.yml up -d --build`
4. Every service (`backend` on `3001`, `archivebox` on `8000`) is bound to `127.0.0.1` only — never exposed on the VPS's public IP directly. Each is reached via its own hostname on the VPS's permanent [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), currently named **`archivebox-vps`** (`5552ec4f-50d0-40f4-8d72-ceff0bec9fe4` — confirm with `cloudflared tunnel list` on the VPS, as this can change), installed as a systemd service (`cloudflared service install`) so it auto-starts on boot:
   - `archivebox.heomay.xyz` → `localhost:8000`
   - `archivebox-api.heomay.xyz` → `localhost:3001`

   Add the new `archivebox-api.heomay.xyz` ingress rule to the tunnel's `config.yml` on the VPS (see `cloudflared-config.yml` in this repo for the ingress block shape — **not** its `tunnel:`/`credentials-file:` lines, which belong to the old, now-unused `memorylane` laptop tunnel), run `cloudflared tunnel route dns archivebox-vps archivebox-api.heomay.xyz` once to create the DNS record, then `sudo systemctl restart cloudflared`. Quick tunnels (`--url`) get a new URL each restart, so they're dev-only — this project uses a named tunnel specifically so both URLs are permanent.
5. In the Cloudflare Pages dashboard, set `BACKEND_URL=https://archivebox-api.heomay.xyz` and trigger a redeploy (Pages Functions read this at deploy time, not per-request).

The backend serves everything **except** archiving's heavy lifting: it accepts memory submissions, serves the map/feed/materials, and enqueues archive jobs into the `archives` table. `archive-worker` (same VPS, same Docker host so it can reach ArchiveBox via `docker exec`) does the actual capture (ArchiveBox/auto-archiver/Wayback), since that needs a real browser/yt-dlp and Docker socket access.

**Gotchas hit setting this up (worth knowing before you re-hit them):**
- **Cloudflare Bot Fight Mode blocks the Pages Function → backend hop.** The `functions/api/[[route]].js` proxy calls `BACKEND_URL` server-to-server from Cloudflare's own edge — that request has no real-browser fingerprint, so if the zone's (`heomay.xyz`) **Bot Fight Mode** is on, it gets served a JS challenge page (HTTP 403, `cf-mitigated: challenge` header) instead of reaching the backend. Unlike **Super Bot Fight Mode**, the classic **Bot Fight Mode** toggle has no per-hostname WAF-rule exception on this plan — it had to be turned off entirely (Cloudflare dashboard → zone → Security → Settings → Bot Fight Mode). Diagnose via Security → Events in the dashboard, which names the exact blocking rule/service for a given `cf-ray` ID.
- **`CHROME_USER_DATA_DIR` crash-loops ArchiveBox 0.7.4 unless it's already a real, bootstrapped Chrome profile.** Pointing it at a fresh/empty directory (even with a `Default` subfolder manually created) isn't enough — ArchiveBox validates for actual profile contents at every startup, including the container's own boot, and refuses to run at all if that check fails. Since the container has `restart: unless-stopped`, this manifests as a permanent crash-loop (`archivebox.heomay.xyz` down, `archive-worker` unable to `docker exec` in) rather than a one-off error. Don't set this without first bootstrapping a real profile outside ArchiveBox (e.g. run `chromium-browser --headless --user-data-dir=<dir> about:blank` once against the target directory so Chrome initializes it itself). `COOKIES_FILE` (a Netscape-format `cookies.txt` exported from a real browser session) achieves the same goal — dismissing cookie-consent banners on capture — without this failure mode.
- **`docker compose restart <service>` does not reload `env_file` changes.** It restarts the existing container's process in place; env vars are only re-read when the container is *recreated*. After editing `backend/.env` (e.g. fixing `ARCHIVEBOX_PUBLIC_URL`), use `docker compose -f docker-compose.vps.yml up -d backend` instead — `restart` will silently keep serving the old values.
- **A trailing slash in `ALLOWED_ORIGINS` silently breaks CORS** — see the note on that variable above. `deploy-vps.sh` checks for this now, but it's easy to reintroduce by hand.

## Privacy

- No name, email, or IP stored. The rate limiter derives a one-way HMAC pseudonym from IP + rotating secret + time window.
- Photos/video/PDFs: browser pre-compresses images and (when needed) videos client-side; the server compresses anything still over the size cap (images/video) and strips EXIF from images via `sharp`; stored under random keys in a **private** bucket, public only after a moderator approves.
- `GET /api/memories` returns only `approved = 1` rows; submissions stay invisible in the pending queue until approved.
- `.gitignore` keeps `backend/.env`, `archivebox/rclone.env`, `backup/` data, dumps, and the local `cloudflared-config.yml`/`cloudflared.exe` out of git.
