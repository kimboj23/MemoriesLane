#!/usr/bin/env node
"use strict";
/**
 * One-time admin token setup.
 * Run: node scripts/setup-admin.js
 *
 * Prints a random token and its SHA-256 hash.
 * Store the token in your password manager; put the HASH in .env.
 */
const crypto = require("crypto");

const token = crypto.randomBytes(32).toString("hex");
const hash  = crypto.createHash("sha256").update(token).digest("hex");
const hmacSecret = crypto.randomBytes(32).toString("hex");

console.log("\n=== MemoriesLane — Initial secrets ===\n");
console.log("Add these to your .env file:\n");
console.log(`ADMIN_TOKEN_HASH=${hash}`);
console.log(`RATE_HMAC_SECRET=${hmacSecret}`);
console.log("\n--- Keep this token in your password manager (never in .env) ---\n");
console.log(`Admin Bearer token: ${token}`);
console.log("\n");
