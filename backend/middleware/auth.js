"use strict";
/**
 * Admin token authentication.
 *
 * We store the SHA-256 hash of the token in the environment, not the token
 * itself. Even if the .env file leaks, the attacker cannot use the hash
 * directly — they would need to find a preimage.
 *
 * Comparison uses crypto.timingSafeEqual to prevent timing attacks that
 * could reveal how many characters of the token are correct.
 */
const crypto = require("crypto");

function verifyAdminToken(token) {
  const expected = process.env.ADMIN_TOKEN_HASH;
  if (!expected || expected === "replace_me_with_sha256_hex") return false;
  if (!token) return false;

  const actualHash = crypto.createHash("sha256").update(token).digest("hex");

  // Both buffers must be the same length for timingSafeEqual.
  // If the hash format is wrong the comparison is skipped (safe — returns false).
  try {
    const a = Buffer.from(actualHash, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Express middleware — rejects requests without a valid admin token.
 * Token is passed as:  Authorization: Bearer <token>
 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!verifyAdminToken(token)) {
    // 401 with WWW-Authenticate so clients know what scheme to use.
    res.set("WWW-Authenticate", 'Bearer realm="MemoriesLane moderation"');
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

module.exports = { requireAdmin };
