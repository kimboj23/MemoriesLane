# Hồ sơ Nhân quyền (public site)

A public site of the MemoryLane hub ("spoke"), rebuilt from the ChatGPT mockup to show the whole data flow.
Design: [docs/integration-design.md](../docs/integration-design.md). Contract with the hub:
[docs/spoke-integration.md](../docs/spoke-integration.md).

- **Shows** only what the hub published. It reads the signed feed, checks it against the pinned root key, and
  keeps only its own collection (`FEED_COLLECTIONS`, default `HSNQ`).
- **Forwards** reports (`/report-case/<nhóm>`) and documents (`/submit`) to the hub's Intake API.
  - Requests are signed with this site's source key, which can only write.
  - Contact details are encrypted in the browser (libsodium sealed box) to the hub's key.
  - The submitter gets a receipt code, checked at `/bien-nhan`.
- **Holds nothing:** no database, no accounts, no IP addresses (rate limits use an hourly HMAC). Files pass
  through to the hub's quarantine; published files are served from the feed after their hash is checked.

Pages: Tra cứu `/`, hồ sơ `/ho-so/<id>`, Chứng cứ `/chung-cu`, Bản đồ `/ban-do`, Mở hồ sơ `/report-case`,
Gửi tài liệu `/submit`, Kiểm tra biên nhận `/bien-nhan`, Cách hoạt động `/cach-hoat-dong` (the flow, with live
verification status).

## Run locally

Needs the hub (`capture/`) running with intake and feed keys (capture/README "Community intake and the public
feed").

```bash
cd hosonhanquyen && npm ci
# register this site in the hub (project HSNQ + source "ho-so-nhan-quyen"); writes .env (gitignored)
HUB_URL=http://127.0.0.1:8700 HUB_ADMIN_TOKEN=mlc_… TILE_URL='https://{s}.basemaps.cartocdn.com/…?key=…' npm run seed-demo -- setup
npm run dev                                   # http://127.0.0.1:3903
# fictional sample cases, sent through this site's own forms, then reviewed and published in the hub
HUB_URL=http://127.0.0.1:8700 HUB_ADMIN_TOKEN=mlc_… SITE_URL=http://127.0.0.1:3903 npm run seed-demo -- content
```

`npm run check-client` fails if `lib/hub-client.js` drifts from `backend/lib/hub-client.js`; it is the same file,
copied so this site deploys on its own.

## Deploy

`Dockerfile` (Node 22, non-root). Configure it with the variables in `.env.example`. Put it behind TLS and set
`TRUST_PROXY=true` there. The hub's Intake API must be reachable from this server, and only from servers like it.
The feed must be reachable publicly.
