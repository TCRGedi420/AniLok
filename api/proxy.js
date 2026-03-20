/**
 * AniLok — CORS Proxy  (Vercel Serverless Function)
 * File:  /api/proxy.js
 *
 * Forwards every  GET /proxy/<path>?<qs>  request to the upstream
 * AniWatch API and injects Access-Control-Allow-Origin: * so any
 * browser origin (including file://) can call it freely.
 *
 * No npm dependencies — uses Node 18 built-in fetch.
 *
 * KEY FIX: We strip `accept-encoding` from the outgoing request so the
 * upstream always returns a plain, uncompressed body.  Node's fetch()
 * decompresses transparently when it manages the encoding itself, but if
 * the browser's `accept-encoding` (gzip / br) is forwarded verbatim the
 * upstream compresses the body, Node passes it through as raw bytes, and
 * the browser then tries to decompress data that is already raw — causing
 * ERR_CONTENT_DECODING_FAILED.  Fix: force `accept-encoding: identity`
 * and strip `content-encoding` from the response so the browser never
 * tries to decompress already-decoded bytes.
 */

const UPSTREAM = 'https://animelokam.vercel.app/api/v2/hianime';

// ── Headers stripped from the browser request before forwarding ─────────────
const DROP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'origin',
  'referer',
  // Critical: never forward compression preferences — force plain text below
  'accept-encoding',
]);

// ── Headers stripped from the upstream response before forwarding ────────────
const DROP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  // Rewrite CORS headers ourselves
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  // Body is fully decoded by upstream.json() / arrayBuffer() — remove any
  // content-encoding declaration so the browser doesn't try to decode again
  'content-encoding',
]);

// ── CORS headers added to every response (including preflight) ───────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Access-Control-Max-Age':       '86400',
};

export default async function handler(req, res) {

  // ── 1. Preflight ────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  // ── 2. Build upstream URL ───────────────────────────────────────────────────
  //  req.url = /proxy/anime/one-piece?page=2  →  strip /proxy prefix
  const tail        = req.url.replace(/^\/proxy/, '') || '/';
  const upstreamUrl = `${UPSTREAM}${tail}`;

  // ── 3. Build safe forwarding headers ───────────────────────────────────────
  const fwdHeaders = { accept: 'application/json' };
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) {
      fwdHeaders[k] = v;
    }
  }
  // Force no compression so we always get a raw, readable body
  fwdHeaders['accept-encoding'] = 'identity';

  // ── 4. Read body for non-GET/-HEAD methods ──────────────────────────────────
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data',  c  => chunks.push(c));
      req.on('end',   () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // ── 5. Hit the upstream ─────────────────────────────────────────────────────
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method:   req.method,
      headers:  fwdHeaders,
      body,
      redirect: 'follow',
    });
  } catch (err) {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(502).json({
      error:   'upstream_unreachable',
      message: err.message,
      url:     upstreamUrl,
    });
  }

  // ── 6. Forward safe response headers ───────────────────────────────────────
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) {
      res.setHeader(k, v);
    }
  });
  // Inject our own CORS headers last so they can't be overridden
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // ── 7. Return the body ──────────────────────────────────────────────────────
  res.status(upstream.status);

  const contentType = upstream.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    // Parse + re-serialise: guarantees a clean uncompressed JSON body
    try {
      const json = await upstream.json();
      return res.json(json);
    } catch (e) {
      return res.status(502).json({
        error:   'invalid_json',
        message: 'Upstream returned a non-JSON or malformed body',
        detail:  e.message,
      });
    }
  }

  // Any other content type — send raw bytes
  const buffer = await upstream.arrayBuffer();
  return res.send(Buffer.from(buffer));
}
