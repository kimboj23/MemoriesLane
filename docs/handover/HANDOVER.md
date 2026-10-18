# Handover log

Newest first. One entry per session that commits: who, which assistant, what changed and why, status, how it was tested, follow-ups with an owner, commit hashes. Details belong in the commit messages. This repo is public; see CLAUDE.md for what must never go here.

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
