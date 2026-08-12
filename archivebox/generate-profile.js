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

  const results = [];
  for (const url of TARGETS) {
    const host = new URL(url).hostname;
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(SHOTS_DIR, `${host}-before.png`) }).catch(() => {});
      const r = await dismissBanner(page);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(SHOTS_DIR, `${host}-after.png`) }).catch(() => {});
      results.push({ url, host, ok: true, ...r });
    } catch (e) {
      results.push({ url, host, ok: false, error: e.message });
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
