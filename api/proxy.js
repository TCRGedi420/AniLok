/**

* AniLok — CORS Proxy (Vercel Serverless Function)
* Clean + Stable + Production Safe
  */

import { HiAnime } from 'aniwatch';

const hianime = new HiAnime.Scraper();

// ✅ REQUIRED CONSTANTS
const UPSTREAM = "https://aniwatchtv.to"; // change if needed
const WORKING_SERVERS = ["hd-1", "hd-2", "streamsb", "streamtape"];

// Headers to strip
const DROP_REQUEST_HEADERS = new Set([
'host', 'connection', 'keep-alive', 'proxy-authenticate',
'proxy-authorization', 'te', 'trailers', 'transfer-encoding',
'upgrade', 'origin', 'referer', 'accept-encoding',
]);

const DROP_RESPONSE_HEADERS = new Set([
'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
'access-control-allow-origin', 'access-control-allow-methods',
'access-control-allow-headers', 'access-control-max-age',
'content-encoding',
]);

// ✅ CORS
const CORS = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
'Access-Control-Max-Age': '86400',
};

function setCors(res) {
Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// ✅ Build URL safely
function buildUrl(path, extraParams = {}) {
const qIdx = path.indexOf('?');
const pathPart = qIdx === -1 ? path : path.slice(0, qIdx);
const rawQuery = qIdx === -1 ? '' : path.slice(qIdx + 1);

const params = new URLSearchParams();

if (rawQuery) {
rawQuery.split('&').forEach(pair => {
const [k, v] = pair.split('=');
if (k && v) params.set(decodeURIComponent(k), decodeURIComponent(v));
});
}

Object.entries(extraParams).forEach(([k, v]) => {
if (v) params.set(k, v);
});

const qs = params.toString();
return `${UPSTREAM}${pathPart}${qs ? '?' + qs : ''}`;
}

// ✅ Fetch wrapper
async function upstreamFetch(url, headers) {
const res = await fetch(url, {
method: 'GET',
headers,
redirect: 'follow'
});

const text = await res.text();

let json = null;
try {
json = JSON.parse(text);
} catch {}

return {
ok: res.status < 500,
status: res.status,
text,
json
};
}

// ✅ MAIN HANDLER
export default async function handler(req, res) {

// Handle preflight
if (req.method === 'OPTIONS') {
setCors(res);
return res.status(204).end();
}

const fwdHeaders = {
accept: 'application/json',
'accept-encoding': 'identity'
};

for (const [k, v] of Object.entries(req.headers)) {
if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) {
fwdHeaders[k] = v;
}
}

const tail = req.url.replace(/^/proxy/, '') || '/';

// ==================================================
// ✅ AUTO SERVER FALLBACK (YOUR CORE FEATURE)
// ==================================================
if (tail.startsWith('/episode/sources/auto')) {

```
const qs = tail.includes('?') ? tail.split('?')[1] : '';
const params = new URLSearchParams(qs);

const epId = params.get('animeEpisodeId');
const category = params.get('category') || 'sub';

if (!epId) {
  setCors(res);
  return res.status(400).json({ error: 'animeEpisodeId is required' });
}

setCors(res);

for (const server of WORKING_SERVERS) {

  try {
    const result = await hianime.getEpisodeSources(epId, server, category);

    if (result) {
      return res.status(200).json({
        success: true,
        server,
        data: result
      });
    }

  } catch (err) {
    console.warn(`[proxy] ${server} failed → ${err.message}`);
  }
}

return res.status(500).json({
  error: 'all_servers_failed',
  servers_tried: WORKING_SERVERS
});
```

}

// ==================================================
// ✅ NORMAL PROXY
// ==================================================
const upstreamUrl = buildUrl(tail);

let upstream;
try {
upstream = await fetch(upstreamUrl, {
method: req.method,
headers: fwdHeaders,
redirect: 'follow'
});
} catch (err) {
setCors(res);
return res.status(502).json({
error: 'upstream_unreachable',
message: err.message
});
}

const text = await upstream.text();

upstream.headers.forEach((v, k) => {
if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) {
res.setHeader(k, v);
}
});

setCors(res);
res.status(upstream.status);

const contentType = upstream.headers.get('content-type') || '';

if (contentType.includes('application/json')) {
try {
return res.json(JSON.parse(text));
} catch {}
}

return res.send(text);
}
