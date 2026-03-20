/**
 * AniLok — CORS Proxy  (Vercel Serverless Function)
 * File:  /api/proxy.js
 *
 * Forwards every  GET /proxy/<path>?<qs>  request to the upstream
 * AniWatch API and injects Access-Control-Allow-Origin: * so any
 * browser origin (including file://) can call it freely.
 *
 * No npm dependencies — uses Node 18 built-in fetch.
 */

const UPSTREAM = 'https://animelokam.vercel.app/api/v2/hianime';

// Headers that must be stripped before forwarding to upstream
const DROP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers', 'transfer-encoding',
  'upgrade', 'origin', 'referer',
]);

// CORS headers injected on every response (including OPTIONS preflight)
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Access-Control-Max-Age':       '86400',
};

export default async function handler(req, res) {
  // ── Preflight ────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  // ── Build upstream URL ───────────────────────────────────────────────────
  // req.url = /proxy/anime/one-piece?page=2  →  strip /proxy
  const tail        = req.url.replace(/^\/proxy/, '') || '/';
  const upstreamUrl = `${UPSTREAM}${tail}`;

  // ── Forward safe request headers ────────────────────────────────────────
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) fwdHeaders[k] = v;
  }
  fwdHeaders['accept'] = fwdHeaders['accept'] || 'application/json';

  // ── Read body for non-GET methods ────────────────────────────────────────
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data',  c => chunks.push(c));
      req.on('end',   () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // ── Fetch from upstream ──────────────────────────────────────────────────
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method:  req.method,
      headers: fwdHeaders,
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

  // ── Copy safe response headers ───────────────────────────────────────────
  const DROP_RESPONSE = new Set([
    'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
    'access-control-allow-origin', 'access-control-allow-methods',
    'access-control-allow-headers',
  ]);
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE.has(k.toLowerCase())) res.setHeader(k, v);
  });
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // ── Stream body back ─────────────────────────────────────────────────────
  res.status(upstream.status);
  const ct = upstream.headers.get('content-type') || '';

  if (ct.includes('application/json')) {
    try {
      return res.json(await upstream.json());
    } catch {
      return res.status(502).json({ error: 'invalid_json' });
    }
  }

  return res.send(Buffer.from(await upstream.arrayBuffer()));
}
