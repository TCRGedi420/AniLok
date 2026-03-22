/**
 * AniLok — CORS Proxy  (Vercel Serverless Function)
 * File:  /api/proxy.js
 *
 * Root cause of ALL "cheerio.load() expects a string" 500 errors:
 *
 * The aniwatch scraper's getEpisodeSources() uses a switch statement that
 * only recognises these server names internally:
 *   hd-1  (VidStreaming)  → data-server-id = 4
 *   hd-2  (VidCloud)      → data-server-id = 1
 *   streamsb              → data-server-id = 5
 *   streamtape            → data-server-id = 3
 *
 * But getEpisodeServers() returns DISPLAY names from the new domain
 * (megacloud, vidsrc, t-cloud…) which don't match the switch —
 * so serverId stays null, the HTML lookup fails, cheerio gets undefined → 500.
 *
 * Fix: expose  GET /proxy/episode/sources/auto  which ignores API-returned
 * server names and iterates WORKING_SERVERS until one succeeds.
 */

const UPSTREAM = 'https://animelokam.vercel.app/api/v2/hianime';

// ONLY names the scraper switch statement understands — order = preference
const WORKING_SERVERS = ['hd-2', 'hd-1', 'streamsb', 'streamtape'];

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

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Access-Control-Max-Age':       '86400',
};

// Builds a safe upstream URL — re-encodes query params via URLSearchParams
// so animeEpisodeId=slug?ep=123 becomes animeEpisodeId=slug%3Fep%3D123
function buildUrl(path, extraParams = {}) {
  const qIdx     = path.indexOf('?');
  const pathPart = qIdx === -1 ? path : path.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? ''   : path.slice(qIdx + 1);

  const params = new URLSearchParams();
  if (rawQuery) {
    rawQuery.split('&').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return;
      params.set(decodeURIComponent(pair.slice(0, eqIdx)),
                 decodeURIComponent(pair.slice(eqIdx + 1)));
    });
  }
  Object.entries(extraParams).forEach(([k, v]) => params.set(k, v));
  const qs = params.toString();
  return `${UPSTREAM}${pathPart}${qs ? '?' + qs : ''}`;
}

async function upstreamFetch(url, headers) {
  const res  = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
  const text = await res.text();
  console.log(`[proxy] ${res.status} ${url.slice(0, 120)}`);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.status < 500, status: res.status, text, json };
}

function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {

  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(204).end();
  }

  const fwdHeaders = { accept: 'application/json', 'accept-encoding': 'identity' };
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQUEST_HEADERS.has(k.toLowerCase())) fwdHeaders[k] = v;
  }

  const tail = req.url.replace(/^\/proxy/, '') || '/';

  // ── SPECIAL: /episode/sources/auto ──────────────────────────────────────────
  // Ignores display names from getEpisodeServers() — they break the scraper's
  // internal switch. Tries WORKING_SERVERS in order, returns first success.
  if (tail.startsWith('/episode/sources/auto')) {
    const qs       = tail.includes('?') ? tail.slice(tail.indexOf('?') + 1) : '';
    const inParams = new URLSearchParams(qs);
    const epId     = inParams.get('animeEpisodeId') || '';
    const category = inParams.get('category') || 'sub';

    setCors(res);

    for (const server of WORKING_SERVERS) {
      const url = buildUrl('/episode/sources', { animeEpisodeId: epId, server, category });
      console.log(`[proxy] auto → server="${server}" cat="${category}"`);

      let result;
      try { result = await upstreamFetch(url, fwdHeaders); }
      catch (err) { console.warn(`[proxy] ${server} fetch error:`, err.message); continue; }

      if (result.ok && result.json) {
        // Tell the client which server succeeded so it can highlight the button
        if (result.json.data) result.json.data._resolvedServer = server;
        return res.status(result.status).json(result.json);
      }
      console.warn(`[proxy] ${server} → ${result.status}, trying next`);
    }

    return res.status(500).json({
      error:         'all_servers_failed',
      message:       `None of [${WORKING_SERVERS.join(', ')}] worked for episodeId="${epId}" category="${category}"`,
      servers_tried: WORKING_SERVERS,
    });
  }

  // ── NORMAL PROXY — all other /proxy/* routes ─────────────────────────────────
  const upstreamUrl = buildUrl(tail);
  console.log('[proxy] →', upstreamUrl);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method, headers: fwdHeaders, redirect: 'follow',
    });
  } catch (err) {
    setCors(res);
    return res.status(502).json({ error: 'upstream_unreachable', message: err.message });
  }

  const text = await upstream.text();
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase())) res.setHeader(k, v);
  });
  setCors(res);
  res.status(upstream.status);

  const ct = upstream.headers.get('content-type') || '';
  if (ct.includes('application/json') || text.trimStart().startsWith('{')) {
    try { return res.json(JSON.parse(text)); } catch {}
  }
  return res.send(text);
}
