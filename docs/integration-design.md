# Integrating the capture platform with the public platforms

**Status:** accepted 2026-10-18 (decisions in §11) and **built** 2026-10-19 (§14) · **Date:** 2026-10-18 · **Related:** [archiving-platform-proposal.md](archiving-platform-proposal.md), [capture/README.md](../capture/README.md)

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
5. **Safety before speed.** Nothing is published automatically. Publication needs two different people: a project manager, plus a member entrusted with publication access (§6.1). Sensitive incidents default to coarser locations (§12).
6. **Survivable.** The feed is static, signed and mirrorable (existing `mirror/` + Tor onion). A spoke can be rebuilt from it. Withdrawals propagate as tombstones.

## 5. Inbound: the Intake API

### 5.1 Sources and credentials

Each spoke is registered in the hub as a **source**, such as `memorylane-map` or `ho-so-nhan-quyen`, with:

- a **service key** that may only call `/intake/v1/*`, held only by the spoke's backend and never sent to the browser;
- request signing: `X-ML-Source`, `X-ML-Timestamp`, `X-ML-Nonce` and `X-ML-Signature = HMAC-SHA256(key, timestamp, nonce, method, path, sha256(body))`, rejected if older than 5 minutes or if the nonce was seen before (exact format: [spoke-integration.md](spoke-integration.md) §2.1);
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
3. **Seal attachments as evidence.** A contributor-provided file is stored content-addressed and hashed exactly as received (`capture.intake_files`), labelled *provided by a contributor*. It is never presented as our own capture.
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
| location | `{lat, lng, precision}`: generalised per the precision policy (§12). The internal exact location is never in the feed |
| date | possibly coarsened (month only) |
| public status | e.g. `verified` / `being verified` / `reported`: a mapping of the internal status and verdicts, not the internal workflow |
| materials | the public files chosen by the reviewer: screenshots, video, restriction notices; EXIF-stripped re-encodes, optional face or number-plate blurring (manual at first); each with its SHA-256 **and** the sealed capture's manifest hash, so anyone can verify it against the archive |
| original URL | shown by default (decision 4); the reviewer can withhold it for a record, e.g. when the post itself puts a private person at risk |
| Wayback link | if one exists |
| contributor credit | none, or the pseudonym the contributor chose, never an account name |

**Publication access** is a per-project grant ("Quyền công bố"). Owners and managers give it to trusted editors on the project's Access tab, and taking it away takes effect immediately.

**Workflow:** draft (editor) → approved (a manager **and** a different member with publication access; managers can hold the grant too, but one person never supplies both approvals) → published → (corrected = new version) → withdrawn. The reason for each step is in the incident feed. A withdrawal publishes a tombstone, so every spoke and mirror deletes the record.

### 6.2 The feed

A static tree on a dedicated public **Backblaze B2** bucket served through Cloudflare (decision 5; egress from B2 via Cloudflare is free under the Bandwidth Alliance). It is separate from the backup bucket and the capture-artifacts bucket, and written only by the hub's **publisher** job:

```
/feed/v1/index.json            every live record: {type, public_id, version, updated_at, sha256}; plus tombstones
/feed/v1/index.json.sig        Ed25519 signature of index.json; the public key is published on both sites
/feed/v1/records/{public_id}.json
/feed/v1/files/{sha256}.{ext}  content-addressed public files (cleaned derivatives)
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

Spokes read `index.json` (polling every few minutes, or nudged by a webhook the publisher sends; records whose hash is unchanged are not re-fetched) and verify the signature before trusting anything. Mirrors copy the whole tree; the signature lets readers check that a mirror hasn't altered it.

### 6.3 What each spoke shows

**MemoryLane community map**
- **Memory pins**: published `memory` records, plus published `incident` records as a separate "hồ sơ" layer.
- **Case pages**: published incidents, with their materials (screenshots, videos, restriction notices, verification hashes, Wayback link) replacing today's `archives`/materials tables.
- **Moderation**: the public site's moderation queue and archive-admin sheet retire (§5.4.6). Submissions just flow to the hub.

**Hồ sơ Nhân quyền**
- **Tra cứu** (search) and the four groups: published incidents from one project "Hồ sơ Nhân quyền", with the group as an incident attribute "Nhóm hồ sơ" (decision 6). `case_report` intake sets it from the form.
- **No accounts** for now (decision 7). Submitters track their submissions with the receipt code, and `/register` and `/account` are dropped from the first version.
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
capture.project_members  + can_publish boolean NOT NULL DEFAULT false   -- the publication-access grant
capture.publications     (id, public_id UNIQUE, type, record_ref, version, state: draft|approved|published|withdrawn,
                          public jsonb, location_precision, approved_by_manager uuid, approved_by_publisher uuid
                          CHECK (approved_by_manager <> approved_by_publisher), published_at, withdrawn_reason)
capture.publication_files(publication_id, artifact_id, derivative_sha256, kind, public_label)
capture.public_refs      (public_id, source_id, external_ref)   -- e.g. a spoke's old case id -> public_id
```

