/**
 * AniLok — CORS Proxy  (Vercel Serverless Function)
 *
 * Strips accept-encoding so upstream always returns plain JSON.
 * Strips content-encoding from response so browser never tries to decompress.
 * Injects Access-Control-Allow-Origin: * on every response.
 */

const UPSTREAM = 'https://animelokam.vercel.app/api/v2/hianime';

const DROP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers', 'transfer-encoding',
  'upgrade', 'origin', 'referer',
  'accept-encoding', // ← forces uncompressed response from upstream
]);

const DROP_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'access-control-allow-origin', 'access-control-allow-methods',
  'access-control-allow-headers', 'access-control-max-age',
  'content-encoding', // ← body already decoded; removing prevents browser re-decompression
]);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Access-Control-Max-Age':       '86400',
};

export default async function handler(req, res) {

  // 1. Preflight
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  // 2. Build upstream URL — strip /proxy prefix
  const tail        = req.url.replace(/^\/proxy/, '') || '/';
  const upstreamUrl = `${UPSTREAM}${tail}`;

  // 3. Forward safe request headers
  const fwdHeaders = { accept: 'application/json' };
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) fwdHeaders[k] = v;
  }
  fwdHeaders['accept-encoding'] = 'identity'; // force plain text

  // 4. Read body for non-GET methods
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data',  c  => chunks.push(c));
      req.on('end',   () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // 5. Fetch upstream
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method, headers: fwdHeaders, body, redirect: 'follow',
    });
  } catch (err) {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(502).json({ error: 'upstream_unreachable', message: err.message, url: upstreamUrl });
  }

  // 6. Forward safe response headers + inject CORS
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) res.setHeader(k, v);
  });
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // 7. Send body
  res.status(upstream.status);
  const ct = upstream.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return res.json(await upstream.json());
    } catch (e) {
      return res.status(502).json({ error: 'invalid_json', message: e.message });
    }
  }
  return res.send(Buffer.from(await upstream.arrayBuffer()));
}
