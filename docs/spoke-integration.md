# Connecting a public site to the MemoryLane hub

**For:** developers of a public site that collects submissions or shows published records: Hồ sơ Nhân quyền, and the
MemoryLane community map (already connected, see `backend/hub.js`). **Design and reasons:**
[integration-design.md](integration-design.md). **Reference code:** [`backend/lib/hub-client.js`](../backend/lib/hub-client.js)
(Node 20+, no dependencies; copy it as is).

A site does two things, and only these:

1. **Forward submissions** to the hub's Intake API. The site's key can create submissions and read their receipt
   status. It cannot read anything else.
2. **Show what the hub published**, by reading the signed feed. The site never queries the hub's database, and never
   publishes anything itself.

Review, moderation and publication decisions all happen in the hub.

## 1. Setup

From a hub admin (Admin page → "Trang cộng đồng (nguồn)"):

| You get | Where it goes |
|---|---|
| a **source slug**, e.g. `ho-so-nhan-quyen` | the site backend's config |
| the **source key** (64 hex characters, shown once; can be rotated) | the site **backend** only, as a secret. Never in a browser, a repo or logs |
| the hub's **Intake URL** | backend config |
| the **feed URL** and the **root public key** (base64) | backend config. Pin the root key in your config and **never accept a different one from the feed itself** |
| the **contact public key** (only if your form collects contact details) | the browser, to seal contacts (§2.5) |

The admin also chooses which hub project each kind of submission is routed to. For Hồ sơ Nhân quyền, all kinds go
to one project with a "Nhóm hồ sơ" attribute (decision 6).

## 2. Forwarding submissions

### 2.1 Signing

Every request carries four headers:

```
X-ML-Source:    <slug>
X-ML-Timestamp: <unix seconds>                       refused if more than 5 minutes off: keep the clock in sync
X-ML-Nonce:     <16–64 chars [A-Za-z0-9_-], random>  new for every request, retries included
X-ML-Signature: hex( HMAC-SHA256( key, "<timestamp>\n<nonce>\n<METHOD>\n<path>\n<hex sha256 of the raw body>" ) )
```

`path` is the URL path without the query string, e.g. `/intake/v1/submissions`. For a GET, the body is empty: use the
SHA-256 of zero bytes. A replayed nonce gets 409, and a bad signature gets 401. `hub-client.js` does all of this
(`signHeaders`).

### 2.2 Endpoints

| Call | Body | Answer |
|---|---|---|
| `POST /intake/v1/submissions` | the envelope (§2.3), JSON, ≤ 256 KB | `{intake_id, duplicate, links, files_expected}`. Idempotent: the same `external_id` again returns the first `intake_id` with `duplicate: true` |
| `PUT /intake/v1/submissions/{intake_id}/files/{n}` | the raw file bytes | `{stored, sha256, kind}`. Compare `sha256` with your own before deleting your copy |
| `GET /intake/v1/receipts/{receipt_sha256}` | — | `{status}`: `received`, `in_review`, `published` or `not_published` |
| `GET /intake/v1/contact-key` | — | `{public_key}` for sealing contacts |

On errors:
- **422** is a validation problem: fix it, don't retry.
- **401, 409, 429 and 5xx**: retry with backoff, signing again with a new nonce.
- Use an **outbox**: write the submission and an outbox row in the same transaction, and let a background relay
  send it. A hub outage then delays submissions instead of losing them. `backend/hub.js` is a working example.

### 2.3 The envelope

```json
{
  "external_id": "case-7f3k2",            // your own id for this submission; [A-Za-z0-9_.:-], ≤ 120
  "kind": "case_report",                  // memory | case_report | document | link
  "submitted_at": "2026-10-18T09:12:00Z", // optional
  "lang": "vi",
  "payload": { ... },                     // per kind, §2.4. Text only: HTML is not interpreted, anywhere
  "links": ["https://…"],                 // optional; the hub also finds links in the text fields
  "files": [{"n": 1, "mime": "application/pdf", "bytes": 81234}],   // announce, then PUT each file
  "contact": {"sealed": "<base64>"},      // optional, §2.5
  "consents": {"may_publish": true, "has_rights": true},
  "receipt_sha256": "<hex>"               // optional, §2.6
}
```

Every link in a submission is **captured by the hub immediately** (posts get deleted fast). Captures stay internal
until reviewers decide.

### 2.4 Kinds, and how Hồ sơ Nhân quyền's forms map to them

**`/report-case` → `case_report`**

