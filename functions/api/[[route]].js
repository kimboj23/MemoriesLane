// Cloudflare Pages Function — proxies all /api/* requests to the backend.
// Set BACKEND_URL in the Cloudflare Pages dashboard (Environment Variables).
// e.g. BACKEND_URL = https://memorylane.up.railway.app
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.BACKEND_URL) {
    return json({ error: "BACKEND_URL not configured" }, 503);
  }

  let target;
  try {
    const url = new URL(request.url);
    target = new URL(url.pathname + url.search, env.BACKEND_URL);
  } catch {
    return json({ error: "BACKEND_URL is not a valid URL" }, 502);
  }

  const proxied = new Request(target, {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "follow",
  });

  // Catch network failures (dead tunnel / unreachable host) so the function
  // returns a clean 502 instead of crashing with a Cloudflare 1101 page. The
  // frontend treats a non-ok response as "API down" and falls back gracefully.
  try {
    return await fetch(proxied);
  } catch (e) {
    return json({ error: "Backend unreachable", detail: String((e && e.message) || e) }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
