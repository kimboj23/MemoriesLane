# Integrating the capture platform with the public platforms

**Status:** proposal, for decision · **Date:** 2026-10-18 · **Related:** [archiving-platform-proposal.md](archiving-platform-proposal.md), [capture/README.md](../capture/README.md)

## 1. The question

The internal platform (`capture/`) is where links are captured, checked, organised into projects and incidents, and reviewed. Two public platforms face the community:

- **MemoryLane community map** (memorylane101.pages.dev): anonymous people pin memories, photos, videos and documents to a map; moderators approve them; case pages show archived source material.
- **Hồ sơ Nhân quyền** (the mockup at ho-so-nhan-quyen…chatgpt.site): a public human-rights database of cases in four groups (violations, trials, social-media restrictions, social movements). People report a new case (`/report-case`) or submit a document (`/submit`, optionally attached to a case, anonymous allowed, quarantined before review). The site shows evidence (`/evidence`) and a map at "safe precision".

Wanted:
1. Whatever the community shares on either site enters the internal platform's queue for processing.
2. What the internal platform has processed and approved is displayed on the public sites.

## 2. Recommendation in one paragraph

Treat the internal platform as the **hub and the only system of record**, and the public sites as **spokes** that do two narrow things:

- **Collect.** A spoke keeps its own anonymous submission forms, but forwards every submission to a write-only **Intake API**. The spoke cannot read anything back except a receipt.
- **Display.** A spoke shows only what the hub has deliberately **published**: a separate, reviewed public version of an incident, a piece of material or a memory, with locations generalised, risky details removed and media cleaned.

Publication is a **signed static feed** (JSON plus files on a public bucket and CDN) that any spoke, or any mirror, can read. Nothing on the public side can query the internal database. A public site going down, being taken over or being seized never exposes unpublished material, contributors or reviewers. The feed can also be mirrored to the existing B2/Tor mirror, so published evidence outlives a takedown of any one site.

## 3. Shape