| Form field | Payload field |
|---|---|
| Nhóm hồ sơ (case group) | `group`: `violation` (Vi phạm), `proceeding` (Tố tụng), `platform_restriction` (Hạn chế mạng xã hội), `movement` (Phong trào xã hội) |
| Tiêu đề (title) | `title` (required, ≤ 300) |
| Mô tả (description) | `description` (required, ≤ 10 000) |
| Diễn biến (timeline) | `timeline` (≤ 10 000) |
| Ngày (date) | `date`: `{year, month, day}`, each optional |
| Nơi xảy ra (place) | `location`: `{lat, lng, label, ward, city, province}`, all optional; plus `precision_wish` (§3.3) |
| Group-specific fields (court, stage, platform, restriction type, …) | `fields`: `{"<name>": "<text>"}`, ≤ 30 entries |
| Bí danh (pseudonym) | `pseudonym` (≤ 80) |

**`/submit` → `document`**

| Form field | Payload field |
|---|---|
| Hồ sơ liên quan (related case; "leave blank if new") | `case_ref`: the **public id** of a published case (e.g. `hs-7kq2m4x`), or omit |
| Loại tài liệu (document type) | `doc_type` |
| Tiêu đề (title) | `title` (required) |
| Bối cảnh (context) | `context` |
| Đường dẫn thay thế (alternative link, HTTPS) | `alt_link` (it is also captured) |
| Tệp (file) | `files` + `PUT …/files/1` |
| Bí danh (pseudonym) | `pseudonym` |

**Also available:** `memory` (the community map: `text`, `category`, `date`, `location`, `case_ref`, `pseudonym`) and
`link` (`url`, `note`).

**Files.**
- Accepted: JPG, PNG, WEBP, GIF, MP4, WEBM, PDF and TXT, checked by their bytes, not their name or declared type.
- Size limits: ≤ 60 MB for video, ≤ 20 MB otherwise.
- The hub keeps them exactly as received (evidence, internal only). What it publishes is a cleaned copy:
  images re-encoded, video remuxed, metadata stripped.
- PDFs and text files are never published, only reviewed.

### 2.5 Contact details (optional)

The mockup offers a "secure contact" field. **Seal it in the browser** to the hub's contact key, so your backend
never holds it in clear text. Use libsodium's sealed box:

```js
import sodium from "libsodium-wrappers";          // pin a version
await sodium.ready;
const sealed = sodium.to_base64(
  sodium.crypto_box_seal(sodium.from_string(contact), sodium.from_base64(CONTACT_PUBLIC_KEY, sodium.base64_variants.ORIGINAL)),
  sodium.base64_variants.ORIGINAL);
// send { contact: { sealed } } in the envelope; never log or store `contact`
```

Only project managers in the hub can open it, and each opening is logged. Say so on the form.

### 2.6 Receipts (instead of accounts)

There are no accounts on Hồ sơ Nhân quyền for now (decision 7). When someone submits:
1. Make a random code and show it once. `newReceipt()` makes one in the form `XXXXX-XXXXX-XXXXX`.
2. Send only its hash (`receipt_sha256`). Store neither the code nor the hash in a way that links it to the person.
3. To check a status later, hash the code (`receiptHash`) and call `GET /intake/v1/receipts/{hash}` from your backend.

The hub only ever answers with one of four statuses.

## 3. Showing what the hub published

### 3.1 The feed

```
<feed>/keys.json          root public key, the root's delegation of the online key, revocations
<feed>/index.json         {schema, generated_at, records: [{type, public_id, version, updated_at, path, sha256}], tombstones: [...]}
<feed>/index.json.sig     {"online_public": "<b64>", "signature": "<b64>"}   Ed25519 over the exact bytes of index.json
<feed>/records/<id>.<hash>.json  one record version (use the `path` from index.json; the previous version stays for one rebuild)
<feed>/files/<sha256>.<ext>
```

**Verify before using anything.** Each step depends on the previous one, and `feedReader().load()` does them all:
1. **Delegation.** `keys.json.delegation` must be signed by **your pinned root key**. Its statement must name the
   `online_public` from `index.json.sig`, and today must fall between its `not_before` and `not_after`.
   No valid revocation may name that key.
2. **Index.** The signature on `index.json` must verify with that online key, over the exact bytes you downloaded.
3. **Records.** Each record's SHA-256 must equal its entry in the index.
4. **Files.** Each file's SHA-256 must equal the `sha256` its record gives.

If any step fails, keep serving your **last verified copy** and alert someone. Never show unverified data.

Refresh every few minutes. The hub can also nudge you after each build (`FEED_WEBHOOKS` → your endpoint, e.g.
`POST /api/hub-feed-changed`). The nudge carries no data: you re-fetch and verify as usual.

### 3.2 Records

**Incident** (a case: Hồ sơ Nhân quyền's Tra cứu / Chứng cứ / Bản đồ; MemoryLane's case pages):

