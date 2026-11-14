/* Live connection to a Meta ad account, straight from the browser to Meta's Graph API.
   The access token never leaves this browser except in requests to graph.facebook.com. */
(function () {
  const K = window.K;
  const G = 'https://graph.facebook.com/';
  const STORE = 'kestrel-meta-connection';
  // Meta sends budgets in the currency's smallest unit. These currencies have no minor unit.
  // The same factor is used to read and to write, so a relative change stays right either way.
  const WHOLE = ['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'];
  const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];

  const M = (K.meta = {
    version: '',        // empty uses Meta's default API version; set e.g. 'v24.0' to pin one
    conn: null,         // { token, account: { id, name, currency }, allow }
    loadedAt: null,
    get allowChanges() { return !!(M.conn && M.conn.allow); },
  });

  async function api(path, params, method) {
    const full = /^https:/.test(path);
    const url = new URL(full ? path : G + (M.version ? M.version + '/' : '') + path);
    const token = (params && params._token) || (M.conn && M.conn.token);
    let opt = {};
    if (method === 'POST') {
      const body = new URLSearchParams(params); body.set('access_token', token);
      opt = { method: 'POST', body };
    } else if (!full) {
      Object.entries(params || {}).forEach(([k, v]) => { if (k !== '_token') url.searchParams.set(k, v); });
      url.searchParams.set('access_token', token);
    }
    let res;
    try { res = await fetch(url, opt); }
    catch (e) { throw new Error('Could not reach Meta. Check your connection; an ad blocker may be blocking graph.facebook.com.'); }
    const j = await res.json().catch(() => ({}));
    if (j.error) {
      const e = j.error;
      if (e.code === 190) throw new Error('Your Meta access token is expired or invalid. Paste a new one on the Connection screen.');
      if (e.code === 200 || e.code === 10) throw new Error('This token is not allowed to do that. It needs the ads_read permission to read and ads_management to make changes.');
      throw new Error(e.error_user_msg || e.message || 'Meta returned an error.');
    }
    if (!res.ok) throw new Error('Meta returned an error (' + res.status + ').');
    return j;
  }
  M.api = api;
  async function all(path, params) {
    let out = [], j = await api(path, params);
    for (let n = 0; n < 60; n++) {
      out = out.concat(j.data || []);
      if (!j.paging || !j.paging.next) break;
      j = await api(j.paging.next);
    }
    return out;
  }

  const iso = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };
  const pick = (list) => {
    if (!Array.isArray(list)) return 0;
    for (const t of PURCHASE) { const a = list.find((x) => x.action_type === t); if (a) return parseFloat(a.value) || 0; }
    return 0;
  };
  const blank = () => Array.from({ length: K.DAYS }, () => ({ spend: 0, impr: 0, clicks: 0, rev: 0, conv: 0 }));
  function fill(days, row, until) {
    const i = K.DAYS - 1 - Math.round((Date.parse(until) - Date.parse(row.date_start)) / 864e5);
    if (i < 0 || i >= K.DAYS) return;
    days[i] = { spend: parseFloat(row.spend) || 0, impr: parseFloat(row.impressions) || 0, clicks: parseFloat(row.clicks) || 0, rev: pick(row.action_values), conv: pick(row.actions) };
  }
  const factor = () => (WHOLE.includes(M.conn.account.currency) ? 1 : 100);

  /** Ad accounts this token can see. */
  M.accounts = async function (token) {
    const list = await all('me/adaccounts', { fields: 'name,account_id,currency,account_status', limit: 100, _token: token });
    return list.map((a) => ({ id: a.account_id, name: a.name || 'Ad account ' + a.account_id, currency: a.currency || 'USD', active: a.account_status === 1 }));
  };

  /** Reads campaigns, 60 days of daily results and ads, and swaps them in for the sample data. */
  M.load = async function () {
    const act = 'act_' + M.conn.account.id, until = iso(-1), since = iso(-K.DAYS);
    const status = '["ACTIVE","PAUSED"]';
    const metrics = 'spend,impressions,clicks,actions,action_values';
    const [camps, rows, ads, adRows] = await Promise.all([
      all(act + '/campaigns', { fields: 'id,name,status,daily_budget,objective', effective_status: status, limit: 200 }),
      all(act + '/insights', { level: 'campaign', time_increment: 1, time_range: JSON.stringify({ since, until }), fields: 'campaign_id,' + metrics, limit: 500 }),
      all(act + '/ads', { fields: 'id,name,campaign_id,creative{thumbnail_url,object_type}', effective_status: status, limit: 200 }).catch(() => []),
      all(act + '/insights', { level: 'ad', time_increment: 1, time_range: JSON.stringify({ since: iso(-30), until }), fields: 'ad_id,' + metrics, limit: 500 }).catch(() => []),
    ]);
    const f = factor();
    const byId = {};
    camps.forEach((c) => {
      const has = c.daily_budget != null && c.daily_budget !== '';
      byId[c.id] = { id: c.id, name: c.name, platform: 'meta', status: c.status === 'ACTIVE' ? 'active' : 'paused',
        budget: has ? Math.round(parseFloat(c.daily_budget) / f) : 0, noBudget: !has, days: blank(), spent: 0 };
    });
    rows.forEach((r) => { const c = byId[r.campaign_id]; if (c) { fill(c.days, r, until); c.spent += parseFloat(r.spend) || 0; } });
    const adById = {};
    ads.forEach((a, k) => {
      const c = byId[a.campaign_id]; if (!c) return;
      const type = (a.creative && a.creative.object_type) || '';
      adById[a.id] = { id: a.id, name: a.name, campaign: c, format: type === 'VIDEO' ? 'Video' : type === 'PHOTO' ? 'Image' : 'Ad',
        hue: (k * 47) % 360, thumb: (a.creative && a.creative.thumbnail_url) || '', days: blank(), spent: 0 };
    });
    adRows.forEach((r) => { const a = adById[r.ad_id]; if (a) { fill(a.days, r, until); a.spent += parseFloat(r.spend) || 0; } });

    K.mode = 'meta'; K.account = M.conn.account;
    K.setCurrency(M.conn.account.currency);
    K.campaigns = Object.values(byId).filter((c) => c.status === 'active' || c.spent > 0);
    K.creatives = Object.values(adById).filter((a) => a.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 60);
    K.loadState();
    M.loadedAt = Date.now();
  };

  M.setStatus = (c, status) => api(c.id, { status: status === 'active' ? 'ACTIVE' : 'PAUSED' }, 'POST');
  M.setBudget = (c, budget) => api(c.id, { daily_budget: Math.round(budget * factor()) }, 'POST');

  /* The connection is kept for this tab only, or on this device if "remember" was ticked. */
  function persist(remember) {
    const text = JSON.stringify(M.conn);
    try { sessionStorage.setItem(STORE, text); if (remember) localStorage.setItem(STORE, text); else localStorage.removeItem(STORE); } catch (e) { /* storage unavailable */ }
  }
  M.remembered = function () { try { return !!localStorage.getItem(STORE); } catch (e) { return false; } };
  M.restore = function () {
    try { M.conn = JSON.parse(sessionStorage.getItem(STORE) || localStorage.getItem(STORE)); } catch (e) { M.conn = null; }
    return !!(M.conn && M.conn.token && M.conn.account);
  };
  M.connect = async function (token, account, remember) {
    M.conn = { token, account, allow: false };
    try { await M.load(); } catch (e) { M.conn = null; throw e; }
    persist(remember);
  };
  M.setAllow = function (on) { M.conn.allow = !!on; persist(M.remembered()); };
  M.disconnect = function () {
    M.conn = null; M.loadedAt = null;
    try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch (e) { /* storage unavailable */ }
    K.useSample();
  };
})();
