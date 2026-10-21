# Handover log

Newest first. One entry per session that commits: who, which assistant, what changed and why, status, how it was tested, follow-ups with an owner, commit hashes. Details belong in the commit messages. This repo is public; see CLAUDE.md for what must never go here.

## 2026-10-21 (afternoon) · kimboj23 with Claude Code (Opus 5.5)

**What:** the four gaps from the team explainer.
- **Trusted timestamps** (RFC 3161: FreeTSA and DigiCert) for every sealed capture. The page shows them; tokens are downloadable and verify with openssl.
- **Duplicate photos:** a dHash fingerprint with Pillow, and "Ảnh tương tự đã có trong kho" on links and submissions.
- **Block rate and canary:** Admin → captures blocked per platform per day; the scheduled canary (stores nothing) with a ⚠ alert.
- **Off-site backup:** `backup/capture-backup.sh` reuses the archive's B2 bucket/key under `capture/`; the timer is installed on the VPS.
- **Signing-key runbook:** docs/runbooks/feed-signing-keys.md.
- **Explainer in the hub:** `/app/docs/pipeline.html`, linked from slide 9 of the tour; the claude.ai page is updated too.
- Migration `011_upkeep.sql`: the WACZ references branch must now become **012**.

**Tested:**
- Local `capture/` stack: 120 unit and 14 e2e tests pass. New e2e: a duplicate photo is found, a different one isn't, an outsider gets 404, admin endpoints.
- Real tokens from both authorities, verified with openssl.
- Screenshots of Admin, the link page and slide 9.
- On the demo after deploying.

**Paid traffic and outside requests:** a dev stack briefly ran with the canary and timestamps on (about 0.5 MB of proxy traffic; 20 test hashes timestamped). Both are now off by default in code.

**Follow-ups:**
- The production signing-key ceremony (the designated maintainer, runbook).
- Rename the references branch's migration to 012.

## 2026-10-21 · kimboj23 with Claude Code (Opus 5.5)

**What:**
- **Threads links "failed" on the demo hub.** The cause: Threads answers HTTP 429 to the VPS address, for every request (including the home page), and the 2- and 4-minute retries only prolonged the limit.
- **Rate-limit handling:**
  - a 429 is now flagged by the gate;
  - the item shows "Rate-limited · will retry" and a note with the next try;
  - retries come after 30 min, 2 h, 6 h and 12 h;
  - the platform's other queued links are held back meanwhile.
  - Migration `009_rate_limited.sql`.
- **Local dev hub reset** (`docker compose down -v`). Hundreds of test projects, sites and accounts had made the admin page slow and the e2e tests flaky; that slowness only existed locally.
  - Recreated: the admin account, KYUC, HSNQ, and the two dev sources at key version 1, so the local spokes' keys still work.

**Tested:**
- Local `capture/` stack: 109 unit tests pass.
- A real capture against a local always-429 server: the item shows `rate_limited` with the next try in 30 min, and another queued link on the platform is held back.
- e2e: 8 passed in 4 of 6 runs; `test_intake_to_feed` failed twice with a bare `assert False` and passed alone (no 429 involved; not investigated).

- **Inbox:** reviewers and admins see the whole team's links by default ("Của tôi" narrows it); all filters sit behind one "Bộ lọc" button.
- **Corrections:** "Sửa thông tin" on a link: status (dropdown), title, author, post date, text, with a reason. Kept beside the sealed capture and logged. Migration `010_item_corrections.sql`.
- **Facebook "removed" mislabel:** logged out, Facebook's "may have been removed" (and a 404) now gives `walled` with an explanation, and the embed uses the post URL instead of the share link.

- **Instagram is rate-limiting the VPS too**, more quietly than Threads: a redirect to its login page with `is_from_rle`. The capture was labelled "partial" because the login page's text counted as the post's. It's now rate-limited (long retries), and Instagram's login wording is a wall phrase.
- **Residential proxy sizing:** a Threads capture moved 1.8 to 6.9 MB through a counting proxy (3 posts, no video), about half of it Instagram's static JS.

