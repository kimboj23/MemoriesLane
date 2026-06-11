"use strict";
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { initDb } = require("./db");
const memoriesRouter = require("./routes/memories");
const moderateRouter = require("./routes/moderate");

const PORT = parseInt(process.env.PORT, 10) || 3001;
const BIND = process.env.BIND_ADDR || "127.0.0.1"; // localhost-only by default
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Validate critical env vars at startup — fail loudly rather than silently
// mis-operating.
// ---------------------------------------------------------------------------
function assertEnv() {
  if (IS_PROD) {
    if (!process.env.RATE_HMAC_SECRET || process.env.RATE_HMAC_SECRET === "replace_me_with_64_hex_chars")
      throw new Error("RATE_HMAC_SECRET must be set in production");
    if (!process.env.ADMIN_TOKEN_HASH || process.env.ADMIN_TOKEN_HASH === "replace_me_with_sha256_hex")
      throw new Error("ADMIN_TOKEN_HASH must be set in production");
    if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === "null")
      throw new Error("ALLOWED_ORIGINS must be set to a real domain in production");
  }
}

// ---------------------------------------------------------------------------
// CORS — strict allowlist.
// "null" is allowed in development because the frontend opens as file://.
// ---------------------------------------------------------------------------
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "null")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function corsOrigin(origin, cb) {
  // origin is undefined for same-origin requests and non-browser clients.
  // origin is the string "null" for file:// requests.
  if (!origin || allowedOrigins.has(origin)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error("CORS: origin not allowed"), { status: 403 }));
  }
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();

// Security headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        // The API serves JSON and images — no scripts, no frames.
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    // Prevent our uploaded images from being embedded in foreign pages.
    crossOriginResourcePolicy: { policy: "same-origin" },
    // HSTS: 1 year, include subdomains. Only meaningful in production behind TLS.
    strictTransportSecurity: IS_PROD
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  })
);

app.use(cors({ origin: corsOrigin, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"], maxAge: 600 }));

// Body parsing — 1 MB covers base64-encoded compressed images.
// express.json rejects anything larger with a 413 before our code runs.
app.use(express.json({ limit: "1mb" }));

// Do not advertise the server technology.
app.disable("x-powered-by");

// In development, trust the loopback for req.ip; in production, trust one
// proxy hop (the TLS-terminating reverse proxy).
app.set("trust proxy", IS_PROD ? 1 : "loopback");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/api/memories", memoriesRouter);
app.use("/api/moderate", moderateRouter);

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) => res.json({ service: "MemoriesLane API", status: "ok", endpoints: ["/api/memories", "/health"] }));

// ---------------------------------------------------------------------------
// Error handler — never leak stack traces to clients.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[error]", err.message, err.stack);
  // Never send the stack or internal message to the client.
  res.status(status).json({ error: err.public || (status === 403 ? "Forbidden" : "Internal server error") });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
assertEnv();
initDb();
app.listen(PORT, BIND, () => {
  console.log(`[server] memorylane backend listening on ${BIND}:${PORT} (${NODE_ENV})`);
  if (!IS_PROD) {
    console.log("[server] Development mode — copy .env.example to .env and set RATE_HMAC_SECRET and ADMIN_TOKEN_HASH");
  }
});

module.exports = app; // exported for testing