Contributor files live in `intake_files`, not as capture artifacts, and cleaned public copies in `public_files`. The feed publisher is a third worker loop, next to captures and Internet Archive copies. (As built: see `capture/migrations/006_intake_publication.sql`.)

## 8. Security and safety

| Risk | Mitigation |
|---|---|
| Spoke compromised | Its key can only create intake records; it holds no internal data; rotate the key; per-source quotas cap flooding |
| Feed tampered (or a hostile mirror) | Ed25519-signed index; spokes and readers verify; files are content-addressed |
| De-anonymising contributors | No IPs; no accounts needed; contact sealed to the hub; EXIF/GPS stripped from public files; no contributor names in the feed |
| Exposing people in posts | Public version written separately; original URL shown by default but can be withheld per record; optional blurring; two-person approval |
| Exposing locations | Exact location stays internal; published precision follows the policy in §12 and is snapped deterministically, never jittered |
| Signing key stolen | Two-tier keys (§13): the online key expires and can be revoked by the offline root |
| Malicious uploads | Quarantine, type sniffing, re-encoding, optional ClamAV; never served from the hub's own origin |
| Takedown of one site | Feed mirrored (B2 + Tor mirror already exist); spokes are replaceable readers |
| Spam / flooding | Spokes keep their rate limits (+ Turnstile); intake quotas per source; duplicates collapsed by canonical URL |
| Mistaken publication | Withdrawal tombstones propagate to spokes and mirrors; every step is in the incident feed |

## 9. Existing data

- **MemoryLane `memories`**: approved memories are imported once as intake records (`source = memorylane-map`, `external_id = memory id`), attached to a "Bản đồ ký ức" project, and **published as-is**: they are already public. A manager and a publisher approve the import once, as a batch, rather than record by record. Their public ids map to the old ids (`public_refs`), so existing links keep working.
- **MemoryLane `cases` and `archives`**: cases become incidents and archives become items. Links are re-captured by the new platform, with the old ArchiveBox snapshots kept as legacy artifacts and the Wayback links kept. They are published after review: the audit found many old "archived" entries were login walls, so they're republished only once verified.
- **Hồ sơ Nhân quyền**: no real data yet (sample data only), so it starts on the feed directly.

## 10. Plan

| Phase | Work | Rough effort |
|---|---|---|
| 1. Intake | `sources`, signed Intake API, `intake` tables, Hộp tiếp nhận triage UI, auto-capture of submitted links; MemoryLane backend forwards new memories (transactional outbox: written in the same DB transaction, relayed with retries) | 2 weeks |
| 2. Uploads | Quarantine, re-encode/EXIF strip, `upload` witness, attachments in triage; receipts | 1 week |
| 3. Publication | Public version editor (text, precision, files, original URL toggle), two-person approval, publisher, signed feed, tombstones; mirror sync of `/feed` | 2–3 weeks |
| 4. MemoryLane reads the feed | Map layers, case pages and materials from the feed; retire its moderation and archives tables; migrate existing data (§9) | 2 weeks |
| 5. Hồ sơ Nhân quyền | Its forms → intake (`case_report`, `document`); search, evidence and map from the feed; receipts instead of accounts | 1–2 weeks |

## 11. Decisions (2026-10-18)

| # | Question | Decision | Effect on the design |
|---|---|---|---|
| 1 | Where moderation lives | **In the hub only** | The spokes' moderation screens retire (§5.4.6) |
| 2 | Publication approval | **A manager plus any member entrusted with publication access**, two different people | New per-project grant `can_publish` (§6.1, §7) |
| 3 | Location precision policy | **The starting policy in §12.4, accepted** | Defaults and override rules as in the table; snapping, never jitter (§12.3) |
| 4 | Original URLs shown publicly by default | **Yes** | Shown unless the reviewer withholds it for a record (§6.1) |
| 5 | Feed hosting and signing key | **B2** (behind Cloudflare); **option C**: offline root key + short-lived online key | §6.2, §13 |
| 6 | Hồ sơ Nhân quyền's four groups | **One project, with a "Nhóm hồ sơ" attribute** | §6.3 |
| 7 | Accounts on Hồ sơ Nhân quyền | **Skipped for now** | Receipt codes only (§5.2, §6.3) |

**Later decisions (2026-10-18):**
- Root key custody (§13): **one designated maintainer with a sealed backup** for this stage. Revisit "2 of 3
  maintainers" later.
- The population threshold for rural locations and the "no exact internal location" option: **skipped**. The §12.4
  table applies as written.
