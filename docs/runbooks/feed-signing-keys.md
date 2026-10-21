# Runbook: the public feed's signing keys

How the feed's signatures are set up, renewed and revoked. Decision (docs/integration-design.md §13): option C,
an **offline root key** held by **one designated maintainer with a sealed backup**, and an **online key** on the
hub server that the root delegates for a limited time. The demo runs on DEMO keys generated on the server, which
is fine for a demo and not for real publication: do this before anything real is published.

Nothing secret goes in this repository. Public keys and fingerprints may.

## Roles

| Role | Holds | Does |
|---|---|---|
| **Root holder** (one designated maintainer) | the root private key, offline | creates the root once; signs a delegation every 3–4 months; signs revocations |
| **Backup holder** (a second, trusted person, somewhere pressure is unlikely) | a sealed copy of the root private key | opens it only if the root holder is unavailable, or the key is lost |
| **Whoever deploys the hub** | the online key and the current delegation (server secrets) | installs them on the server; never sees the root |

## 1. Create the root key (once, offline)

Use a machine that is **not connected to the internet** during this step: a laptop with networking off, or better a
live USB system (e.g. Tails) booted for this purpose. Bring the repository on a USB stick.

```bash
cd capture
python -m memlane_capture.feedkeys root-init --out /media/usb/feed-root.key
# prints the ROOT PUBLIC KEY: write it down; it is not secret
```

- The private key file is written with mode 600 and never overwritten.
- **Sealed backup, now:** copy `feed-root.key` to a second USB stick (or print it: it is one short base64 line),
  put it in a tamper-evident envelope, sign across the seal, and hand it to the backup holder. Note the date.
- Store the root holder's copy offline (USB stick in a safe place). Never on a server, in cloud storage, chat or
  email. Wipe the live system after use.

## 2. Create the online key and delegate it (every 3–4 months)

On the **hub server** (whoever deploys):

```bash
docker compose exec hub-api python -m memlane_capture.feedkeys online-init --out /secrets/feed-online.key
# prints the ONLINE PUBLIC KEY
```

The root holder, offline, signs a delegation for that public key (120 days by default):

```bash
python -m memlane_capture.feedkeys delegate --root /media/usb/feed-root.key \
  --online-public <ONLINE PUBLIC KEY> --days 120 --out delegation.json
```

`delegation.json` is not secret (it is published in `keys.json`). Copy it to the server as
`secrets/feed-delegation.json`; the hub's env points at both files: `FEED_ONLINE_KEY=/secrets/feed-online.key` and
`FEED_DELEGATION=/secrets/feed-delegation.json` (see capture/.env.example). Restart; then check:

```bash
docker compose exec hub-api python -m memlane_capture.feedkeys show     # "usable": true
```

**Renew** about 2 weeks before the delegation expires (the date is in `show`): either delegate the same online key
again, or (better) create a new online key and delegate that. Put a calendar reminder for the root holder.

## 3. Pin the root on every site

Every site that reads the feed checks signatures against the **root public key**:
- community map backend: `HUB_FEED_ROOT_KEY` in `backend/.env`
- Hồ sơ Nhân quyền: `HUB_FEED_ROOT_KEY` in its `.env`
- the mirror's index page, and this repository (README), show its fingerprint so anyone can compare.

Changing the online key needs **no** change on the sites. Changing the root does (section 5).

## 4. Revoke an online key (server compromised, or key leaked)

1. The root holder, offline:
   `python -m memlane_capture.feedkeys revoke --root /media/usb/feed-root.key --online-public <OLD KEY> --reason "…"`
2. On the server: append the printed revocation as one line to `secrets/feed-revocations.jsonl`
   (`FEED_REVOCATIONS=/secrets/feed-revocations.jsonl`), create a new online key, get a new delegation (section 2),
   install both, restart. The next feed build publishes the revocation in `keys.json`.
3. Sites refuse anything signed by the revoked key from then on. Check with `feedkeys show` and by loading a site.
4. Tell the team; if forged records may have been shown publicly, say so publicly, with the time window.

A server compromise is therefore limited to the online key's remaining validity and ended by one offline signature.

## 5. If the root is lost or exposed

- **Lost, backup intact:** the backup holder opens the sealed copy; make a new sealed backup; carry on.
- **Exposed (or lost with no backup):** create a new root (section 1), delegate a new online key, and **re-pin the
  new root public key on every site** (section 3). Announce the new fingerprint publicly, from channels people
  already trust, so nobody accepts records signed by the old root.

## 6. Moving to "2 of 3 maintainers" later

The same root can be split (Shamir 2-of-3, or three hardware keys) without re-pinning: only who can assemble it
changes. Do it when the team grows; see integration-design.md §13.
