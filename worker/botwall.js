"use strict";
/**
 * Flags snapshots whose captured content is a bot wall / login wall / consent
 * wall rather than the actual page, by tagging them `bot-wall` in ArchiveBox.
 *
 * Why this exists: ArchiveBox has no notion of "this capture is worthless".
 * If a site serves a CAPTCHA or a login page, every extractor happily
 * succeeds -- it captured *a* page -- and the snapshot shows up as
 * `archived`, with a thumbnail, a plausible size and a green tick. Confirmed
 * 2026-09-01 on a nytimes.com article: status `archived`, 9 saved, 771 KB,
 * singlefile/pdf/screenshot/dom all `succeeded`, and the archived content was
 * "confirm that you are human" with a slider CAPTCHA. The Wayback copy of the
 * same URL was an HTTP 204 stub. Nothing anywhere held the article.
 *
 * For a censorship archive that is the dangerous failure mode: it *looks*
 * archived, so nobody re-captures it, and the gap is only discovered years
 * later when the original is gone. This makes the failure visible at capture
 * time instead.
 *
 * Tags rather than deletes or fails: the capture is still evidence of *what
 * the site served us*, which for a project documenting censorship can itself
 * be worth keeping. A human decides what to do -- re-capture from another
 * route, or accept it. Filter the admin by the `bot-wall` tag to review them.
 *
 * Runs on the same sweep cadence as reconcile.js/social-sweep.js.
 */
const { spawn } = require("child_process");

const CONTAINER = process.env.ARCHIVEBOX_CONTAINER || "memorieslane-archivebox-1";
const TAG_NAME = process.env.BOTWALL_TAG || "bot-wall";

// Phrases that essentially never occur in real article body text, taken from
// walls this archive has actually hit (NYT/PerimeterX, Cloudflare, Google
// consent, Threads/Meta login) plus the common commercial bot-blockers.
// Deliberately literal and specific: a generic word like "captcha" would
// match any article *about* captchas, and a false `bot-wall` tag on real
// evidence is worse than a missed one -- the tag is a prompt to re-capture.
const SIGNATURES = [
  "confirm that you are human",
  "slide right to secure",
  "press and hold to confirm",
  "verify you are human",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "attention required! | cloudflare",
  "just a moment...",
  "pardon our interruption",
  "request unsuccessful. incapsula",
  "you've been blocked by network security",
  "before you continue to youtube",
  "log in or sign up for threads",
  "say more with threads",
  "sign up to see photos and videos from",
  "this content isn't available right now",
  "you must log in to continue",
  "access denied",
];

// Reads the HEAD and the TAIL of each candidate file, not just the head.
// SingleFile inlines every stylesheet, script and base64 image *before* the
// visible markup, so on a real NYT capture the phrase "confirm that you are
// human" sat at byte 412118 of a 415935-byte file -- a head-only read missed
// it entirely and the detector silently passed the very snapshot that
// prompted it. Head+tail keeps I/O bounded (~500KB per file however large the
// snapshot is), which matters because this runs every sweep against the
// S3-backed mount -- the same per-file cost that caused this project's 524s.
const PY = `
import os
from core.models import Snapshot, Tag

SIGS = ${JSON.stringify(SIGNATURES)}
FILES = ["output.html", "readability/content.txt", "mercury/content.txt", "singlefile.html"]
HEAD_BYTES = 200000
TAIL_BYTES = 300000
TAG_NAME = ${JSON.stringify(TAG_NAME)}

# NOTE: deliberately no helper function here. Django's manage-shell runs
# this via exec() inside a method, so a def'd function cannot see these
# module-level constants (they are locals of that frame) and raises NameError
# -- which the per-file 'except Exception: continue' below would swallow
# silently, making the whole detector a no-op that reports success. That
# exact bug shipped once; the logic stays inline.

tagged = []
for s in Snapshot.objects.all():
    existing = []
    for t in s.tags.all():
        existing.append(t.name)
    if TAG_NAME in existing:
        continue
    d = "/data/archive/" + s.timestamp
    if not os.path.isdir(d):
        continue
    hit = None
    for fn in FILES:
        p = os.path.join(d, fn)
        if not os.path.exists(p):
            continue
        try:
            size = os.path.getsize(p)
            fh = open(p, "r", encoding="utf-8", errors="ignore")
            if size <= HEAD_BYTES + TAIL_BYTES:
                blob = fh.read().lower()
            else:
                head = fh.read(HEAD_BYTES)
                fh.seek(max(0, size - TAIL_BYTES))
                blob = (head + fh.read()).lower()
            fh.close()
        except Exception as e:
            # Never swallow silently -- a masked error here makes the whole
            # detector a no-op that still reports success.
            print("BOTWALL_READERR %s %s: %s" % (s.timestamp, fn, e))
            continue
        for sig in SIGS:
            if sig in blob:
                hit = sig
                break
        if hit:
            break
    if hit:
        tag, _ = Tag.objects.get_or_create(name=TAG_NAME)
        s.tags.add(tag)
        s.save()
        tagged.append((s.timestamp, hit, s.url))

print("BOTWALL_TAGGED %d" % len(tagged))
for row in tagged:
    print("BOTWALL %s | %s | %s" % (row[0], row[1], row[2][:90]))
`;

// Piped over stdin rather than `manage shell -c "..."`: this script crosses
// ssh -> docker exec -> sh, and quoting it inline reliably corrupts it (see
// README). stdin has no such problem.
function runInArchiveBox(script, timeoutMs = 1000 * 60 * 10) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["exec", "-i", "--user=archivebox", CONTAINER, "archivebox", "manage", "shell"]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("bot-wall sweep timed out")); }, timeoutMs);
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `docker exec exited ${code}`));
    });
    proc.stdin.end(script);
  });
}

async function botWallSweep() {
  const out = await runInArchiveBox(PY);
  const flagged = out
    .split("\n")
    .filter((l) => l.startsWith("BOTWALL "))
    .map((l) => l.slice("BOTWALL ".length).trim());

  for (const row of flagged) {
    console.warn(`[worker] [bot-wall] captured a wall, not the page -> ${row}`);
  }
  if (flagged.length) {
    console.warn(
      `[worker] [bot-wall] tagged ${flagged.length} snapshot(s) "${TAG_NAME}" -- ` +
      `filter the ArchiveBox admin by that tag to review/re-capture`
    );
  }
  return flagged.length;
}

module.exports = { botWallSweep, SIGNATURES };
