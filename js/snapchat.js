/* Live connection to a Snapchat Ads account through the Snapchat Marketing API.
   Credentials never leave this browser except in requests to Snapchat. */
(function () {
  const K = window.K;
  const API = 'https://adsapi.snapchat.com/v1/';
  const TOKEN_URL = 'https://accounts.snapchat.com/login/oauth2/access_token';
  const STORE = 'kestrel-snapchat-connection';

  const S = (K.snapchat = K.sources.snapchat = {
    platform: 'snapchat', label: 'Snapchat Ads',
    // { accessToken, expires, clientId, clientSecret, refreshToken, account: { id, name, currency }, allow }
    conn: null,
    get allowChanges() { return !!(S.conn && S.conn.allow); },
  });

  /* Snapchat access tokens last an hour. With the app's client ID, secret and a refresh token,
     a new one is fetched whenever the old one runs out. */
  async function renew(conn) {
    if (!conn.refreshToken) throw new Error('Your Snapchat access token has expired. Connect again with a new one, or use a refresh token so it renews itself.');
    let res;
    try {
      res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken, client_id: conn.clientId, client_secret: conn.clientSecret }).toString() });
    } catch (e) { throw new Error('Could not reach Snapchat to renew the sign-in.'); }
    const j = await res.json().catch(() => ({}));
    if (!j.access_token) throw new Error('Snapchat would not renew the sign-in' + (j.error_description || j.error ? ': ' + (j.error_description || j.error) : '') + '. Check the client ID, client secret and refresh token.');
    conn.accessToken = j.access_token; conn.expires = Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60e3;
    if (j.refresh_token) conn.refreshToken = j.refresh_token;
    if (conn === S.conn && K.connStore.read(STORE)) K.connStore.write(STORE, conn, K.connStore.remembered(STORE));
  }

  async function call(method, url, body, conn, retried) {
    conn = conn || S.conn;
    if (!conn.accessToken || (conn.refreshToken && conn.expires && Date.now() > conn.expires)) await renew(conn);
    const opt = { method, headers: { Authorization: 'Bearer ' + conn.accessToken } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(/^https:/.test(url) ? url : API + url, opt); }
    catch (e) { throw new Error('Could not reach Snapchat. Check your connection; an ad blocker may be blocking adsapi.snapchat.com.'); }
    if (res.status === 401 && !retried && conn.refreshToken) { conn.accessToken = ''; return call(method, url, body, conn, true); }
    if (res.status === 401) throw new Error('Your Snapchat access token is invalid or has expired. Connect again.');
    const j = await res.json().catch(() => null);
    if (!j) throw new Error('Snapchat returned an unreadable response (' + res.status + ').');
    if (!res.ok || String(j.request_status).toUpperCase() !== 'SUCCESS') {
      const sub = [].concat(j.campaigns || []).map((x) => x.sub_request_error_reason).filter(Boolean)[0];
      throw new Error(sub || j.display_message || j.debug_message || 'Snapchat returned an error (' + res.status + ').');
    }
    return j;
  }
  S.call = call;
  /** Follows Snapchat's paging links and returns every item under `key`. */
  async function list(url, key, conn) {
    let out = [], next = url + (url.includes('?') ? '&' : '?') + 'limit=200';
    for (let n = 0; n < 50 && next; n++) {
      const j = await call('GET', next, null, conn);
      out = out.concat(j[key] || []);
      next = j.paging && j.paging.next_link;
    }
    return out;
  }

  /** Ad accounts this sign-in can see. `details` carries the token fields from the form. */
  S.accounts = async function (details) {
    const conn = Object.assign({ expires: 0 }, details);
    const orgs = await list('me/organizations?with_ad_accounts=true', 'organizations', conn);
    const found = orgs.flatMap((o) => ((o.organization || {}).ad_accounts || []).map((a) => ({ id: a.id, name: a.name || 'Ad account', currency: a.currency || 'USD', active: a.status === 'ACTIVE' })));
    return { accounts: found, token: { accessToken: conn.accessToken, expires: conn.expires, refreshToken: conn.refreshToken } };
  };

  const micro = (v) => (Number(v) || 0) / 1e6;
  const dayOf = (s) => ({ spend: micro(s.spend), impr: Number(s.impressions) || 0, clicks: Number(s.swipes) || 0, rev: micro(s.conversion_purchases_value), conv: Number(s.conversion_purchases) || 0 });

  /* Day boundaries are given without a time zone, which Snapchat reads in the ad account's own.
     Daily reports are requested 30 days at a time. */
  async function report(breakdown, days) {
    const jobs = [];
    for (let end = 0; end < days; end += 30) {
      const q = new URLSearchParams({ granularity: 'DAY', breakdown, fields: 'impressions,swipes,spend,conversion_purchases,conversion_purchases_value',
        start_time: K.isoDay(-Math.min(days, end + 30)) + 'T00:00:00', end_time: K.isoDay(-end) + 'T00:00:00' });
      jobs.push(list('adaccounts/' + S.conn.account.id + '/stats?' + q, 'timeseries_stats'));
    }
    const out = [];
    (await Promise.all(jobs)).flat().forEach((t) => (((t.timeseries_stat || {}).breakdown_stats || {})[breakdown] || []).forEach((e) => out.push(e)));
    return out;
  }

  /** Reads campaigns, 60 days of daily results and ads. */
  S.fetch = async function () {
    const acct = 'adaccounts/' + S.conn.account.id, until = K.isoDay(-1);
    const [camps, rows, adRows, ads, squads] = await Promise.all([
      list(acct + '/campaigns', 'campaigns'),
      report('campaign', K.DAYS),
      report('ad', 30).catch(() => []),
      list(acct + '/ads', 'ads').catch(() => []),
      list(acct + '/adsquads', 'adsquads').catch(() => []),
    ]);
    const byId = {};
    camps.forEach((x) => {
      const c = x.campaign; if (!c) return;
      const daily = Number(c.daily_budget_micro) > 0;
      byId[c.id] = { id: 's' + c.id, sid: c.id, name: c.name, platform: 'snapchat', status: c.status === 'ACTIVE' ? 'active' : 'paused',
        budget: daily ? Math.round(micro(c.daily_budget_micro)) : 0, noBudget: !daily, budgetNote: 'Set on ad sets', days: K.blankDays(), spent: 0 };
    });
    const fill = (target, entry) => (entry.timeseries || []).forEach((p) => { const d = dayOf(p.stats || {}); K.fillDay(target.days, String(p.start_time).slice(0, 10), until, d); target.spent += d.spend; });
    rows.forEach((e) => { const c = byId[e.id]; if (c) fill(c, e); });
    const squadCampaign = {}; squads.forEach((x) => { const q = x.adsquad; if (q) squadCampaign[q.id] = q.campaign_id; });
    const adInfo = {}; ads.forEach((x) => { const a = x.ad; if (a) adInfo[a.id] = a; });
    const creatives = [];
    adRows.forEach((e) => {
      const info = adInfo[e.id] || {}, c = byId[squadCampaign[info.ad_squad_id]]; if (!c) return;
      const a = { id: 's' + e.id, name: info.name || 'Ad ' + String(e.id).slice(0, 8), campaign: c, format: 'Ad', hue: (parseInt(String(e.id).slice(0, 4), 16) || 0) % 360, thumb: '', days: K.blankDays(), spent: 0 };
      fill(a, e); if (a.spent > 0) creatives.push(a);
    });
    return { campaigns: Object.values(byId).filter((c) => c.status === 'active' || c.spent > 0), creatives };
  };

  /* Snapchat updates a campaign by sending the whole campaign back with the changed field,
     so the current version is read first and only that one field is altered. */
  async function update(c, change) {
    const cur = await call('GET', 'campaigns/' + c.sid);
    const campaign = Object.assign({}, ((cur.campaigns || [])[0] || {}).campaign);
    if (!campaign.id) throw new Error('Snapchat did not return the campaign to update.');
    ['updated_at', 'created_at', 'delivery_status'].forEach((k) => delete campaign[k]);
    Object.assign(campaign, change);
    const res = await call('PUT', 'adaccounts/' + S.conn.account.id + '/campaigns', { campaigns: [campaign] });
    const sub = (res.campaigns || [])[0] || {};
    if (String(sub.sub_request_status).toUpperCase() !== 'SUCCESS') throw new Error(sub.sub_request_error_reason || 'Snapchat did not accept the change.');
  }
  S.setStatus = (c, status) => update(c, { status: status === 'active' ? 'ACTIVE' : 'PAUSED' });
  S.setBudget = (c, budget) => update(c, { daily_budget_micro: Math.round(budget * 1e6) });

  S.restore = function () { S.conn = K.connStore.read(STORE); return !!(S.conn && (S.conn.accessToken || S.conn.refreshToken) && S.conn.account); };
  /** token: { accessToken, expires, clientId, clientSecret, refreshToken } */
  S.connect = async function (token, account, remember) {
    S.conn = Object.assign({ expires: 0 }, token, { account, allow: false });
    try { await K.loadLive(S); } catch (e) { S.conn = null; await K.loadLive().catch(() => K.useSample()); throw e; }
    K.connStore.write(STORE, S.conn, remember);
  };
  S.setAllow = function (on) { S.conn.allow = !!on; K.connStore.write(STORE, S.conn, K.connStore.remembered(STORE)); };
  S.disconnect = function () { S.conn = null; K.connStore.clear(STORE); };
})();
