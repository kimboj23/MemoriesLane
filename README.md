# Miền Ký Ức — memorylane

A collective, anonymous civic memory archive. People pin stories to a map of Vietnamese cities, documenting lived experiences around urban restructuring and displacement (2026–2045 relocation zone proposals).

Built with Leaflet, React 18, and Express/SQLite. No build step — the frontend is plain HTML + JSX loaded via CDN.

---

## Contents

- [How the project is structured](#project-structure)
- [Option A — Open the frontend directly (no install)](#option-a--open-the-frontend-directly)
- [Option B — Run everything locally with Docker](#option-b--run-everything-locally-with-docker)
- [Option C — Run the backend only (no Docker)](#option-c--run-the-backend-only-no-docker)
- [Deploy Track 1 — Frontend on Cloudflare Pages](#deploy-track-1--frontend-on-cloudflare-pages)
- [Deploy Track 2 — Backend on Railway](#deploy-track-2--backend-on-railway)
- [Open-source & data privacy](#open-source--data-privacy)
- [Environment variables reference](#environment-variables-reference)

---

## Project structure

```
memorylane/
├── index.html          ← entry point (same file as memorylane.html)
├── memorylane.html   ← original file, kept for reference
├── app/
│   ├── data.jsx        ← seed memories, i18n strings, utilities
│   ├── map.jsx         ← Leaflet map, markers, drawing
│   ├── compose.jsx     ← anonymous submission flow
│   ├── memory.jsx      ← memory reading dock + about modal
│   ├── research.jsx    ← advanced search (Boolean query, spatial filters)
│   ├── export.jsx      ← data export: HTML report + CSV/JSON/GeoJSON
│   ├── tweaks-panel.jsx← design-token playground (dev only)
│   └── app.jsx         ← root component, all state
├── backend/
│   ├── server.js       ← Express app
│   ├── db.js           ← SQLite schema + prepared statements
│   ├── middleware/
│   │   ├── auth.js     ← admin Bearer token verification
│   │   ├── rate-limit.js ← IP-free rate limiting
│   │   └── sanitize.js ← input validation
│   ├── routes/
│   │   ├── memories.js ← public submit + read API
│   │   └── moderate.js ← authenticated moderation queue
│   ├── scripts/
│   │   └── setup-admin.js ← one-time secret generator
│   ├── Dockerfile
│   ├── .env.example    ← copy to .env, never commit .env
│   └── package.json
├── docker-compose.yml  ← runs frontend + backend together locally
├── nginx.conf          ← used by docker-compose frontend service
└── .gitignore          ← ensures .env, *.db, uploads/ are never committed
```

---

## Option A — Open the frontend directly

No install, no server. The app ships 37 seed memories and all features work in-browser. Submitted memories only persist for the current tab session.

```
Double-click index.html   (Windows / macOS)
```

or drag it into any browser. That's it.

---

## Option B — Run everything locally with Docker

This runs the frontend (nginx) and backend (Node + SQLite) together. Submitted memories are saved to a Docker volume and survive restarts.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### Step 1 — Generate secrets (one time only)

```bash
cd backend
npm install
node scripts/setup-admin.js
```

You will see output like:

```
ADMIN_TOKEN_HASH=abc123...
RATE_HMAC_SECRET=def456...

Admin Bearer token: 9f3a2b...   ← save this in your password manager
```

### Step 2 — Create the backend .env file

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and paste in the two values from the previous step:

```
ADMIN_TOKEN_HASH=abc123...   ← the hash, not the token
RATE_HMAC_SECRET=def456...
```

Leave all other values as-is for local development.

### Step 3 — Start everything

```bash
docker-compose up --build
```

First run pulls images and builds the backend container (~2 min). Subsequent starts take a few seconds.

- **Frontend → [http://localhost:8080](http://localhost:8080)**
- **Backend API → [http://localhost:3001](http://localhost:3001)**

### Moderation (reviewing submitted memories)

Use any HTTP client (curl, Bruno, Postman) with the raw admin token:

```bash
# List pending submissions
curl -H "Authorization: Bearer YOUR_RAW_TOKEN" http://localhost:3001/api/moderate/queue

# Approve one
curl -X POST -H "Authorization: Bearer YOUR_RAW_TOKEN" \
  http://localhost:3001/api/moderate/MEMORY_ID/approve

# Reject with a reason
curl -X POST -H "Authorization: Bearer YOUR_RAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"off-topic"}' \
  http://localhost:3001/api/moderate/MEMORY_ID/reject
```

### Stopping and data

```bash
docker-compose down          # stops containers, keeps data volume
docker-compose down -v       # stops containers AND deletes all saved memories
```

---

## Option C — Run the backend only (no Docker)

If you want to run just the API with Node.js directly:

```bash
cd backend
npm install
node scripts/setup-admin.js   # if you haven't yet
cp .env.example .env          # then fill in the two generated values
npm run dev
```

The API listens on `http://localhost:3001`. Open `index.html` separately in your browser.

---

## Deploy Track 1 — Frontend on Cloudflare Pages

The frontend is static files — no build step, no server needed. Cloudflare Pages hosts it for free and gives your team a public URL in about 30 seconds.

### Step 1 — Push to GitHub

If you haven't already, create a new repository on [github.com](https://github.com/new), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/memorylane.git
git push -u origin main
```

### Step 2 — Connect to Cloudflare Pages

1. Go to [pages.cloudflare.com](https://pages.cloudflare.com) and log in (free account)
2. Click **Create a project** → **Connect to Git**
3. Select your GitHub repository
4. On the build settings screen:
   - **Build command** — leave empty (no build needed)
   - **Build output directory** — type `/` (just a forward slash — the repo root)
5. Click **Save and Deploy**

Cloudflare Pages gives you a URL like `https://memorylane-abc.pages.dev`.

Every time you push to `main`, Cloudflare redeploys automatically.

> **What the team sees**: the full map with all 37 seed memories, the submission form, bilingual UI, research mode with spatial drawing and Boolean queries, and the data export. Submitted memories only live in the browser tab — they vanish on refresh. This is the right scope for reviewing the UI before wiring up the backend.

---

## Deploy Track 2 — Backend on Railway

Railway runs Docker containers with persistent storage for free ($5/month credit, which covers a small Node app at near-zero cost).

### Step 1 — Commit the Docker setup

```bash
git add backend/Dockerfile docker-compose.yml nginx.conf README.md
git commit -m "Add Docker and deployment config"
git push
```

### Step 2 — Create a Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your repository
3. Railway will ask for a **Root Directory** — type `backend`
4. It will detect the `Dockerfile` automatically

### Step 3 — Add a persistent volume

Without this step, the SQLite database resets every time Railway redeploys.

1. In your Railway project, click on the service
2. Go to **Settings** → **Volumes** → **Add Volume**
3. Set the **Mount Path** to `/data`

### Step 4 — Set environment variables

In Railway → **Variables** tab, add these one by one:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://memorylane-abc.pages.dev` (your Cloudflare URL) |
| `ADMIN_TOKEN_HASH` | The hash from `node scripts/setup-admin.js` |
| `RATE_HMAC_SECRET` | The secret from `node scripts/setup-admin.js` |

> Run `node scripts/setup-admin.js` locally if you need fresh values. Store the raw admin token in your password manager — it never goes into Railway or GitHub.

### Step 5 — Get your Railway URL

Railway gives you a public URL like `https://memorylane-production.up.railway.app`. You can verify the backend is running by visiting `/health` in a browser.

> **Note**: The frontend is not yet wired to call the backend API — submitted memories still only live in-browser. Wiring up the API is the next development step (a ~5 line change in `app/app.jsx`).

---

## Open-source & data privacy

**Short answer: No, people cannot see submitted memories from GitHub.**

Here is exactly why, layer by layer.

### What GitHub stores (and is fine to be public)

| File | Contains | Safe? |
|------|----------|-------|
| All `app/*.jsx` files | UI code, 37 seed memories (publicly known) | ✅ Intended |
| `backend/*.js` | API code, validation logic | ✅ Intended |
| `backend/.env.example` | Placeholder values only, no real secrets | ✅ Safe |
| `backend/package.json` | Dependency list | ✅ Safe |

### What GitHub never sees (blocked by .gitignore)

| Path | Contains |
|------|----------|
| `backend/.env` | Your real `ADMIN_TOKEN_HASH` and `RATE_HMAC_SECRET` |
| `backend/memories.db` | Every submitted memory |
| `backend/uploads/` | All uploaded photos |

### What the public API exposes (and is intentional)

The deployed backend has one unauthenticated endpoint: `GET /api/memories`. It returns only memories that a moderator has explicitly approved. Unreviewed submissions are invisible to everyone except a moderator holding the admin token.

This means:
- A user who submits a sensitive memory is not exposed until a human moderator decides it is safe to publish
- Anyone on the internet can read approved memories — that is by design for an open archive
- The moderation queue (`GET /api/moderate/queue`) requires the admin Bearer token, which only exists in Railway's environment variables and your password manager

### The one real risk: accidentally committing .env

If `backend/.env` was ever committed before the `.gitignore` was in place, the secrets would be in git history. Check this now:

```bash
git log --all --full-history -- backend/.env
```

If that command returns nothing, you are clean. If it returns any commits, rotate your secrets immediately by running `node scripts/setup-admin.js` again and updating Railway's Variables tab.

GitHub's [secret scanning](https://docs.github.com/en/code-security/secret-scanning) will also alert you automatically if a token pattern is detected in a push.

### Photo privacy after approval

EXIF metadata (GPS coordinates, device model, capture timestamp) is stripped server-side before any image is stored. The image *content* is public once approved. Advise contributors not to photograph things that would identify their home address, face, or anyone else's — the photo appears on the map.

---

## Environment variables reference

All variables live in `backend/.env` (local) or Railway's Variables tab (production).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Port the API listens on |
| `BIND_ADDR` | No | `127.0.0.1` | Set to `0.0.0.0` inside Docker |
| `NODE_ENV` | No | `development` | Set to `production` on Railway |
| `ALLOWED_ORIGINS` | Yes | `null` | Comma-separated list of allowed CORS origins. Use `null` for file:// in local dev. Set to your Cloudflare URL in production. |
| `RATE_HMAC_SECRET` | Yes | — | Random 32-byte hex string. Used to derive rate-limit pseudonyms from IPs without storing IPs. Rotate every 30 days. |
| `ADMIN_TOKEN_HASH` | Yes | — | SHA-256 hash of your admin Bearer token. The raw token is never stored anywhere. |
| `DB_PATH` | No | `./memories.db` | SQLite database file path. Set to `/data/memories.db` in Docker/Railway. |
| `UPLOADS_DIR` | No | `./uploads` | Directory for EXIF-stripped photos. Set to `/data/uploads` in Docker/Railway. |

Generate `RATE_HMAC_SECRET` and `ADMIN_TOKEN_HASH` together:

```bash
cd backend && node scripts/setup-admin.js
```
