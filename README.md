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
                  ├─▶ ArchiveBox (container, archive on the VPS disk)
                  ├─▶ auto-archiver (social posts, uploads straight to S3)
                  └─▶ Internet Archive / Wayback (public link)
   nocodb         ─ Airtable-style grid over the Supabase tables for the content
                    manager (restricted `content_manager` Postgres role)
   cloudflared (named tunnel, systemd service) ─▶ archivebox.heomay.xyz     → localhost:8000
                                                 ─▶ archivebox-api.heomay.xyz → localhost:3001
                                                 ─▶ memorylanedb.heomay.xyz          → localhost:8090 (+ Cloudflare Access)
```

- **Frontend** — static React (in-browser JSX, no build step): `index.html` + `app/*.jsx`, deployed on **Cloudflare Pages**.
- **Backend** — Express on Node 22 (`pg` → Supabase Postgres over the IPv4 session pooler, TLS), runs on the same **VPS** as archiving, deployed via `docker-compose.vps.yml`, reached at `https://archivebox-api.heomay.xyz` through the Cloudflare named tunnel. (Previously on Railway — moved off after the Railway trial ended.)
- **Database/Storage** — **Supabase**: Postgres (memories, cases, topics, archives) + Storage (private `memory-photos` bucket for submitted photos/videos/docs, public `memory-archive` bucket for auto-archiver's social captures). ArchiveBox's own archive lives on the VPS disk since 2026-09-17 (see "ArchiveBox storage" below).
- **Archiving** — runs on the same **VPS** (needs a browser/yt-dlp and the Docker socket): ArchiveBox + auto-archiver + Internet Archive, driven by `archive-worker`, deployed via `docker-compose.vps.yml` with `restart: unless-stopped`.
- **Backups** — daily local `pg_dump` + bucket sync via a Windows Scheduled Task (runs from the maintainer's machine, separate from the VPS), plus a nightly VPS-side systemd timer that snapshots ArchiveBox's index and copies the archive off-box to Backblaze B2 (`backup/archivebox-backup.sh`).

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
  scripts/                  setup-admin, seed-*, create-bucket, backup-photos, content-manager-role.sql
worker/                    archive-worker: poll Supabase + drive ArchiveBox/auto-archiver/Wayback
nocodb/                    nocodb.env.example — env template for the content manager's NocoDB (see "Content manager UI")
functions/api/[[route]].js Cloudflare Pages proxy → BACKEND_URL
docker-compose.yml         local dev: frontend (nginx) + backend + postgres (local fallback) + adminer + archivebox + archive-worker
docker-compose.vps.yml     production: backend + archivebox + archive-worker + nocodb, deployed on the VPS (restart: unless-stopped)
deploy-vps.sh              run on the VPS: build/start the stack + wire up the Cloudflare Tunnel ingress rule
migrate-archivebox-data.sh one-time: migrate a standalone local-disk ArchiveBox instance's data into the S3-backed setup
nginx.conf                 proxies /api/* → backend
backup/                    backup.ps1, register-task.ps1 (laptop: Supabase) · archivebox-backup.sh, b2.env.example (VPS: ArchiveBox)
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

## Content manager UI — NocoDB

https://memorylanedb.heomay.xyz — an Airtable-style grid (filter, sort, inline edit, gallery/kanban views, linked records for the `*_topics` join tables) directly over the app's Supabase tables, for a content manager who shouldn't need Adminer, SQL, or the raw admin API. Runs as the `nocodb` service in `docker-compose.vps.yml` on the VPS, bound to `127.0.0.1:8090`, reached only through the Cloudflare Tunnel.

**This is for the MemoryLane DB only.** ArchiveBox's `index.sqlite3` is not mounted into NocoDB and shouldn't be: ArchiveBox's own admin (`archivebox.heomay.xyz/admin/`) is already the filterable/taggable grid for that data, and the `archives` table (which `worker/reconcile.js` fills from ArchiveBox's index) is how snapshots show up in NocoDB alongside everything else.

### Why it's safe to hand out

Three independent layers, each of which holds on its own:

1. **Postgres grants, not UI settings, are the real fence.** NocoDB connects as a dedicated `content_manager` role created by [backend/scripts/content-manager-role.sql](backend/scripts/content-manager-role.sql) — never as the backend's `postgres` superuser (that credential isn't mounted into the container at all). The role gets `SELECT` on the seven content tables and **column-level** `UPDATE` on editorial columns only. It cannot touch the columns `archive-worker` owns (`archives.status`/`error`/`attempts`, every `*_url`, `sha256`, `tool*`, `archived_at` — flipping `status` back to `pending` would re-queue a capture, and the URL/hash columns are the evidentiary record), the storage columns (`memories.photo_path`/`file_mime`/`has_photo`), ids, or submission dates. `INSERT` only on `cases`, `topics`, and the join tables (memories arrive from public submissions; archives are queued via `POST /api/archive`). `DELETE` only on the join tables (un-tagging) — hide a row with `approved=0`/`rejected=1`, rows in this archive are not deleted from a spreadsheet. No `CREATE`, so NocoDB's "add table/column" UI fails loudly instead of altering the schema. Postgres enforces this on every query, so it holds even if the NocoDB login is compromised or the UI is misconfigured.
2. **Cloudflare Access in front of the hostname.** Nothing reaches NocoDB without first passing an Access policy (email one-time-code for an allowlist of addresses). Configure it in the Cloudflare dashboard → Zero Trust → Access → Applications → *Add an application* → Self-hosted: application domain `memorylanedb.heomay.xyz`, policy *Allow* → Include → Emails → the maintainer's and the content manager's addresses, identity provider *One-time PIN*. Session duration 24h is fine. Until this exists NocoDB is reachable by anyone with the URL, protected only by its own login — `deploy-vps.sh` reminds you.
3. **NocoDB's own accounts.** No self-registration. The maintainer's super-admin comes from `NC_ADMIN_EMAIL`/`NC_ADMIN_PASSWORD` in `nocodb/nocodb.env`; the content manager is invited from inside NocoDB with the **Editor** role (can edit rows, cannot see or change the data-source connection, add tables, or invite others). Webhooks can't target private addresses (`NC_WEBHOOK_ALLOW_PRIVATE_NETWORK=false`), so an Editor can't aim one at the backend or ArchiveBox on the same host.

   **The `NC_INVITE_ONLY_SIGNUP=true` env var in the compose file is ignored by the pinned NocoDB version** — verified 2026-09-17 by booting `2026.09.0` with it set and `POST`ing to `/api/v1/auth/user/signup`, which created an account, while `/api/v1/app-settings` still reported `invite_only_signup: false`. The real switch is that app setting, stored in NocoDB's metadata DB and only changeable by a super-admin. `deploy-vps.sh` step 4 flips it through the settings API with the bootstrap credentials, re-reads it, and then proves it from outside by attempting an anonymous signup (must not return 200) — the deploy aborts otherwise. If you've changed the super-admin password since first boot the script can't sign in and instead tells you to verify by hand: account menu → Settings → signup disabled. Don't skip that.

Edits made here bypass the backend's sanitize middleware and moderation routes — that's the point (direct editing) but also the trade-off. `approved`/`rejected` set from the grid work exactly like the Queue tab's approve/reject (both just set the flags; see the Adminer note above), except `moderated_at` isn't filled in automatically.

### Setup (once)

1. Create the role and grants. In the Supabase SQL editor paste [backend/scripts/content-manager-role.sql](backend/scripts/content-manager-role.sql) (or `psql "$DATABASE_URL" -f backend/scripts/content-manager-role.sql`), then set its password **separately** so it never lands in a file or shell history: `psql "$DATABASE_URL" -c "\password content_manager"`. Re-running the script is safe — it resets the grants to exactly what the file says.
2. On the VPS: `cp nocodb/nocodb.env.example nocodb/nocodb.env`, fill in `NC_AUTH_JWT_SECRET` (random 64 hex) and `NC_ADMIN_EMAIL`/`NC_ADMIN_PASSWORD`. Then `TUNNEL=archivebox-vps ./deploy-vps.sh` (adds the `memorylanedb.heomay.xyz` ingress rule + DNS route alongside the existing ones) — or by hand: `docker compose -f docker-compose.vps.yml up -d nocodb`, add `- hostname: memorylanedb.heomay.xyz` / `service: http://localhost:8090` to the tunnel's `config.yml`, `cloudflared tunnel route dns archivebox-vps memorylanedb.heomay.xyz`, `sudo systemctl restart cloudflared`.
   **Went live 2026-09-18** — steps 1-2 done from the VPS rather than the SQL editor. Two gotchas: (a) `psql "$DATABASE_URL" -c "\password …"` is a *terminal* command, not SQL — pasted into the Supabase SQL editor it fails with `syntax error at or near "psql"`; `\password` also prompts interactively, so non-interactively use `ALTER ROLE content_manager PASSWORD '…'` with a generated value (done; the password sits in `nocodb/content_manager.password` on the VPS, mode 600, until it has been typed into NocoDB's data-source form — delete it after). (b) Connecting as plain `content_manager` through the pooler fails with `ENOIDENTIFIER: no tenant identifier provided` — the username must be `content_manager.<project-ref>` exactly as the table below says; verified the full fence with that user (editorial `UPDATE` allowed; `status`/`wayback_url` updates, any `DELETE` on content tables, `INSERT` on `archives`, and `CREATE TABLE` all `permission denied`). Invite-only signup was set through the settings API and probed (`POST /api/v1/auth/user/signup` → 400).
3. Cloudflare Access application for `memorylanedb.heomay.xyz` (layer 2 above). Do this **before** inviting anyone.
4. Log in at `https://memorylanedb.heomay.xyz` as the super-admin. Create a base → *Connect external data* → PostgreSQL:

   | Field | Value |
   |-------|-------|
   | Host | `aws-1-<region>.pooler.supabase.com` (same host as `DATABASE_URL`) |
   | Port | `5432` — the **session** pooler. NocoDB holds persistent connections; the transaction pooler on `6543` breaks its prepared statements. |
   | Username | `content_manager.<project-ref>` (Supabase's pooler wants `role.project-ref`, same convention as `postgres.<ref>` in `DATABASE_URL`) |
   | Password | the one set in step 1 |
   | Database | `postgres` |
   | SSL | required (`rejectUnauthorized: false`, as the backend does) |

   NocoDB stores this connection encrypted in its own metadata DB on the `memorylane-nocodb-data` volume, not in any file in this repo. Attaching is an async job — give it ~10 s before the tables appear. You'll see **four** tables (`memories`, `cases`, `archives`, `topics`), not seven: NocoDB detects `memory_topics`/`case_topics`/`archive_topics` as many-to-many junctions and surfaces them as link fields on the parent tables instead, which is the Airtable-style tagging UX we want. (Verified locally against the docker Postgres with the real role script — the fence holds through NocoDB exactly as at the SQL level: editing an allowed column saves, editing `photo_path`/deleting a row/adding a column each surface as `ERR_DATABASE_OP_FAILED` 42501 in the UI, and a row added to `cases` came back as `case-<12 hex>` with today's date.)
5. In each table's default grid, **hide** the read-only columns (the worker/storage/id ones listed above) so the content manager never hits a "permission denied" from trying to edit one — the grant is what stops them; hiding is just courtesy. Set `approved`/`rejected` fields to Checkbox display, `city`/`cat`/`status` to Single-select with the values from the `CHECK` constraints in `backend/db.js`.
6. *Team & Settings → Members → Invite*: the content manager's email, role **Editor**. They get an invite link (works because `NC_SITE_URL` points at the tunnel hostname), pass Cloudflare Access with the same email, and are in.

### Operating notes

- **Rows created from the grid.** `cases.id`, `cases.created_at` and `topics.id` get server-side defaults from the role script (`case-<12 hex>`, today's `YYYY-MM-DD`, `<12 hex>`), so a new row only needs the `NOT NULL` editorial fields (`title_vi`, `summary_vi`, `city`; `slug`, `name_vi`, `name_en`). A different random alphabet than the backend's `base64url` ids — nothing depends on the shape beyond `[A-Za-z0-9_-]{1,64}`.
- **`CHECK` constraints still apply.** A `city` outside `hanoi|hcmc|hue|danang|cantho` or a `cat`/`status` outside the allowed set is rejected by Postgres with a constraint error in the grid — the Single-select setup in step 5 avoids the round trip.
- **Connections.** The role has `CONNECTION LIMIT 5`; Supabase's free-tier pooler is small and the backend + worker share it. If NocoDB shows connection errors under load, that's the limit doing its job — don't raise it without checking the pooler's headroom.
- **Upgrading NocoDB.** The image is pinned (`nocodb/nocodb:2026.09.0`). Before bumping, copy the metadata volume: `docker run --rm -v memorylane-nocodb-data:/data -v "$PWD:/backup" alpine tar czf /backup/nocodb-data.tgz -C /data .` — same reasoning as the ArchiveBox `index.sqlite3` note under "Backups". The volume holds users, views and the encrypted data-source config; the actual data is in Supabase and covered by the existing laptop backup task.
- **Don't use "Create table" inside the Supabase source.** Column adds fail cleanly (Postgres: "not the owner"), but a table add is worse: NocoDB reports success and registers the table in its own metadata while nothing is actually created in Postgres (verified — `information_schema` unchanged). The result is a phantom table in the sidebar that errors on open. If someone does it, delete the phantom from the NocoDB table menu; Postgres needs no cleanup. Schema changes go in `backend/db.js`.
- **Running it locally** (against the laptop `docker-compose.yml` Postgres, for trying things out): `docker compose -f docker-compose.vps.yml up -d --no-deps nocodb` works with a local `nocodb/nocodb.env`, but NocoDB refuses data sources on private addresses by default (`Connection to internal hosts is not allowed`) — add `NC_ALLOW_LOCAL_EXTERNAL_DBS=true` via a compose override for the local run only, never on the VPS (the Supabase pooler is a public host, so production doesn't need it). Apply the role script to the local DB with `docker exec -i memorieslane-postgres-1 psql -U memorylane -d memorylane -f - < backend/scripts/content-manager-role.sql`, host `postgres`, port `5432`, user `content_manager` (no `.<ref>` suffix — that's a Supabase-pooler convention).
- **Revoking access.** Remove the email from the Cloudflare Access policy (immediate, cuts the network path) and from NocoDB's members. To retire the role entirely: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM content_manager; DROP ROLE content_manager;` (drop the NocoDB data source first, or it will spin on reconnects).

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

### ArchiveBox (VPS-side, systemd timer)

`backup/archivebox-backup.sh` runs nightly at 03:00 UTC via `archivebox-backup.timer` (this VPS image ships no cron; `systemctl list-timers archivebox-backup.timer` shows the next run, `~/backups/archivebox-backup.log` the history). It (1) takes a WAL-consistent snapshot of `index.sqlite3` through SQLite's online-backup API — a plain `cp` of the live DB can be torn — plus `ArchiveBox.conf` (`SECRET_KEY`) and auto-archiver's `orchestration.yaml`, into `~/backups/archivebox/` with 30-day retention and `600` perms; then (2) `rclone copy`s `/data/archive` and those snapshots to a Backblaze B2 bucket. Credentials come from `backup/b2.env` (gitignored; template `backup/b2.env.example`; newcomer walkthrough of the B2 console in [backup/B2-SETUP.md](backup/B2-SETUP.md)). **Copy, never sync**, paired with an application key that lacks `deleteFiles` and a bucket created with Object Lock: nothing the VPS can do removes a file from B2, so even a fully compromised VPS cannot destroy the off-box copy. Until `b2.env` exists the script still takes the local snapshot, then exits 2 loudly — systemd shows the unit as failed on purpose. Run it by hand with `~/MemoriesLane/backup/archivebox-backup.sh`.

Gotcha found writing it: `docker exec` **without `-i`** does not forward stdin, so `docker exec … python3 - <<EOF` runs an empty script, exits 0, and the step silently does nothing. Always `docker exec -i` when piping a script in.

Before 2026-09-17 there was no ArchiveBox backup at all — **the laptop task covers Supabase Postgres/Storage only; ArchiveBox's own `index.sqlite3` (on the `memorylane-archivebox-data` VPS volume) was not backed up anywhere.** Surfaced for real 2026-08-20 during an ArchiveBox 0.9.x upgrade attempt (see "Attempted upgrade to 0.9.x" below): after rolling back the container image, the shared `index.sqlite3` still had 0.9.x's restructured schema (new `crawls_*`/`machine_*` tables, `core_snapshot` columns renamed/added), which 0.7.4 can't read — no snapshot of the pre-upgrade file existed to restore from. Recovered without data loss only because `archivebox init --force` can rebuild the index by rescanning `archive/` folder contents directly (real archived content lives in S3, not in the index) — but that's a lucky recovery path, not a backup. Before any future ArchiveBox version change, manually copy `index.sqlite3` off the volume first: `docker run --rm -v memorylane-archivebox-data:/data -v "$PWD:/backup" alpine cp /data/index.sqlite3 /backup/index.sqlite3.bak`.

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

**auto-archiver's capture also gets injected into ArchiveBox's own snapshot** (`worker/archivers/archivebox.js`'s `injectScreenshot()`, called from `social-sweep.js`, added 2026-08-14), so the central index (ArchiveBox's admin) shows real captured content instead of the weak/empty snapshot its own extractor produced — per the goal of everything being reachable from one place, not scattered between ArchiveBox's admin and this app's `archives` table. When auto-archiver's result is a PNG (its usual output for social platforms), the worker downloads it and writes it directly into the existing ArchiveBox snapshot's folder on the S3-backed mount (`/data/archive/<timestamp>/screenshot.png`, piped in via `docker exec -i ... sh -c 'cat > ...'` since `execFile` can't stream stdin), then records a genuinely-`succeeded` `screenshot` `ArchiveResult` for it via `archivebox manage shell`. ArchiveBox's admin picks this up automatically — `Snapshot.thumbnail_url` (`core/models.py`) is a `cached_property` that just queries `archiveresult_set.filter(extractor='screenshot', status='succeeded').last()`, so the new row wins over any earlier failed one without any other change needed. Verified end-to-end 2026-08-14: byte-exact file on the mount, correct DB row via direct ORM query, and correct public serving (`curl .../archive/<ts>/screenshot.png` → 200, byte-exact).
- **Caveat, same category as the YouTube auth-cookie limitation below:** this only improves *what ArchiveBox displays*, not what auto-archiver was able to capture in the first place. Wiring auto-archiver's `generic_extractor` up to the same `COOKIES_FILE` consent-cookie jar ArchiveBox uses (`AUTOARCHIVER_COOKIES_FILE` → `--cookies` in `ytdlp_args`) was tried and kept (harmless, may help on some platforms), but for YouTube specifically the screenshot itself comes from a *different* component — `antibot_extractor_enricher`'s own webdriver, which needs a **persisted browser profile** (`user_data_dir`), not a cookies.txt file — and getting past YouTube's bot-wall for real video content needs an authenticated account, same as ArchiveBox's own `yt-dlp` extractor already documented above. Deliberately not automated for the same reason: scripting a real account login risks getting that account flagged/banned. Confirmed by testing: a real capture attempt against a YouTube Shorts URL, both before and after the cookie fix, only produced a screenshot of YouTube's own cookie-consent wall — so that specific test injection was reverted rather than left live (a consent-wall thumbnail is strictly worse than no thumbnail). If this matters enough later, the fix is the same shape as `generate-profile.js`/`CHROME_USER_DATA_DIR` for ArchiveBox: pre-generate a real browser profile once, persist it in a volume, mount it at `antibot_extractor_enricher.user_data_dir`.

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

**The `/admin/auth/user/` change form used to save passwords as plaintext, not a hash — patched, but check any account created before 2026-08-17.** Confirmed twice (`longtrinh`, then `sana`): typing a password directly into that field's raw text box and saving stored the literal string in the `password` column instead of running it through Django's hasher — `has_usable_password()` still returned `True` (it only checks for the empty/`!`-prefixed sentinel, not a real hash format), so nothing in the admin itself flagged it; the account just silently couldn't log in. Root cause, and the same root cause behind the next entry (no Groups UI): `core/admin.py` does `admin.site = ArchiveBoxAdmin()`, replacing Django's default admin site with a fresh, empty one — which drops every registration `django.contrib.auth`'s own admin.py would normally have made against the *old* default site, including the real `UserAdmin` (ArchiveBox re-registered `User` with a bare `admin.ModelAdmin` instead, which has no hashing awareness at all).

**Fixed in `archivebox/Dockerfile`** by patching `core/admin.py` at build time (same guarded-`sed` pattern as the `size`-column patch above — fails the build loudly if either exact line ever changes upstream) to register `User` with Django's real `django.contrib.auth.admin.UserAdmin` instead. This is a backport, not an original fix — checked upstream first (`core/admin_users.py` on the unreleased 0.9.x branch, no stable release since 0.7.4 as of 2026-08-17) and it hit the same bug, fixed the same way, via a `CustomUserAdmin(UserAdmin)`. Verified live post-patch via the admin registry itself (`admin.site._registry[User]` → `UserAdmin` MRO, `.form` → `UserChangeForm`), not just "container didn't crash."

**Also now registers `Group`** (`django.contrib.auth.admin.GroupAdmin`) — the `Groups:` field on the user form always existed (it's a real model relation), but there was no admin page to actually create/manage a `Group` object, for the same reason as above. This part is *not* an upstream backport — checked the same 0.9.x file and ArchiveBox has never registered `Group` in its admin, on any release; added here only so this deployment has a working Groups UI. Note groups only affect non-superuser staff accounts — both existing users (`longtrinh`, `sana`) are superusers, which bypasses permission/group checks entirely.

**Any account created before this patch (2026-08-17) needs checking**, since the admin form wouldn't have flagged the plaintext-save either way:
```bash
docker exec --user=archivebox <archivebox-container> archivebox manage shell -c "from django.contrib.auth.models import User; [print(u.username, u.password[:20]) for u in User.objects.all()]"
```
A real hash starts with `pbkdf2_sha256$`; anything else (a plain word) means that account can't log in and needs a reset:
```bash
docker exec --user=archivebox <archivebox-container> archivebox manage changepassword <username>
```

**Queue a URL** (admin token):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"caseId":"case-phuc-tan","originalUrl":"https://example.gov/notice","mediaType":"document","titleEn":"Eviction notice"}' \
  http://localhost:3001/api/archive
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/archive/queue?caseId=case-phuc-tan"
```

`POST /api/archive/<id>/retry` requeues a failed/partial job. Set `ARCHIVE_DRY_RUN=1` to exercise the queue without external tools.

**ArchiveBox storage — on the VPS disk since 2026-09-17; auto-archiver still on Supabase.**
- **ArchiveBox**'s archive is a plain directory: `/data/archive` on the `memorylane-archivebox-data` docker volume (the VPS's own disk, 99 GB). Selected by `ARCHIVE_STORAGE=local` in `docker-compose.vps.yml`. The entrypoint ([archivebox/archivebox-entrypoint.sh](archivebox/archivebox-entrypoint.sh)) still supports `ARCHIVE_STORAGE=s3` — the legacy `rclone mount` of the Supabase bucket over `/data/archive` (FUSE; needs `cap_add: SYS_ADMIN` + `devices: /dev/fuse`) — as the rollback path only. The worker captures via **`docker exec`** into the running container (not throwaway `docker run`), so every path is unchanged from the S3 days.
- **auto-archiver** still uploads directly to the public `memory-archive` bucket via its native `s3_storage` (in `orchestration.yaml`); `local_url` is a Supabase public-object URL. ~134 MB — well inside Supabase's free tier now that ArchiveBox's 1.2 GB is off it.

**Why it moved.** One forcing reason and one long overdue. Forcing: the Supabase org is on the free plan (1 GB storage) and ArchiveBox's archive alone was 1.17 GB — the org entered its over-quota grace period (ending 2026-10-17). Overdue: the bucket is in Tokyo and its *only* client was this VPS in Frankfurt (readers arrive via Cloudflare either way), and that ~800 ms round trip was the root cause of three separate production incidents documented under "VPS region vs. Supabase Storage region" below. Local disk removes the latency, lets the tunnel-facing container drop the near-root `SYS_ADMIN` capability, and means the VPS no longer needs S3 write credentials for the archive. The trade-off: the primary copy is now on one VPS — which is why the nightly off-box backup (see "Backups") went in the same day and is not optional.

**How it moved (no single-copy window).** `rclone copy` from S3 into `/data/archive-local` on the volume while ArchiveBox kept running (1.17 GB, 5,122 files, ~10 min); `rclone check` → 0 differences; index backup; stop container; final delta pass (0 new files); rename — not delete — the empty mountpoint dir aside and `archive-local` into place; start with `ARCHIVE_STORAGE=local`. Verified live: random existing snapshots served 200 via the public URL, and a fresh capture with 11/12 extractors succeeding was written to local disk. The Supabase copy was retired on 2026-09-18 once the B2 backup was hash-verified and a restore drill had passed: Supabase dropped from 1.30 GB to 134 MB (auto-archiver's output only, under the free tier), and `cap_add`/`devices`/`security_opt`/`rclone.env` came off the archivebox service. Verified afterwards: `CapAdd=[]`, no S3 credential in the container's environment, and a full 12/12-extractor capture. **Gotcha:** `rclone purge` fails against Supabase's S3 gateway (`received versions listing with IsTruncated set with no NextKeyMarker` — it calls the list-versions API, which Supabase doesn't implement, the same gap that rules it out as an immutable store); use `rclone delete <prefix> --fast-list` followed by `rclone rmdirs` instead.

**Gotcha — the entrypoint used to `find /data/archive -mindepth 1 -delete` on every boot.** Correct when `/data/archive` was only ever an empty mountpoint (rclone refuses to mount over a non-empty dir) — and it would have silently wiped the entire local archive the first time the container started in the wrong mode. The s3 branch now refuses to start if `/data/archive` holds more than a handful of entries, and the local branch never deletes anything. If you ever see `ERROR: ARCHIVE_STORAGE=s3 but /data/archive already holds N entries`, that guard is doing its job — do not "fix" it by clearing the directory.

S3 credentials live in `archivebox/rclone.env` (gitignored, `RCLONE_CONFIG_SB_*`; now only read in `ARCHIVE_STORAGE=s3` mode) and the auto-archiver `orchestration.yaml`. After editing those: `docker compose build archivebox && docker compose up -d archivebox archive-worker` locally, or `docker compose -f docker-compose.vps.yml build archivebox && docker compose -f docker-compose.vps.yml up -d archivebox archive-worker` on the VPS.

**TLS verification disabled (deliberate):** ArchiveBox runs with `CHECK_SSL_VALIDITY=False` (in `docker-compose.yml` + persisted in `ArchiveBox.conf`). Many Vietnamese gov/edu sources — the primary material here — serve broken/incomplete certificate chains, which otherwise fail the local capture with `CERTIFICATE_VERIFY_FAILED` (the Internet Archive copy still succeeds, but the local snapshot is empty). **Trade-off:** fetched content isn't authenticated against a verified cert, so a MITM'd connection can't be detected. We accept this for a public-document archiver; the WARC + content hashes still record exactly what was fetched. To re-enable verification, set `CHECK_SSL_VALIDITY=True` and `archivebox config --set CHECK_SSL_VALIDITY=True`. A capture that produces no content (e.g. a genuinely dead link) is reported `partial`/`failed` with no broken local link — only the public Wayback link is offered.

> `archive-worker` mounts the Docker socket to run the tools as sibling containers — it must run on the same Docker host as ArchiveBox (the VPS), never bundled into a serverless/edge API host.

**A stale Chrome profile lock silently kills every Chrome-backed extractor — cleared at startup since 2026-08-26.** Chromium writes `SingletonLock -> <hostname>-<pid>` into `CHROME_USER_DATA_DIR` while running and deletes it on a clean exit. Killing the container never gives it that chance, and the replacement container has a **different hostname**, so Chromium decides the profile is open "on another computer" and refuses to start — permanently, because nothing ever cleans it up.

The failure is nasty because it's silent and partial: `singlefile`/`pdf`/`screenshot`/`dom` all fail (and `title`/`readability`/`htmltotext` fail downstream of them), while `wget`/`mercury`/`media`/`favicon`/`headers` keep succeeding. Captures therefore look like they're working, and only show up as snapshots with **no title ("Pending…"), no screenshot, and a missing `singlefile.html`**. Diagnosed 2026-08-26 from a lock six days stale — `The profile appears to be in use by another Chromium process (13194) on another computer (196f2995ae14)` — which had broken 8 snapshots in the meantime. Note the generic per-extractor errors ("Failed to save screenshot", "SingleFile was not able to archive the page") say nothing useful; run the browser by hand against the real profile to see the actual reason:
```bash
docker exec --user=archivebox <archivebox-container> /usr/bin/chromium-browser \
  --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu \
  --user-data-dir=/data/chrome_profile --dump-dom https://example.com 2>&1 | head
```
`archivebox/archivebox-entrypoint.sh` now removes `SingletonLock`/`SingletonSocket`/`SingletonCookie` before ArchiveBox starts, logging what it cleared. Safe unconditionally: a brand-new container can't legitimately hold the profile yet. **Backgrounded captures make this much likelier** (see "Captures no longer block the HTTP request") — a capture now outlives its HTTP request, so any redeploy can land mid-Chrome; this project caused exactly that with a run of rapid rebuilds.

**SingleFile and the other Chrome extractors must not share a Chrome profile — it silently broke every PDF capture for two weeks.** SingleFile launches its *own* chromium through its node CLI (`extractors/singlefile.py` passes `chrome_args()` through as `--browser-args`). Pointed at the same `--user-data-dir` as the other extractors, it leaves the profile in a state that hangs the **next** chromium launch. `pdf` is the extractor that runs immediately after it, so `pdf` always absorbed the hit and failed on the full `TIMEOUT=180`, while `screenshot`/`dom` — which run later, once it clears — kept succeeding. That asymmetry is what made this look for a long time like a pdf-specific, page-specific, or ad/tracker problem; it is none of those.

Dates pin it exactly: `pdf` last succeeded **2026-08-05** and failed on **every** capture from **2026-08-12**, the day `CHROME_USER_DATA_DIR` was introduced (`60d6649`) and put singlefile on the shared profile for the first time. Before that, singlefile's puppeteer used its own temp profile and never collided. Proven by disabling singlefile for a single capture — `pdf` then succeeded in **1.1s**.

Fixed by giving SingleFile its own profile: `archivebox/Dockerfile` overrides `CHROME_USER_DATA_DIR` for that one extractor (`chrome_args()` merges its kwargs over `CHROME_OPTIONS`, so a single argument is enough), and `archivebox-entrypoint.sh` seeds `/data/chrome_profile_singlefile` from the real profile on first boot so it keeps the consent cookies. ~100 MB on the local volume, never on the S3 mount. Verified on a real vnexpress.net article: `singlefile succeeded 20.9s` **and** `pdf succeeded 143.2s` in the same capture, with every other extractor green.

Two debugging notes worth keeping, both of which cost real time here:
- **`archivebox add` on the CLI silently skips a URL already in the index** (`Found 0 new URLs not already in index`) — the re-add-as-new-snapshot behaviour only applies to `/add/` (see "Saving multiple snapshots of a single URL"). A "verification capture" that never ran will happily show you two-week-old `ArchiveResult` rows as if they were fresh. Always check `start_ts`.
- **Extractor error strings say nothing useful** ("Failed to save PDF", "SingleFile was not able to archive the page"). Run the browser by hand against the real profile instead — and redirect its output the same way ArchiveBox does, since `>/dev/null` hides pipe-related behaviour.

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
- **Used to 524 through Cloudflare — fixed 2026-08-20, see "Captures no longer block the HTTP request" below.** ArchiveBox 0.7.4 ran that crawl synchronously inside the HTTP request, so a JS-heavy page burning the full `TIMEOUT=180` (the `singlefile`/Chromium extractor alone can) sailed past Cloudflare's fixed ~100s edge timeout and always 524'd — even though the capture itself kept running and succeeded server-side. Captures are now started on a background thread and the response returns immediately, so this path can't time out regardless of how long the capture takes.
- **Used to mean the Wayback link never showed up in this app** (though it was always visible in ArchiveBox's own admin) — before `SAVE_ARCHIVE_DOT_ORG` got flipped back on (see "Archiving" above), only `archive-worker`-processed jobs got a Wayback submission at all.
  - **Fixed by a reconcile sweep** (`worker/reconcile.js`, runs every `RECONCILE_INTERVAL_MS` — default 5 min): it lists every successfully-captured URL in ArchiveBox's index, and for any URL with no `wayback_url` recorded anywhere in `archives`, copies over whatever ArchiveBox's own `archive_org` extractor already produced and inserts a `case_id: NULL` row (nullable by design — see `POST /api/archive` — for materials not tied to a specific case) so it shows up in this app's UI too. This is a safety net, not a replacement for submitting through the app — prefer `POST /api/archive` so materials get linked to their case.
- ArchiveBox 0.7.4's "Re-Snapshot" admin action also has an upstream race bug (`Snapshot.DoesNotExist` in `index/schema.py`'s `_asdict()`, surfaces as a `500` on `/admin/core/snapshot/`) — not something to patch here since it's vendored third-party code; just another reason to avoid using it.

**A literal `%` in a page-requisite's filename can never upload to Supabase Storage — no client-side fix exists.** Occasionally a captured page has a script/asset URL whose query string itself contains a URL-encoded value (e.g. `...?s=xxx%3Fc=yyy`), and wget preserves that literal `%` in the local filename. Confirmed by direct testing: Supabase's S3-compatible gateway rejects any object key containing `%` with `InvalidKey`/`400 Bad Request` — and rclone's usual workaround (`--s3-encoding` substituting a look-alike Unicode character for `%`) does **not** help, because Supabase's key validator still rejects the substitute (it appears to Unicode-normalize before validating). The rclone VFS write-back cache will retry an upload like this forever (every `--vfs-write-back` cycle) since it never succeeds — harmless (the file is a non-essential page-requisite; the actual article capture — html/warc/pdf/screenshot — is unaffected) but noisy. If `docker logs memorieslane-archivebox-1` is spammed with repeating `InvalidKey`/`BadRequest` for the same path, that's this — recreating the `archivebox` container (`docker compose -f docker-compose.vps.yml up -d archivebox`) clears the local retry cache (that file was never in S3 to begin with, so nothing is lost).

**VPS region vs. Supabase Storage region — known latency trade-off, deliberately kept, and it has now caused two real production incidents.** The VPS is in Frankfurt (OVH); the Supabase project's Postgres and Storage are genuinely in AWS `ap-northeast-1` (Tokyo) — confirmed via the DB pooler hostname (`aws-1-ap-northeast-1.pooler.supabase.com`), not just the `RCLONE_CONFIG_SB_REGION` label. Measured ~800ms time-to-first-byte from the VPS to Supabase Storage for a single small request; a snapshot with 100+ page-requisites pays that on every asset not already in ArchiveBox's local rclone read-cache (`--vfs-cache-mode full`, effectively unbounded — a snapshot viewed once stays fast on repeat views). Moving the VPS to OVH's Singapore region would meaningfully cut this (closer to both Tokyo and Vietnam) with no risk to archived data (unlike migrating the Supabase project itself, which has no in-place region move and would mean a full Postgres+Storage data migration). Evaluated 2026-08-12 and deliberately left as-is. Three concrete incidents since, all root-caused back to this same latency, all documented in detail below:
- 2026-08-13: a visitor in Taiwan got a 524 that nobody else could reproduce — turned out to be unrelated to their location entirely (see "A slow synchronous admin request can 524 a *different* visitor's request" below).
- 2026-08-14: the admin snapshot list itself became unloadable — a per-row S3 operation in ArchiveBox's own code that this latency makes prohibitively expensive at scale (see "The admin snapshot list can take up to ~35 minutes to render" below).
- 2026-08-17: the same per-row S3 operation, in a *second, independent* code path this project's own patch for the incident above never touched — the admin's "grid" view has its own hand-written template that calls the same expensive property directly (see "The admin snapshot grid view has its own copy of the same slow-size bug" below).

All three are fixed, but this is a trade-off that keeps having a real, user-facing cost, not a purely theoretical one anymore — worth weighing that against the migration effort next time it comes up.

**A slow synchronous admin request can 524 a *different* visitor's request, not just the one who submitted it.** Diagnosed 2026-08-13 from a report that one visitor (repeatably) got a 524 loading the plain site while nobody else — including from a Taiwan VPN, different browsers, incognito — could reproduce it. Root cause, confirmed via `cloudflared`'s own logs (`journalctl -u cloudflared`): someone submitted a slow `POST /add/` (the same synchronous-crawl issue described above); Cloudflare's edge gave up on that request after its ~100s timeout ("context canceled"), but ArchiveBox's Django dev server kept running it in the background regardless, unaware the client had disconnected. When it finally finished minutes later, its late response landed on an HTTP keep-alive connection `cloudflared` had already recycled for a *different, unrelated* request — logged as `Unsolicited response received on idle HTTP channel`. Whichever visitor's request happened to land on that poisoned connection next got a 524 with no slow action of their own. Not reproducible by retrying, since a retry almost always lands on a different, healthy pooled connection. Fixed by disabling connection reuse to this origin specifically, in the live (not git-tracked — see `cloudflared-config.yml`'s own note about being stale/reference-only) `/etc/cloudflared/config.yml` on the VPS:
```yaml
  - hostname: archivebox.heomay.xyz
    service: http://localhost:8000
    originRequest:
      keepAliveConnections: 0
```
Every request now gets a fresh connection to the origin, so a late/stuck response can't poison a connection a future unrelated request would reuse.

**The admin snapshot list can take up to ~35 minutes to render — fixed by removing the column that caused it.** Diagnosed and fixed 2026-08-14, a different mechanism than the incident above (that fix doesn't touch this at all). `SnapshotAdmin.size()` (ArchiveBox's own `core/admin.py`) runs a recursive directory-size walk over *every row's* archive folder for the list's "SIZE" column — and that folder lives on the S3-backed FUSE mount, so every uncached file stat pays the ~800ms Frankfurt↔Tokyo round trip above. Confirmed live and quantified via `archivebox manage shell`: **~52 seconds per snapshot on a cold cache** (261.85s measured for 5 snapshots). The cache backing this is process-memory-only (`LocMemCache`, wiped by every container restart) and keyed to invalidate on every `Snapshot.updated` change, so in practice it's cold often. With `SNAPSHOTS_PER_PAGE=40`, a fully-cold page render could take ~35 minutes — nowhere near viable against Cloudflare's ~100s edge timeout, and no amount of connection-level tuning (like the fix directly above) could have fixed this, since the origin itself is genuinely too slow to answer. Fixed in `archivebox/Dockerfile` by dropping `size` from `SnapshotAdmin.list_display` at build time (a guarded `sed` patch against ArchiveBox's vendored `core/admin.py` — fails the build loudly if the exact line ever changes upstream, rather than silently no-op'ing). Confirmed live: the recurring `context canceled` errors on `/admin/core/snapshot/` (a different error than the one above, but same generic cause -- Cloudflare gave up waiting) stopped immediately after deploy.

**The admin snapshot *grid* view has its own copy of the same slow-size bug — the `list_display` fix above never touched it.** Diagnosed and fixed 2026-08-17. `SnapshotAdmin.grid_view` (the card layout with thumbnails, at `/admin/core/snapshot/grid/`) renders its own hand-written template, `templates/admin/snapshots_grid.html`, which calls `{{ obj.archive_size | file_size }}` directly for every card — this is a separate, from-scratch template, not Django's normal changelist column rendering, so it was never affected by removing `size` from `list_display`. Same root cause as the incident directly above (the same `archive_size` property's recursive walk over the S3-mounted archive folder), just a third distinct code path reaching it — confirmed via `cloudflared` logs: `context canceled` on `.../admin/core/snapshot/grid/` specifically, not `/admin/core/snapshot/`. Fixed the same way, in `archivebox/Dockerfile`: a guarded `sed` patch deletes that one line from the vendored template (fails the build loudly if the exact line ever changes upstream). Verified live post-fix with Django's own test client (`Client(SERVER_NAME='localhost')`, `force_login`, timed) rather than just "container didn't crash": the grid view went from what would have been the same ~52s/snapshot cost down to **4.44s total** for a full authenticated render, and `cloudflared` logged zero repeat errors afterward. Worth checking for a fourth copy of this same bug if any other custom admin view/template in `core/admin.py` is ever added — `archive_size` is the recurring trap, not any one specific view.

**Saving multiple snapshots of a single URL — enabled for the Add form and the browser extension, 2026-08-20.** ArchiveBox keeps one Snapshot per unique *URL string*, and this deployment runs `ONLY_NEW=True`, so re-adding a URL already in the index silently did nothing. The only way 0.7.4 stores several snapshots of one page is to make the URL string distinct, which is what its own **Re-Snapshot** admin action does (`url.split('#')[0] + f'#{timestamp}'` in `SnapshotAdmin.resnapshot_snapshot`) — that action already worked, but only *after the fact*, from the Snapshots changelist.

`archivebox/views_nonblocking.py` now applies the same trick at capture time (`_ml_resnapshot_existing`), so re-adding a page from the Add form **or the browser extension** saves a new, separate snapshot instead of doing nothing — the point being to capture how a page changes over time (edits, corrections, takedowns), which is the whole reason this archive exists. Two deliberate limits:
- **Only URLs already in the index get a fragment.** A first-time capture is stored under the clean canonical URL, because `archive-worker` resolves snapshots with `list --filter-type=exact <url>` (`worker/archivers/archivebox.js`) and fragment-suffixing every capture would break those exact matches.
- **Only bare `http(s)` lines are rewritten.** The Add form's `url` field is a textarea that may hold several URLs or a pasted blob for another parser, so anything that isn't plainly a URL passes through untouched rather than risk corrupting it.

Cost to be aware of: every repeat capture is a full extra snapshot in Supabase Storage (a news article runs ~6 MB), so re-adding the same page repeatedly does grow the bucket. Verified live: re-adding an already-archived URL produced a second coexisting snapshot (`…/protocols` and `…/protocols#2026-08-20T10:42:54+00:00`) instead of being skipped.

**Captures no longer block the HTTP request — the root fix for 524, 2026-08-20.** The three fixes above each made a slow *read* fast. This one addresses the remaining class, slow *writes*, which can't be made fast enough: no real capture is ever guaranteed to finish inside Cloudflare's ~100s edge timeout (`TIMEOUT=180` × ~12 extractors), so any endpoint that waits for one will 524 by construction. Six endpoints did: `AddView.form_valid` in `core/views.py` (backing `/add/` — used by both the admin's Add form and the **browser extension**, and the target `/admin/core/snapshot/add/` redirects to), plus the Snapshot changelist's Pull / ⬇️ Title / Re-Snapshot / Reset / Delete bulk actions in `core/admin.py` (Delete included: removing many snapshots means one `rm` per archived file across the S3-backed mount).

Fixed by running each on a background thread and returning the response immediately (`archivebox/ml_background.py` + the two appended patches `views_nonblocking.py` / `admin_nonblocking.py`, applied in `archivebox/Dockerfile`). Threads rather than subprocesses because Django's dev server is already threaded and ArchiveBox's own CLI already writes to the same SQLite index concurrently with the server (that's how `archive-worker` has always worked), so it adds no new concurrency risk; each task closes its Django DB connection on the way out so a long-lived server doesn't leak one per action. The patches are *appended* to the vendored files rather than `sed`'d into their middles — appending runs after the target classes are fully defined, so each is a plain monkeypatch — and each is guarded on the exact upstream call sites it depends on plus an `ast.parse` of the result, so an upstream change breaks the build loudly instead of silently shipping a no-op.

Verified live: `POST /add/` went from **26.16s → 0.06s** (and that 26s was a *fast* page; heavy ones ran for minutes), with the capture confirmed to still run and produce its snapshot afterwards. All admin read pages measured under 0.5s, and `cloudflared` logged zero `context canceled`/`unsolicited response` errors afterwards. **Tradeoff, deliberate:** the Add page can no longer stream the capture's stdout, since the response is sent before the work starts — progress goes to `docker logs -f memorieslane-archivebox-1` instead, and the Snapshots list shows the result when it lands. Note this only removes the *timeout*; a background capture that fails still fails, and nothing retries it.

**Attempted upgrade to 0.9.x (2026-08-19/20) — rolled back to 0.7.4, Chrome-dependent capture is unreliable on that RC line.** Tried for the new admin UI (Crawls/Machines/Workers/Plugins/Personas dashboard). Real progress made and preserved on the `archivebox-0.9x-upgrade-wip` git branch (not merged): migration worked cleanly, the plaintext-password bug turned out to already be fixed upstream (`CustomUserAdmin`, same fix this project made independently), the grid-view S3-walk bug above is also genuinely fixed upstream (`archive_size` now wraps a persisted `output_size` column), and the Wayback SPN2 authenticated-submission fix was fully ported to the new `abx-plugins` extractor architecture (stock 0.9.x still uses the same broken unauthenticated endpoint 0.7.4 did).

Blocked on Chrome itself. Confirmed by direct reproduction, not guesswork: Chrome's bundled crashpad handler crashes intermittently (`chrome_crashpad_handler: --database is required`, SIGABRT/SIGTRAP) on every 0.9.x RC tested, including the newest available (`0.9.35rc302`, ~100 releases past the first one tried). Proven unrelated to this project's S3-FUSE storage (crashes identically against a plain local directory) and not fixable by any Chrome flag tried (`--disable-crash-reporter`, legacy `--headless`, `--disable-features=Crashpad`). Worse than just intermittent: even when the hook's own internal retry recovers from the crash, downstream per-snapshot hooks (browser extensions like `ublock`, `istilldontcareaboutcookies`) can't find the resulting Chrome session — confirmed not specific to any one extension, and unaffected by `CHROME_ISOLATION=snapshot` vs the default `crawl`. Failed crawls also don't transition out of `started` status, so the admin UI shows a permanently-stuck "waiting for Chrome" message for a process that already died.

**A rollback surfaced a second, independent problem: the shared `index.sqlite3` doesn't roll back with the container image.** 0.9.x's migrations had already restructured `core_snapshot` (new `crawls_id`/`status`/`config`/`output_size` columns, `added` split into `bookmarked_at`/`created_at`/`modified_at`) — reverting to the 0.7.4 image just made every query crash with `no such column: core_snapshot.added`, since the physical schema had moved on even though 0.7.4's own migration bookkeeping still thought everything was fine (it doesn't know about 0.9.x's tables/migrations at all). No backup existed to restore from (see "Backups" above — this is what surfaced that gap). Recovered via `archivebox init --force` after quarantining every 0.9.x-only artifact 0.9.x had left in the data volume (`machines/`, `personas/`, `sonic/`, `tmp/`, a stray Chrome core-dump file) — it rescanned `archive/` directly and rebuilt a fresh, correct index from the real content (real archived data lives in S3, not the index, so nothing was actually lost), recovering all pre-existing snapshots. This also wipes every `auth_user` row (the index is where ArchiveBox's own users live, separate from this app's Supabase-backed accounts) — recreate any ArchiveBox admin accounts afterward via `archivebox manage shell`/`changepassword`, never the admin UI's user form (see "Never add/edit users..." above).

Revisit the branch once ArchiveBox cuts an actual stable release past this RC line, or a future RC's changelog specifically mentions a Chrome/crashpad fix — check `archivebox/archivedotorg_spn2.py`'s and `archivebox/Dockerfile`'s comments on that branch for exactly what to re-verify (plugin filename prefixes and `list --json`'s output shape both already drifted once between the two RCs tried).

**"Snapshot exists in DB, but resource `<ts>/index.html` does not exist in snapshot dir yet" — now self-heals, 2026-08-24.** A snapshot folder's `index.html` is **not** captured content: ArchiveBox generates it itself (`write_link_details`, `index/__init__.py`) at the very end of a capture, entirely from data already in the DB. So it can go missing while every archived artifact is perfectly intact — the snapshot just 404s with that message and looks lost when nothing actually is. Two ways it happens here:
- **An index rebuilt from folder contents.** `archivebox init --force` (the 0.9.x rollback recovery above) restores the DB rows by scanning `archive/`, but does *not* regenerate these per-snapshot pages. That silently broke 5 of 22 snapshots — exactly the ones its own output had flagged as `Skipped adding 23 invalid link data directories`.
- **A capture interrupted before that final write.** Captures now run on a background thread (see "Captures no longer block the HTTP request"), so redeploying the container mid-capture can leave a snapshot without one.

`archivebox/views_nonblocking.py` now patches `SnapshotView.get` to rebuild the page on demand: on a 404 for a path ending in `/index.html`, it regenerates via `write_link_details` and retries once. Deliberately lazy rather than a scheduled scan of every snapshot folder — that S3-mounted walk is exactly what caused this project's 524 incidents — so it costs nothing on the normal path, only running after a 404 that would otherwise have been a dead end. It only ever regenerates ArchiveBox's *own* page: a genuinely missing capture artifact (`screenshot.png`, `warc/`, …) still returns the honest error rather than being fabricated, and a snapshot with no directory at all is left alone. Verified by deleting a live `index.html` and re-requesting it: HTTP 200 with the real page, file restored on disk, `[+] regenerated missing index.html for snapshot …` in the log.

To repair in bulk without waiting for someone to hit each one (e.g. straight after an `init --force`), call the same function directly for every affected snapshot:
```bash
docker exec -i --user=archivebox <archivebox-container> archivebox manage shell <<'EOF'
import os
from core.models import Snapshot
from index import write_link_details
for s in Snapshot.objects.all():
    d = "/data/archive/" + s.timestamp
    if os.path.isdir(d) and not os.path.exists(d + "/index.html"):
        write_link_details(s.as_link(), out_dir=d, skip_sql_index=True)
        print("regenerated", s.timestamp)
EOF
```

## Deploy

**Frontend (Cloudflare Pages)** — static, no build. Connect the repo: build command empty, output dir `/`. Set env var `BACKEND_URL` to `https://archivebox-api.heomay.xyz`. `functions/api/[[route]].js` proxies `/api/*` there automatically.

**Backend + ArchiveBox + archive-worker + NocoDB (VPS, permanent)** — all four deployed together via `docker-compose.vps.yml`, each with `restart: unless-stopped` so they survive a VPS reboot unattended. (The backend previously ran on Railway; it moved here after the Railway trial ended — no code changes were needed, since all data already lived in Supabase and the Dockerfile/env vars carried straight over.)

`deploy-vps.sh` in this repo automates steps 3–4 below (build/start the stack, wait for the backend health check, validate + wire up the Cloudflare Tunnel ingress rules for both `archivebox-api` and `data`, restart `cloudflared`, verify end-to-end) — run `TUNNEL=archivebox-vps ./deploy-vps.sh` from the repo root on the VPS after step 1–2. It pauses and opens `$EDITOR` for the one manual edit (adding the ingress block to `cloudflared`'s `config.yml`) rather than rewriting that file programmatically, since a round-tripped YAML dump would strip your comments and risks breaking the live tunnel.

1. Copy `backend/`, `archivebox/`, `worker/`, `nocodb/`, `backend/.env`, `nocodb/nocodb.env` (from `nocodb/nocodb.env.example`), and `archivebox/rclone.env` to the VPS (same relative layout as this repo).
2. In `backend/.env`, make sure `ALLOWED_ORIGINS` is set to the real frontend origin (`https://memorylane101.pages.dev`, **no trailing slash** — browsers never send one in the `Origin` header, so a trailing slash here silently breaks CORS for every real request), not `null`. The backend also refuses to start in production if it's `null`.
3. `docker compose -f docker-compose.vps.yml up -d --build`
4. Every service (`backend` on `3001`, `archivebox` on `8000`, `nocodb` on `8090`) is bound to `127.0.0.1` only — never exposed on the VPS's public IP directly. Each is reached via its own hostname on the VPS's permanent [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), currently named **`archivebox-vps`** (`5552ec4f-50d0-40f4-8d72-ceff0bec9fe4` — confirm with `cloudflared tunnel list` on the VPS, as this can change), installed as a systemd service (`cloudflared service install`) so it auto-starts on boot:
   - `archivebox.heomay.xyz` → `localhost:8000`
   - `archivebox-api.heomay.xyz` → `localhost:3001`
   - `memorylanedb.heomay.xyz` → `localhost:8090` (NocoDB; additionally gated by Cloudflare Access — see "Content manager UI — NocoDB")

   Add each new ingress rule to the tunnel's `config.yml` on the VPS (see `cloudflared-config.yml` in this repo for the ingress block shape — **not** its `tunnel:`/`credentials-file:` lines, which belong to the old, now-unused `memorylane` laptop tunnel), run `cloudflared tunnel route dns archivebox-vps <hostname>` once per hostname to create the DNS record, then `sudo systemctl restart cloudflared`. Quick tunnels (`--url`) get a new URL each restart, so they're dev-only — this project uses a named tunnel specifically so both URLs are permanent.
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
