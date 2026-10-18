# MemoryLane: notes for AI assistants and maintainers

MemoryLane is a collective, anonymous civic memory archive (public site on Cloudflare Pages, Express backend and archiving on a VPS, Supabase Postgres). See [README.md](README.md) for the current stack.

**The archiving side is being rebuilt.** The audit and plan are in [docs/archiving-platform-proposal.md](docs/archiving-platform-proposal.md), and the new service is [capture/](capture/README.md). Decision 2026-10-18: the current archiving stack (`archivebox/`, `worker/`) is not in use and is **left as-is** until migration. Don't patch it; build on `capture/` instead.

## Working agreements for AI assistants

Several people work on this repo through AI coding assistants, and each needs to pick up the others' work without asking. Every assistant follows these rules:

- **Before starting:** read `git log` since your last session and the top of [docs/handover/HANDOVER.md](docs/handover/HANDOVER.md). If the user's request touches an open item (below, or in the handover log), say so.
- **Commit messages explain the change for the next person.** Say what changed and why, and the effect a user or admin will see. Say how it was tested: which environment (the `capture/` Docker stack, the root `docker-compose.yml`, the VPS, a script, a manual check on the live site) and which checks passed. List any manual step it needs (SQL to apply, environment variables, dashboard settings). One logical change per commit.
- **Test before pushing, in whatever way fits** (see Commands), and write down what you tested. A push to `main` is a production release for the static site; work in progress goes on a feature branch.
- **Keep this file current.** When you add a rule others must keep (an invariant, a gotcha, a "never do X"), add it to the relevant section here, in the same commit.
- **Open items** (things left undone, decisions waiting on someone, rotations, clean-ups) go in "Pending ops for maintainers" below, with who should do them.
- **Handover log:** every session that commits adds one dated entry at the top of [docs/handover/HANDOVER.md](docs/handover/HANDOVER.md): who (the person's handle) and which assistant, what changed and why, status (done / partly / blocked), how it was tested, follow-ups with an owner, and the commit hashes. Keep entries short; details belong in the commit messages.
- **This repository is public.** Nothing that would help an adversary goes in a commit, a commit message or the handover log: no secrets or tokens, no cookies or browser profiles, no names of throwaway accounts, no private hostnames, IPs or tunnel IDs beyond what README already documents, no security weaknesses that are still open (those go in the gitignored `SECURITY-PLAN.md`). **No real private people from captures** either: no handles, names, post IDs or post text in tests, docs, examples or fixtures. Use placeholders (`user.b`, `Nguyễn Văn A`, `PostCode001`). The posters are often critics of the authorities, and this repo links them to a censorship archive. Real canary links live in the gitignored `capture/secrets/canary.json`.

## Pending ops for maintainers

| Item | Owner | Notes |
|---|---|---|
| Decide on logged-in capture for Facebook (throwaway accounts vs. a hosted service vs. logged-out only) | maintainers | proposal §10.1; blocks Facebook "complete" for photo/text posts |
| Decide on capture egress (residential/VN proxy, or move the VPS region) | maintainers | proposal §10.2; datacenter IPs get worse results from Meta/YouTube |
| Decide who reviews `walled` / `unavailable` captures, and where | maintainers | proposal §10.4 |
| Create a B2 bucket + key for `capture/` artifacts (S3 backend) before any deployment | maintainers | `capture/.env.example`; keep it separate from the backup bucket |
| Generate the production feed root key offline, make the sealed backup, delegate an online key (`feedkeys.py`), write the revocation runbook, before anything is published | the designated maintainer | docs/integration-design.md §13 (one holder + sealed backup for now; "2 of 3" to be reconsidered) |
| Deploy the hub's intake + feed: `INTAKE_KEY_SECRET`, `CONTACT_SECRET_KEY`, feed keys, `FEED_*` for the B2 bucket; register the sources | whoever deploys `capture/` | capture/README "Community intake and the public feed" |
| Switch the community map to the hub: `HUB_*`, `PUBLIC_SOURCE=both`, run `scripts/export-to-hub.js --commit`, approve the legacy batch, later `PUBLIC_SOURCE=feed` | maintainers | backend/README "Connecting to the MemoryLane hub" |
| Hồ sơ Nhân quyền: implement the spoke on its own codebase | its developers | docs/spoke-integration.md |
| Create a separate public B2 bucket for the publication feed, behind Cloudflare | maintainers | docs/integration-design.md §6.2; not the backup or artifacts bucket |
| Set `ARTIFACT_URL_SECRET` in any deployment with more than one API process | whoever deploys `capture/` | see capture/README "Known limitations" |
| Choose the map tile server for real use (`TILE_URL`): public OSM tiles reveal viewed areas and have a usage policy | maintainers | capture/.env.example |
| Add Internet Archive keys to `capture/.env` and decide which projects share with the Internet Archive | maintainers | the existing `IA_ACCESS_KEY`/`IA_SECRET_KEY` work (SPN2 quota checked 2026-10-18) |

## Commands

### capture/ (the new archiving service)

```bash
cd capture
docker compose up -d --build                                    # db + api + worker, local only
docker compose exec api python -m memlane_capture.admin add-contributor "Me" --email me@example.org --role admin
docker compose exec api python -m memlane_capture.admin add-token me@example.org "laptop"
# UI: http://127.0.0.1:8700/   API docs: http://127.0.0.1:8700/docs
docker compose run --rm --no-deps api python -m pytest          # unit tests (offline)
docker compose exec -e E2E_BASE_URL=http://api:8700 -e E2E_TOKEN=mlc_... worker python -m pytest tests/e2e
CAPTURE_TOKEN=mlc_... python tests/canary.py                    # real links per platform
```

### Current stack

See README "Run locally" (root `docker-compose.yml`) and "Deploy" (`docker-compose.vps.yml`, `deploy-vps.sh`).

## Invariants: capture/

- **A wall is never `complete`.** Verdicts come only from `gate.py`. A Wayback link never upgrades a verdict. Wall and unavailable phrases are lowercase English and Vietnamese. Social login-wall phrases are not applied to ordinary web pages, since VN news sites carry their own login boxes.
- **Platform notices are never content.** "Không có thread", login prompts and restriction messages are excluded from post text (`gate._text_ok`). Content withheld by the platform ("This content isn't available to everyone", Meta's "legal request" notice) is `restricted`, and the notice behind "See why" is captured as evidence.
- **Captures are versions.** Re-capturing adds a `captures` row; nothing is overwritten. Artifacts are content-addressed by SHA-256 and never modified or deleted in place.
- **Never store yt-dlp's `.info.json`.** With cookies it can contain the session. Write the sanitised subset instead (`witnesses/media.py`). The output template stays `%(id).80B.%(ext)s`: title-based names broke on long Vietnamese captions.
- **Captured content is hostile.** The UI inserts it only via `textContent` or as `blob:` media, never as HTML. Artifact downloads are served with `Content-Security-Policy: sandbox`, and the UI with a strict CSP. Chromium and yt-dlp run as the non-root `pwuser`. No `docker.sock` anywhere.
- **Artifacts are only ever served sandboxed.** Every `/v1/artifacts` response carries `CSP: sandbox; default-src 'none'` (no scripts, nothing external loads), and the UI embeds HTML in `<iframe sandbox>`. Signed artifact URLs (`signing.py`) are issued only inside responses to users who may read the item. Don't relax either.
- **Access is per project** (`access.py`, Atlos's five roles). Every endpoint that touches a project checks the role there with `require_project`, and a project you aren't in answers 404, never 403. Data-only viewers never receive the feed, comments or anyone's name. Invite links store only a hash, are shown once, can't grant owner, and never lower an existing role.
- **The Internet Archive is an external copy, not evidence.** Wayback submissions are a separate job (`external.py`), never part of a sealed capture or a verdict, and never automatic unless the project opted in ("Share with the Internet Archive", off by default; submissions are public). Threads/Instagram are skipped; Facebook sends the embed URL.
- **Migrations:** add a new numbered file in `capture/migrations/`; never edit one that has been applied. The runner holds an advisory lock, because the API and worker start together.
- **Workspace UI:** copy Atlos's *design*, not its code (Atlos is GPLv3). Render pages with `mount()`/`el()` from `web/js/core.js`. They flatten arrays and insert captured text only as text.
- **Pin everything** (base image, Python deps, yt-dlp, Playwright). Bump deliberately, and run the canary before and after.
- **A link is one item, in any number of incidents** (`capture.item_incidents`). Its captures exist once; filing it elsewhere never re-captures it. People see a link if they're in any project using it, but only the incidents in projects they belong to, and never the submitter's private note or tags.
- **Tests never send anything to external services for real**, above all the Internet Archive (public and permanent). Check `/v1/config` → `wayback_configured` and skip the step when keys are set. This happened twice on 2026-10-18 (two example.com test URLs were archived publicly) before the guard existed.
- **Public sites only write, and only read what was published.** A source's key (intake.py) can create submissions and read receipts, nothing else. The public sites never query the hub; they read the signed feed. Nothing reaches the feed without two approvals by two different people (a manager + a member with `can_publish`); any edit clears them; withdrawal is immediate and leaves a tombstone.
- **Exact locations never leave the hub.** Public records carry only `geo.snap()` output under the §12.4 policy (snap, never jitter), and media only as `derive.public_copy()` output (EXIF/GPS and container tags stripped). Community uploads are kept as received (evidence) and served internally only, sandboxed. Submitted text is rendered as text only.
- **The feed root key never touches a server.** The server holds only the online key and the root's time-limited delegation (feedkeys.py). Dev keys in `capture/secrets/dev-feed-*` are for local use only.
- **Unit tests stay offline.** Anything needing the network goes in `tests/e2e/` or `tests/canary.py`.
- **Throwaway accounts only** for any cookies or profiles, per [archivebox/THROWAWAY-ACCOUNTS.md](archivebox/THROWAWAY-ACCOUNTS.md), and never committed (`capture/secrets/` and `capture/.env` are gitignored).

## Gotchas

- **Windows + Git Bash mangles non-ASCII in command-line arguments.** Vietnamese text in `curl -d '…'` or `node -e '…'` arrives as invalid UTF-8. Put the payload in a UTF-8 file (`curl --data-binary @file.json`), edit files with the editor rather than inline scripts, and set `PYTHONIOENCODING=utf-8` when printing Vietnamese from Python on Windows.
- **`archivebox/archivebox:latest` is now v0.9.x.** The old stack's `archivebox/Dockerfile` only builds on a cached 0.7.4 base (`--pull` fails). Another reason not to touch it.
