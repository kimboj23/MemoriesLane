#!/usr/bin/env bash
# Deploy backend + archivebox + archive-worker + nocodb on the VPS, and wire
# the backend (archivebox-api.heomay.xyz) and NocoDB (memorylanedb.heomay.xyz) into
# the existing Cloudflare Tunnel.
#
# Run this FROM the repo root on the VPS, after copying backend/, archivebox/,
# worker/, nocodb/, backend/.env, nocodb/nocodb.env and archivebox/rclone.env
# there (same relative layout as the repo). See README.md "Deploy" for the
# full explanation.
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
NOCODB_HOSTNAME="memorylanedb.heomay.xyz"
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

if [ ! -f nocodb/nocodb.env ]; then
  echo "nocodb/nocodb.env not found — copy nocodb/nocodb.env.example and fill" >&2
  echo "in NC_AUTH_JWT_SECRET + NC_ADMIN_EMAIL/PASSWORD first (README" >&2
  echo "\"Content manager UI — NocoDB\")." >&2
  exit 1
fi
if grep -qE '^NC_AUTH_JWT_SECRET=(replace_me.*)?$' nocodb/nocodb.env; then
  echo "nocodb/nocodb.env: NC_AUTH_JWT_SECRET is still the placeholder." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
step "2. Build and start backend + archivebox + archive-worker + nocodb"
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
step "4. NocoDB: wait for it, then enforce invite-only signup"
# ---------------------------------------------------------------------------
# NC_INVITE_ONLY_SIGNUP in docker-compose.vps.yml is ignored by the pinned
# NocoDB version (see the comment there); the real switch is the
# invite_only_signup app setting in NocoDB's own metadata store, which only
# a super-admin can flip. Do it here through the settings API using the
# bootstrap credentials from nocodb/nocodb.env, and verify -- otherwise
# anyone who can reach the hostname could register an account.
for i in $(seq 1 45); do
  if curl -fsS -o /dev/null http://127.0.0.1:8090/dashboard 2>/dev/null; then
    echo "nocodb is up."
    break
  fi
  [ "$i" -eq 45 ] && { echo "nocodb never came up — check: $COMPOSE logs nocodb" >&2; exit 1; }
  sleep 2
done

# Pull just the two values out of nocodb.env without sourcing the whole file.
NC_ADMIN_EMAIL="$(sed -n 's/^NC_ADMIN_EMAIL=//p' nocodb/nocodb.env | tail -n1)"
NC_ADMIN_PASSWORD="$(sed -n 's/^NC_ADMIN_PASSWORD=//p' nocodb/nocodb.env | tail -n1)"
# Login JSON via python so a password containing quotes/backslashes survives.
nc_login_body="$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))' "$NC_ADMIN_EMAIL" "$NC_ADMIN_PASSWORD")"
nc_token="$(curl -fsS -H 'Content-Type: application/json' -d "$nc_login_body" \
  http://127.0.0.1:8090/api/v1/auth/user/signin 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"

if [ -z "$nc_token" ]; then
  cat >&2 <<EOF
Could not sign in to NocoDB as $NC_ADMIN_EMAIL with the password in
nocodb/nocodb.env (changed in the UI since first boot?). Can't enforce
invite-only signup automatically. Verify it yourself before continuing:
  log in at https://$NOCODB_HOSTNAME as a super-admin -> account menu ->
  Settings -> make sure signup is DISABLED.
EOF
  read -rp "Press Enter once you've checked (Ctrl-C to abort)... "
else
  curl -fsS -o /dev/null -H "xc-auth: $nc_token" -H 'Content-Type: application/json' \
    -d '{"invite_only_signup":true}' http://127.0.0.1:8090/api/v1/app-settings
  nc_setting="$(curl -fsS -H "xc-auth: $nc_token" http://127.0.0.1:8090/api/v1/app-settings \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("invite_only_signup"))')"
  if [ "$nc_setting" != "True" ]; then
    echo "nocodb: invite_only_signup is still '$nc_setting' after setting it — aborting." >&2
    exit 1
  fi
  # Prove it from the outside: an anonymous signup must be refused.
  nc_signup_code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -d '{"email":"deploy-probe@invalid.example","password":"Probe#12345678"}' \
    http://127.0.0.1:8090/api/v1/auth/user/signup)"
  if [ "$nc_signup_code" = "200" ]; then
    echo "nocodb: anonymous signup still returns 200 — refusing to expose it. Delete the" >&2
    echo "deploy-probe@invalid.example account it just created and investigate." >&2
    exit 1
  fi
  echo "nocodb: invite-only signup enforced (anonymous signup -> HTTP $nc_signup_code)."