- Build everything as proposed (§14 records what was built).

## 12. Location precision: background for decision 3

### 12.1 Why it matters

A published point on a map is not only a place. Combined with a date and a short description, it can point to a **person**: the house where an arrest happened, the home of a family whose relative is detained, the café where a group met. Anyone can read the public map, including the people the records are about. The risks are concrete:

- **Re-identification.** "Police searched a house, 14 March, ward X" plus an exact pin identifies the household to neighbours, local police and anyone hostile.
- **Retaliation against witnesses and submitters.** A memory pinned where it was experienced is often pinned where the submitter lives or works.
- **Linking records.** Several coarse records that each look harmless can, together, narrow down one person, e.g. three incidents with the same family name in one small commune.

On the other side, precision has value:

- **Verification.** Investigators and journalists check claims against the place, e.g. matching a video's street to the pin.
- **Credibility and memory.** "Outside the People's Court of province Y" is a stronger record than "somewhere in province Y".
- **Map usefulness.** Points coarsened to one centroid per province pile on top of each other.

So the policy should be exact where the place is **public and institutional**, and coarse where it is **private or identifies people**.

### 12.2 Precision levels to choose from

| Level | Roughly | Published as | Typical use |
|---|---|---|---|
| `exact` | ~10 m | the point | public institutions and landmarks: courts, police stations, detention centres, government offices, squares |
| `street` | 100–250 m | centre of a grid cell (fixed grid, e.g. H3 resolution 9) | public gatherings, demonstrations in public space |
| `ward` | a ward or commune (phường/xã) | the unit's centroid, drawn as an area | events at private homes in cities; most personal memories |
| `province` | a province or city | the province centroid, drawn as an area | rural private locations; very sensitive cases; online-only events with a known home province |
| `none` | no point | no map pin, listed only | when even the province is identifying, or the event happened only online |

Notes specific to Vietnam:

- Since the mid-2025 administrative reform there is no district level. Units are province and ward/commune, and wards and communes were merged into much larger units. A ward is therefore a coarser area than it used to be, which helps anonymity in cities. Old addresses in existing MemoryLane data still use pre-merger names, so the generaliser maps them to current units.
- **Population density changes what a level hides.** An urban ward has tens of thousands of residents, but a remote commune may have a few hundred households. The same "ward" setting is safe in Hà Nội and identifying in a mountain commune. One option is a rule like *private locations: ward if the unit has more than N residents, otherwise province*.

### 12.3 How generalisation should work

- **Snap, never jitter.** Random offsets look anonymous but leak. Each new version or each related record gets a new random offset, and averaging them points back to the true spot. Snapping to a fixed grid cell or administrative unit always gives the same answer, so republishing leaks nothing new.
- **Draw coarse points as areas.** Readers otherwise take a ward centroid as the real place, and may wrongly suspect whoever lives there. Label it "khu vực ước lượng" (approximate area).
- **The rest of the record must match.** A coarse pin is pointless if the public text names the street, a photo shows a house number, or the shown original post has a geotag. Reviewers check text and media against the precision chosen, and EXIF/GPS is always stripped (§5.4).
- **Dates are part of it.** Exact date plus exact place is the most identifying combination. The public version can coarsen the date to month or year for private-location records.
- **The submitter's wish is a ceiling.** Forms can offer "show only the approximate area". The public version may be coarser than the submitter chose, never finer.

### 12.4 A starting policy to accept or amend

| Kind of place / record | Default | Who may publish finer |
|---|---|---|
| Public institution or landmark | `exact` | n/a |
| Public gathering, protest, public space | `street` | the two approvers, with a reason, e.g. location already widely reported by the press |
| Private home or workplace, city | `ward` | nobody (stays `ward` or coarser) |
| Private home or workplace, rural or sparsely populated | `province` | the two approvers, with a reason, if the ward is large enough |
| Personal memory (new submissions) | `ward`, or the submitter's choice if coarser | the two approvers, if the submitter allowed exact and the place is public |
| Existing public MemoryLane memories (§9) | as already published | n/a: already public; coarsening on request is always allowed |
| Online-only events (account restrictions, takedowns) | `none` | `province` if the person has publicly said where they are |
| Where submitters or witnesses are | never published | nobody |

Anyone drafting a public version can always choose **coarser** without approval. **Finer** than the default needs both approvers and a recorded reason. Since publication already needs two people, this adds no extra step, only a visible justification.

**Decided 2026-10-18:** this table is the policy. The population rule and the "exact not recorded" option were skipped.

## 13. Signing-key custody: options for decision 5

The feed signature proves a record came from the hub and wasn't altered by a mirror or a compromised site. Whoever holds the private key can publish anything in MemoryLane's name, and spokes would display it. The publisher job needs to sign automatically whenever something is approved, so some key has to be usable without a person present.

