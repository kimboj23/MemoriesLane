# Archiving platform: audit and rebuild proposal

**Status:** accepted 2026-10-18: option B; the current stack is left as-is (not in use) and the new platform is built alongside it, then migrated · **Date:** 2026-10-18 · **Scope:** the capture side of MemoryLane: `archivebox/`, `worker/`, auto-archiver, Internet Archive. The frontend, backend API, moderation and NocoDB are out of scope.

---

## 1. Summary

Reported problems: Facebook/Threads links not archived, videos not downloaded, Chromium failing, and Internet Archive blocks. I checked each in a local Docker sandbox and against production data. All four are real. **The biggest problem is one nobody reported: the platform records failed captures as successes.**

- Every one of the 151 rows in `archives` is `archived` or `partial`. **None is `failed`.** I opened 8 of the stored social-media artifacts. All 8 are a login wall, a consent wall, a thumbnail, or a cropped post image. None holds the post itself.
- **Videos are often downloaded and then thrown away.** auto-archiver saved the Facebook reel's MP4 to the bucket (41.6 s, verified). The worker linked the JPG thumbnail instead, because of how it picks a "viewable" file. ArchiveBox's own video download fails on every Facebook video with a long Vietnamese caption, because the generated filename exceeds 255 bytes.
- **Threads has no working extractor anywhere in the stack.** yt-dlp, gallery-dl and auto-archiver all reject it. Yet a plain logged-out browser gets the full post text, date, counts, replies and images, and Threads' `/embed` page renders a clean card.
- **Facebook posts need either the embed route (logged out) or a sock-puppet session (logged in).** The hosted auto-archiver.com service reverse-engineered below uses the logged-in route. We use neither.
- **"Chromium not working" is a state and config problem, not a Chromium problem.** In a clean container every Chrome extractor succeeded. Production breaks because of a shared, pre-seeded profile, stale lock files, and a failed 0.9.x upgrade.
- **The Internet Archive account is healthy:** authenticated SPN2 works, with a 30,000/day quota. The "blocks" come from three places. The legacy endpoint is deprecated (already patched). Wayback rate-limits its availability API (HTTP 429). And Meta serves Wayback login/error pages: 7 distinct Threads URLs are "archived" in Wayback as `threads.com/?error=invalid_post`.
- **The platform cannot currently be rebuilt from scratch.** `archivebox/archivebox:latest` moved to v0.9.73 on 2026-10-06. Our Dockerfile's first step now fails (`pip: exit 127`), and its ten guarded patches only apply to 0.7.4.

**Recommendation:** replace ArchiveBox with a small **capture service** we own (§6), built alongside the current stack and migrated to once ready (§9). It uses auto-archiver and browsertrix-crawler as libraries, adds platform adapters for Facebook and Threads, and adds a quality gate that refuses to call a login wall "archived". Reuse what works: the Postgres queue, SPN2 code, B2 backup, static mirror, throwaway-account procedure and bot-wall signatures. Freeze the existing ArchiveBox archive read-only behind the static mirror that already exists.

**Collaboration (§11):** build a Vietnamese-first, mobile-first Workspace into MemoryLane that copies Atlos's workflow (versioned evidence, review statuses, assignees, activity feed), rather than adopting Atlos itself. Atlos is English-only and would become a second source of truth.

---

## 2. How the audit was done

