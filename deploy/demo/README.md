# Demo deployment (internal platform + Hồ sơ Nhân quyền + community map)

`setup.sh` runs on the VPS. It brings up the internal platform (`capture/`: db, api, worker) and the Hồ sơ Nhân
quyền site with `docker-compose.yml` here, then:
- generates the hub's secrets and **demo** feed keys (gitignored files here);
- creates an admin token (`ADMIN_TOKEN.txt`, shown once: move it to the password manager);
- registers the two public sites as sources and seeds fictional demo content through their forms;
- connects the community map's existing backend (`docker-compose.vps.yml`, `backend/.env`) to the hub with
  `PUBLIC_SOURCE=feed`;
- adds the two hostnames to the Cloudflare tunnel.

```bash
cd deploy/demo
HUB_HOST=<hub hostname> HSNQ_HOST=<site hostname> TUNNEL=<tunnel name> \
  BACKEND_REPO=<checkout running docker-compose.vps.yml> TILE_URL='https://{s}.basemaps.cartocdn.com/…?key=…' ./setup.sh
```

It is safe to re-run: generated files are kept, and the steps check before they change anything. Backups are
taken of `backend/.env` and the cloudflared config before editing them.

**Not production.** The feed's root signing key is generated on the server for the demo. Production needs the
offline root key held by the designated maintainer, and the feed on its public B2 bucket (CLAUDE.md "Pending ops").