| Option | How it works | Protects against | Weak points | Effort |
|---|---|---|---|---|
| **A. One key on the hub server** | Ed25519 key file, readable only by the publisher; backup in the maintainers' password manager | tampering by mirrors and spokes | whoever takes over the hub can sign forgeries until the key is replaced, and replacing it means every spoke must be updated by hand | lowest |
| **B. Key in a hardware token or cloud KMS** | the key never leaves a YubiKey/HSM attached to the server, or a cloud key service (check it supports Ed25519; otherwise use ECDSA P-256) | theft of the key file: an attacker can sign only while they control the server, not after | an attacker on the server can still sign while there; a cloud KMS adds a vendor that can be compelled or suspend the account | medium |
| **C. Two-tier: offline root + online key** (recommended) | an **offline root key** signs a short statement "online key K is valid until date D" (e.g. 3–6 months). The server holds only K and signs the feed with it. Spokes trust the root's public key, pinned on both sites, the mirror and the repo | a server compromise is limited to K's validity period, and the root can revoke K at once by signing a new statement; no spoke needs updating | needs people to hold the root and re-sign every few months; a lost root means re-pinning everywhere, hence the split backup below | medium |
| **D. Each approver signs** | the manager and the publisher sign each record with personal keys; spokes require two valid signatures | even a full hub compromise can't publish without two people's keys | personal key management for every publisher; spokes must track who may sign; slow if someone loses a key | highest |

**Who holds the offline root in option C** (choose one):

1. **Two of three maintainers (Shamir 2-of-3 split, or three YubiKeys each holding the root).** Any two together can re-sign or revoke, and no one person can. Recommended.
2. **One designated maintainer with a sealed backup** held by a second person. Simpler, but that one person is a single point of pressure.
3. **An organisation or trusted partner** (e.g. a legal or digital-security partner) holds one share of the 2-of-3 split. This adds continuity if the core team is unavailable.

Considerations whatever you pick:
- **Where holders live matters.** A key holder who can be detained or pressured can be forced to sign. At least two of the root holders should be somewhere that pressure is unlikely, so a quorum can always revoke.
- **Write down a revocation and rotation runbook** before launch: who signs, how spokes learn of it, and what is announced publicly.
- **The public key is not a secret.** Its fingerprint goes on both sites, the mirror's index and this repo. Only the private parts stay out of the repo, per CLAUDE.md.

**Decided 2026-10-18: option C, with the root held by one designated maintainer and a sealed backup** (holder option
2) for this stage. "2 of 3 maintainers" is to be reconsidered later; moving to it only means re-splitting the same
root, not re-pinning it on the sites.

Options C and D can be combined later. Start with C, and add approver signatures for the most sensitive records if the threat model calls for it.

## 14. As built (2026-10-19)

All five phases of §10, on branch `feat/capture-platform`.

| Part | Where | Notes |
|---|---|---|
| Intake API, sources, triage | `capture/memlane_capture/intake.py`, UI Hộp thư → **Cộng đồng** | The team's saved links and community submissions share one inbox, filtered by source (Tất cả / Nội bộ / Cộng đồng, plus "Cần xử lý") |
| Uploads | `intake.py` (sniffing, storage), `derive.py` (clean copies) | No ClamAV yet; PDFs and text are reviewed internally, never published |
| Public versions, two approvals, batches | `publish.py`, UI "Bản công khai" | Policy enforced by `geo.py`; the preview is the exact record |
| Feed and keys | `feed.py`, `feedkeys.py` | Local dir (dev) or B2 (`FEED_STORE=s3`). Index-only (no `changes/` files: records are fetched only when their hash changes) |
| Community map | `backend/hub.js`, `backend/routes/hub.js`, `app/*.jsx` | Off unless `HUB_*` is set; `PUBLIC_SOURCE` = db / both / feed |
| Migration | `backend/scripts/export-to-hub.js` | Legacy memories published as one batch; cases and archives for review |
| Hồ sơ Nhân quyền | [spoke-integration.md](spoke-integration.md) + `backend/lib/hub-client.js` | The site's code isn't in this repo; the guide maps its forms and pages |

**Differences from the text above:**
- Locations snap to grid cells sized like the units (ward ≈ 2.8 km, province ≈ 55 km), not to real ward or
  province boundaries. A boundary dataset can replace the grid later.
- Contributor files are stored in their own table, not as capture artifacts.
- The signature carries an explicit nonce, so a quick identical retry is not mistaken for a replay.

**Before real use** (CLAUDE.md "Pending ops"):
- The designated maintainer generates the production root key offline, makes the sealed backup, and delegates an
  online key to the server.
- Create the public B2 bucket for the feed.
- Set `INTAKE_KEY_SECRET` and `CONTACT_SECRET_KEY`.
- Register the sources.