| Step | What | Where |
|---|---|---|
| Production data | Read-only queries (`BEGIN READ ONLY`) on `archives`: outcomes by tool, host and error; artifact URLs | Supabase |
| Stored artifacts | Downloaded and viewed 8 social artifacts from the public `memory-archive` bucket; listed bucket file types (707 objects, 134 MB: 465 JPG, 52 PNG, 116 HTML, **9 MP4**) | Supabase Storage |
| ArchiveBox | Rebuilt `archivebox/Dockerfile` (fails on today's base; succeeded on the cached 0.7.4 base); ran an isolated instance with production's capture env; captured 6 URLs | Local Docker, `mlaudit-ab` |
| auto-archiver | `bellingcat/auto-archiver:latest` (1.2.9, 2026-09-01) with production's module list, local storage instead of S3 | Local Docker |
| Raw tools | yt-dlp 2026.08.19, gallery-dl 1.32.17 on the same URLs | Local Docker |
| Browser | Playwright/Chromium, logged out: post pages, `/embed` pages, FB embed plugin | Local Docker |
| WACZ | browsertrix-crawler 1.15.0 | Local Docker |
| Internet Archive | SPN2 `/save/status/user` (read-only quota), availability API, the stored Wayback captures | archive.org |
| Reference code | Shallow clones of `bellingcat/auto-archiver` (v1.2.9), `djhmateer/auto-archiver` (the fork behind auto-archiver.com / OSR4Rights, 1.2.9+dm.8, last commit 2026-10-17), `atlosdotorg/atlos` | GitHub |

Test URLs came from the production table: real Vietnamese Facebook posts and reels, Threads posts, a YouTube Short, an Instagram reel, and vnexpress.net.

> **Caveat:** the sandbox ran from a residential connection. Production runs from an OVH datacenter IP in Frankfurt, which Meta and YouTube treat more harshly. Every result below is therefore a *best case* for production. Where production did worse than the sandbox on the same URL (YouTube, Threads), the datacenter IP is the likely reason.

---

## 3. Findings

Severity: **S1** means the archive is wrong or misleading, **S2** means content is lost, **S3** means fragility or operational cost.

### F1 (S1). "Archived" does not mean the content was archived

- **Evidence:** 151 rows: 150 `archived`, 1 `partial`, 0 `failed`. The 8 artifacts I opened:

  | Job | Stored `local_url` shows |
  |---|---|
  | FB post (person.a) | Only the post's photo. No author, text or date. |
  | FB post (person.c), FB post (luatkhoa.org) | Only the post's attached image |
  | FB reel (share/r/AbCdEf1234) | Thumbnail JPG. **The MP4 was in the bucket** (F2). |
  | Threads share/ShareCode02 | Threads **home feed** under a "Say more with Threads" login modal. Not the post. |
  | Threads @user.b | Post partly visible behind the login modal |
  | YouTube Short | "Before you continue to YouTube" consent page |
  | Instagram reel | Post behind a sign-up modal. Video frame blank. |

  ArchiveBox's sandbox captures of the two Facebook URLs were full-page login walls. ArchiveBox still marked 10 of 12 extractors "succeeded".
- **Root cause:** success is defined as "some extractor produced some file" ([worker/archivers/archivebox.js](../worker/archivers/archivebox.js) `captureSucceeded`) or "auto-archiver printed a URL" ([worker/archivers/autoarchiver.js](../worker/archivers/autoarchiver.js) `parseResult`). Nothing checks *what* was captured. [worker/botwall.js](../worker/botwall.js) is a good start, but it has three gaps. It only tags ArchiveBox snapshots and never auto-archiver output. It never changes `status`. And it has no Facebook login-wall phrases ("See more on Facebook", "Create new account"), which the hosted service checks for.

### F2 (S2). Videos not downloaded, or downloaded and then dropped

Three separate causes:

1. **The worker discards videos auto-archiver saved.** `parseResult()` prefers `png > jpg/webp > pdf > html` and never considers `.mp4`. Reproduced locally: the reel run produced `ad2f31d780abab616b24737b.mp4` plus the thumbnail `9afc1fdedfb1bb04df6d3b10.jpg`. Both files are already in production storage under those exact names, and production's `local_url` is the JPG. The 9 MP4s in the bucket are orphans that no row points to. auto-archiver's text, author and metadata (in its HTML report) are discarded the same way.
2. **ArchiveBox's `media` extractor fails on Facebook videos with long Vietnamese captions.** yt-dlp names files `<title> [<id>].<ext>`. Facebook uses the caption as the title, and Vietnamese is 2–3 bytes per character in UTF-8. Reproduced: `ERROR: Cannot write video description file 1.1K reactions · 66 shares ｜ Nhà nước nói…`. ArchiveBox 0.7.4 passes no `-o` template, so this affects every such video. The same reel downloads fine with standalone yt-dlp.
3. **yt-dlp goes stale inside auto-archiver.** The 1.2.9 image ships yt-dlp 2026.06.09 ("older than 90 days" warning). Its built-in self-update fails on every run (`pip install --upgrade yt-dlp … exit status 1`), wasting about 60 s per URL. Each URL also starts a fresh `docker run`. Measured end to end: 98–192 s per URL.

### F3 (S1/S2). Threads: no extractor, but the content is reachable

- yt-dlp and gallery-dl both return "Unsupported URL". auto-archiver falls through to `antibot_extractor_enricher`, which crashed in the sandbox (`failed to close window`) and returned **`nothing archived`**. The production worker would still have recorded whatever URL it found.
- A **logged-out Chromium** on the post page renders the whole post in the DOM *behind* the login modal: author, date, text, view/like/reply/repost counts, the replies, all image URLs. `og:description`/`og:image` carry the text and main image. `https://www.threads.com/@user/post/<id>/embed` renders a clean, legible card with quoted post, timestamp and counts.
- **Share links** (`threads.com/share/…`) resolve correctly in a real browser. Wayback and our tools got `?error=invalid_post` instead (7 distinct URLs in production).

### F4 (S2). Facebook: logged-out coverage is partial, and we use the weaker part

| Route (logged out) | Post with photo | Reel/video | Public group post |
|---|---|---|---|
| yt-dlp | ✗ "registered users only" | ✓ full HD video + uploader, timestamp, caption | not tested |
| gallery-dl | ✗ AuthRequired | ✗ unsupported | not tested |
| Post page in a browser | ✗ login wall (og: tags give truncated text + 1 image) | partial: caption + video stream | ✓ text renders |
| **Embed plugin** `facebook.com/plugins/post.php?href=…` | ✓ author, relative date, text up to "Xem thêm", photo, counts | not tested | not tested |
| Wayback (SPN2) | Wayback rewrites to the embed plugin, so text is captured but truncated | — | — |

Full text past "See more", every photo in a carousel, and comments need a **logged-in session**. That is exactly what the hosted auto-archiver does (§4.2).

### F5 (S3). "Chromium not working"

In a clean 0.7.4 container with no profile, `singlefile`, `pdf`, `screenshot` and `dom` succeeded on all six URLs (singlefile failed once, on YouTube). The production failures documented in the README all come from *state around* Chromium:

- the pre-generated `CHROME_USER_DATA_DIR`, which must match the exact Chromium build;
- `SingletonLock` left behind by killed containers;
- SingleFile and the other extractors sharing one profile;
- the 0.9.x RC's crashpad crashes (rolled back).

browsertrix-crawler hit a Chromium launch timeout once in the sandbox (`waiting for the WS endpoint`). Headless browsers fail sometimes, so the fix is retry plus isolation, not more patches to a shared profile.

### F6 (S2). Internet Archive "block"

- Account and quota are fine: `{"available":3,"daily_captures_limit":30000,...}`.
- The legacy `web.archive.org/save/<url>` endpoint returning 498 is already worked around by the SPN2 patch ([archivebox/archive_org.py](../archivebox/archive_org.py)).
- `archive.org/wayback/available` returned **HTTP 429** during the audit.
- For Meta platforms Wayback is not a usable witness. Threads captures are error redirects, Facebook captures are the truncated embed, and video is never captured. Yet a Wayback URL counts as a successful archiver in the worker's `archived`/`partial` arithmetic.

### F7 (S3). The current stack cannot be rebuilt or maintained

- `FROM archivebox/archivebox:latest` now pulls v0.9.73. The build fails at the first `RUN pip install` (exit 127). Production keeps running only because the VPS has the old base image cached. A new VPS, a `docker system prune`, or `docker build --pull` takes archiving down.
- 0.7.4 is the last stable release and is not maintained. We carry **10 build-time patches** to it, covering the admin, password hashing, the size-walk, non-blocking views, Chrome locks, SingleFile profile and lock, re-snapshot, SPN2 and the index regenerator. Moving to 0.9.x was tried and rolled back.
- `bellingcat/auto-archiver:latest` is unpinned too.
- Three workaround loops exist only because ArchiveBox and the app keep separate indexes: `reconcile.js`, `social-sweep.js`, and `injectScreenshot()` writing into ArchiveBox's folders.

### F8 (S1). Integrity data does not mean what it says

- `sha256` is computed over `local_url`. For web jobs that is ArchiveBox's **generated `index.html`**, which our own patch regenerates on demand. For social jobs it is a thumbnail. The captured content itself is never hashed.
- `wacz_url` exists in the schema and is never set. There is no replayable, standard capture format (WARC/WACZ) per job, no signed manifest, and no trusted timestamp.

### F9 (S3). Operations and security

- `archive-worker` mounts `/var/run/docker.sock`, which is root-equivalent on the VPS, to run a container per URL.
- The capture IP is a well-known datacenter range. YouTube and Meta behave noticeably worse there than in this residential sandbox.
- There is no canary: nothing alerts when a platform silently breaks. The `platform_status` module in auto-archiver 1.2.9 exists for exactly this.

---

## 4. How the reference platforms do it

### 4.1 Bellingcat auto-archiver (open source, v1.2.9)

A pipeline of pluggable modules: **feeders → extractors → enrichers → databases / storages / formatters**. Each URL produces one `Metadata` object holding media, hashes and status.

- **Facebook:** `generic_extractor` wraps yt-dlp's `FacebookIE`. A "drop-in" (`generic_extractor/facebook.py`) parses the `ScheduledServerJS` JSON blobs in the page for author, text, timestamp and counts. Its own TODO notes that long posts come back truncated to about 100 characters. Photos-only posts skip yt-dlp. Anything else falls to `antibot_extractor_enricher`, a Selenium(Base) browser screenshot with captcha hooks.
- Also useful: `wacz_extractor_enricher` (browsertrix-crawler, optionally with a logged-in **browser profile**), `hash_enricher`, `timestamping_enricher` (RFC 3161), `opentimestamps_enricher`, `pdq_hash_enricher` (perceptual), `wayback_extractor_enricher`, `instagram_*`, `telethon_extractor`, and `platform_status` (a canary report per platform and content type).

### 4.2 auto-archiver.com / OSR4Rights (hosted; reverse-engineered from `djhmateer/auto-archiver`)

The hosted service is Dave Mateer's fork, "upstream with added Facebook crawling". It is fed from Google Sheets and runs on a cron every minute on Azure EU. Its Facebook pipeline:

1. **Reels and videos skip the drop-in** and go straight to yt-dlp's own extractor (`"facebook.com/reel" → return False`), because "this Generic Dropin is causing problems with FB reels". Output: `video.mkv` plus frame thumbnails.
2. **A logged-in sock-puppet session.** A cookies jar for `facebook.com` is injected into a **Firefox** webdriver: it loads `robots.txt` to get a domain context, then calls `add_cookie` for each cookie. They switched from Chrome because "Chrome antibot measures were affecting the FB cookie and causing flagging issues". The browser is forced to English so the cookie dialog can be dismissed by text.
3. **OCR guard on every screenshot.** pytesseract searches for "we suspect automated behaviour", "log in to facebook", "see more on facebook", "create new account" and similar. A hit sets the status to `FACEBOOK PROBLEM: …`. With `stop_on_suspected_block` it fails the item, protecting the account once it has been flagged.
4. **WACZ via browsertrix-crawler with a logged-in `profile.tar.gz`** (Brave/Chromium, version pinned to browsertrix's). Command: `--scopeType page --generateWACZ --text to-pages --screenshot fullPage --behaviors autoscroll,autoplay,autofetch,siteSpecific`.
5. **WARC mining for full-resolution photos:**
   - Read `__user=<id>` from the recorded requests. `0` means the crawl was logged out, so the profile has expired, and they alert.
   - Find the post's carousel set id (`pcb.<post_id>`) in recorded `bulk-route-definitions` responses. Recommended posts flagged `originated_from_recommendation` are ignored.
   - Crawl each `facebook.com/photo?fbid=<id>&set=pcb.<set>` page with browsertrix, capped at 30 crawls. Take the image whose node matches `"image":{"uri":…}` from each.
   - A single `/photo` URL takes its image straight from the first WACZ.
6. **Stories** have a dedicated extractor that uses a separate session cookie, so a block on one session doesn't kill the other. **YouTube** uses the `bgutil-ytdlp-pot-provider` sidecar for PO tokens. **mhtml** and Firefox **screenshot** enrichers run as well.

What they report capturing per Facebook post: a screenshot, every full-resolution image, video, thumbnails, and SHA-256 of everything. Scale claimed: over 300k links and over 7 TB since 2022. Their own published status table (2026-08-31) shows Facebook video, image and text-only all ✓ **with a session**. YouTube was ✗ in the barebones config.

### 4.3 Atlos (open source)

Elixir/Phoenix plus Postgres, with **Oban** jobs in the same database (no Redis). `Platform.Workers.Archiver` calls `utils/archive.py` in a subprocess, which:

- takes its own **Selenium full-page screenshot + viewport screenshot + PDF**;
- runs **auto-archiver as a CLI** (yt-dlp, twitter, tiktok extractors) and reads its `db.csv`;
- computes **SHA-256 and perceptual hashes (pHash; TMK for video)** of every artifact for duplicate detection;
- uploads to S3, with optional SPN submission.

Every capture is a versioned **"media version"** of an incident, never an overwrite. Lessons: keep auto-archiver as a library rather than a framework, make captures versioned and immutable, use perceptual hashes for dedupe, and keep the queue in Postgres.

### 4.4 What this means for us

| Practice | Bellingcat AA | Hosted AA | Atlos | **MemoryLane today** |
|---|---|---|---|---|
| Videos stored and linked | ✓ | ✓ | ✓ | ✗ (dropped, F2) |
| Logged-in sessions for Meta | optional | ✓ profile + cookies, health-checked | — | ✗ (doc only) |
| Detect walls, fail the item | partial | ✓ OCR + `__user` | — | tag-only, ArchiveBox-only |
| WACZ per capture | optional | ✓ | — | ✗ |
| Hash of actual content | ✓ | ✓ | ✓ + perceptual | ✗ (hash of index.html) |
| Platform canary | ✓ `platform_status` | ✓ | — | ✗ |
| Pinned tool versions | — | ✓ ("updates turned off") | ✓ | ✗ (`:latest` ×2) |

---

## 5. Options

| | Option | For | Against | Effort |
|---|---|---|---|---|
| A | **Patch in place.** Keep ArchiveBox 0.7.4 and do §8. | Cheapest; fixes the worst data loss this week | Leaves F5/F7/F8. Pinned to an unmaintained release with 10 patches. No path to logged-in Facebook or WACZ. | ~2–3 days |
| **B** | **Rebuild: own capture service** on auto-archiver (library) + browsertrix + Playwright adapters (§6) | Fixes all of F1–F9. Small codebase we understand. Matches what the hosted service proved works. Keeps our DB, UI and mirror. | Real engineering time. Facebook sessions need ongoing care. | ~8 weeks, 1 dev, including §8 |
| C | **Adopt Atlos** as the archive back end | Mature, versioned, perceptual hashes, team features | Elixir cluster (≥2 instances), its own incident model and UI. Archiving is thin (screenshot + AA CLI), so it doesn't solve Facebook or Threads. Large migration. | 6–10 weeks, mostly integration |
| D | **Buy hosted auto-archiver.com** for social URLs and keep a slim web capture | Facebook expertise and session upkeep are their job | Sheet-based workflow. Data held by a third party (Azure EU). Recurring cost. Threads not listed. Still need F1/F8 fixes on our side. | ~1–2 weeks integration + subscription |

**Decided: B.** The current stack is not in active use, so the A quick fixes are skipped and it is left untouched until migration. Keep D as a fallback for Facebook if running our own sock-puppet accounts turns out to be operationally or legally unacceptable (§10).

---

## 6. Proposed architecture: MemoryLane capture service

```
POST /api/archive ─▶ archives (Postgres queue, FOR UPDATE SKIP LOCKED)  ◀── existing
                         │
              capture-service (Python, long-running, N workers; no docker.sock)
                         │
   1. resolve      real browser follows share links/redirects → canonical URL, platform
   2. route        platform adapter (facebook | threads | instagram | tiktok | youtube | x | web | document)
   3. capture      in parallel, each a "witness":
                     • media      yt-dlp -o "%(id)s.%(ext)s" (+ gallery-dl for images, bgutil POT for YouTube)
                     • page       browsertrix-crawler → WACZ + full-page screenshot + text   (logged-in profile per platform, optional)
                     • view       Playwright: modal-stripped screenshot, DOM text, og:/ld+json, embed card
                     • document   direct fetch of PDFs/files (+ SingleFile for plain web pages)
                     • wayback    SPN2 submission (non-Meta only; never counted as "the" capture)
   4. verify       quality gate → verdict per witness and overall (§6.2)
   5. seal         SHA-256 every artifact · manifest.json · RFC 3161 timestamp (+ OpenTimestamps)
   6. store        content-addressed S3-compatible bucket (B2) · rows in capture/artifact tables
                         │
   frontend: ReplayWeb.page (static JS) for WACZ · native <video>/<img> for media · manifest + hashes shown
   mirror/:  unchanged pattern, now syncing the capture bucket as well
```

### 6.1 Components and what is reused

| Need | Choice | Reused from |
|---|---|---|
| Queue | Postgres `archives` + new `captures`/`artifacts` tables; one worker loop with `SKIP LOCKED` | `worker/db.js` logic (port it) |
| Social media | `auto_archiver` **imported as a Python library** (`generic_extractor` and its drop-ins, `instagram_*`, `telethon`), pinned version | Bellingcat |
| Replayable page capture | `webrecorder/browsertrix-crawler` pinned tag, run as a subprocess inside the capture image (no docker.sock), with per-platform profiles | Hosted AA pattern |
| Facebook carousel/photo walk, `__user` check, OCR guard | Port from the djhmateer fork (MIT) | Hosted AA |
| Threads and Facebook embed capture | New Playwright adapters (§7) | — |
| Plain web pages and documents | browsertrix WACZ + SingleFile HTML + direct PDF download | ArchiveBox's best extractors, reused |
| Wall detection | `botwall.js` signatures + hosted AA's Facebook phrases, run on DOM text **and** OCR of screenshots | ours + hosted AA |
| Wayback | Port `worker/archivers/wayback.js` (SPN2, `skip_first_archive`) | ours |
| Accounts/cookies | `THROWAWAY-ACCOUNTS.md` procedure, but output a browsertrix `profile.tar.gz` per platform; `generate-profile.js` becomes the profile builder | ours |
| Backup and mirror | `backup/archivebox-backup.sh` → generalised; `mirror/` syncs the new bucket prefix too | ours |
| Legacy ArchiveBox snapshots | **Freeze**: stop the Django server and serve `/data/archive` as static files (the mirror already does this) | ours |

Dropped: Django admin, `index.sqlite3`, all 10 patches, `reconcile.js`, `social-sweep.js`, `injectScreenshot()`, rclone/FUSE, and `docker.sock` in the worker.

### 6.2 Verdicts instead of "archived"

Each witness returns structured evidence, and the gate assigns one of:

| Verdict | Meaning | Shown publicly? |
|---|---|---|
| `complete` | Primary content captured: expected fields present (author, text or media), media count and duration plausible, no wall signature | yes |
| `partial` | Some primary content, e.g. embed text only, or a video without the full caption | yes, labelled |
| `walled` | Every primary witness hit a login/consent/bot wall. Kept as evidence of *what the site served*. | no, review queue |
| `unavailable` | The platform says the content is gone or restricted (404, "not available in Vietnam", Threads `invalid_post`). Itself evidence of takedown or censorship. | yes, labelled |
| `failed` | Technical failure; retried with backoff | no |

Signals the gate uses:
- wall phrases in DOM text and in OCR of the screenshot;
- `__user=0` on a crawl that was supposed to be logged in;
- final URL ≠ requested URL (e.g. redirected to `/login` or `?error=`);
- page-title heuristics ("Log in", bare site name), as the hosted fork does;
- video present but duration 0;
- a perceptual hash matching a known wall screenshot.

A Wayback URL never upgrades a verdict on its own.

### 6.3 Data model (additions)

```sql
captures  (id, archive_id → archives, started_at, finished_at, verdict, adapter, adapter_version,
           tool_versions jsonb, egress (direct|proxy:<name>), session (none|<platform>:<account-alias>),
           final_url, manifest_sha256, tsa_token, notes)
artifacts (id, capture_id, kind (video|image|screenshot|wacz|html|pdf|text|metadata|wayback),
           role (primary|context), sha256, phash, bytes, mime, duration_s, width, height,
           storage_key, source_url)
```

`archives` keeps its public fields, and its `status` becomes a projection of the latest capture's verdict. Re-archiving a URL adds a new `captures` row (versioned, Atlos-style) and never overwrites, which preserves the "how did this page change" use case.

### 6.4 Operations

- **Pin everything**: browsertrix tag, auto-archiver version, yt-dlp version, Playwright version, all by digest. Bump yt-dlp **deliberately** every 2–4 weeks via a PR that must pass the canary.
- **Canary:** a fixed list of about 15 real URLs (2 per platform and content type plus VN news/gov) runs nightly. The result goes into a `platform_status` table and alerts on regression. This answers "did Facebook break this week?" before users notice.
- **Egress:** default is direct from the VPS. Optionally route Meta and YouTube through a residential or VN-region proxy (config per adapter). Consider moving the capture VPS to OVH Singapore (README already weighs this).
- **Rate limits per platform** (e.g. Facebook ≤ 20 captures/hour per session) plus a **circuit breaker**: one OCR "automated behaviour" hit pauses that platform's session and alerts.
- **Isolation:** each capture gets a fresh temp dir and a fresh browser context. Logged-in profiles are copied read-only per run (browsertrix does this) and are never shared between tools.

---

## 7. Platform playbooks

### Facebook

| Tier | Requires | Captures |
|---|---|---|
| **T0: logged out** (always runs) | nothing | yt-dlp for reels/videos/watch (full video + caption + uploader + timestamp) · embed plugin `plugins/post.php?href=<url>&show_text=true` screenshot + HTML + text · `og:` meta · public group posts in the browser · SPN2 of the **embed** URL |
| **T1: session** (when configured) | throwaway account → browsertrix `profile.tar.gz` | full WACZ of the post · click "See more" for full text · first page of comments · carousel walk for every full-res photo (port of the hosted fork's `pcb.` logic) · stories |
| **T2: egress** (when T0/T1 are flagged) | residential/VN proxy | same as T0/T1 |

The quality gate requires author + text + (media, if the post has any). With only T0 available, a photo post with long text is `partial`: text truncated at "Xem thêm", first photo only. That is honest and still better than today.

### Threads

| Step | How |
|---|---|
| Resolve | Open `share/…` links in the browser and keep the final `@user/post/<code>` URL. `?error=invalid_post` means `unavailable`. |
| Capture | Post page: wait for network idle, remove `[role=dialog]`, restore scrolling, take a full-page screenshot, save DOM text and `og:` meta. Record media responses (`cdninstagram`/`fbcdn` images and videos) and download originals. Plus the `/embed` card screenshot (clean, legible, ideal as the public thumbnail). Plus a browsertrix WACZ. |
| Gate | Author + text + timestamp present; image/video count matches the post |
| Session | Optional (Instagram-backed); only needed for long reply threads |

### YouTube, Instagram, TikTok, X

auto-archiver's extractors, with yt-dlp pinned and recent.
- **YouTube:** add the `bgutil-ytdlp-pot-provider` sidecar (PO tokens) and a consent-cookie or profile for the screenshot witness.
- **Instagram:** yt-dlp worked logged out for reels in the sandbox; gallery-dl got 429.
- **TikTok, X:** use the upstream drop-ins.

### Web pages and documents (VN news, gov notices)

browsertrix WACZ (replayable, standard format) + SingleFile HTML + full-page screenshot + PDF fetch for documents + SPN2. Keep `CHECK_SSL_VALIDITY` off (README rationale stands) but **record the TLS certificate** with auto-archiver's `ssl_enricher`, so the trade-off is documented per capture.

---

## 8. Quick fixes to the current platform: not pursued

> **Decision 2026-10-18:** nobody is using the current setup, so it is left as-is. The list below is kept only as a record of known defects. Each one is designed out of the new platform rather than patched.

| # | Fix | File | Fixes |
|---|---|---|---|
| 1 | Pin the base: `FROM archivebox/archivebox:0.7.4@sha256:<cached digest>`; pin `bellingcat/auto-archiver:1.2.9`. Build once with a derived AA image that bakes in a current yt-dlp and disables self-update. | `archivebox/Dockerfile`, `worker/archivers/autoarchiver.js` | F7, F2.3 |
| 2 | `parseResult()`: prefer video > image > pdf; store **all** artifact URLs (add `artifacts jsonb` or reuse `wacz_url` until §6.3); keep auto-archiver's text and metadata | `worker/archivers/autoarchiver.js`, `backend/db.js` | F2.1, F1 |
| 3 | Add `--output=%(id)s.%(ext)s` to `YOUTUBEDL_ARGS` (env on the archivebox service, full list) | `docker-compose.vps.yml` | F2.2 |
| 4 | Run bot-wall detection on auto-archiver output too; add the Facebook phrases ("see more on facebook", "create new account", "forgotten password", "log in to facebook"); set `status='walled'` instead of only tagging | `worker/botwall.js`, `worker/index.js` | F1 |
| 5 | Don't count Wayback toward `archived` for Meta URLs; treat `?error=invalid_post` final URLs as `unavailable` | `worker/index.js` | F6, F1 |
| 6 | Hash the primary media file (video/image), not `index.html` | `worker/integrity.js` | F8 |
| 7 | One-off: re-queue the ~95 social rows that only have a wall or thumbnail once #2–#4 are deployed | SQL | F1 |

None of these needs new infrastructure, and all of them carry over to the rebuild.

---

## 9. Plan

| Phase | Weeks | Deliverables | Exit criterion |
|---|---|---|---|
| 0. Foundations | 1 | New `capture/` service skeleton · schema · canonicaliser · canary list · decision on accounts (§10) | Service runs locally in Docker with tests passing |
| 1. Capture service MVP | 2–4 | Python service · Postgres queue · `captures`/`artifacts` tables · media, page (WACZ) and view witnesses · quality gate · B2 storage · manifest + SHA-256 + RFC 3161 · runs as `tool='capture'` **in shadow** next to the current worker | On the canary + 50 historical URLs: no `complete` verdict on a wall; every video stored and linked |
| 2. Social depth | 5–6 | Threads adapter · Facebook T0 + T1 (session profiles, carousel walk, OCR guard, circuit breaker) · YouTube POT sidecar · optional proxy egress | Canary ≥ 90% `complete`/`partial` for FB/Threads with a session; wall rate visible per platform |
| 3. Viewer + cutover | 7–8 | ReplayWeb.page + media viewer in `materials`/`archive-admin` · mirror syncs the new prefix · switch `POST /api/archive` to the new service · ArchiveBox frozen read-only · re-capture of historical `walled` rows | ArchiveBox container removed from `docker-compose.vps.yml`; `docker.sock` gone |
| 4. Workspace | 9–12 | §11.4: Supabase Auth accounts + RLS roles (retire the shared token) · §11.6 save-from-anywhere: personal submit-only tokens, `/api/inbox`, PWA share target, iOS Shortcut, browser extension, Telegram bot · paste-many · duplicate check · capture card with verdicts · auto-filled metadata · review queue, assignees, activity feed · versions view | Contributors submit and review from a phone, in Vietnamese, with per-person attribution |

**Progress (2026-10-18):** the Phase 0 foundations and the core of Phase 1 are built in [capture/](../capture/README.md): schema, URL canonicaliser, inbox API with personal tokens, worker with media/view/wayback witnesses, Facebook/Threads/Instagram embed capture, quality gate, sealing and content-addressed storage, unit tests and a canary. Still open in Phase 1: the WACZ witness and B2 deployment.

Estimates assume one developer familiar with the repo. Phase 2's Facebook work is the least predictable part: Meta changes markup often, and the hosted fork's commit log shows weekly Facebook fixes through October 2026. Budget ongoing upkeep of **about 1 day/month** for adapters and sessions after launch.

---

## 10. Risks and decisions needed

1. **Sock-puppet accounts.** Logged-in Facebook capture is what makes the hosted service work, and it breaks Meta's ToS. It also risks account bans, and for a seized server, a live session. The existing [THROWAWAY-ACCOUNTS.md](../archivebox/THROWAWAY-ACCOUNTS.md) procedure is the right shape. **Decision:** run T1 ourselves, buy option D for Facebook, or accept T0 (`partial`) only?
2. **Capture egress.** Datacenter IPs get worse results. **Decision:** budget for a residential/VN proxy, or move the capture VPS region?
3. **Storage growth.** Storing videos and WACZ properly will grow the archive faster than today's ~17 MB/snapshot (a 40 s reel is ~8 MB; a news WACZ ~24 MB). B2 is cheap, but the mirror sizing in `mirror/README.md` should be revisited.
4. **Review load.** `walled`/`unavailable` items need a human. Who triages, and in which UI? (NocoDB view, or the existing archive-admin tab.)
5. **Supabase free-tier quota** (grace period ended 2026-10-17). Keep capture artifacts on B2, not Supabase Storage.

---

## 11. Collaboration and intake UI for non-technical contributors

Capture quality is half the problem. The other half is that the people who *find* the links (content managers, researchers, community contributors, mostly on phones and in Vietnamese) need a way to submit them, describe them and review them together, without a spreadsheet and without help from a developer.

### 11.1 What exists today

| Surface | Good at | Falls short on |
|---|---|---|
| **In-app Archive admin sheet** ([app/archive-admin.jsx](../app/archive-admin.jsx)) | Bilingual form; map picker; case/topic assignment; queue list | One **shared Bearer admin token** for everyone, so no per-person identity, attribution or revocation. Every field (titles VI/EN, source, account, date) is typed by hand, though the capture could fill most of them. No preview of what was captured. No comments or assignment. Desktop-oriented. |
| **NocoDB** (`memorylanedb.heomay.xyz`) | Airtable-style grid, filters, kanban/gallery views, inline edit, M:N topic links. Postgres-enforced column fence (`content_manager` role). Cloudflare Access in front. | **Cannot add links**: the role has no `INSERT` on `archives`. Shows captures only as raw URLs. Edits arrive as one shared DB role, so Postgres can't tell who changed what (NocoDB's own audit log can). No capture-aware workflow. |

### 11.2 What Atlos gets right (worth copying regardless)

From Atlos's docs and source:
- **Incident ↔ source-material model.** One "incident" holds many pieces of evidence, each auto-archived and *versioned*. This maps directly onto our `cases` ↔ `archives`.
- **Every change is an "update" in a feed with an optional explanation.** Nothing is destructively edited. Comments live in the same feed.
- **A fixed review workflow:** To Do → In Progress → Help Needed → Ready for Review → Completed / Cancelled, plus **assignees**.
- **Five project roles** from Data-only Viewer to Owner; invite links that can be revoked; flair to show organisation; suspend rather than delete users.
- **Custom attributes per project** (text, single/multi-select, date, geolocation with a precision level); **bulk CSV import**; CSV export of any search.
- **Safety features:** sensitive-media flags with blur, and guidance on vicarious trauma.
- **auto-archiver integration already exists** (`atlos_feeder_db_storage`): AA reads unarchived links from Atlos and writes artifacts and status back.

Why not adopt it as-is:
- **English-only UI.** Strings are hardcoded and there is no locale besides `en`.
- GPLv3 Elixir stack; self-hosting needs ≥2 clustered nodes plus PostGIS, and Atlos itself recommends against self-hosting for most organisations.
- The hosted service puts the evidence on a third party; organisation pricing is by enquiry (the docs list Enterprise at $500/month for small teams).
- It would become a **second source of truth** next to MemoryLane's `cases`/`archives`/`memories`, kept consistent by a sync job.

### 11.3 Options

| | Option | Effort | Fit |
|---|---|---|---|
| **U1** | **Make NocoDB the intake + review desk.** Grant column-level `INSERT` on `archives` (URL, type, case, notes) with DB defaults for `id`/`created_at`/`status`. A NocoDB **Form view** becomes the "submit a link" page and a **Kanban view by status** becomes the review board. The capture service writes back read-only display columns (thumbnail URL, verdict, captured title/author/date/text) so the grid and **Gallery view** show what was captured. | 2–3 days | Quick and on infrastructure you already run. Still a database UI: no evidence viewer, weak attribution, generic UX. |
| **U2** | **Atlos (hosted) as the collaborative workspace.** Our capture service (or AA's Atlos module) handles archiving; approved incidents sync to MemoryLane via the Atlos API. | 2–3 weeks integration + subscription | Best-in-class workflow on day one. English-only, third-party custody, two systems to keep in sync. |
| **U3** | **Build a "Workspace" into MemoryLane** on top of the capture service (§11.4) | ~3–4 weeks, after Phase 1 | Vietnamese-first, mobile-first, one source of truth, evidence preview built in. Most work. |

**Decided: U3 as part of the rebuild (U1 skipped along with all changes to the current stack), borrowing Atlos's model (§11.2).** NocoDB stays as the power-user grid for bulk editing; U3 becomes the everyday surface for contributors. Revisit U2 only if the team grows into multi-organisation investigations where Atlos's maturity outweighs language and custody.

### 11.4 Workspace design (U3)

**Principle: paste a link, and everything else is a suggestion to confirm, not a field to fill.**

1. **Identity and roles.** Per-person accounts via Supabase Auth with magic link or email OTP: no passwords, nothing for contributors to remember. Roles Contributor → Reviewer → Editor → Admin, enforced with Postgres RLS (the same "the database is the fence" approach the `content_manager` role already takes). This **retires the shared Bearer token**. Every row records `submitted_by`/`updated_by`; display names can be pseudonyms.
2. **Intake from wherever people already are**, in the style of raindrop.io and Zotero (full design in §11.6). The phone **share button** inside Facebook, Instagram, Threads, TikTok and YouTube; a **browser extension** button; plus a paste-many box, a Telegram bot and CSV import.
3. **Instant feedback at paste time.**
   - URL canonicalisation and a **duplicate check**: "This link was saved by Lan 2 days ago — view it / save a new version".
   - Then a live **capture card** showing the screenshot/video as soon as it lands, with a plain-language verdict: *Đã lưu đầy đủ* (complete), *Chỉ lưu được một phần* (partial), *Bị chặn — cần kiểm tra* (walled), *Nội dung đã bị gỡ* (unavailable).
4. **Auto-filled metadata.** Prefill from the capture: title, author/account, post date, text and language, platform. Then:
   - **suggest** a Vietnamese/English title and a case or topics (an LLM call is reasonable here, always shown as a suggestion to accept or edit);
   - **suggest** a map location from place names in the text, with Atlos-style precision (exact / vicinity / locality).
5. **Review workflow.** Atlos's statuses and assignees, a **review queue** that puts `walled`/`unavailable` captures first, one-tap approve/reject with reason, and a per-item **activity feed** of updates and comments with @mentions and email notifications.
6. **Versions.** "Capture again" adds a new capture under the same item, and a side-by-side view shows how a post changed or when it disappeared, which is central to documenting takedowns.
7. **Safety.** A sensitive-media flag blurs content until clicked. Contributors are reminded never to use personal accounts (link to [THROWAWAY-ACCOUNTS.md](../archivebox/THROWAWAY-ACCOUNTS.md)). Contributor names are never shown publicly.
8. **Exports.** CSV/JSON of any filtered view, plus a "case dossier" export (manifest + hashes + media) for partners or lawyers.

### 11.5 U1 steps (not pursued, kept for reference)

1. `content-manager-role.sql`:
   - `GRANT INSERT (original_url, media_type, case_id, collection, title_vi, title_en, source, account, doc_date, notes, city, cat, lat, lng) ON archives`;
   - add defaults on `archives.id` and `created_at`; `status` already defaults to `pending`, so the worker picks new rows up unchanged;
   - add a `CHECK` that `original_url` is `http(s)`.
2. In NocoDB:
   - a Form view "Gửi liên kết / Submit a link" with only URL, type, case and notes visible;
   - a Kanban view on `status`;
   - a Gallery view on a new `preview_url` column (written by the worker).
3. Have the worker write back `preview_url` (screenshot or thumbnail), `verdict` and the captured title/author/date into read-only columns.

This gives contributors a link inbox and a visual board right away, with no new service.

### 11.6 "Save to MemoryLane" from anywhere (raindrop.io / Zotero-style)

**Target experience:** a contributor is scrolling Facebook on their phone, taps **Share → MemoryLane**, a small sheet slides up with the post already recognised, they optionally pick a case and add a note, tap **Lưu** (save), and are back in Facebook in under 5 seconds. Archiving happens on the server; the sheet or extension later shows how it went. On a computer, the same in one click from the toolbar, or by right-clicking any link.

#### The save sheet (shared by every entry point)

Same component everywhere (phone, extension popup, web), modelled on raindrop.io's "add bookmark" sheet:

```
┌─────────────────────────────────────────┐
│ [thumbnail]  Nguyễn Văn A · Facebook   │  ← recognised instantly from the URL
│              "Bài viết thử nghiệm về…" │    (title/text filled in as the capture lands)
│ ⚠ Đã có người lưu link này 2 ngày trước │  ← duplicate check (only if already saved)
│   [Xem]  [Lưu phiên bản mới]            │
├─────────────────────────────────────────┤
│ Hồ sơ (case)   [ Phúc Tân ▾ ]  (last used)│
│ Chủ đề (tags)  [cưỡng chế] [+]          │
│ Ghi chú        [ optional note…       ] │
│ ☐ Nội dung nhạy cảm (blur)              │
├─────────────────────────────────────────┤
│             [   Lưu   ]                 │  ← only the URL is required
└─────────────────────────────────────────┘
```

- **One tap is enough.** URL is the only required field; case and tags default to the contributor's last choice; everything else can be added later in the Workspace.
- **Instant recognition, no network wait:** platform and post type are parsed from the URL locally. Server enrichment (title, author, thumbnail) fills in if it arrives while the sheet is open.
- **After saving:** a toast "Đã gửi vào kho lưu trữ" (sent to the archive). Later, a status in the extension badge / Workspace inbox: saved fully · partly · blocked · removed (the §6.2 verdicts).
- **Works offline / on bad connections:** saves queue locally and retry (important on mobile).

#### Phone: the share button in Facebook, Instagram, Threads, TikTok, YouTube, Zalo

These apps all hand a URL to the operating system's share sheet ("Share → More…" / "Chia sẻ qua…"). What appears in that sheet depends on the OS:

| Option | Android | iOS | Distribution | Effort | Notes |
|---|---|---|---|---|---|
| **A. Installable web app (PWA) with Web Share Target** | ✓ appears in the share sheet once "Add to Home screen" is done from Chrome | ✗ iOS does not support web share targets | None (it's the website) | ~3–4 days | Manifest `share_target` → `/save?url=…&text=…` opens the save sheet. Facebook often puts the link in `text`, not `url`, so parse both. |
| **B. Apple Shortcut "Lưu vào MemoryLane"** | — | ✓ appears in the share sheet | An iCloud link to install | ~1 day | Receives the URL, calls the API with the contributor's personal token, shows a notification. No case/tag picker beyond a simple menu. Good stop-gap for iOS. |
| **C. Native app with a share extension** (Capacitor or Expo wrapping the same web UI) | ✓ | ✓ | Play Store + App Store (or TestFlight / sideload APK) | ~2–3 weeks + store review | The raindrop.io experience exactly, on both platforms. **Risk:** store listings can be pulled on government request, and a store listing makes the project discoverable. A sideloaded APK + TestFlight avoids public listings. |
| **D. Telegram bot** | ✓ | ✓ | Nothing to install beyond Telegram | ~2 days | Share → Telegram → the bot replies with the verdict. Zero-friction for people who already use Telegram. A Zalo OA bot is the equivalent, pending Zalo's business verification. |

**Recommended:** A + B first (about a week; covers Android and iOS with nothing to publish), D in parallel as the lowest-friction option, and C only if usage justifies it and the store risk is acceptable.

#### Desktop: a small browser extension, Zotero-connector style

A Manifest V3 WebExtension (one codebase: Chrome, Edge, Brave, Firefox; Safari later via Apple's converter).

- **Toolbar button.** Click to open the save sheet for the current tab. Keyboard shortcut (e.g. `Alt+Shift+S`).
- **Right-click "Lưu liên kết này vào MemoryLane"** on any link. This matters most on Facebook and Threads: right-click a post's timestamp in the feed to save *that post* without opening it.
- **Site detectors** (Zotero calls these "translators"). Small per-site scripts that work out *what* you're saving: on a Facebook feed or group page, the permalink of the post in view rather than the feed URL; on Threads, the canonical `@user/post/<id>`; on YouTube, the video rather than the playlist; on news sites, `og:`/`ld+json` metadata. The toolbar icon changes to show the detected type (post, video, article, PDF), as Zotero's does.
- **Never looks things up by itself.** The extension makes no requests while you browse; it only talks to the server when you click Save. Otherwise it would leak every page a contributor visits.
- **Minimal permissions:** `activeTab`, `contextMenus`, `storage`, and host permission for the MemoryLane API only. Distribute through the Chrome Web Store / Firefox Add-ons as *unlisted*, or as a signed package from the Workspace, to keep it off public search.

**Optional "also save what I see" (contributor capture).** Zotero and Webrecorder's ArchiveWeb.page can record the page *from the user's own browser*. For us that would solve login walls, since the contributor is already logged in. It also brings real risks:
- the page chrome shows **the contributor's own name, avatar and friends**, which deanonymises them inside the archive;
- the capture comes from an untrusted device, so it is weaker evidence than a server capture.

If offered at all: off by default, records only the post element (not the page chrome), is labelled *contributor capture* alongside the server capture, and is recommended only in a dedicated browser profile logged into a throwaway account (per [THROWAWAY-ACCOUNTS.md](../archivebox/THROWAWAY-ACCOUNTS.md)).

#### What the backend needs for this

1. **Personal, submit-only tokens.** Each contributor creates one in the Workspace ("Connect a device"), shown as a QR code for phones and pasted into the extension and Shortcut. It can only *submit and read own submissions*, and is revocable per device. **The current shared admin token must never go into a Shortcut or extension:** it can also approve, reject and delete.
2. **`POST /api/inbox`:** accepts `{url, text, title?, caseId?, topics?, note?, sensitive?, client}`, extracts the URL from shared text, and returns `{id, duplicateOf?, platform}` immediately. It is idempotent per (user, canonical URL, 10 min), so double-taps don't double-save.
3. **URL canonicalisation before the duplicate check:**
   - strip tracking parameters (`fbclid`, `mibextid`, `rdid`, `share_url`, `xmt`, `slof`, `igsh`, `si`, `utm_*`); production rows already carry `xmt=…&slof=1` and `#<timestamp>` fragments;
   - resolve share links (`facebook.com/share/…`, `threads.com/share/…`, `fb.watch`, `youtu.be`) to the canonical post;
   - keep the URL exactly as submitted as well, as evidence.
4. **`GET /api/inbox/:id`** (and a small "my recent saves" list) for the badge, toast and Workspace inbox to show the verdict.
5. **Rate limits per token**, not per IP (mobile IPs are shared and change constantly), via the existing HMAC limiter.

#### Effort

| Piece | Effort |
|---|---|
| Tokens + `/api/inbox` + canonicaliser + duplicate check | ~4 days |
| Save sheet (responsive, Vietnamese/English) + PWA manifest/service worker/share target | ~4 days |
| iOS Shortcut + install guide | ~1 day |
| Browser extension (button, context menu, 3 site detectors: Facebook, Threads, generic) | ~5 days |
| Telegram bot | ~2 days |
| **Total** | **~3 weeks**, slotted into Phase 4 (or pulled forward: it works against today's queue too, not only the rebuilt capture service) |

---

## Appendix A: test matrix (sandbox, residential IP, 2026-10-18)

| URL | Prod record | ArchiveBox 0.7.4 (sandbox) | auto-archiver 1.2.9 | yt-dlp | Browser, logged out |
|---|---|---|---|---|---|
| FB reel 900000000000009 | `archived`, thumbnail only | screenshot = login wall; **media ✗ (filename >255 B)** | ✓ MP4 41.6 s + caption | ✓ HD | caption + video stream |
| FB post person.a/pfbid0EX… | `archived`, one photo | screenshot = login wall; title ✓ | "success": og image + truncated text | ✗ login | page ✗ wall; **embed ✓** |
| FB group post 1158…/1720… | `archived`, image | — | — | — | ✓ text renders |
| Threads @user.b/PostCode001 | `archived`, modal screenshot | title ✓, no wall flag | **nothing archived** (antibot crash) | ✗ unsupported | ✓ full post + replies; **embed ✓** |
| Threads share/ShareCode01 | `archived` | — | — | ✗ unsupported | ✓ resolves to post |
| YouTube Short jSc5Dn8Z1xQ | `archived`, consent wall | ✓ video (residential IP) | — | ✓ | — |
| Instagram reel DZWmzjOILRo | `archived`, sign-up modal | ✓ MP4 | — | ✓ | — |
| vnexpress.net | — | ✓ 10/12 (media ✗) | — | — | browsertrix WACZ 24 MB ✓ |

## Appendix B: reproduce

```bash
# ArchiveBox sandbox (needs the cached 0.7.4 base; --pull will fail, see F7)
docker build -t mlaudit-archivebox ./archivebox
docker run -d --name mlaudit-ab -p 127.0.0.1:18000:8000 -v mlaudit-ab-data:/data \
  -e SAVE_ARCHIVE_DOT_ORG=False -e CHECK_SSL_VALIDITY=False -e TIMEOUT=180 \
  mlaudit-archivebox server --quick-init 0.0.0.0:8000
docker exec --user=archivebox mlaudit-ab archivebox add "<url>"

# The FB-reel media failure (F2.2)
docker exec --user=archivebox -w /tmp mlaudit-ab yt-dlp --write-description <fb reel url>

# auto-archiver with production's modules, local storage
docker run --rm -v "$PWD/aa:/aa" bellingcat/auto-archiver:1.2.9 --config /aa/orchestration.yaml "<url>"

# browsertrix WACZ
docker run --rm -v "$PWD/crawls:/crawls" webrecorder/browsertrix-crawler:1.15.0 crawl --url "<url>" \
  --scopeType page --generateWACZ --text to-pages --screenshot view
```

## Appendix C: sources

- auto-archiver.com · osr4rightstools.org/auto-archiver · github.com/djhmateer/auto-archiver (`wacz_extractor_enricher.py`, `screenshot_enricher.py`, `utils/webdriver.py`, `facebook_story_extractor`, `generic_extractor/facebook.py`, `PLATFORM_STATUS.md`, `docs/…/ubuntu_24_server_install.md`)
- github.com/bellingcat/auto-archiver v1.2.9 (`modules/`) · bellingcat.gitbook.io/toolkit/more/all-tools/auto-archiver
- github.com/atlosdotorg/atlos (`platform/README.md`, `platform/utils/archive.py`, `lib/platform/workers/archiver.ex`)
- This repo: `README.md` § Archiving, `archivebox/Dockerfile`, `worker/`