```
        COMMUNITY (anonymous)                                PUBLIC READERS / MIRRORS
              │  forms                                               ▲  HTTPS / Tor
              ▼                                                      │
 ┌───────────────────────────┐   ┌───────────────────────────┐   ┌──┴───────────────────────────┐
 │ MemoryLane community map  │   │ Hồ sơ Nhân quyền          │   │ Publication feed (static)    │
 │ (Cloudflare Pages + API)  │   │ (public site + API)       │   │ public bucket + CDN          │
 │  · own submit + rate limit│   │  · report-case / submit   │   │  index.json + .sig           │
 │  · renders the feed ◀─────┼───┼── renders the feed ◀──────┼───┤  records/*.json, files/*    │
 └────────────┬──────────────┘   └────────────┬──────────────┘   └──────────────▲───────────────┘
              │ Intake API (write-only, signed)│                                 │ publisher (one-way)
              └───────────────┬────────────────┘                                 │
                              ▼                                                  │
 ┌────────────────────────────────────────────────────────────────────────────────┴───────────────┐
 │ INTERNAL PLATFORM (capture/, private: VPS behind Cloudflare Access/tunnel)                     │
 │  intake queue ─▶ triage (Hộp tiếp nhận) ─▶ incidents / items ─▶ captures (sealed, hashed)      │
 │                        │                         │                                             │
 │                        └──── review & publish (bản công khai, two-person rule) ────────────────┘
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Principles

1. **One system of record.** Incidents, evidence, captures, decisions and audit trail live only in the hub. Spokes hold their own submission drafts and a cache of the public feed, nothing else of value.
2. **Write-only inbound, read-only outbound.** A spoke's credential can create intake records and nothing more. The feed is public data by construction.
3. **The public version is a separate artifact.** Like the mockup's "chuẩn bị bản công khai riêng", publishing never exposes the internal record. It creates a reviewed projection with its own text, its own location precision and its own cleaned media.
4. **Minimum data.** No IP addresses (the existing HMAC rate-limit approach), no submitter identity published, optional contact details encrypted. Submitters never become platform accounts unless they choose to.
5. **Safety before speed.** Nothing is published automatically. Publication needs a project manager plus a second reviewer. Sensitive incidents default to coarser locations and no original URLs.
6. **Survivable.** The feed is static, signed and mirrorable (existing `mirror/` + Tor onion). A spoke can be rebuilt from it. Withdrawals propagate as tombstones.

## 5. Inbound: the Intake API

### 5.1 Sources and credentials

Each spoke is registered in the hub as a **source**, such as `memorylane-map` or `ho-so-nhan-quyen`, with:

- a **service key** that may only call `/intake/v1/*`, held only by the spoke's backend and never sent to the browser;
- request signing: `X-Source`, `X-Timestamp` and `X-Signature = HMAC-SHA256(key, timestamp + method + path + sha256(body))`, rejected if older than 5 minutes or replayed (nonce cache);
- a per-source rate limit and size quota; optionally an IP allowlist for the spoke's backend.

### 5.2 Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/intake/v1/submissions` | A submission (JSON, see 5.3). Idempotent on `(source, external_id)`. Returns `{intake_id, receipt}` |
| PUT | `/intake/v1/submissions/{intake_id}/files/{n}` | Upload an attachment, streamed. Max 60 MB video / 20 MB other (as both sites already limit) |
| GET | `/intake/v1/receipts/{receipt}` | Optional, public: status of a submission for its submitter (`received / in review / published / not published`), with no details |

The `receipt` is a random code shown to the submitter. It lets an anonymous person check status without an account, matching the mockup's anonymous flow.

### 5.3 Submission kinds

All kinds share the same envelope; the `payload` differs.

```json
{
  "external_id": "mem_8f3k2",            // the spoke's own id: makes retries idempotent
  "kind": "memory",                       // memory | case_report | document | link
  "submitted_at": "2026-10-18T09:12:00Z",
  "lang": "vi",
  "payload": { ... },                     // per kind, below
  "links": ["https://www.facebook.com/…"],// every URL found in the text: captured automatically
  "files": [{"n": 1, "mime": "image/jpeg", "bytes": 81234}],
  "contact": {"sealed": "…"},             // optional, encrypted in the browser to the hub's public key
  "consents": {"may_publish": true, "has_rights": true}
}
```

| Kind | From | Payload |
|---|---|---|
| `memory` | MemoryLane map | `text`, `date` (year/month/day, label), `location` {lat, lng, city, ward}, `category` (personal / news / community / event), `case_ref` (public case id, optional) |
| `case_report` | Hồ sơ Nhân quyền `/report-case` | `group` (violation / proceeding / platform_restriction / movement), `title`, `description`, `timeline`, `location`; group-specific fields: e.g. court and stage for proceedings; platform, restriction type and date for platform restrictions |
| `document` | Hồ sơ Nhân quyền `/submit` | `doc_type`, `title`, `context`, `case_ref` (public case id, optional, "leave blank if new"), `alt_link` (HTTPS) |
| `link` | either; also the share sheet | `url`, `note` |

Contact details are encrypted in the browser to the hub's public key (libsodium sealed box), so the spoke never holds them in clear text. Only project owners and managers can decrypt them, inside the hub.

### 5.4 What the hub does with a submission

1. **Store** it in `capture.intake`, pending, together with its source and external id. Attachments go to quarantine storage: type sniffing, size limits, image re-encoding with EXIF and GPS stripped (the original kept, sealed, for evidence), optional ClamAV scan for documents.
2. **Capture every link immediately.** Each URL becomes an item and is captured as usual, even before review, because posts get deleted fast. It stays unfiled and private until triage.
3. **Seal attachments as evidence.** A contributor-provided file becomes an artifact of a new witness type `upload`, hashed and in the manifest, and labelled *provided by a contributor*. It is never presented as our own capture.
4. **Route** it to the right project's **Hộp tiếp nhận** (intake inbox) using source rules, e.g. MemoryLane memories → project "Bản đồ ký ức"; Hồ sơ Nhân quyền case reports by group → the matching project; a `case_ref` that maps to a published incident → straight to that incident's intake.
5. **Triage** (viewer+ can comment, editor+ can act), in an Atlos-style queue:
   - **attach** to an existing incident (the items are filed via `item_incidents`), **create** a new incident from it, or **reject** with a reason;
   - each action posts to the feed and notifies followers. Duplicates are flagged via canonical URLs and perceptual hashes of photos.
6. **Moderation moves into the hub.** The spokes' own moderation screens (MemoryLane's admin token sheet, NocoDB edits) retire, so there is one review path, with roles, audit trail and four-eyes publication.

## 6. Outbound: publication

### 6.1 The public version

A **publication** is a reviewed, versioned projection of one hub record:

| Field | Notes |
|---|---|
| `public_id` | random slug (e.g. `hn-7kq2m`), never the internal UUID or `CODE-12`, which reveal internal structure |
| `type` | `incident` (a case on Hồ sơ Nhân quyền, a case page on MemoryLane), `material` (one link with its public files), `memory` |
| title / summary / text | written for the public, VI + EN; can differ from the internal description |
| location | `{lat, lng, precision}`: generalised per a safety level. Exact for public buildings, ward or commune centroid when people could be identified, city only for the most sensitive. The internal exact location is never in the feed |
| date | possibly coarsened (month only) |
| public status | e.g. `verified` / `being verified` / `reported`: a mapping of the internal status and verdicts, not the internal workflow |
| materials | the public files chosen by the reviewer: screenshots, video, restriction notices; EXIF-stripped re-encodes, optional face or number-plate blurring (manual at first); each with its SHA-256 **and** the sealed capture's manifest hash, so anyone can verify it against the archive |
| original URL | shown or withheld (withheld by default if the post identifies a private person) |
| Wayback link | if one exists |
| contributor credit | none, or the pseudonym the contributor chose, never an account name |

**Workflow:** draft (editor) → approved (manager plus one other reviewer) → published → (corrected = new version) → withdrawn. The reason for each step is in the incident feed. A withdrawal publishes a tombstone, so every spoke and mirror deletes the record.

### 6.2 The feed

A static tree on a dedicated public bucket (Cloudflare R2 or B2 behind Cloudflare), written only by the hub's **publisher** job:

```
/feed/v1/index.json            every live record: {type, public_id, version, updated_at, sha256}; plus tombstones
/feed/v1/index.json.sig        Ed25519 signature of index.json; the public key is published on both sites
/feed/v1/records/{public_id}.json
/feed/v1/files/{sha256}.{ext}  content-addressed public files (cleaned derivatives)
/feed/v1/changes/{yyyy-mm-dd}.json   incremental changes, so spokes don't re-read everything
```

```json
{
  "type": "material", "public_id": "mt-q81zd", "version": 3, "updated_at": "2026-10-18T10:02:00Z",
  "incident": "hn-7kq2m",
  "platform": "threads", "captured_at": "2026-10-18T07:45:09Z",
  "public_status": "restricted",
  "summary_vi": "Bài đăng bị Meta hạn chế truy cập sau một yêu cầu pháp lý.",
  "restriction_notice": "…",
  "original_url": null,
  "files": [{"kind": "screenshot", "label": "restriction-notice", "url": "/feed/v1/files/9b1c….png",
             "sha256": "9b1c…", "bytes": 87234}],
  "verification": {"manifest_sha256": "a0a7e188…", "archive": "MemoryLane capture"},
  "wayback_url": null
}
```

Spokes read `index.json` and `changes/` (polling every few minutes, or nudged by a webhook the publisher sends) and verify the signature before trusting anything. Mirrors copy the whole tree; the signature lets readers check that a mirror hasn't altered it.

### 6.3 What each spoke shows

**MemoryLane community map**
- **Memory pins**: published `memory` records, plus published `incident` records as a separate "hồ sơ" layer.
- **Case pages**: published incidents, with their materials (screenshots, videos, restriction notices, verification hashes, Wayback link) replacing today's `archives`/materials tables.
- **Moderation**: the public site's moderation queue and archive-admin sheet retire (§5.4.6). Submissions just flow to the hub.

**Hồ sơ Nhân quyền**
- **Tra cứu** (search) and the four groups: published incidents, with the group from a project or custom attribute.
- **Chứng cứ** (evidence): published materials with their verification hashes. This is the "bản lưu web" (web archive copy) the site promises.
- **Bản đồ** (map): the generalised locations, which matches its stated "safe precision".
- **`/report-case`** maps to `case_report`, and **`/submit`** maps to `document` with `case_ref` = the public case id.

## 7. Data model additions (hub)

```sql
capture.sources          (id, slug, name, key_sha256, scopes, rate_limit, project_routing jsonb, disabled_at)
capture.intake           (id, source_id, external_id, kind, payload jsonb, links text[], contact_sealed bytea,
                          consents jsonb, receipt_sha256, state: new|triaged|attached|created|rejected,
                          incident_id, reviewed_by, reason, received_at,  UNIQUE (source_id, external_id))
capture.intake_files     (intake_id, n, artifact_id, quarantine_state)
capture.publications     (id, public_id UNIQUE, type, record_ref, version, state: draft|approved|published|withdrawn,
                          public jsonb, location_precision, approved_by uuid[], published_at, withdrawn_reason)
capture.publication_files(publication_id, artifact_id, derivative_sha256, kind, public_label)
capture.public_refs      (public_id, source_id, external_ref)   -- e.g. a spoke's old case id -> public_id
```

The witness type `upload` (contributor files) joins `media`/`view` in the existing artifact model. The feed publisher is a third worker loop, next to captures and Internet Archive copies.

## 8. Security and safety

| Risk | Mitigation |
|---|---|
| Spoke compromised | Its key can only create intake records; it holds no internal data; rotate the key; per-source quotas cap flooding |
| Feed tampered (or a hostile mirror) | Ed25519-signed index; spokes and readers verify; files are content-addressed |
| De-anonymising contributors | No IPs; no accounts needed; contact sealed to the hub; EXIF/GPS stripped from public files; no contributor names in the feed |
| Exposing people in posts | Public version written separately; original URL withheld by default when private people appear; optional blurring; two-person approval |
| Exposing locations | Exact location stays internal; published precision chosen per record (exact / ward / city) |
| Malicious uploads | Quarantine, type sniffing, re-encoding, optional ClamAV; never served from the hub's own origin |
| Takedown of one site | Feed mirrored (B2 + Tor mirror already exist); spokes are replaceable readers |
| Spam / flooding | Spokes keep their rate limits (+ Turnstile); intake quotas per source; duplicates collapsed by canonical URL |
| Mistaken publication | Withdrawal tombstones propagate to spokes and mirrors; every step is in the incident feed |

## 9. Existing data

- **MemoryLane `memories`**: approved memories are imported once as intake records (`source = memorylane-map`, `external_id = memory id`), attached to a "Bản đồ ký ức" project, and **published as-is**: they are already public. Their public ids map to the old ids (`public_refs`), so existing links keep working.
- **MemoryLane `cases` and `archives`**: cases become incidents and archives become items. Links are re-captured by the new platform, with the old ArchiveBox snapshots kept as legacy artifacts and the Wayback links kept. They are published after review: the audit found many old "archived" entries were login walls, so they're republished only once verified.
- **Hồ sơ Nhân quyền**: no real data yet (sample data only), so it starts on the feed directly.

## 10. Plan

| Phase | Work | Rough effort |
|---|---|---|
| 1. Intake | `sources`, signed Intake API, `intake` tables, Hộp tiếp nhận triage UI, auto-capture of submitted links; MemoryLane backend forwards new memories (transactional outbox: written in the same DB transaction, relayed with retries) | 2 weeks |
| 2. Uploads | Quarantine, re-encode/EXIF strip, `upload` witness, attachments in triage; receipts | 1 week |
| 3. Publication | Public version editor (text, precision, files, original URL toggle), two-person approval, publisher, signed feed, tombstones; mirror sync of `/feed` | 2–3 weeks |
| 4. MemoryLane reads the feed | Map layers, case pages and materials from the feed; retire its moderation and archives tables; migrate existing data (§9) | 2 weeks |
| 5. Hồ sơ Nhân quyền | Its forms → intake (`case_report`, `document`); search, evidence and map from the feed | 1–2 weeks |

## 11. Decisions needed

1. **Where moderation lives.** Recommended: in the hub only, so spoke moderation UIs retire. The alternative, keeping both, means two sources of truth.
2. **Publication approval.** One manager, or a manager plus a second reviewer? Recommended: two for incidents and materials; one for memories already public.
3. **Location precision policy** per sensitivity level, and who can override it.
4. **Original URLs in public records:** shown by default, or withheld by default? Recommended: withheld when the post identifies a private person.
5. **Feed hosting:** Cloudflare R2 (same vendor as Pages) or B2 (already used for backups and the mirror). Also who holds the signing key, and where; recommended: an offline-generated key on the VPS, with a backup in the password manager.
6. **Hồ sơ Nhân quyền's four groups:** one project each, or one project with a "Nhóm hồ sơ" (case group) attribute.
7. **Accounts on Hồ sơ Nhân quyền** (`/register`, `/account`): only for submitters to track their own submissions (receipts may make them unnecessary), or later to join the hub as contributors via an invite link.
