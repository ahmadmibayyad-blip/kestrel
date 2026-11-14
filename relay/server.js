/* Kestrel relay.

   The TikTok and Pinterest ad APIs do not accept requests from web pages, so the Kestrel app
   in the browser cannot call them directly. This small server sits in between: the app calls
   the relay, the relay calls the ad platform and passes the answer back with the headers a
   browser needs. Meta, Google Ads and Snapchat do not need it.

   - Forwards only to these two APIs. It is not a general proxy:
       /open_api/...       ->  https://business-api.tiktok.com/open_api/...
       /pinterest/v5/...   ->  https://api.pinterest.com/v5/...
   - Stores nothing and logs no tokens. Each request carries its own token, which is passed
     straight on: TikTok's in the Access-Token header, Pinterest's in X-Upstream-Authorization
     (sent on to Pinterest as Authorization, so it cannot be confused with the relay host's
     own Authorization header).
   - No dependencies. Runs as an Apify Server Actor (see relay/README.md) or anywhere with
     Node 18+: `node relay/server.js`.

   Settings (environment variables):
     KESTREL_ALLOWED_ORIGINS   comma-separated page addresses allowed to use the relay,
                               e.g. "https://you.github.io,http://localhost:8000". Default: any.
     PORT                      port to listen on outside Apify. Default 8787. */
const http = require('http');

const trim = (s) => s.replace(/\/$/, '');
const ROUTES = [
  { prefix: '/open_api/', upstream: trim(process.env.KESTREL_RELAY_UPSTREAM || 'https://business-api.tiktok.com'), keep: '/open_api/',
    methods: ['GET', 'POST'], auth: (req) => ({ 'Access-Token': req.headers['access-token'] || '' }) },
  { prefix: '/pinterest/v5/', upstream: trim(process.env.KESTREL_RELAY_PINTEREST || 'https://api.pinterest.com'), keep: '/v5/',
    methods: ['GET', 'POST', 'PATCH'], auth: (req) => ({ Authorization: req.headers['x-upstream-authorization'] || '' }) },
];
const ORIGINS = (process.env.KESTREL_ALLOWED_ORIGINS || '*').split(',').map((s) => trim(s.trim())).filter(Boolean);
const PORT = Number(process.env.ACTOR_WEB_SERVER_PORT || process.env.PORT || 8787);
const MAX_BODY = 1024 * 1024;

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = ORIGINS.includes('*') ? '*' : ORIGINS.includes(origin) ? origin : '';
  if (!allow) return null;
  return { 'access-control-allow-origin': allow, 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'access-token,x-upstream-authorization,content-type', 'access-control-max-age': '3600', vary: 'origin' };
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
  if (url.pathname === '/') return send(res, 200, Object.assign({ 'content-type': 'text/plain' }, cors), 'Kestrel relay is running.');
  if (!cors) return json(res, 403, {}, 'This page address is not allowed to use the relay.');

  // new URL() has already resolved any "../", so a path cannot climb out of its prefix.
  const route = ROUTES.find((r) => url.pathname.startsWith(r.prefix));
  if (!route) return json(res, 404, cors, 'Only TikTok (/open_api/) and Pinterest (/pinterest/v5/) API paths are relayed.');
  if (!route.methods.includes(req.method)) return json(res, 405, cors, 'That method is not relayed for this API.');

  url.searchParams.delete('token'); // an Apify token in the address is for Apify, never for the ad platform
  const target = new URL(route.upstream + route.keep + url.pathname.slice(route.prefix.length) + url.search);
  if (target.origin !== new URL(route.upstream).origin || !target.pathname.startsWith(route.keep)) return json(res, 404, cors, 'That path is not relayed.');

  const headers = route.auth(req);
  const opt = { method: req.method, headers };
  if (req.method !== 'GET') {
    try { opt.body = await readBody(req); } catch (e) { return json(res, 413, cors, 'Request body is too large.'); }
    headers['Content-Type'] = req.headers['content-type'] || 'application/json';
  }
  let upstream, text;
  try { upstream = await fetch(target, opt); text = await upstream.text(); }
  catch (e) { return json(res, 502, cors, 'The relay could not reach the ad platform.'); }
  send(res, upstream.status, Object.assign({ 'content-type': upstream.headers.get('content-type') || 'application/json' }, cors), text);
}

const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, {}, 'Relay error.'); else res.end(); }); });
if (require.main === module) server.listen(PORT, () => console.log(`Kestrel relay listening on port ${PORT}`));
module.exports = { server };