- **Residential egress live on the demo** (DataImpulse, VN, a sticky port per capture, Threads/Instagram only, Meta's file servers direct). Credentials are only in the gitignored env files on the laptop and the server.
  - Measured on the server through it: Threads complete at 0.16-0.62 MB billed (it got HTTP 429 before), Instagram complete at 2.25 MB.
- **Headful Chromium** in Xvfb with the genuine user agent; `navigator.webdriver` is false.

- **Decided (WACZ, not built):** record replayable archives from the same browser visit (HAR to WACZ), not a separate browsertrix crawl, which would double paid traffic. The replay viewer goes on its own isolated origin. The capture/README "Not built yet" list is updated.
- **Team explainer** of the pipeline, published as a private page for the team (owner kimboj23 shares it).

- **Replayable archives built:** a WACZ for social posts from the visit we already make, opened in a new replay
  viewer on its own origin.
  - Locally: a Facebook post replays from the archive with no outside request.
  - The proxy credentials never reach the archive (tested through a local proxy that requires a fake login).
  - Not yet reachable on the demo: the viewer needs its own HTTPS hostname.

**Follow-ups:**
- **Viewer pop-up toggle** ("Ẩn cửa sổ bật lên", on by default): it hides platform login prompts on screen. The script reaches the replayed page through ReplayWeb.page's "ruffle" injection slot. Off, it reloads exactly as served (a preference cookie; that script is `no-store`, because Cloudflare rewrites `no-cache`). The viewer's scripts have versioned URLs because Cloudflare caches `.js`. Checked on the demo on a Threads post.
- Done: the demo's replay viewer has its own HTTPS hostname (a cloudflared ingress rule and DNS record, config backed up on the server), with REPLAY_URL set in demo hub.env. A Facebook capture replays there over HTTPS with no outside request. The viewer sends `no-transform`, because Cloudflare had injected its analytics beacon.
- Set a monthly traffic limit in the DataImpulse dashboard. Owner: kimboj23.
- Done: yt-dlp now downloads media direct from Meta's file servers after extracting through the proxy. Instagram went from 2.25 to 0.59 MB billed, still complete with its video.
- The `feat/intake-references` branch also has a `009_` migration: rename it to `011_` when rebasing. Owner: kimboj23.
- Capture egress is still the root cause (pending ops). Owner: maintainers.

## 2026-10-19 (late night) · kimboj23 with Claude Code (Opus 5.5)

**What:**
- **Hub onboarding tour:** 9 steps (VI/EN). It opens once after a person's first sign-in in a browser, and the ⓘ button in the top bar replays it.
- **Admin → Community sites explained:**
  - a plain intro and a 5-step flow (submit → forward → Inbox · Community → approve → shown);
  - a collapsible "routing, keys and safety" section;
  - one sentence per site saying where its submissions go;
  - help text on the column headers and the "add a site" form.

**Tested:**
- Local `capture/` stack: 106 unit tests and 8 e2e tests pass, including a new tour test.
- Chromium screenshots at 1280 and 390 px.

- **Community sites explanation moved into a popup** (ⓘ beside the section title), with the flow shown as numbered steps; the page itself stays compact.
- **"Add to incident" on a link's page did nothing** with the default "Not filed" choice: it now starts at "Choose an incident", offers "+ Create a new incident", and explains what an unfiled link means (`9dcb99a`). Three tests that failed intermittently because of the tests themselves were fixed (`c961a49`).
- **Paused, on branch `feat/intake-references` (WIP, not merged):** community submissions used as references in other projects' incidents (contact and publication stay with the home project). Before merging: screenshots, docs, rebase. Owner: kimboj23.
- **Hub UI cache fix:** Cloudflare kept browsers on the old UI for up to 4 hours after a deploy. Scripts and styles now load from build-versioned URLs (`/app/b/<build>/`).

**Status:** done. Deployed to the demo hub.

## 2026-10-19 (night) · kimboj23 with Claude Code (Opus 5.5)

**What:**
- **The Hồ sơ Nhân quyền site** (`hosonhanquyen/`, `b0447f2`). Feed records now carry `collection`, so each site shows only its own (`3b253ed`).
- **A demo deployment of all three apps** on the VPS (`deploy/demo/`, `6e746e9`).
- **`main` fast-forwarded and pushed:** the live map now runs the new frontend.

**Server state:**
- **`~/memlane-demo`** (clean clone of main) runs the hub and Hồ sơ Nhân quyền.
  - Containers: `memlane-demo-*`, on localhost ports 8700 and 3903.
  - Secrets live in its gitignored `deploy/demo/`, including the admin token and **DEMO feed keys, root generated on the server**.
- **`~/MemoriesLane`** (runs `docker-compose.vps.yml`):
  - **only `backend/` was updated** from origin/main (`git checkout origin/main -- backend`);
  - its uncommitted server-side edits to archivebox/worker/compose were left alone, and HEAD is still old;
  - `backend/.env` now has the HUB_* variables and `PUBLIC_SOURCE=feed` (backup alongside it).
- **cloudflared:** two new ingress hostnames (config backed up); DNS routes created.
- **DNS gotcha:** a fresh hostname was cached as missing by the server's resolver, and the backend couldn't reach the hub until `sudo resolvectl flush-caches`.

**Status:** live for the demo. All three sites are verified in Chromium:
- the map shows 3 published demo memories from the hub's feed;
- Hồ sơ Nhân quyền shows 4 cases;
- the hub is reachable with a token.

**Follow-ups (maintainers):**
- Reconcile `~/MemoriesLane` on the server: commit or drop its local edits, then pull main.
- Production feed keys (offline root) and the B2 feed bucket before real use.
- Pages serves a stale `app/archive-admin.js` from its build cache. Nothing loads it; a no-cache redeploy removes it.

**Commits:** `3b253ed`, `b0447f2`, `6e746e9`, and this entry.

## 2026-10-19 (evening) · kimboj23 with Claude Code (Opus 5.5)

**What:**
- Public versions read the incident's live location, and the precision menu only offers what the policy allows (`26e13c2`).
- On the map: a receipt-check panel, list ↔ map switching, and the materials panel and area circle removed (`fb02b4b`).
- Community notes: a published case's submissions are its dots on the map, and a note opens the case (`9b0087d`, `e3a64b0`).
- Notes and links added to an already-published case join its public version, flagged "unpublished changes" until one approval.
- Feed records are content-addressed, keeping one previous generation (migration 008).

**Tested:** 106 unit and 7 e2e tests (twice); local map dev setup.

**Follow-ups:** none new; same pending ops.

## 2026-10-19 (later) · kimboj23 with Claude Code (Opus 5.5)

**What:** changes from the user's hands-on testing.
- **Platform:**
  - one approval publishes, with an optional "Xin ý kiến thứ hai" (second-opinion) request; decision 2 revised;
  - @role tags in comments (@reviewer, @manager…) and @-autocomplete;
  - the unfollow error fixed;
  - "+ Thêm tư liệu" picks from the inbox and from community submissions;
  - calendar pickers on every date field;
  - suggestions from values already used;
  - tooltips on unfamiliar buttons;
  - no save form on the inbox page.
- **Community map:** the archive admin is removed, a location-consent choice is added, and the privacy note is corrected.

**Status:** done; still local only (same pending ops).

**Tested:** capture/ stack: 105 unit and 7 e2e tests. Local map dev setup: consent forwarded correctly, published materials served, no page errors.

**Commits:** `d04ca9f`, `e5f5e6d`, `eedac7f`, and this entry.

## 2026-10-19 · kimboj23 with Claude Code (Opus 5.5)

**What:** built the whole integration design (docs/integration-design.md §14):
- **Hub (capture/):**
  - signed Intake API for community sites, with sources and receipts;
  - file quarantine and cleaning;
  - public versions under the §12.4 location policy, with two-person approval, withdrawal and legacy batches;
  - a feed signed with an offline root key and a delegated online key, served from a local dir or B2.
- **Inbox:** "Hộp thư" and the intake are merged into one inbox with a source filter (Tất cả / Nội bộ / Cộng đồng, plus "Cần xử lý"), as the user asked.
- **Community map (backend, app):** a transactional outbox and relay to the hub, the purging of forwarded copies, a verified feed reader, generalised locations drawn as areas, receipts, and a legacy export script. All of it is off unless `HUB_*` is set.
- **Hồ sơ Nhân quyền:** docs/spoke-integration.md plus `backend/lib/hub-client.js`. Its code isn't in this repo.

**Why:** the user accepted the design and asked to build all of it. Decisions recorded in §11/§13:
- the root key is held by one designated maintainer with a sealed backup ("2 of 3" to be reconsidered later);
- the optional population threshold and "no exact internal location" option were skipped.

**Status:** built and tested locally. Not deployed: needs production keys, the B2 bucket and the switch-on steps (CLAUDE.md "Pending ops").

**Tested:**
- capture/ Docker stack: 104 unit tests (32 new) and 7 e2e tests (new: test_intake_e2e).
- A 74-check hub smoke test driven through the Node client.
- The community backend on Node 22 against a throwaway Postgres and the local hub: 24 checks. It ran without the production `backend/.env`; no Supabase or Internet Archive calls were made.
- Chromium screenshots at 1280 and 390 px.

**Follow-ups:**
- the designated maintainer: generate the production root key offline, make the sealed backup, delegate an online key, write the revocation runbook;
- maintainers: the B2 feed bucket and the switch-on steps;
- Hồ sơ Nhân quyền developers: implement the spoke from the guide.

**Commits** (branch `feat/capture-platform`, not pushed): `d4f71e9` hub intake/publication/feed, `b2f38d2` one inbox with a source filter, `dce1d09` community map as a spoke, and the commit adding this entry.

## 2026-10-18 (night) · kimboj23 with Claude Code (Opus 5.5)

**What:**
- Map tiles now come from CARTO basemaps (OpenStreetMap's servers returned 403). The CSP allows the `{s}` subdomains and the referrer policy is `strict-origin`.
- A link can be source material of several incidents (`capture.item_incidents`, migration 005).
- Internet Archive safeguards: the UI asks to confirm before sending; tests skip the step when IA keys are set.
- Wrote docs/integration-design.md: the hub-and-spoke design connecting the community map and Hồ sơ Nhân quyền (Intake API in; a signed publication feed out).

**Why:** the user reported the broken map, asked that a link can belong to several incidents, and asked for an integration design.

**Status:** done. The user decided integration questions 1, 2, 4, 5 (B2), 6 and 7 (recorded in §11). Then accepted the §12.4 location policy and signing option C (offline root + online key). Still open: who holds the root key, and two optional precision details; both in CLAUDE.md "Pending ops".

**Incident:** after the user added IA keys locally, an e2e test and a smoke script submitted two example.com test URLs to the Wayback Machine for real (public, permanent). No sensitive data was involved. The guard and a CLAUDE.md rule now prevent this, and every project's Internet Archive sharing is off in the dev DB.

**Tested:** map tiles 19/19 HTTP 200 with no CSP violations; 72 unit and 6 e2e tests pass; API permission matrix including the many-to-many checks.

**Follow-ups (maintainers):** decide §11 of the integration design; choose which projects share with the Internet Archive.

**Commits** (branch `feat/capture-platform`, not pushed): `9a8181e` map + IA safety, `0f28c1f` many-to-many, and the commit adding this entry.

## 2026-10-18 (evening) · kimboj23 with Claude Code (Opus 5.5)

**What:** built Atlos-style collaboration in capture/:
- per-project roles (data-only viewer → owner) and the Access tab;
- invite links, including joining without an account;
- an Admin page for people, instance roles and tokens;
- notifications: follow, @mentions, assignees, bell;
- map views with Leaflet vendored and the tile server configurable;
- CSV bulk import with preview, all or nothing;
- Internet Archive copies as a separate job: per-project opt-in plus "send now"; Facebook via its embed URL; Threads/Instagram skipped with the reason shown.

**Why:** the user asked for members and invite links with admin-assigned access levels, notifications, a map view, bulk import, and an answer on the Internet Archive link.

**Status:** done for this scope. Open: the same link in several incidents, email/Telegram notifications, per-project API tokens, translated server error texts.

**Tested:** capture/ Docker stack. 72 unit and 6 e2e tests pass (the new ones cover invite → roles → @mention → bell, and import → map → Internet Archive → admin); a 42-check API permission matrix; canary 9/9; screenshots reviewed. No real Internet Archive submission was made (no IA keys locally); the SPN2 client was tested against a fake archive.org.

**Follow-ups (maintainers):** IA keys plus which projects share with the Internet Archive; the tile server choice (`TILE_URL`); per CLAUDE.md "Pending ops".

**Commits** (branch `feat/capture-platform`, not pushed): `5adb8d5` collaboration features, and the commit adding this entry.

## 2026-10-18 (later) · kimboj23 with Claude Code (Opus 5.5)

**What:**
- Fixed a Threads post that showed only a wall. Meta had restricted it after a legal request; it now gets the new `restricted` verdict, with Meta's "See why" notice saved as evidence.
- Built the Atlos-style workspace: projects configured on a Manage page; incidents picked from dropdowns, with attributes, a feed and comments; source material.
- Added in-browser viewers and a full viewer for every artifact.
- Fixed a migration race that crashed the worker.

**Why:** the user's requests: the broken Threads archive, in-browser viewing, configurable cases/incidents/projects, and an Atlos-like contributor UI.

**Status:** done for this scope. Not yet: per-project membership and invites, notifications, map view, bulk import (Atlos features still to copy); WACZ; logged-in sessions; deployment.

**Tested:** capture/ Docker stack. 61 unit tests and 4 e2e tests pass; API smoke test (permissions, signed URLs, ranges, CSV); canary 8/8, and the restricted post is now in the private canary list; fresh-DB migration check; screenshots reviewed at desktop and phone width.

**Follow-ups:**
- the per-project permissions decision and `ARTIFACT_URL_SECRET` (CLAUDE.md "Pending ops");
- next build steps: share-sheet PWA + iOS Shortcut + extension, WACZ witness (next assistant session).

**Commits** (branch `feat/capture-platform`, not pushed): `599b173` restricted verdict, `08b4dd7` migration lock, `968dccf` workspace + viewers, and the commit adding this entry.

## 2026-10-18 · kimboj23 with Claude Code (Opus 5.5)

**What:** audited the archiving platform and started the rebuild.
- `docs/archiving-platform-proposal.md`: audit findings (F1–F9), reference pipelines (Bellingcat auto-archiver, the hosted auto-archiver.com fork, Atlos), options, the decided plan, and the collaboration/intake design (§11, including save-from-anywhere).
- `capture/`: the new service. Inbox API with personal tokens and URL canonicalisation; a worker with media (yt-dlp), view (Chromium + platform embeds) and wayback witnesses; a quality gate that assigns verdicts; sealing with hashes and a manifest; content-addressed storage; a local test UI at `/app`; unit, e2e and canary tests.
- `CLAUDE.md` (these working agreements) and this log.

**Why:** the old stack recorded login walls and thumbnails as "archived" (0 of 151 rows failed, while every opened social artifact was a wall or a thumbnail). It dropped downloaded videos, had no Threads support, and can no longer be rebuilt (`archivebox:latest` moved to 0.9.x). Decision: leave it untouched (unused) and build the new platform alongside it, then migrate.

**Status:** partly. The core of Phase 1 is done and runs locally. Not yet: WACZ witness, logged-in sessions, timestamps, deployment, the share-sheet PWA, the extension, the review workflow, migration.

**Tested:** `capture/` Docker stack on a Windows laptop (residential IP). Try it: `cd capture && docker compose up -d --build`, create a token (capture/README), open http://127.0.0.1:8700/.
- 58 unit tests pass.
- 4 Playwright e2e tests pass: save → capture → detail → edit → duplicate → new version, plus a 375 px phone run.
- The canary passes 8/8: FB reel complete (with video), FB photo post partial (truncated without login), FB group post partial, Threads ×2 complete, Instagram reel complete, YouTube complete, VnExpress complete.
- Production Supabase was only read (`BEGIN READ ONLY`); nothing in the current stack was changed.

**Follow-ups:**
- the decisions in CLAUDE.md "Pending ops" (maintainers);
- next build steps per proposal §9: WACZ witness, YouTube PO-token sidecar, share-sheet PWA + iOS Shortcut + extension (next assistant session).

**Commits** (branch `feat/capture-platform`, not pushed): `02f06d8` proposal, `4bbf532` capture service + test UI, and the commit adding this log and CLAUDE.md.
