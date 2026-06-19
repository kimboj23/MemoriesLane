# Miền Ký Ức — MemoryLane

A collective, anonymous civic memory archive. People pin stories to a map of Vietnamese cities, documenting lived experience around urban restructuring and displacement. No account, no name, no email — submissions are moderated before they appear.

## Architecture

```
Cloudflare Pages (static UI)
   └─ /api/* ─▶ Pages Function (functions/api/[[route]].js)
                  └─▶ BACKEND_URL (Railway, always-on) ─▶ Express backend
                         ├─ Supabase Postgres  (memories, cases, topics, archives)
                         └─ Supabase Storage   (private "memory-photos" + public "memory-archive" buckets)

Local machine (Windows, Docker Desktop) — only needed for archiving:
   archive-worker ─ polls the shared `archives` table in Supabase
                  ├─▶ ArchiveBox (local container, S3-backed via rclone)
                  ├─▶ auto-archiver (social posts, uploads straight to S3)
                  └─▶ Internet Archive / Wayback (public link)
   cloudflared (named tunnel, runs as a Windows service) ─▶ archivebox.heomay.xyz → localhost:8000
```

- **Frontend** — static React (in-browser JSX, no build step): `index.html` + `app/*.jsx`, deployed on **Cloudflare Pages**.
- **Backend** — Express on Node 22 (`pg` → Supabase Postgres over the IPv4 session pooler, TLS), deployed on **Railway**.
- **Database/Storage** — **Supabase**: Postgres (memories, cases, topics, archives) + Storage (private `memory-photos` bucket for submitted photos/videos/docs, public `memory-archive` bucket for archived source materials).
- **Archiving** — runs **locally only** (needs a browser/yt-dlp and the Docker socket): ArchiveBox + auto-archiver + Internet Archive, driven by `archive-worker`, exposed via a permanent Cloudflare named tunnel.
- **Backups** — daily local `pg_dump` + bucket sync via a Windows Scheduled Task.

### Does the live site depend on your laptop being on?

**No, for the core site — yes, for archiving.** They're independent:

| If your local machine is off / Docker isn't running | Still works | Stops working |
|---|---|---|
| Effect | Cloudflare Pages frontend, the `/api/*` proxy, the Railway backend, memory submission, the public map/feed, moderation (approve/reject memories), case profiles, the Materials list of *already-archived* items — all of this lives in Cloudflare + Railway + Supabase, none of it touches your machine. | `archivebox.heomay.xyz` (ArchiveBox UI/snapshots) becomes unreachable, and **new** archive jobs (`POST /api/archive`) just sit in the queue as `status=pending` — nothing is lost, the worker simply isn't there to process them until it's back online. |

The `cloudflared` Windows service auto-starts on boot (`Get-Service cloudflared` → `Automatic`/`Running`), so the tunnel itself comes back on its own after a reboot. The Docker containers it points at do **not** auto-start — `docker-compose.yml` has no `restart:` policy configured — so you still need to bring them up manually (see below).

### Restarting the local environment after a reboot

```powershell
# 1. Make sure Docker Desktop is running, then from the repo root:
docker compose up -d

# 2. cloudflared is a Windows service and should already be running — verify:
Get-Service cloudflared

# 3. Sanity-check:
curl http://localhost:3001/health        # local backend (dev only — production traffic goes to Railway)
curl https://archivebox.heomay.xyz       # tunnel + ArchiveBox container
```

If `cloudflared` isn't running: `Start-Service cloudflared` (or reinstall per the comment block at the bottom of `cloudflared-config.yml`).

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
worker/                    local archive-worker: poll Supabase + drive ArchiveBox/auto-archiver/Wayback
functions/api/[[route]].js Cloudflare Pages proxy → BACKEND_URL
docker-compose.yml         frontend (nginx) + backend + postgres (local fallback) + adminer + archivebox + archive-worker
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
| `ARCHIVEBOX_PUBLIC_URL` | no | public URL shown for local snapshots, e.g. `https://archivebox.heomay.xyz` |
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

Case source materials (gov pages, news, social posts) are preserved two ways: a **public, durable Internet Archive link** + a **self-hosted snapshot stored in Supabase Storage (S3)** — ArchiveBox for web/documents, auto-archiver for social. The capture **tools** run locally (they need a browser/yt-dlp), but write **nothing to local disk** — everything goes to the cloud bucket. They're driven by a **local archive-worker** that coordinates through the shared `archives` table in Supabase. This is the one part of the system that genuinely depends on your machine being on — see "Does the live site depend on your laptop being on?" above.

