#!/usr/bin/env bash
# Deploy backend + archivebox + archive-worker on the VPS, and wire the
# backend into the existing Cloudflare Tunnel at archivebox-api.heomay.xyz.
#
# Run this FROM the repo root on the VPS, after copying backend/, archivebox/,
# worker/, backend/.env, and archivebox/rclone.env there (same relative
# layout as the repo). See README.md "Deploy" for the full explanation.
#
# Usage:
#   chmod +x deploy-vps.sh
#   TUNNEL=<tunnel-name-or-id> ./deploy-vps.sh
#
# Not sure of the tunnel name? Run `cloudflared tunnel list` and use whichever
# one shows active CONNECTIONS (a tunnel with 0 connections is dormant/unused).
# As of this writing that's "archivebox-vps" — but confirm, don't assume.

set -euo pipefail

TUNNEL="${TUNNEL:?Set TUNNEL to the tunnel name or ID, e.g. TUNNEL=memorylane ./deploy-vps.sh}"
CLOUDFLARED_CONFIG="${CLOUDFLARED_CONFIG:-/etc/cloudflared/config.yml}"
API_HOSTNAME="archivebox-api.heomay.xyz"
COMPOSE="docker compose -f docker-compose.vps.yml"

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
step "1. Sanity-check backend/.env"
# ---------------------------------------------------------------------------
if [ ! -f backend/.env ]; then
  echo "backend/.env not found — copy it from your old Railway config first." >&2
  exit 1
fi
if grep -qE '^ALLOWED_ORIGINS=(null)?$' backend/.env; then
  echo "backend/.env: ALLOWED_ORIGINS is missing or 'null' — the backend will" >&2
  echo "refuse to start in production. Set it to your real frontend origin" >&2
  echo "(e.g. ALLOWED_ORIGINS=https://memorylane101.pages.dev) and re-run." >&2
  exit 1
fi
# Browsers never send a trailing slash in the Origin header, so one here means
# every real CORS check silently fails even though the value "looks" right.
if grep -qE '^ALLOWED_ORIGINS=.*/(,|$)' backend/.env; then
  echo "backend/.env: ALLOWED_ORIGINS has a trailing slash on at least one" >&2
  echo "origin — that will never match a browser's Origin header and CORS" >&2
  echo "will silently reject every request. Remove the trailing slash(es)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
step "2. Build and start backend + archivebox + archive-worker"
# ---------------------------------------------------------------------------
$COMPOSE up -d --build
$COMPOSE ps

# ---------------------------------------------------------------------------
step "3. Wait for the backend to answer on localhost"
# ---------------------------------------------------------------------------
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "backend is up."
    break
  fi
  [ "$i" -eq 30 ] && { echo "backend never came up — check: $COMPOSE logs backend" >&2; exit 1; }
  sleep 2
done

# ---------------------------------------------------------------------------
step "4. Cloudflare Tunnel ingress rule for $API_HOSTNAME"
# ---------------------------------------------------------------------------
if [ ! -f "$CLOUDFLARED_CONFIG" ]; then
  echo "Couldn't find $CLOUDFLARED_CONFIG." >&2
  echo "Set CLOUDFLARED_CONFIG=/path/to/config.yml and re-run." >&2
  exit 1
fi

if grep -q "$API_HOSTNAME" "$CLOUDFLARED_CONFIG"; then
  echo "$API_HOSTNAME already present in $CLOUDFLARED_CONFIG — skipping edit."
else
  cat <<EOF

$CLOUDFLARED_CONFIG does not yet route $API_HOSTNAME. Add this block to its
"ingress:" list, ABOVE the catch-all "- service: http_status:404" line
(see cloudflared-config.yml in this repo for the exact block):

  - hostname: $API_HOSTNAME
    service: http://localhost:3001

Opening it now with \$EDITOR (${EDITOR:-nano}). Save and exit when done.
EOF
  read -rp "Press Enter to open the editor... "
  "${EDITOR:-nano}" "$CLOUDFLARED_CONFIG"

  if ! grep -q "$API_HOSTNAME" "$CLOUDFLARED_CONFIG"; then
    echo "$API_HOSTNAME still not found in $CLOUDFLARED_CONFIG — aborting." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
step "5. Validate the tunnel config before touching the live service"
# ---------------------------------------------------------------------------
cloudflared --config "$CLOUDFLARED_CONFIG" tunnel ingress validate

# ---------------------------------------------------------------------------
step "6. Create the DNS route (no-op if it already exists) and restart cloudflared"
# ---------------------------------------------------------------------------
cloudflared tunnel route dns "$TUNNEL" "$API_HOSTNAME" || true
sudo systemctl restart cloudflared
sudo systemctl --no-pager status cloudflared

# ---------------------------------------------------------------------------
step "7. End-to-end check"
# ---------------------------------------------------------------------------
sleep 3
if curl -fsS "https://$API_HOSTNAME/health" >/dev/null; then
  echo "https://$API_HOSTNAME is live."
else
  echo "https://$API_HOSTNAME did not respond — check: journalctl -u cloudflared -f" >&2
  exit 1
fi

cat <<EOF

Done. Last manual step: in the Cloudflare Pages dashboard, set
  BACKEND_URL=https://$API_HOSTNAME
and trigger a redeploy (Pages Functions read env vars at deploy time).
EOF