fi

# ---------------------------------------------------------------------------
step "5. Cloudflare Tunnel ingress rules"
# ---------------------------------------------------------------------------
if [ ! -f "$CLOUDFLARED_CONFIG" ]; then
  echo "Couldn't find $CLOUDFLARED_CONFIG." >&2
  echo "Set CLOUDFLARED_CONFIG=/path/to/config.yml and re-run." >&2
  exit 1
fi

# ensure_ingress <hostname> <local port>: no-op if the hostname is already
# routed, otherwise open the (root-owned) tunnel config in $EDITOR with the
# exact block to paste, and refuse to continue until it's there.
ensure_ingress() {
  local host="$1" port="$2"
  if grep -q "$host" "$CLOUDFLARED_CONFIG"; then
    echo "$host already present in $CLOUDFLARED_CONFIG — skipping edit."
    return
  fi
  cat <<EOF

$CLOUDFLARED_CONFIG does not yet route $host. Add this block to its
"ingress:" list, ABOVE the catch-all "- service: http_status:404" line
(see cloudflared-config.yml in this repo for the exact block):

  - hostname: $host
    service: http://localhost:$port

Opening it now with \$EDITOR (${EDITOR:-nano}), via sudo since this file is
root-owned. Save and exit when done.
EOF
  read -rp "Press Enter to open the editor... "
  SUDO_EDITOR="${EDITOR:-nano}" sudo -e "$CLOUDFLARED_CONFIG"

  if ! grep -q "$host" "$CLOUDFLARED_CONFIG"; then
    echo "$host still not found in $CLOUDFLARED_CONFIG — aborting." >&2
    exit 1
  fi
}

ensure_ingress "$API_HOSTNAME" 3001
ensure_ingress "$NOCODB_HOSTNAME" 8090

# ---------------------------------------------------------------------------
step "6. Validate the tunnel config before touching the live service"
# ---------------------------------------------------------------------------
cloudflared --config "$CLOUDFLARED_CONFIG" tunnel ingress validate

# ---------------------------------------------------------------------------
step "7. Create the DNS route (no-op if it already exists) and restart cloudflared"
# ---------------------------------------------------------------------------
cloudflared tunnel route dns "$TUNNEL" "$API_HOSTNAME" || true
cloudflared tunnel route dns "$TUNNEL" "$NOCODB_HOSTNAME" || true
sudo systemctl restart cloudflared
sudo systemctl --no-pager status cloudflared

# ---------------------------------------------------------------------------
step "8. End-to-end check"
# ---------------------------------------------------------------------------
sleep 3
if curl -fsS "https://$API_HOSTNAME/health" >/dev/null; then
  echo "https://$API_HOSTNAME is live."
else
  echo "https://$API_HOSTNAME did not respond — check: journalctl -u cloudflared -f" >&2
  exit 1
fi
# NocoDB sits behind Cloudflare Access once that's configured, so an
# unauthenticated curl legitimately gets a 302 to the Access login page.
# Any 2xx/3xx proves tunnel + container; a connection failure or 5xx does not.
nocodb_code="$(curl -s -o /dev/null -w '%{http_code}' "https://$NOCODB_HOSTNAME/" || echo 000)"
case "$nocodb_code" in
  2*|3*) echo "https://$NOCODB_HOSTNAME is live (HTTP $nocodb_code)." ;;
  *) echo "https://$NOCODB_HOSTNAME answered HTTP $nocodb_code — check: $COMPOSE logs nocodb" >&2; exit 1 ;;
esac

cat <<EOF

Done. Remaining manual steps:
  1. Cloudflare Pages dashboard: set BACKEND_URL=https://$API_HOSTNAME and
     trigger a redeploy (Pages Functions read env vars at deploy time).
  2. Cloudflare Zero Trust: put an Access application in front of
     https://$NOCODB_HOSTNAME (README "Content manager UI — NocoDB"). Until
     that exists, NocoDB is reachable by anyone with the URL, protected only
     by its own login.
EOF