```
Moderator ─▶ POST /api/archive {caseId,url,mediaType}  → inserts archives row (status=pending)
archive-worker (local) ─ polls Supabase ─▶ Wayback (public link) + ArchiveBox/auto-archiver (local snapshot)
                                           └▶ writes wayback_url/local_url, status=archived
Materials/Case API ─▶ returns status=archived rows → public "Materials" list + case profile
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
4. ArchiveBox is locked down (`PUBLIC_INDEX/SNAPSHOTS/ADD_VIEW=False`); a superuser is auto-created from the env above (or `docker compose exec archivebox archivebox manage createsuperuser`). Log in at http://localhost:8000 locally, or https://archivebox.heomay.xyz via the named tunnel.

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

S3 credentials live in `archivebox/rclone.env` (gitignored, `RCLONE_CONFIG_SB_*`) and the auto-archiver `orchestration.yaml`. After editing those: `docker compose build archivebox && docker compose up -d archivebox archive-worker`.

**TLS verification disabled (deliberate):** ArchiveBox runs with `CHECK_SSL_VALIDITY=False` (in `docker-compose.yml` + persisted in `ArchiveBox.conf`). Many Vietnamese gov/edu sources — the primary material here — serve broken/incomplete certificate chains, which otherwise fail the local capture with `CERTIFICATE_VERIFY_FAILED` (the Internet Archive copy still succeeds, but the local snapshot is empty). **Trade-off:** fetched content isn't authenticated against a verified cert, so a MITM'd connection can't be detected. We accept this for a public-document archiver; the WARC + content hashes still record exactly what was fetched. To re-enable verification, set `CHECK_SSL_VALIDITY=True` and `archivebox config --set CHECK_SSL_VALIDITY=True`. A capture that produces no content (e.g. a genuinely dead link) is reported `partial`/`failed` with no broken local link — only the public Wayback link is offered.

> The `archive-worker` mounts the Docker socket to run the tools as sibling containers — it must run on the local Docker host, never on the cloud API host.

**Rate limiting (testing phase):** the API limiter is tunable via env — `RATE_LIMIT_MULT=50` multiplies every limit, `RATE_LIMIT_DISABLED=true` bypasses it entirely. Set on the backend host (Railway) during testing; default is production limits. Note the admin Queue tab auto-refreshes (every 20s) and consumes the `archive` namespace budget.

## Deploy

**Frontend (Cloudflare Pages)** — static, no build. Connect the repo: build command empty, output dir `/`. Set env var `BACKEND_URL` to the Railway backend's public URL. `functions/api/[[route]].js` proxies `/api/*` there automatically.

**Backend (Railway, always-on)** — deploy the Docker image; since all data is in Supabase, no persistent volume is needed.

1. Push the repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → select this repo.
3. Settings: root/build context `backend`, Dockerfile build, port `3001`.
4. Set env vars (from `backend/.env`): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_HMAC_SECRET`, `ADMIN_TOKEN_HASH`, `IA_ACCESS_KEY`/`IA_SECRET_KEY`, and `ALLOWED_ORIGINS=https://<your>.pages.dev`. (`NODE_ENV`, `PORT`, `BIND_ADDR` are baked into the image.)
5. Deploy → copy the Railway public URL → set it as `BACKEND_URL` in CF Pages (set once; it rarely changes).

The Railway backend serves everything **except** archiving's heavy lifting: it accepts memory submissions, serves the map/feed/materials, and enqueues archive jobs into the `archives` table — but the actual capture (ArchiveBox/auto-archiver/Wayback) is done by `archive-worker` on your local machine, since that needs a real browser/yt-dlp and Docker socket access that a serverless host can't provide. That's the dependency described above: the main site survives your laptop being off; new archive captures don't process until it's back on.

**ArchiveBox / archive-worker (local, permanent)** — exposed via a permanent [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared-config.yml`, `archivebox.heomay.xyz`), installed as a Windows service so it auto-starts on boot. Quick tunnels (`--url`) get a new URL each restart, so they're dev-only — this project uses a named tunnel specifically so the URL is permanent.

## Privacy

- No name, email, or IP stored. The rate limiter derives a one-way HMAC pseudonym from IP + rotating secret + time window.
- Photos/video/PDFs: browser pre-compresses images and (when needed) videos client-side; the server compresses anything still over the size cap (images/video) and strips EXIF from images via `sharp`; stored under random keys in a **private** bucket, public only after a moderator approves.
- `GET /api/memories` returns only `approved = 1` rows; submissions stay invisible in the pending queue until approved.
- `.gitignore` keeps `backend/.env`, `archivebox/rclone.env`, `backup/` data, dumps, and the local `cloudflared-config.yml`/`cloudflared.exe` out of git.
