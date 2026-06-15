# Miền Ký Ức — MemoryLane

A collective, anonymous civic memory archive. People pin stories to a map of Vietnamese cities, documenting lived experience around urban restructuring and displacement. No account, no name, no email — submissions are moderated before they appear.

## Architecture

```
Cloudflare Pages (static UI)
   └─ /api/* ─▶ Pages Function (functions/api/[[route]].js)
                  └─▶ BACKEND_URL (Cloudflare Tunnel) ─▶ Express backend (local)
                         ├─ Supabase Postgres  (memories, cases, topics)
                         └─ Supabase Storage   (private bucket "memory-photos")
```

- **Frontend** — static React (in-browser JSX, no build step): `index.html` + `app/*.jsx`.
- **Backend** — Express on Node 22 (`pg` → Supabase Postgres over the IPv4 session pooler, TLS).
- **Photos** — private Supabase Storage bucket; served back through the API behind the `approved=1` gate.
- **Backups** — daily local `pg_dump` + bucket sync via a Windows Scheduled Task.

## Project structure

```
index.html                 entry point; all CSS inline
app/                        UI: app, map, compose, memory, case-profile, research, export, data (jsx)
backend/
  server.js                Express app + startup (initDb, ensureBucket)
  db.js                    Postgres schema + queries (auto-migrates, seeds topics)
  storage.js               Supabase Storage helper (ensureBucket/upload/download)
  middleware/              auth (admin Bearer), rate-limit (IP-free HMAC), sanitize
  routes/                  memories, moderate, cases, topics, feed, archive
  scripts/                 setup-admin, seed-*, create-bucket, backup-photos
worker/                    local archive-worker: poll Supabase + drive ArchiveBox/auto-archiver/Wayback
functions/api/[[route]].js Cloudflare Pages proxy → BACKEND_URL
docker-compose.yml         frontend (nginx) + backend + postgres (fallback) + adminer + archivebox + archive-worker
nginx.conf                 proxies /api/* → backend
backup/                    backup.ps1, register-task.ps1
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
| `PORT` / `BIND_ADDR` / `NODE_ENV` | no | `3001` / `127.0.0.1` (`0.0.0.0` in Docker) / `development` |
| `UPLOADS_DIR` | no | local-disk photo fallback when `SUPABASE_*` unset |

Leaving `SUPABASE_*` unset makes the backend store photos on local disk instead — dev convenience only.

## API

Public:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/memories` | Submit a memory (→ pending queue) |
| GET | `/api/memories?city=&minYear=&maxYear=&offset=` | List approved memories |
| GET | `/api/memories/:id` | Single approved memory |
| GET | `/api/memories/:id/photo` | Approved memory's photo (WebP) |
| GET | `/api/feed?city=&topics=&cats=&minYear=&maxYear=` | Unified cases + memories feed |
| GET | `/api/topics` | All topics |
| GET | `/api/cases/:id` | Case profile + linked memories |
| GET | `/health` | Health check |

Moderation (require `Authorization: Bearer <token>`):

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/moderate/queue
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/moderate/<id>/approve
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"off-topic"}' http://localhost:3001/api/moderate/<id>/reject
```

## Admin UI — Adminer

http://localhost:8081 (server pre-filled). Log in to the Supabase DB:

| Field | Value |
|-------|-------|
| System | PostgreSQL |
| Server | `aws-1-<region>.pooler.supabase.com` |
| Username | `postgres.<ref>` |
| Password | Supabase DB password |
| Database | `postgres` |

Approve a row by setting `approved = 1`. To manage the local fallback DB instead, set Server to `postgres`.

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

## Archiving

Case source materials (gov pages, news, social posts) are preserved two ways: a **public, durable Internet Archive link** + a **local snapshot** (ArchiveBox for web/documents, auto-archiver for social). The heavy tools can't run on a serverless host, so they live in a **local archive-worker** that coordinates through the shared `archives` table in Supabase.

```
Moderator ─▶ POST /api/archive {caseId,url,mediaType}  → inserts archives row (status=pending)
archive-worker (local) ─ polls Supabase ─▶ Wayback (public link) + ArchiveBox/auto-archiver (local snapshot)
                                           └▶ writes wayback_url/local_url, status=archived
