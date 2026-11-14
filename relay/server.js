/* Kestrel TikTok relay.

   TikTok's Marketing API does not accept requests from web pages, so the Kestrel app in the
   browser cannot call it directly. This small server sits in between: the app calls the relay,
   the relay calls TikTok and passes the answer back with the headers a browser needs.

   - Forwards only to TikTok's Marketing API (paths under /open_api/). It is not a general proxy.
   - Stores nothing and logs no tokens. The TikTok access token arrives in the Access-Token
     header of each request and is passed straight on.
   - No dependencies. Runs as an Apify Server Actor (see relay/README.md) or anywhere with
     Node 18+: `node relay/server.js`.

   Settings (environment variables):
     KESTREL_ALLOWED_ORIGINS   comma-separated page addresses allowed to use the relay,
                               e.g. "https://you.github.io,http://localhost:8000". Default: any.
     PORT                      port to listen on outside Apify. Default 8787. */
const http = require('http');

const UPSTREAM = (process.env.KESTREL_RELAY_UPSTREAM || 'https://business-api.tiktok.com').replace(/\/$/, '');
const ORIGINS = (process.env.KESTREL_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const PORT = Number(process.env.ACTOR_WEB_SERVER_PORT || process.env.PORT || 8787);
const MAX_BODY = 1024 * 1024;

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = ORIGINS.includes('*') ? '*' : ORIGINS.includes(origin) ? origin : '';
  if (!allow) return null;
  return { 'access-control-allow-origin': allow, 'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'access-token,content-type', 'access-control-max-age': '3600', vary: 'origin' };
}
function send(res, status, headers, body) { res.writeHead(status, headers); res.end(body); }
const json = (res, status, cors, message) => send(res, status, Object.assign({ 'content-type': 'application/json' }, cors), JSON.stringify({ code: -1, message }));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  // Apify checks that the server is up before sending it traffic.
  if (req.headers['x-apify-container-server-readiness-probe']) return send(res, 200, { 'content-type': 'text/plain' }, 'ready');
  const url = new URL(req.url, 'http://relay.local');
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return send(res, cors ? 204 : 403, cors || {}, '');
  if (url.pathname === '/') return send(res, 200, Object.assign({ 'content-type': 'text/plain' }, cors), 'Kestrel TikTok relay is running.');
  if (!cors) return json(res, 403, {}, 'This page address is not allowed to use the relay.');
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, cors, 'Only GET and POST are relayed.');

  url.searchParams.delete('token'); // an Apify token in the address is for Apify, never for TikTok
  const target = new URL(UPSTREAM + url.pathname + url.search);
  if (target.origin !== new URL(UPSTREAM).origin || !target.pathname.startsWith('/open_api/')) return json(res, 404, cors, 'Only TikTok Marketing API paths under /open_api/ are relayed.');

  const headers = { 'Access-Token': req.headers['access-token'] || '' };
  const opt = { method: req.method, headers };
  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 413, cors, 'Request body is too large.'); }
    headers['Content-Type'] = 'application/json'; opt.body = body;
  }
  let upstream, text;
  try { upstream = await fetch(target, opt); text = await upstream.text(); }
  catch (e) { return json(res, 502, cors, 'The relay could not reach TikTok.'); }
  send(res, upstream.status, Object.assign({ 'content-type': upstream.headers.get('content-type') || 'application/json' }, cors), text);
}

const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, {}, 'Relay error.'); else res.end(); }); });
if (require.main === module) server.listen(PORT, () => console.log(`Kestrel TikTok relay listening on port ${PORT}`));
module.exports = { server };
