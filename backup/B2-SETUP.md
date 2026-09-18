# Backblaze B2 setup — step by step

The off-box, tamper-resistant copy of the ArchiveBox archive. Written for
someone who has never used B2. Nothing in this file is secret; the secrets go
in `backup/b2.env` on the VPS (gitignored) and nowhere else.

Time: about 15 minutes. Cost at the current 1.2 GB: **$0/month** (the first
10 GB are free).

**Why these particular settings.** The goal is not just "have a copy" — it is
"have a copy the VPS cannot destroy". Since 2026-09-17 the archive's primary
copy is the VPS's own disk, so a compromised or failing VPS is a total-loss
event unless the off-box copy survives it. Three settings below make the copy
survive even an attacker who holds the VPS's B2 key:

1. **Object Lock, compliance mode, 90-day default retention** — every uploaded
   file is frozen for 90 days. Not even you can delete it early. A compromise
   therefore has to go unnoticed for 90 days before it can cost you anything.
2. **The backup script only ever `rclone copy`s** — never syncs, never
   deletes — so a normal night cannot remove anything either.
3. **(Optional hardening) a key without `deleteFiles`** — belt and braces on
   top of 1. See Part 3B.

---

## Part 1 — Create the account

1. Go to **https://www.backblaze.com/** → **Sign Up** (top right) → choose
   **B2 Cloud Storage** (not "Computer Backup", which is a different product).
2. Email + password. Use a strong unique password from your password manager,
   and an email address you control long-term.
3. **Region.** During signup you pick a data-center region. Choose
   **EU Central** (Amsterdam). This is fixed for the life of the account.
   Reasons: ~10 ms from the Frankfurt VPS instead of ~150 ms to the US, so
   the 1.2 GB first upload takes minutes; and the data sits in the
   Netherlands. (Backblaze is a US company, so US law still applies to the
   company — see "Alternatives" at the end for why that is acceptable here.)
4. Verify the email.
5. **Turn on two-factor authentication immediately.** Top right → your account
   → **My Settings** → **Sign-In Settings** → **Two-Factor Verification**. Use
   an authenticator app, not SMS. This account can *read* every archive
   backup — treat it like the Cloudflare account.
6. **Add a payment method:** left menu → **Billing** → add a card. The free
   tier is real (you will see $0.00 invoices), but Backblaze wants a card on
   file to store data. Set a **spending cap** on the same page if it is
   offered — $5/month is more than this project will ever reach.

---

## Part 2 — Create the bucket

Left menu → under **B2 Cloud Storage** → **Buckets** → **Create a Bucket**.

| Field | Set to | Why |
|---|---|---|
| **Bucket Unique Name** | something unguessable, e.g. `ml-archive-b7q2x` | Bucket names are global across all of Backblaze. Do not use `memorieslane`. |
| **Files in Bucket are** | **Private** | Never public. |
| **Default Encryption** | **Enable** (SSE-B2) | At-rest encryption, free. |
| **Object Lock** | **Enable** — "restrict a file from being modified or deleted for a specified period of time" | The whole point. |

Click **Create a Bucket**.

### Set the default retention — this is what actually makes files immutable

Enabling Object Lock alone does nothing until a retention period is set. On
the bucket list, the bucket now shows **"Object Lock: Enabled"** as a link.

1. Click **Object Lock: Enabled** on your bucket.
2. **Default Bucket Retention** → enter **90** days. Mode: **Compliance**
   (if a mode choice is shown; if only one is offered, it is compliance).
3. **Save changes.**

You will see a warning that files cannot be deleted by anyone during the
retention period. That is correct and intended.

**What 90 days commits you to.** Every file is undeletable for 90 days from
*its own* upload. The archive is append-only and small, so the bill stays at $0
regardless. The one practical consequence: if you ever want to empty and close
the bucket, you wait up to 90 days after the last upload. That is the price of
the guarantee, and a good trade.

**Ignore Backblaze's warning about "backup software" and default retention.**
Their docs warn that default bucket retention can cause data loss with backup
*software* — meaning tools like Veeam or Duplicati that store data as chunks
and must prune old chunks. Our backup is a plain `rclone copy` of ordinary
files that are never pruned. Default retention is exactly right for it.

### Lifecycle

Bucket → **Lifecycle Settings** → leave on **"Keep all versions of the file
(default)"**. Object Lock would block a lifecycle deletion anyway.

---

## Part 3A — Create the application key (web console)

Left menu → **Application Keys** → **Add a New Application Key**.

| Field | Set to | Why |
|---|---|---|
| **Name of Key** | `vps-archive-backup` | So you can recognise and revoke it later. |
| **Allow access to Bucket(s)** | **your bucket only** (pick it from the dropdown, not "All") | A stolen key then reaches nothing else. |
| **Type of Access** | **Read and Write** | Needed to upload. See the note below on `deleteFiles`. |
| **Allow List All Bucket Names** | **ticked** | rclone needs this to resolve the bucket name to its ID. Without it, rclone fails with "bucket not found". |
| **File name prefix** | leave blank | |
| **Duration (seconds)** | leave blank | A permanent key; you revoke it manually if needed. |