Case API ─▶ returns status=archived rows  → "Archived Materials" in the case profile
```

**Flow:** `web`/`document` → ArchiveBox + Wayback; `social` → auto-archiver + Wayback. A job is `archived` (all succeeded), `partial` (some), or `failed`. Only `archived`/`partial` rows are public; the local snapshot link stays behind ArchiveBox login.

**One-time setup**

1. In `backend/.env` set `IA_ACCESS_KEY`/`IA_SECRET_KEY` ([archive.org S3 keys](https://archive.org/account/s3.php)) and `ARCHIVEBOX_ADMIN_USER`/`ARCHIVEBOX_ADMIN_PASSWORD`.
2. For social: copy the auto-archiver config into its volume and tune it:
   ```powershell
   docker run --rm -v memorylane-autoarchiver-config:/config -v "${PWD}/worker/auto-archiver:/src" `
     alpine sh -c "cp /src/orchestration.sample.yaml /config/orchestration.yaml"
   ```
3. Start the stack: `docker compose up -d archivebox archive-worker`
4. ArchiveBox is locked down (`PUBLIC_INDEX/SNAPSHOTS/ADD_VIEW=False`); a superuser is auto-created from the env above (or `docker compose exec archivebox archivebox manage createsuperuser`). Log in at http://localhost:8000.

**Queue a URL** (admin token):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"caseId":"case-phuc-tan","originalUrl":"https://example.gov/notice","mediaType":"document","titleEn":"Eviction notice"}' \
  http://localhost:3001/api/archive
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/archive/queue?caseId=case-phuc-tan"
```

`POST /api/archive/<id>/retry` requeues a failed/partial job. Set `ARCHIVE_DRY_RUN=1` to exercise the queue without external tools.

**Storage notes (from ArchiveBox):** `index.sqlite3` stays on the local/SSD `memorylane-archivebox-data` volume. For very large archives, point the `archive/` folder at bigger storage via `ARCHIVEBOX_ARCHIVE_VOLUME` (mounted identically in `worker/archivers/archivebox.js`); on NFS/SMB/FUSE/S3-backed shares you may need `PUID`/`PGID`/root-squash adjustments, and avoid EXT3/FAT.

> The `archive-worker` mounts the Docker socket to run the tools as sibling containers — it must run on the local Docker host, never on the cloud API host.

## Deploy

**Frontend (Cloudflare Pages)** — static, no build. Connect the repo: build command empty, output dir `/`. Set env var `BACKEND_URL` to the backend's public URL. `functions/api/[[route]].js` proxies `/api/*` there automatically.

**Backend (Koyeb — always-on, no credit card)** — deploy the Docker image; since all data is in Supabase, no persistent volume is needed.

1. Push the repo to GitHub.
2. Koyeb → **Create Service → GitHub** → select this repo.
3. Builder: **Dockerfile**, build context/work dir `backend`, port `3001`.
4. Set env vars (from `backend/.env`): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_HMAC_SECRET`, `ADMIN_TOKEN_HASH`, and `ALLOWED_ORIGINS=https://<your>.pages.dev`. (`NODE_ENV`, `PORT`, `BIND_ADDR` are baked into the image.)
5. Deploy → copy the `*.koyeb.app` URL → set it as `BACKEND_URL` in CF Pages (set once; it never changes).

Same steps work on Render/Fly. The image binds `0.0.0.0` and runs in production mode by default.

**Alt — keep the backend on your machine** via a permanent [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) + a domain you own (`cloudflared service install` to auto-start). Quick tunnels (`--url`) get a new URL each restart, so they're dev-only.

## Privacy

- No name, email, or IP stored. The rate limiter derives a one-way HMAC pseudonym from IP + rotating secret + time window.
- Photos: browser pre-compresses; server strips EXIF via `sharp`; stored under random keys in a **private** bucket, public only after a moderator approves.
- `GET /api/memories` returns only `approved = 1` rows; submissions stay invisible in the pending queue until approved.
- `.gitignore` keeps `backend/.env`, `backup/` data, and dumps out of git.
