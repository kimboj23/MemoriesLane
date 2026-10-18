"""Admin CLI.

    python -m memlane_capture.admin migrate
    python -m memlane_capture.admin add-contributor "Lan" --email lan@example.org --role reviewer
    python -m memlane_capture.admin add-token lan@example.org "Lan's phone"     # prints the token once
    python -m memlane_capture.admin revoke-token <token-id>
    python -m memlane_capture.admin list
    python -m memlane_capture.admin contact-key-init        # prints CONTACT_SECRET_KEY for .env, and the public key
    python -m memlane_capture.admin source-key <slug>       # a source's current intake key (needs INTAKE_KEY_SECRET)
"""

import argparse
import asyncio

from .auth import ROLE_RANK, hash_token, new_token
from .db import make_pool, migrate


async def _run(args) -> None:
    if args.cmd == "contact-key-init":
        import base64
        from nacl.public import PrivateKey
        k = PrivateKey.generate()
        print("CONTACT_SECRET_KEY=" + base64.b64encode(bytes(k)).decode())
        print("# public key (the sites seal contacts to it):", base64.b64encode(bytes(k.public_key)).decode())
        return
    pool = make_pool(max_size=2)
    await pool.open()
    try:
        if args.cmd == "migrate":
            applied = await migrate(pool)
            print("applied:", ", ".join(applied) or "nothing (up to date)")
            return
        await migrate(pool)
        async with pool.connection() as conn:
            if args.cmd == "add-contributor":
                r = await (await conn.execute(
                    "INSERT INTO capture.contributors (display_name, email, role) VALUES (%s, %s, %s) RETURNING id",
                    (args.name, args.email, args.role))).fetchone()
                print(r["id"])
            elif args.cmd == "add-token":
                c = await (await conn.execute(
                    "SELECT id, display_name FROM capture.contributors WHERE email = %s OR id::text = %s",
                    (args.who, args.who))).fetchone()
                if not c:
                    raise SystemExit(f"no contributor {args.who!r}")
                token = new_token()
                t = await (await conn.execute(
                    "INSERT INTO capture.tokens (contributor_id, label, token_sha256) VALUES (%s, %s, %s) RETURNING id",
                    (c["id"], args.label, hash_token(token)))).fetchone()
                print(f"token id {t['id']} for {c['display_name']} ({args.label}). Shown once, store it now:")
                print(token)
            elif args.cmd == "revoke-token":
                cur = await conn.execute("UPDATE capture.tokens SET revoked_at = now() WHERE id = %s AND revoked_at IS NULL",
                                         (args.token_id,))
                print("revoked" if cur.rowcount else "no such active token")
            elif args.cmd == "source-key":
                from .intake import derive_key
                s = await (await conn.execute("SELECT slug, key_version FROM capture.sources WHERE slug = %s",
                                              (args.slug,))).fetchone()
                if not s:
                    raise SystemExit(f"no source {args.slug!r}")
                print(derive_key(s["slug"], s["key_version"]))
            elif args.cmd == "list":
                rows = await (await conn.execute(
                    "SELECT c.id, c.display_name, c.email, c.role, count(t.id) FILTER (WHERE t.revoked_at IS NULL) AS tokens"
                    " FROM capture.contributors c LEFT JOIN capture.tokens t ON t.contributor_id = c.id"
                    " GROUP BY c.id ORDER BY c.created_at")).fetchall()
                for r in rows:
                    print(f"{r['id']}  {r['role']:<11} {r['display_name']} <{r['email'] or '-'}>  tokens={r['tokens']}")
    finally:
        await pool.close()


def main() -> None:
    ap = argparse.ArgumentParser(prog="memlane_capture.admin")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    a = sub.add_parser("add-contributor")
    a.add_argument("name")
    a.add_argument("--email")
    a.add_argument("--role", default="contributor", choices=list(ROLE_RANK))
    t = sub.add_parser("add-token")
    t.add_argument("who", help="contributor email or id")
    t.add_argument("label", help="which device, e.g. \"Lan's phone\"")
    r = sub.add_parser("revoke-token")
    r.add_argument("token_id")
    sub.add_parser("list")
    sub.add_parser("contact-key-init")
    k = sub.add_parser("source-key")
    k.add_argument("slug")
    asyncio.run(_run(ap.parse_args()))


if __name__ == "__main__":
    main()
