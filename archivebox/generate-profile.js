"use strict";
/**
 * Visits the real sites this project archives from, in a real (scripted)
 * headless browser, and dismisses their actual consent banners -- producing
 * a genuinely-issued cookie/localStorage state, not fabricated values.
 * Output: a persistent Chrome profile dir (-> CHROME_USER_DATA_DIR) and a
 * cookies export (-> converted to cookies.txt for wget, see
 * cookies-to-netscape.js). Not part of the deployed image -- run manually via
 * a disposable Playwright container, see README.md "Cookie-consent banners
 * in captures" for the full regeneration process, required CHROME_EXECUTABLE
 * env var, and the two sharp edges (chromium build mismatch, chown -R).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Major, popular, mainstream Vietnamese domestic news outlets (cross-checked
// against live Semrush/Feedspot rankings 2026-08, not just prior knowledge).
// Excludes non-news-outlet sites (law/human-rights commentary, academic
// repositories, literary/political forums) even if this project has archived
// from them before -- this list is specifically for the news-outlet cookie
// consent problem.
const TARGETS = [
  "https://vnexpress.net/",
  "https://tuoitre.vn/",
  "https://thanhnien.vn/",
  "https://vietnamnet.vn/",
  "https://dantri.com.vn/",
  "https://24h.com.vn/",
  "https://kenh14.vn/",
  "https://znews.vn/",
  "https://laodong.vn/",
  "https://tienphong.vn/",
  "https://nld.com.vn/",
  "https://soha.vn/",
  "https://danviet.vn/",
  "https://plo.vn/",
  "https://vietnamplus.vn/",
  "https://kienthuc.net.vn/",
];

const PROFILE_DIR = process.env.PROFILE_DIR || "/output/chrome_profile";
const SHOTS_DIR = process.env.SHOTS_DIR || "/output/shots";

// Optional: a directory of Netscape cookies.txt files exported from THROWAWAY
// accounts (one file per platform, e.g. threads.cookies.txt), to be loaded
// into the profile before the consent-banner pass. This is the 0.7.4
// equivalent of 0.9.x's `archivebox persona create --import=...`: login state
// lands in the Chrome profile (so singlefile/pdf/screenshot/dom capture as a
// logged-in user) AND in the exported cookies.txt (wget, auto-archiver).
// Content managers export these on their own machines from a dedicated
// browser profile that holds nothing but the throwaway login -- see
// archivebox/THROWAWAY-ACCOUNTS.md. Never a personal profile: the 2026-08
// incident was a full-browser export that included bank and Cloudflare
// sessions.
const IMPORT_DIR = process.env.IMPORT_DIR || "/import";

// Netscape cookies.txt -> Playwright cookie objects. Handles the "#HttpOnly_"
// domain prefix that the common browser exporters write for httpOnly
// cookies (it is a comment to older parsers, deliberately).
function parseNetscape(text, file) {
  const out = [];
  for (let raw of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (raw.startsWith("#HttpOnly_")) { httpOnly = true; raw = raw.slice("#HttpOnly_".length); }
    else if (!raw.trim() || raw.startsWith("#")) continue;
    const f = raw.split("\t");
    if (f.length < 7) continue;
    const [domain, , cpath, secure, expiry, name, ...rest] = f;
    const value = rest.join("\t");
    const exp = parseInt(expiry, 10);
    out.push({
      name, value, domain, path: cpath || "/",
      expires: exp > 0 ? exp : -1,
      httpOnly, secure: secure === "TRUE",
      sameSite: "Lax",
    });
  }
  if (!out.length) console.warn(`[import] ${file}: no cookies parsed`);
  return out;
}

// Refuse imports that look like a whole-browser dump rather than one
// throwaway account. A single platform's export is a few dozen cookies over
// a handful of related domains; 4,061 cookies over 1,793 domains was the
// incident. The maintainer can raise the ceiling knowingly.
const MAX_DOMAINS_PER_FILE = parseInt(process.env.IMPORT_MAX_DOMAINS || "12", 10);

function loadImports() {
  if (!fs.existsSync(IMPORT_DIR)) return { cookies: [], files: [] };
  const files = fs.readdirSync(IMPORT_DIR).filter((f) => f.endsWith(".txt")).sort();
  const cookies = [];
  for (const f of files) {
    const parsed = parseNetscape(fs.readFileSync(path.join(IMPORT_DIR, f), "utf8"), f);
    const domains = new Set(parsed.map((c) => c.domain.replace(/^\./, "")));
    if (domains.size > MAX_DOMAINS_PER_FILE) {
      throw new Error(
        `[import] ${f} spans ${domains.size} domains (limit ${MAX_DOMAINS_PER_FILE}). ` +
        `That looks like a whole-browser export, not one throwaway account -- refusing. ` +
        `Re-export for the single site only (see THROWAWAY-ACCOUNTS.md), or set IMPORT_MAX_DOMAINS if this is intended.`
      );
    }
    console.log(`[import] ${f}: ${parsed.length} cookies, domains: ${[...domains].join(", ")}`);
    cookies.push(...parsed);
  }
  return { cookies, files };
}

const SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#didomi-notice-agree-button",
  'button[aria-label="Accept all"]',
  'button[aria-label="Accept"]',
  ".fc-cta-consent",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
];

const TEXT_PATTERNS = [
  /^(accept all|accept all cookies|accept)$/i,
  /^(i agree|agree|got it|ok|allow all|allow)$/i,
  /^(đồng ý|đồng ý tất cả|tôi đồng ý|chấp nhận|chấp nhận tất cả)$/i,
];

async function dismissBanner(page) {
  for (const sel of SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) {
        await el.click({ timeout: 3000 });
        return { dismissed: true, via: sel };
      }
    } catch { /* try next */ }
  }
  const candidates = await page.$$('button, a[role="button"], div[role="button"], input[type="button"]');
  for (const el of candidates) {
    try {
      if (!(await el.isVisible())) continue;
      const text = ((await el.innerText().catch(() => "")) || "").trim();
      if (!text || text.length > 40) continue;
      if (TEXT_PATTERNS.some((re) => re.test(text))) {
        await el.click({ timeout: 3000 });
        return { dismissed: true, via: `text:"${text}"` };
      }
    } catch { /* try next */ }
  }
  return { dismissed: false };
}

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 2000 },
    ignoreHTTPSErrors: true,
    args: ["--no-sandbox"],
  });

  // Throwaway-account logins first, so the sites below see them on the visit.
  const imports = loadImports();
  if (imports.cookies.length) {
    await context.addCookies(imports.cookies);
    console.log(`[import] loaded ${imports.cookies.length} cookies from ${imports.files.length} file(s) into the profile`);
  }
  // Visit each imported platform's front page too: (a) sites store part of
  // the session in localStorage/IndexedDB on first load, which only a real
  // visit creates; (b) the "<host>-after.png" screenshot is how the
  // maintainer checks the login actually took (a logged-in home page vs a
  // "log in or sign up" wall) before deploying the profile.
  const importedHosts = [...new Set(imports.cookies.map((c) => c.domain.replace(/^\./, "")))]
    .filter((d) => d.split(".").length === 2)           // registrable roots only: threads.com, not www.threads.com
    .map((d) => `https://www.${d}/`);
  const visits = [...importedHosts.map((url) => ({ url, imported: true })), ...TARGETS.map((url) => ({ url }))];

  const results = [];
  for (const { url, imported } of visits) {
    const host = new URL(url).hostname;
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(SHOTS_DIR, `${host}-before.png`) }).catch(() => {});
      const r = await dismissBanner(page);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(SHOTS_DIR, `${host}-after.png`) }).catch(() => {});
      // Cheap login heuristic for imported platforms: a wall page says so in
      // its title/body. Not authoritative -- the maintainer looks at the
      // screenshot -- but it makes an obviously-failed import loud in results.json.
      let loginWall = null;
      if (imported) {
        const text = ((await page.title().catch(() => "")) + " " + (await page.locator("body").innerText().catch(() => ""))).toLowerCase();
        loginWall = /log in or sign up|sign up to see|you must log in|sign in to confirm/.test(text);
      }
      results.push({ url, host, ok: true, imported: !!imported, ...(imported ? { loginWall } : {}), ...r });
    } catch (e) {
      results.push({ url, host, ok: false, imported: !!imported, error: e.message });
    } finally {
      await page.close();
    }
  }

  const cookies = await context.cookies();
  fs.writeFileSync("/output/cookies.json", JSON.stringify(cookies, null, 2));
  fs.writeFileSync("/output/results.json", JSON.stringify(results, null, 2));

  await context.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
