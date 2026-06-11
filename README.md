# Miền Ký Ức — MemoriesLane

A collective, anonymous civic memory archive. People pin stories to a map of Vietnamese cities, documenting lived experiences around urban restructuring and displacement (2026–2045 relocation zone proposals).

**Stack:** Leaflet · React 18 (UMD, no build step) · Express · SQLite · NocoDB · Cloudflare Pages + Tunnel

---

## Contents

- [Project structure](#project-structure)
- [Run locally with Docker](#run-locally-with-docker)
- [Admin panel — NocoDB](#admin-panel--nocodb)
- [Moderation API](#moderation-api)
- [Deploy: frontend on Cloudflare Pages](#deploy-frontend-on-cloudflare-pages)
- [Expose local backend to the internet (Cloudflare Tunnel)](#expose-local-backend-to-the-internet)
- [Alternative: deploy backend to Koyeb (free, no CC)](#alternative-backend-on-koyeb)
- [Environment variables reference](#environment-variables-reference)
- [Data privacy](#data-privacy)

---

## Project structure

```
MemoriesLane/
├── index.html              ← entry point; all CSS lives here
├── app/
│   ├── app.jsx             ← root component, all state, API calls
│   ├── map.jsx             ← Leaflet map, markers, spatial drawing
│   ├── compose.jsx         ← anonymous submission flow
│   ├── memory.jsx          ← memory reading dock + about modal
│   ├── research.jsx        ← advanced search (Boolean, spatial, facets)
│   ├── export.jsx          ← HTML report + CSV / JSON / GeoJSON export
│   ├── tweaks-panel.jsx    ← design-token playground
│   └── data.jsx            ← seed memories, i18n strings, utilities
├── backend/
│   ├── server.js           ← Express app
│   ├── db.js               ← SQLite schema + prepared statements
│   ├── middleware/
│   │   ├── auth.js         ← admin Bearer token (SHA-256 hash check)
│   │   ├── rate-limit.js   ← IP-free HMAC rate limiting
│   │   └── sanitize.js     ← input validation + HTML stripping
│   ├── routes/
│   │   ├── memories.js     ← public submit + read API
│   │   └── moderate.js     ← authenticated moderation queue
│   ├── scripts/
│   │   └── setup-admin.js  ← one-time secret generator
│   ├── Dockerfile
│   ├── .env.example
│   └── package.json
├── functions/
│   └── api/[[route]].js    ← Cloudflare Pages Function: proxies /api/* → backend
├── docker-compose.yml      ← frontend (nginx) + backend + NocoDB admin
├── nginx.conf              ← proxies /api/* to backend container
├── cloudflared-config.yml  ← named tunnel config (fill in tunnel ID + domain)
└── .gitignore
```

---

## Run locally with Docker

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### Step 1 — Generate secrets (one time only)

```bash
cd backend
npm install
node scripts/setup-admin.js
```

Output:
```
ADMIN_TOKEN_HASH=abc123...
RATE_HMAC_SECRET=def456...

Admin Bearer token: 9f3a2b...   ← save this in your password manager
```

### Step 2 — Create the backend .env

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and paste in the two generated values. Leave everything else as-is for local dev.

### Step 3 — Start everything

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:3001/api/memories |
| NocoDB admin | http://localhost:8081 |

First run builds the backend image (~2 min). Subsequent starts take a few seconds.

The SQLite database is stored in the `memorylane-data` Docker volume at `/data/memories.db` and survives restarts.

### Stop / reset

```bash
docker compose down          # stop containers, keep data
docker compose down -v       # stop containers AND delete all saved memories
```

---

## Admin panel — NocoDB

NocoDB provides a spreadsheet UI over the SQLite database. Use it to browse submissions, bulk-edit rows, approve memories, add notes, and run queries — no SQL needed.

### First-time setup

1. Open **http://localhost:8081**
2. Create one account (signup is locked after the first account via `NC_INVITE_ONLY_SIGNUP`)
3. **New Base → SQLite → File path:** `/data/memories.db` → Test → Save

### Useful views to create

| View | Filter |
|------|--------|
| Pending queue | `approved = 0` AND `rejected = 0` |
| Approved | `approved = 1` |
| Rejected | `rejected = 1` |

To approve a submission: find the row, set `approved` to `1`. It immediately appears on the live map.

### Invite teammates to NocoDB

From inside NocoDB: **Settings → Team & Auth → Invite** — teammates receive an email link; they do not go through the public signup page.

---

## Moderation API

For scripted or bulk operations, the moderation endpoints are also available directly:

```bash
# List pending submissions (up to 50)
curl -H "Authorization: Bearer YOUR_RAW_TOKEN" \
  http://localhost:3001/api/moderate/queue

# Approve
curl -X POST -H "Authorization: Bearer YOUR_RAW_TOKEN" \
  http://localhost:3001/api/moderate/<id>/approve

# Reject with a reason
curl -X POST -H "Authorization: Bearer YOUR_RAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"off-topic"}' \
  http://localhost:3001/api/moderate/<id>/reject
```

---

## Deploy: frontend on Cloudflare Pages

The frontend is static files — no build step. CF Pages hosts it for free and redeploys on every push to `main`.

1. Push the repo to GitHub
2. Go to [pages.cloudflare.com](https://pages.cloudflare.com) → **New project → Connect to Git**
3. Select this repository
4. Build settings:
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
5. **Environment variables:**

   | Key | Value |
   |-----|-------|
   | `BACKEND_URL` | your backend's public URL (tunnel or hosted) |

6. Deploy → you get a `*.pages.dev` URL

The `functions/api/[[route]].js` file is picked up automatically by CF Pages and proxies all `/api/*` requests to `BACKEND_URL`. The frontend code never changes — it always calls `/api/memories` as a relative path.

---

## Expose local backend to the internet

Run the backend on your own machine and expose it via **Cloudflare Tunnel** — free, no credit card, no cloud server.

### Prerequisites

Download `cloudflared.exe` into the project root:
```powershell
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe"
```

### Quick tunnels (temporary URLs, change on restart)

Open two PowerShell terminals in the project folder:

```powershell
# Terminal 1 — backend API
.\cloudflared.exe tunnel --url http://localhost:3001 --loglevel warn

# Terminal 2 — NocoDB admin
.\cloudflared.exe tunnel --url http://localhost:8081 --loglevel warn
```

Each prints a `https://*.trycloudflare.com` URL. Set the backend URL as `BACKEND_URL` in CF Pages and redeploy. Share the NocoDB URL with your team.

### Named tunnels (permanent URLs, requires a domain on Cloudflare)

```powershell
# One-time setup
.\cloudflared.exe tunnel login
.\cloudflared.exe tunnel create memorylane
# Copy the tunnel ID from the output

.\cloudflared.exe tunnel route dns memorylane api.yourdomain.com
.\cloudflared.exe tunnel route dns memorylane admin.yourdomain.com
```

Edit `cloudflared-config.yml` — replace `<TUNNEL_ID>` and `yourdomain.com`, then:

```powershell
# Run tunnel
.\cloudflared.exe tunnel --config cloudflared-config.yml run

# Or install as a Windows service (auto-starts on boot) — run as Administrator
.\cloudflared.exe service install --config C:\path\to\cloudflared-config.yml
Start-Service cloudflared
```

Set `BACKEND_URL=https://api.yourdomain.com` in CF Pages and redeploy.

---

## Alternative: backend on Koyeb

If you want the backend fully cloud-hosted (no local machine required) without a credit card:

1. Sign up at [koyeb.com](https://koyeb.com) — no CC required
2. **New App → GitHub** → select this repo
3. Settings:
   - **Builder:** Buildpack
   - **Working directory:** `backend`
   - **Run command:** `node server.js`
   - **Port:** `3001`
4. Environment variables:

   | Key | Value |
   |-----|-------|
   | `NODE_ENV` | `production` |
   | `BIND_ADDR` | `0.0.0.0` |
   | `RATE_HMAC_SECRET` | from `node scripts/setup-admin.js` |
   | `ADMIN_TOKEN_HASH` | from `node scripts/setup-admin.js` |
   | `ALLOWED_ORIGINS` | your `*.pages.dev` URL |

5. Deploy → set the `*.koyeb.app` URL as `BACKEND_URL` in CF Pages

> **Note:** Koyeb free tier has no persistent volume. The SQLite DB resets on redeploy. The app falls back to the 22 built-in seed memories automatically. For persistent storage, add a Koyeb volume or migrate to Turso (free SQLite-over-HTTP).

---

## Environment variables reference

All variables go in `backend/.env` (local) or the hosting provider's dashboard (production).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Port the API listens on |
| `BIND_ADDR` | No | `127.0.0.1` | Set to `0.0.0.0` in Docker or any cloud host |
| `NODE_ENV` | No | `development` | Set to `production` when deployed |
| `ALLOWED_ORIGINS` | Yes | `null` | Comma-separated CORS origins. Use `null` for local `file://` dev. Set to your CF Pages URL in production. |
| `RATE_HMAC_SECRET` | Yes | — | Random 32-byte hex. Derives rate-limit tokens from IPs without storing IPs. Rotate every 30 days. |
| `ADMIN_TOKEN_HASH` | Yes | — | SHA-256 hash of your admin Bearer token. The raw token is never stored. |
| `DB_PATH` | No | `./memories.db` | SQLite path. Set to `/data/memories.db` in Docker. |
| `UPLOADS_DIR` | No | `./uploads` | Photo storage dir. Set to `/data/uploads` in Docker. |

Generate `RATE_HMAC_SECRET` and `ADMIN_TOKEN_HASH` in one step:

```bash
cd backend && node scripts/setup-admin.js
```

---

## Data privacy

**Submitted memories are never visible from GitHub.**

| What GitHub stores | Safe? |
|--------------------|-------|
| `app/*.jsx` — UI code + 22 seed memories (public domain content) | ✅ |
| `backend/*.js` — API logic | ✅ |
| `backend/.env.example` — placeholder values only | ✅ |

| What `.gitignore` blocks | Contains |
|--------------------------|----------|
| `backend/.env` | Real secrets (`ADMIN_TOKEN_HASH`, `RATE_HMAC_SECRET`) |
| `backend/*.db` | Every submitted memory |
| `backend/uploads/` | All uploaded photos |

**Moderation gate:** `GET /api/memories` returns only memories with `approved = 1`. Submissions sit in the pending queue, invisible to everyone except a moderator with the admin token, until explicitly approved.

**Photo privacy:** EXIF metadata (GPS, device model, timestamp) is stripped server-side via `sharp` before any image is stored. The image content is public once approved.

**Check for accidental .env commits:**

```bash
git log --all --full-history -- backend/.env
```

If this returns any output, rotate your secrets immediately with `node scripts/setup-admin.js` and update all environment variable settings.