Click **Create New Key**.

**The next screen shows `keyID` and `applicationKey` exactly once.** Copy
both into your password manager now. If you lose the `applicationKey`, delete
the key and make a new one — it cannot be shown again.

**On `deleteFiles`.** The web console's "Read and Write" preset includes the
`deleteFiles` capability; the console cannot create a key without it. This is
acceptable because of the Object Lock you set in Part 2: a file under
compliance retention cannot be deleted by *any* key, `deleteFiles` or not,
until its 90 days are up. So an attacker holding this key can add files, and
can "hide" a filename (which creates a hide marker but destroys nothing), and
that is all. If you want the extra layer anyway, do Part 3B instead.

---

## Part 3B — Optional: a key that genuinely cannot delete (CLI)

Skip this on the first pass. Come back to it once the backup is running.

The B2 command-line tool can create keys with an exact capability list. Run it
**from your laptop** in a throwaway container so nothing is installed or left
behind. It will prompt for your *master* key ID and key — find those under
**Account** → **My Settings** → **Application Keys** → "Master Application
Key" (generate one if none exists, and treat it as the root password of the
account). Typing them at the prompt keeps them out of shell history.

```bash
docker run --rm -it python:3-alpine sh -c '
  pip -q install b2 >/dev/null &&
  b2 account authorize &&
  b2 key create --bucket YOUR_BUCKET_NAME vps-archive-backup-nodelete \
     listBuckets,listFiles,readFiles,writeFiles'
```

It prints `keyID applicationKey` on one line. Use those in `b2.env` instead of
the Part 3A key, then delete the Part 3A key in the console. If the backup's
first run fails with an *unauthorized* error that mentions retention, recreate
the key with `readBucketRetentions,readFileRetentions` appended to the list.

---

## Part 4 — Put the key on the VPS

On the VPS, as `debian`:

```bash
cd ~/MemoriesLane/backup
cp b2.env.example b2.env
chmod 600 b2.env
nano b2.env          # or vim
```

Fill in the three values. `RCLONE_CONFIG_B2_ACCOUNT` is the **keyID**,
`RCLONE_CONFIG_B2_KEY` is the **applicationKey**, `B2_BUCKET` is the bucket
name. Save. The file should look like this (with real values):

```
RCLONE_CONFIG_B2_TYPE=b2
RCLONE_CONFIG_B2_ACCOUNT=0041234567890abcdef000001
RCLONE_CONFIG_B2_KEY=K004AbCdEfGhIjKlMnOpQrStUvWxYz0123456
B2_BUCKET=ml-archive-b7q2x
```

`b2.env` is gitignored. Do not paste its contents into chat, an issue, or any
document — including this one.

---

## Part 5 — First run and verification

```bash
~/MemoriesLane/backup/archivebox-backup.sh
```

The first run uploads ~1.2 GB. From Frankfurt to Amsterdam expect 3-10
minutes. A good run ends with:

```
[...] rclone copy archive -> b2:ml-archive-b7q2x/archive
[...] rclone copy index snapshots -> b2:ml-archive-b7q2x/index
[...] done
```

and `echo $?` prints `0`. Exit code `2` means the local snapshot worked but
the B2 step was skipped — `b2.env` is missing or still has `REPLACE_ME` in it.

Verify in the console: **Buckets** → your bucket → **Browse Files**. You
should see two folders, `archive/` (the snapshot directories, named by
timestamp) and `index/` (dated `index-*.sqlite3` files). Click the **ⓘ** next
to any file: it shows an **Object Lock expiration date** ~90 days out. That
date is the proof the immutability is real.

From now on the systemd timer runs the script nightly at 03:00 UTC. Check on
it occasionally:

```bash
systemctl list-timers archivebox-backup.timer      # next / last run
tail -20 ~/backups/archivebox-backup.log            # what happened
```

---

## Part 6 — Restore drill (do this once now, then quarterly)

A backup you have never restored from is a hope, not a backup. Pull one index
snapshot back and open it:

```bash
docker run --rm --env-file ~/MemoriesLane/backup/b2.env -v /tmp:/out \
  rclone/rclone:1.68 copy "b2:$(grep B2_BUCKET= ~/MemoriesLane/backup/b2.env | cut -d= -f2)/index" /out/b2-restore-test --include 'index-*.sqlite3' --max-age 2d

docker run --rm -v /tmp/b2-restore-test:/b:ro python:3-alpine python3 -c "
import sqlite3,glob
f=sorted(glob.glob('/b/index-*.sqlite3'))[-1]
c=sqlite3.connect('file:%s?immutable=1'%f, uri=True)
print(f, c.execute('pragma integrity_check').fetchone()[0], 'snapshots=', c.execute('select count(*) from core_snapshot').fetchone()[0])"
rm -rf /tmp/b2-restore-test
```