```json
{
  "schema": "memlane-feed-record/1", "type": "incident", "public_id": "hs-7kq2m4x", "version": 2,
  "published_at": "2026-10-19T08:00:00+00:00",
  "title": {"vi": "…", "en": "…"}, "summary": {"vi": "…", "en": null},
  "group": "Hạn chế mạng xã hội", "tags": [], "public_status": "being_verified",
  "date": {"value": "2026-03", "precision": "month"},
  "location": {"lat": 10.7625, "lng": 106.7125, "precision": "ward", "radius_m": 2000, "label": "Quận 1, TP.HCM"},
  "credit": null,
  "materials": [{
    "public_id": "mt-q81zd5k", "platform": "facebook", "kind": "post", "public_status": "restricted",
    "captured_at": "2026-10-18T07:45:09+00:00", "title": "…", "summary": {"vi": "…", "en": null},
    "original_url": "https://www.facebook.com/…",          // null when the reviewers withheld it
    "wayback_url": null,
    "verification": {"manifest_sha256": "a0a7…", "archive": "MemoryLane capture"},
    "files": [{"kind": "image", "label": "restriction-notice", "provided_by": "archive", "url": "files/9b1c….webp",
               "sha256": "9b1c…", "bytes": 87234, "mime": "image/webp", "original_sha256": "…", "manifest_sha256": "a0a7…"}]
  }],
  "community_files": [ … same shape, "provided_by": "contributor" … ]
}
```

**Memory** (the community map): `text {vi, en}`, `category`, `date`, `location`, `credit`, `case` (an incident's
`public_id` or null), `legacy_id` (for migrated memories), `files`.

`public_status` values:

| Incidents | Materials |
|---|---|
| `reported`, `being_verified`, `verified` | `archived`, `partially_archived`, `restricted` (the platform withholds it; the notice is a file), `login_wall`, `unavailable` |

### 3.3 What a site must do with them

- **Draw areas, not pins, for coarse locations.** If `location.radius_m > 0`, draw a circle of that radius and label
  it as approximate ("khu vực ước lượng"). Never present the centre as the place. `precision: "none"` or no
  `location` means no map point. Don't try to make a location more precise from other fields.
- **Show dates at their precision** (`2026-03` is a month, not 1 March).
- **Show the verification.** On the evidence page (Chứng cứ), show each file's SHA-256 and the material's
  `manifest_sha256`. The original stays in the hub's sealed archive, so a hash lets anyone confirm a copy is unaltered.
- **Label contributor files** (`provided_by: "contributor"`) as provided by a contributor, not as archive captures.
- **Withdrawals are binding.** When a `public_id` moves to `tombstones` (or disappears from `records`), remove it
  from your pages, caches, search index and CDN on your next refresh. The hub deletes its files from the feed at the
  same time.
- **Don't edit records.** Translate the interface, not the content. To fix a record, report it to the hub.
- **Render all text as text.** Never as HTML or Markdown that can embed scripts.

### 3.4 Mapping to Hồ sơ Nhân quyền's pages

| Page | Feed data |
|---|---|
| Tra cứu (search) and the four groups | incident records; group = `group`; status = `public_status` |
| A case | the incident: title, summary, date, area, materials, community files |
| Chứng cứ (evidence) | `materials[]` and `community_files[]`: files, hashes, original link if given, Wayback link if any |
| Bản đồ (map) | `location` with `radius_m` ("safe precision" is exactly this) |
| `/report-case`, `/submit` | §2.4 |
| `/register`, `/account` | not in the first version; receipts instead (§2.6) |

## 4. Your own obligations

- **No IP addresses or identities in your logs or database.** The community map derives rate-limit pseudonyms
  with an HMAC (`backend/middleware/rate-limit.js`); do the same.
- **Rate-limit your forms**, and add Turnstile or a similar challenge. The hub also caps each source per hour.
- **Delete what you forwarded** once the hub confirmed it (compare the returned `sha256`). You are not the archive.
- **Rotate the key** (hub Admin → "Đổi khoá") if your backend may have been exposed. The old key stops at once.

## 5. Trying it locally

1. Run the hub (`capture/`, see its README, "Community intake and the public feed") with the dev keys.
2. Add a source on its Admin page.
3. Point your backend at `http://127.0.0.1:8700`, with feed `http://127.0.0.1:8700/feed` and the dev root public key
   (`root_public` in `capture/secrets/dev-feed-delegation.json`).
4. To see the whole cycle: submit, then on the hub open Hộp thư → **Cộng đồng**, create an incident or a memory's
   public version, and approve it (one approval by a manager or a member with publication access). It then shows up in your feed.
