# Running a mirror of the MemoriesLane archive

A mirror is a read-only copy of every snapshot in the archive, served as
plain static files, pulled hourly from the project's Backblaze B2 backup.
It exists so that a takedown, block, or failure of the primary host at
`archivebox.heomay.xyz` does not make the archive unreachable.

**A mirror holds nothing an attacker would want.** It has one credential — a
B2 key that can only *read* the `archive/` prefix — no accounts, no upload
form, no database, and no visitor logs. If a mirror is seized or compromised,
nothing is lost and nothing leaks that is not already public.

Time to set up: about 20 minutes. Cost: the host (a $5–15/month VPS is
plenty; 1.2 GB today, growing slowly). B2 egress is free at this size.

## What you need

- A machine with Docker and `docker compose` (any Linux VPS, or a spare
  computer with an always-on connection).
- The **read-only B2 key + bucket name** from the project maintainer. Never
  use any other key. If someone hands you a key that can write, refuse it.
- Optionally, a domain name pointed at the host (for clearnet HTTPS). Not
  required — the mirror also publishes a Tor onion address by itself.

## Setup

```bash
git clone https://github.com/kimboj23/MemoriesLane.git
cd MemoriesLane/mirror
cp b2.env.example b2.env
nano b2.env                 # paste the read-only keyID / applicationKey / bucket
docker compose up -d --build
docker compose logs -f sync # watch the first pull
```

The first pull is ~1.2 GB and ~5,000 files. **Two things about that first
run:**

1. B2 counts each downloaded file as one "Class B transaction", and the free
   allowance is 2,500 per day. The account owner should raise the *Class B
   Transactions* and *Download Bandwidth* caps in B2's **Caps & Alerts** to
   $1/day before your first sync. If they haven't, the first sync stops at
   the cap and completes the next day — nothing breaks, it just takes two
   days.
2. Until it finishes, the front page lists only what has arrived so far. It
   rebuilds after every pull.

Then:

- **Local check:** `curl -s http://127.0.0.1:8080/ | head` — the front page.
- **Onion address:** `docker compose exec tor cat /var/lib/tor/hidden_service/hostname`
  (takes ~30 s to appear on first start). The front page prints it too.
  Send it to the maintainer so it can be listed on the primary site.
- **Clearnet HTTPS** (optional): set `MIRROR_DOMAIN` in `b2.env`, point the
  domain's DNS at this host, and run `docker compose --profile tls up -d`.
  Caddy fetches a Let's Encrypt certificate automatically. If you are
  putting Deflect or another DDoS shield in front, do the same — they connect
  to your origin over HTTPS.

## What runs

| Container | Job |
|---|---|
| `sync` | `rclone copy` from `b2:<bucket>/archive` every hour (never `sync`, so upstream deletions never propagate), then regenerates `index.html` from each snapshot's `index.json`. |
| `web` | nginx serving `/srv/data` read-only on `127.0.0.1:8080`. |
| `tor` | v3 onion service → `web:80`. Keys in the `tor-keys` volume; back that volume up if you want to keep the same `.onion` after a rebuild. |
| `caddy` | optional (`--profile tls`): automatic HTTPS on `MIRROR_DOMAIN`. |

## Things to know

- **Snapshots marked `bot-wall`** captured a CAPTCHA or login wall instead of
  the page. They're kept as evidence of what the site served and flagged in
  red on the front page. Nothing for you to do.
- **Snapshot pages** (`/archive/<timestamp>/index.html`) are ArchiveBox's
  own per-snapshot pages, unmodified. The `singlefile.html` link is the most
  faithful self-contained copy; `output.pdf` and `screenshot.png` are the
  visual record; `Wayback` is the independent copy at archive.org.
- **Content Security Policy** on the mirror blocks captured third-party
  scripts from making network requests. Some captured pages will look
  slightly different than on the original site because of that; the content
  is intact.
- **Updating:** `git pull && docker compose up -d --build`. Data is in
  docker volumes and survives.
- **Disk:** ~1.3 GB now. `docker system df` to check.
- **Stopping:** `docker compose down` keeps the data; add `-v` to delete it.

## If you want to be *very* useful

Seed the quarterly torrent when the maintainer publishes one (see the
security plan, section 12.4) — that lets the archive be re-hosted by anyone
even if every mirror is gone.

## For the maintainer: creating the read-only key

Backblaze console → **Application Keys** → **Add a New Application Key**:

| Field | Value |
|---|---|
| Name of Key | `mirror-readonly` (one key per mirror operator is better: `mirror-<name>`) |
| Allow access to Bucket(s) | the archive bucket only |
| Type of Access | **Read Only** |
| Allow List All Bucket Names | **ticked** (rclone needs it) |
| File name prefix | **`archive/`** — the key then cannot even list `index/`, where the encrypted secrets bundle lives |
| Duration | blank |

Hand the operator the keyID, applicationKey and bucket name over a channel
you trust (Signal, or in person). Revoke the key in the same console if an
operator drops out; the mirror keeps serving what it already has.
