/**
 * Production-side proxy for Ollama Cloud.
 *
 * Why this exists: ollama.com does not set Access-Control-Allow-Origin
 * headers, so direct browser-to-Ollama fetches are blocked by CORS. The Vite
 * dev server papered over this with a built-in proxy; in production (Vercel)
 * we need a real serverless function that does the same.
 *
 * Runtime: Edge so the upstream NDJSON stream forwards directly without
 * buffering, keeping ChatGPT-style token streaming smooth.
 *
 * Behavior: forwards the incoming Authorization + Content-Type headers and
 * request body verbatim to https://ollama.com/api/chat, then pipes the
 * upstream response body straight back to the browser. No request shaping,
 * no logging of secrets.
 */

export const config = {
  runtime: 'edge',
};

const UPSTREAM = 'https://ollama.com/api/chat';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    // Handle preflight cleanly even though same-origin requests shouldn't
    // need it — useful when this endpoint is called from non-browser tools.
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Only POST is supported', { status: 405 });
  }

  const auth = req.headers.get('authorization');
  if (!auth) {
    return new Response('Missing Authorization header', { status: 401 });
  }

  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (err) {
    return new Response(
      `Failed to reach Ollama Cloud: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 },
    );
  }

  // Pipe the upstream stream straight back. Preserve status code and the
  // content type so the browser's NDJSON parser keeps working.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  });
}