`ok` and a plausible snapshot count means the round trip works. Write the
date in the security plan's verification table.

---

## Part 7 — After B2 is proven

**Done 2026-09-18.** Kept for the record and for anyone repeating this on
another project:

1. Delete the old Supabase copy of the archive from the archivebox container.
   Note `rclone purge` does **not** work against Supabase's S3 gateway (it
   needs the list-versions API, which Supabase lacks); use
   `rclone delete sb:memory-archive/archivebox --fast-list` then
   `rclone rmdirs sb:memory-archive/archivebox --leave-root=false`.
   Result here: 1.30 GB → 134 MB, auto-archiver's 707 files untouched.
2. Remove `cap_add`, `devices`, `security_opt` and the `rclone.env` env_file
   from the `archivebox` service in `docker-compose.vps.yml`, and redeploy.
   That strips the near-root `SYS_ADMIN` capability from the container that
   faces the internet. Verified: `CapAdd=[]`, no S3 credential in the
   container, and a 12/12-extractor capture afterwards.

---

## On Part 3B, now that Object Lock is confirmed

Your file-info screenshot showed **"Compliance Mode — Expires On 12/16/2026"**
on a file uploaded 09/17. That is the guarantee working. With compliance-mode
retention on every upload, `deleteFiles` on the key cannot delete anything
until the file's 90 days are up — not for an attacker, not for you.

So Part 3B (a key without `deleteFiles`) now protects against exactly one
thing: a future *misconfiguration* where someone with account access lowers or
removes the default retention, after which newly uploaded files would be
deletable with the current key. It does nothing against an attacker today. It
is worth doing when you next have ten minutes, and it is fine to leave for now.
If you do it, run it from your laptop (Part 3B), swap the values in `b2.env`,
run the backup once, and delete the old key in the console.

---

## Is B2 the best option? Alternatives compared

The requirements, in order: (1) **Object Lock / WORM** — the copy must survive
a VPS compromise, which rules out anything without it; (2) free or near-free
at 1.2 GB; (3) works with `rclone`; (4) a jurisdiction that will not hand data
to Vietnam; (5) simple enough to set up without prior experience.

| Provider | Object Lock | Cost at 1.2 GB | Jurisdiction | Verdict |
|---|---|---|---|---|
| **Backblaze B2** | Yes, compliance + governance, mature | **$0** (10 GB free), then $6/TB | US company; EU data center available | **Recommended.** Only option that is free, immutable and simple. |
| Cloudflare R2 | **No** — no versioning, no lock | $0 (10 GB free) | US | **Ruled out.** Fails requirement 1, and would concentrate even more of the project on one Cloudflare account (tunnel, DNS, Access, Pages already). |
| AWS S3 | Yes, mature | ~$0.03/month | US; EU regions available | Solid second choice if you already have AWS. IAM and billing are much harder for a newcomer, and egress costs bite on restore. |
| Scaleway Object Storage | Yes | 75 GB free tier | **France, EU-headquartered** | Best choice if EU-only jurisdiction matters more than simplicity. Console is French-first, fewer guides. |
| Wasabi | Yes | ~$7/month **minimum** (1 TB billed) plus 90-day minimum storage | US; EU regions | Fine product, wrong size — you would pay for 1 TB to store 1.2 GB. |
| Hetzner Object Storage | **Not yet** (roadmap) | ~€5/month minimum | Germany | Ruled out until Object Lock ships. Revisit in a year. |
| Storj | Yes (since 2024) | 25 GB free | Decentralised, US company | Works, but a niche tool with fewer answers when something breaks. |
| Hetzner Storage Box / rsync.net + borg | Immutability via append-only mode, not Object Lock | ~€4/month | Germany / US | Powerful but a different toolchain (borg), more to learn, and not the S3 model this project already uses everywhere. |

**On jurisdiction.** Every serious option is a US or EU company. For this
project's threat model that is fine: the realistic adversary is the Vietnamese
state, and neither a US nor an EU court will hand it your backups on request.
The thing to avoid is a provider with a Vietnamese office or Vietnamese
data-localisation obligations — none of the above have one.

**Why not two providers?** You could, and the script would need one more
`rclone copy` line. At this size the marginal benefit is small: B2 with Object
Lock already gives you 3 copies (VPS, Supabase-until-retired-then-laptop, B2),
2 providers, 1 off-site, 1 immutable. If the archive grows past ~8 GB (B2's
free tier), that is the moment to reconsider — Scaleway's 75 GB free tier is
the natural second leg then.
