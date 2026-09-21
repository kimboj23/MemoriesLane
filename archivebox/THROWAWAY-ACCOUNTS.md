# Giving the archive a login: throwaway accounts for content managers

Some sites won't show the real page to a visitor who isn't logged in —
Threads, Facebook, Instagram, YouTube, Reddit, X. When the archive captures
one of those without a login, it saves the "log in or sign up" wall instead
of the post (those captures are tagged `bot-wall` in the archive). To capture
the actual post, the archive's browser has to be logged in.

You can give it that login **without ever giving anyone your password**, by
exporting the *cookies* of a dedicated throwaway account. This page is the
whole procedure. It takes about 15 minutes the first time and 3 minutes
each refresh.

## The one rule

**Never do this with an account that is yours.**

- The archive runs in a data centre. Platforms notice a login that suddenly
  appears from a server IP and sometimes lock or ban the account. That must
  be an account nobody cares about.
- If the server were ever seized or compromised, whoever has it has a live
  logged-in session for that account. That must be an account that reveals
  nothing about a real person.
- In August 2026 this project had an incident where a cookie export
  accidentally contained a whole browser's worth of sessions — bank, tax
  office, Cloudflare. The steps below are designed so that cannot happen
  again, but the design only works if the account is throwaway.

A throwaway account is: created for this purpose, with a fresh email address
(a ProtonMail or SimpleLogin alias is fine), **no phone number if the
platform allows it**, no real name, no photo of you, no links to your other
accounts, and a password you use nowhere else.

## Part 1 — A separate browser profile, used for nothing else

This is what keeps your personal sessions out of the export.

**Chrome / Edge / Brave:** click your profile picture (top right) → **Add**
→ name it `Archive throwaway` → *Continue without an account*. A new window
opens. Everything below happens in **that** window only.

**Firefox:** type `about:profiles` in the address bar → **Create a New
Profile** → name it `Archive throwaway` → **Launch profile in new browser**.

Do not sign this browser profile into Google/Microsoft sync. Do not log in
to anything personal in it, ever.

## Part 2 — Create the throwaway account

In the throwaway browser window, sign up for the platform you'll be
providing (one account per platform is best). Use the throwaway email. If
the platform asks for a phone number and lets you skip it, skip it.

Then use the account a little: follow a few large public accounts, scroll,
open a few posts, over a day or two if you can. A brand-new account that
immediately logs in from a server is the fastest way to get it flagged.

## Part 3 — Export the cookies (for that one site only)

1. In the throwaway browser, install **"Get cookies.txt LOCALLY"**
   (open-source, Chrome Web Store / Firefox Add-ons). The word *LOCALLY*
   matters — several similarly named extensions upload your cookies to a
   third party. This one doesn't.
2. Go to the platform's site and make sure you are logged in as the
   throwaway (open your profile page to check).
3. Click the extension's icon **while on that site**. It shows the cookies
   for the current site only. Click **Export** (or *Export As* → Netscape
   format). Save the file as, for example, `threads.cookies.txt`.

   Do **not** use any "export all" option. One site per file.
4. **Look at the file** before sending it. Open it in a text editor. Every
   line after the `#` comments should start with that platform's domain —
   `.threads.com`, `.instagram.com`, `.facebook.com` for a Meta export;
   `.youtube.com` / `.google.com` for YouTube. If you see any other website's
   name in there — anything — delete the file and go back to Part 1; your
   throwaway browser profile is not clean.

   (The import tool on the server also refuses any file that spans more
   than a dozen domains, as a backstop. Don't rely on it.)

## Part 4 — Send it

Send the file to the maintainer over **Signal** (or another end-to-end
encrypted channel you already use with them). Not email, not a chat app that
isn't end-to-end encrypted, not a shared drive, and never anywhere near Git.

Include: which platform, the throwaway's username, and the date. Then delete
the file from your computer.

Cookies expire. Meta's typically last months, Google's less, and a platform
can invalidate them any time it gets suspicious. Expect the maintainer to ask
for a fresh export every few weeks, or when captures from that platform start
coming back tagged `bot-wall` again. Repeat Part 3–4 — the browser profile
and account stay.

## What to expect afterwards

- The maintainer imports the file into the archive's browser profile and
  checks a screenshot of the platform's home page to confirm the login took.
- Captures from that platform should then show the real post. If they still
  come back as `bot-wall`, the account was probably flagged — the maintainer
  will tell you, and the fix is usually to log in to the throwaway from your
  browser, pass whatever check it wants, and export again.
- If the platform bans the throwaway, nothing else is affected. Make a new
  one.

## What this can't do

- **It won't beat a datacenter-IP block on its own.** YouTube in particular
  answers "sign in to confirm you're not a bot" to server IPs; a logged-in
  throwaway usually gets past that, but not always. That is an IP problem,
  discussed separately in the security plan.
- **One account per platform is active at a time.** If two people provide
  Meta cookies, the later import wins. Coordinate with the maintainer.

---

## For the maintainer: importing

Netscape `cookies.txt` files go in `~/profile-gen/import/` on the VPS (one
per platform, any name ending in `.txt`). Then regenerate the profile exactly
as in README "Cookie-consent banners in captures", adding one mount to the
generator run:

```bash
docker run --rm \
  -v ~/profile-gen:/work -v ~/profile-gen/output:/output \
  -v ~/profile-gen/import:/import:ro \
  -v ~/profile-gen/chromium-1217:/chromium-1217:ro -w /work \
  -e CHROME_EXECUTABLE=/chromium-1217/chrome-linux64/chrome \
  mcr.microsoft.com/playwright:v1.62.1-jammy node generate-profile.js
```

The script loads every import into the profile *before* the consent-banner
pass, visits each imported platform's front page, and writes
`~/profile-gen/output/shots/www.<platform>-after.png`. **Open that screenshot.**
A logged-in home feed means the import worked; a "log in or sign up" wall
means it didn't (also visible as `"loginWall": true` for that host in
`results.json`). Don't deploy a profile whose import failed — you'd just be
replacing working consent state with the same wall.

The export step (`cookies-to-netscape.js`) then writes a `cookies.txt` that
includes the throwaway sessions, so the same login reaches wget
(`COOKIES_FILE`) and auto-archiver (`cookies_file` in `orchestration.yaml`,
which points at the same file). Deploy both as documented.

Guard rails in the script: any single import file spanning more than 12
domains is refused as a probable whole-browser export
(`IMPORT_MAX_DOMAINS` to override knowingly). `~/profile-gen/import/` holds
live sessions — `chmod 700` it, and delete the files once the profile is
deployed; the sessions live on in `chrome_profile/` and `cookies.txt`, which
are already in the encrypted secrets bundle.
