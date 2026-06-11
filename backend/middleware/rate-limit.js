"use strict";
/**
 * IP-free rate limiter.
 *
 * Why: We must enforce rate limits to prevent spam, but we must not store
 * IP addresses — they are PII and could be used to identify vulnerable users.
 *
 * How: Derive a pseudonym for each client using HMAC(ip, secret + window).
 * The window (1-hour bucket by default) is baked into the key, so old counters
 * expire automatically when the window rolls over. The raw IP is never written
 * to memory beyond the duration of the current request stack frame.
 */
const crypto = require("crypto");

const SECRET = () => process.env.RATE_HMAC_SECRET || "dev_secret_replace_in_production";
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-process counter store.
// For multi-process deployments, replace with Redis INCR + EXPIRE.
// Separate counter map per namespace so read and write limits don't share budget.
const countersByNs = new Map(); // namespace → Map(pseudonym → count)
const windowAt = { v: 0 };

function currentWindow() {
  return Math.floor(Date.now() / WINDOW_MS);
}

function sweep() {
  const win = currentWindow();
  if (win !== windowAt.v) {
    countersByNs.clear();
    windowAt.v = win;
  }
}

function pseudonym(ip) {
  const win = currentWindow();
  // HMAC ensures: given the hash you cannot recover the IP.
  // The window number is mixed in so the same secret produces different
  // pseudonyms each hour — old entries self-expire.
  //
  // NOTE: With Cloudflare Tunnel, cloudflared sets X-Forwarded-For to the
  // real client IP. Express reads req.ip from that header when trust proxy is
  // set. To prevent IP spoofing via forged X-Forwarded-For, configure
  // cloudflared's Access policies or use a named tunnel with Cloudflare WAF
  // to strip and re-set the header before it reaches the backend.
  return crypto
    .createHmac("sha256", SECRET() + win)
    .update(ip || "unknown")
    .digest("hex")
    .slice(0, 24); // 96-bit prefix — plenty for a counter key
}

/**
 * Returns an Express middleware that limits to `max` requests per WINDOW_MS
 * within the given `namespace` (defaults to "default").
 * Namespacing ensures read and write endpoint limits are independent.
 * On breach: responds 429, does NOT log the IP.
 */
function rateLimit(max = 10, namespace = "default") {
  return (req, res, next) => {
    sweep();
    const ip = req.ip || req.socket.remoteAddress || "";
    const key = pseudonym(ip);
    if (!countersByNs.has(namespace)) countersByNs.set(namespace, new Map());
    const counters = countersByNs.get(namespace);
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count);

    if (count > max) {
      res.set("Retry-After", Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 1000));
      return res.status(429).json({ error: "Too many requests — please wait before submitting again." });
    }
    next();
  };
}

module.exports = { rateLimit };
