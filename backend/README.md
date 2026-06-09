# MemoriesLane — Backend

A minimal Express/SQLite API for the civic memory archive. Designed around anonymity as a first-class constraint.

## Quick start

```bash
cd backend
npm install
node scripts/setup-admin.js   # generates .env values
cp .env.example .env          # edit with the values above
npm run dev
```

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/memories` | — | Submit a memory (→ pending queue) |
| `GET` | `/api/memories` | — | List approved memories (`?city=hanoi&minYear=2020&maxYear=2026`) |
| `GET` | `/api/memories/:id` | — | Single approved memory |
| `GET` | `/api/memories/:id/photo` | — | EXIF-stripped WebP photo (approved only) |
| `GET` | `/api/moderate/queue` | Bearer | List up to 50 pending memories |
| `POST` | `/api/moderate/:id/approve` | Bearer | Approve a memory |
| `POST` | `/api/moderate/:id/reject` | Bearer | Reject with optional reason |
| `GET` | `/health` | — | Liveness probe |

## Security design

### No IP storage
Rate limiting uses a rotating HMAC pseudonym derived from the client IP — `HMAC(secret, ip + hourWindow)`. The raw IP is never written to memory, disk, or logs. Old counters expire automatically when the hour window rolls over.

### EXIF stripping
Every uploaded photo is decoded, passed through `sharp` with `withMetadata(false)`, re-encoded to WebP at ≤1280px, and written to disk. The original data URL is never persisted. This removes GPS coordinates, device model, capture time, and any other EXIF/IPTC/XMP fields that could identify the submitter.

### Moderation queue
Submissions default to `approved = 0`. Nothing appears on the public map until a human moderator reviews it. This prevents spam and protects users from self-incrimination through poorly considered submissions.

### Temporal fingerprinting mitigation
Submission timestamps are stored at day precision (`submit_date TEXT — YYYY-MM-DD`) rather than second precision. This prevents correlating a submission with a specific meeting or event based on the exact time of upload.

### Admin authentication
The `.env` file stores the SHA-256 hash of the admin token, not the token itself. Comparison uses `crypto.timingSafeEqual` to prevent timing-based token disclosure. Generate the initial token with `npm run setup-admin`.

### Input validation
All fields are validated and sanitised before touching the database. Text fields are stripped of HTML tags. All enum values (category, city, language, media type) are checked against strict allowlists enforced at both the application layer and via SQLite `CHECK` constraints. SQLite `STRICT` mode enforces column types at the database layer.

## Production deployment

1. Put the server behind a TLS-terminating reverse proxy (nginx/Caddy). Never expose port 3001 directly.
2. Set `BIND_ADDR=127.0.0.1` (default) so only the proxy can reach the server.
3. Set `ALLOWED_ORIGINS=https://your-domain.com` — remove `null`.
4. Set `NODE_ENV=production` — this enables HSTS and strict env validation.
5. The `uploads/` directory should be backed up and never publicly accessible except through the `/photo` route (which checks approval status before serving).
6. Consider rotating `RATE_HMAC_SECRET` every 30 days — this automatically expires all old rate-limit counters.
