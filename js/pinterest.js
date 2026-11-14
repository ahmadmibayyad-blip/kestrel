/* Live connection to a Pinterest Ads account through the Pinterest API (v5).
   Credentials never leave this browser except in requests to your relay and, through it, Pinterest. */
(function () {
  const K = window.K;
  const API = 'https://api.pinterest.com/v5/';
  const STORE = 'kestrel-pinterest-connection';
  const COLUMNS = 'SPEND_IN_MICRO_DOLLAR,TOTAL_IMPRESSION,TOTAL_CLICKTHROUGH,TOTAL_CHECKOUT,TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR';

  const P = (K.pinterest = K.sources.pinterest = {
    platform: 'pinterest', label: 'Pinterest Ads',
    // { accessToken, expires, clientId, clientSecret, refreshToken, relay, account: { id, name, currency }, allow }
    conn: null,
    get allowChanges() { return !!(P.conn && P.conn.allow); },
  });

  /* Pinterest refuses requests sent from web pages, so in the browser every call goes through
     the relay (see relay/README.md). There the token travels as X-Upstream-Authorization, which
     the relay sends on as Authorization. The scheduler calls Pinterest directly. */
  async function send(conn, method, path, auth, body, type) {
    let url;
    if (/^https:/.test(path) || /^http:\/\/localhost/.test(path)) url = new URL(path);
    else if (conn.relay) { url = new URL(conn.relay); url.pathname = url.pathname.replace(/\/$/, '') + '/pinterest/v5/' + path.split('?')[0]; new URLSearchParams(path.split('?')[1] || '').forEach((v, k) => url.searchParams.set(k, v)); }
    else url = new URL(API + path);
    const headers = { [conn.relay ? 'X-Upstream-Authorization' : 'Authorization']: auth };
    const opt = { method, headers };
    if (body) { headers['Content-Type'] = type; opt.body = body; }
    try { return await fetch(url, opt); }
    catch (e) {
      throw new Error(conn.relay ? 'Could not reach the relay. Check the relay address and that the relay is running.'
        : typeof document !== 'undefined' ? 'Pinterest does not accept requests from web pages. Add a relay address (see relay/README.md in the repository).'
        : 'Could not reach Pinterest.');
    }
  }

  /* Access tokens last 30 days. With the app's ID, secret and a refresh token a new one is fetched when needed. */
  async function renew(conn) {
    if (!conn.refreshToken) throw new Error('Your Pinterest access token has expired. Connect again with a new one, or add a refresh token so it renews itself.');
    const basic = 'Basic ' + (typeof btoa === 'function' ? btoa(conn.clientId + ':' + conn.clientSecret) : Buffer.from(conn.clientId + ':' + conn.clientSecret).toString('base64'));
    const res = await send(conn, 'POST', 'oauth/token', basic, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }).toString(), 'application/x-www-form-urlencoded');
    const j = await res.json().catch(() => ({}));
    if (!j.access_token) throw new Error('Pinterest would not renew the sign-in' + (j.message ? ': ' + j.message : '') + '. Check the app ID, app secret and refresh token.');
    conn.accessToken = j.access_token; conn.expires = Date.now() + (Number(j.expires_in) || 86400) * 1000 - 60e3;
    if (j.refresh_token) conn.refreshToken = j.refresh_token;
    if (conn === P.conn && K.connStore.read(STORE)) K.connStore.write(STORE, conn, K.connStore.remembered(STORE));
  }

  async function call(method, path, body, conn, retried) {
    conn = conn || P.conn;
    if (!conn.accessToken || (conn.refreshToken && conn.expires && Date.now() > conn.expires)) await renew(conn);
    const res = await send(conn, method, path, 'Bearer ' + conn.accessToken, body ? JSON.stringify(body) : null, 'application/json');
    if (res.status === 401 && !retried && conn.refreshToken) { conn.accessToken = ''; return call(method, path, body, conn, true); }
    const j = await res.json().catch(() => null);
    if (res.status === 401) throw new Error(j && j.error && j.error.message ? 'The relay refused the request: ' + j.error.message + ' Check the token in the relay address.' : 'Your Pinterest access token is invalid or has expired. Connect again.');
    if (j === null) throw new Error((conn.relay ? 'The relay did not pass on an answer from Pinterest' : 'Pinterest returned an unreadable response') + ' (' + res.status + ').');
    if (!res.ok) throw new Error(j.code === -1 ? 'Relay: ' + j.message : j.message || 'Pinterest returned an error (' + res.status + ').');
    return j;
  }
  P.call = call;
  /** Follows Pinterest's bookmarks and returns every item. */
  async function list(path, conn) {
    let out = [], bookmark = '';
    for (let n = 0; n < 50; n++) {
      const j = await call('GET', path + (path.includes('?') ? '&' : '?') + 'page_size=250' + (bookmark ? '&bookmark=' + encodeURIComponent(bookmark) : ''), null, conn);
      out = out.concat(j.items || []);
      bookmark = j.bookmark; if (!bookmark) break;
    }
    return out;
  }

  /** Ad accounts this sign-in can see. `details` carries the token fields and relay from the form. */
  P.accounts = async function (details) {
    const conn = Object.assign({ expires: 0 }, details);
    const items = await list('ad_accounts', conn);
    return { accounts: items.map((a) => ({ id: a.id, name: a.name || 'Ad account ' + a.id, currency: a.currency && a.currency !== 'UNK' ? a.currency : 'USD' })),
      token: { accessToken: conn.accessToken, expires: conn.expires, refreshToken: conn.refreshToken } };
  };

  const micro = (v) => (Number(v) || 0) / 1e6;
  const day = (r) => ({ spend: micro(r.SPEND_IN_MICRO_DOLLAR), impr: Number(r.TOTAL_IMPRESSION) || 0, clicks: Number(r.TOTAL_CLICKTHROUGH) || 0, rev: micro(r.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR), conv: Number(r.TOTAL_CHECKOUT) || 0 });
  /* Reports take up to 250 IDs per request. */
  async function report(kind, idParam, ids, days) {
    const base = `ad_accounts/${P.conn.account.id}/${kind}/analytics?start_date=${K.isoDay(-days)}&end_date=${K.isoDay(-1)}&granularity=DAY&columns=${COLUMNS}`;
    const jobs = [];
    for (let i = 0; i < ids.length; i += 250) jobs.push(call('GET', base + '&' + idParam + '=' + ids.slice(i, i + 250).join(',')));
    return (await Promise.all(jobs)).flatMap((r) => (Array.isArray(r) ? r : []));
  }

  /** Reads campaigns, 60 days of daily results and ads. */
  P.fetch = async function () {
    const acct = 'ad_accounts/' + P.conn.account.id, until = K.isoDay(-1);
    const [camps, ads] = await Promise.all([list(acct + '/campaigns?entity_statuses=ACTIVE,PAUSED'), list(acct + '/ads?entity_statuses=ACTIVE,PAUSED').catch(() => [])]);
    const byId = {};
    camps.forEach((c) => {
      const daily = Number(c.daily_spend_cap) > 0;
      byId[c.id] = { id: 'p' + c.id, pid: String(c.id), name: c.name, platform: 'pinterest', status: c.status === 'ACTIVE' ? 'active' : 'paused',
        budget: daily ? Math.round(micro(c.daily_spend_cap)) : 0, noBudget: !daily, budgetNote: Number(c.lifetime_spend_cap) > 0 ? 'Lifetime budget' : 'Set on ad groups', days: K.blankDays(), spent: 0 };
    });
    const adById = {};
    ads.forEach((a, k) => { const c = byId[a.campaign_id]; if (c) adById[a.id] = { id: 'p' + a.id, name: a.name || 'Pin ' + (a.pin_id || a.id), campaign: c,
      format: a.creative_type === 'VIDEO' ? 'Video' : a.creative_type === 'REGULAR' ? 'Image' : 'Ad', hue: (k * 47) % 360, thumb: '', days: K.blankDays(), spent: 0 }; });
    const [rows, adRows] = await Promise.all([
      Object.keys(byId).length ? report('campaigns', 'campaign_ids', Object.keys(byId), K.DAYS) : [],
      Object.keys(adById).length ? report('ads', 'ad_ids', Object.keys(adById), 30).catch(() => []) : [],
    ]);
    rows.forEach((r) => { const c = byId[r.CAMPAIGN_ID]; if (c && r.DATE) { const d = day(r); K.fillDay(c.days, r.DATE, until, d); c.spent += d.spend; } });
    adRows.forEach((r) => { const a = adById[r.AD_ID]; if (a && r.DATE) { const d = day(r); K.fillDay(a.days, r.DATE, until, d); a.spent += d.spend; } });
    return { campaigns: Object.values(byId).filter((c) => c.status === 'active' || c.spent > 0), creatives: Object.values(adById).filter((a) => a.spent > 0) };
  };

  async function update(c, change) {
    const res = await call('PATCH', 'ad_accounts/' + P.conn.account.id + '/campaigns', [Object.assign({ id: c.pid }, change)]);
    const item = (res.items || [])[0] || {}, ex = item.exceptions;
    const why = ex && (ex.message || (Array.isArray(ex) && ex[0] && ex[0].message) || (Object.keys(ex).length ? JSON.stringify(ex) : ''));
    if (why) throw new Error(why);
    if (!item.data) throw new Error('Pinterest did not confirm the change.');
  }
  P.setStatus = (c, status) => update(c, { status: status === 'active' ? 'ACTIVE' : 'PAUSED' });
  P.setBudget = (c, budget) => update(c, { daily_spend_cap: Math.round(budget * 1e6) });

  P.restore = function () { P.conn = K.connStore.read(STORE); return !!(P.conn && (P.conn.accessToken || P.conn.refreshToken) && P.conn.account); };
  /** token: { accessToken, expires, clientId, clientSecret, refreshToken, relay } */
  P.connect = async function (token, account, remember) {
    P.conn = Object.assign({ expires: 0 }, token, { account, allow: false });
    try { await K.loadLive(P); } catch (e) { P.conn = null; await K.loadLive().catch(() => K.useSample()); throw e; }
    K.connStore.write(STORE, P.conn, remember);
  };
  P.setAllow = function (on) { P.conn.allow = !!on; K.connStore.write(STORE, P.conn, K.connStore.remembered(STORE)); };
  P.disconnect = function () { P.conn = null; K.connStore.clear(STORE); };
})();
