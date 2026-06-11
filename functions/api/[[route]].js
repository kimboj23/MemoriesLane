// Cloudflare Pages Function — proxies all /api/* requests to the backend.
// Set BACKEND_URL in the Cloudflare Pages dashboard (Environment Variables).
// e.g. BACKEND_URL = https://memorylane.onrender.com
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.BACKEND_URL) {
    return new Response(JSON.stringify({ error: "BACKEND_URL not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.BACKEND_URL);

  const proxied = new Request(target, {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "follow",
  });

  return fetch(proxied);
}
