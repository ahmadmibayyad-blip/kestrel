/* Live connection to a Google Ads account, straight from the browser to the Google Ads API.
   Credentials never leave this browser except in requests to Google. */
(function () {
  const K = window.K;
  const API = 'https://googleads.googleapis.com/';
  const STORE = 'kestrel-google-connection';
  const SCOPE = 'https://www.googleapis.com/auth/adwords';

  const G = (K.google = K.sources.google = {
    platform: 'google', label: 'Google Ads',
    version: 'v26',     // Google retires API versions about a year after release; raise this when it does
    // { devToken, customerId, loginId, clientId, accessToken, expires, account: { id, name, currency }, allow }
    conn: null,
    get allowChanges() { return !!(G.conn && G.conn.allow); },
  });
  const digits = (s) => String(s || '').replace(/\D/g, '');

  /* ---- sign-in: Google's own sign-in window, using the person's OAuth client ID ---- */
  let gisLoading;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (!gisLoading) gisLoading = new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.onload = ok;
      s.onerror = () => { gisLoading = null; fail(new Error('Could not load Google sign-in. Check your connection or ad blocker.')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }
  /** Opens Google sign-in and resolves with { accessToken, expires }. Must follow a click. */
  G.signIn = async function (clientId) {
    await loadGis();
    return new Promise((ok, fail) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: (r) => (r && r.access_token
          ? ok({ accessToken: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000 })
          : fail(new Error('Google sign-in did not complete' + (r && r.error ? ': ' + r.error : '.')))),
        error_callback: (e) => fail(new Error(e && e.type === 'popup_closed' ? 'The Google sign-in window was closed.' : 'Google sign-in failed. Allow pop-ups for this page and try again.')),
      });
      client.requestAccessToken();
    });
  };

  function message(body, status) {
    const e = (Array.isArray(body) ? body[0] : body || {}).error || {};
    const detail = (e.details || []).flatMap((d) => d.errors || []).map((x) => x.message).filter(Boolean)[0];
    if (status === 401 || e.status === 'UNAUTHENTICATED') return 'Your Google sign-in has expired. Sign in again on the Connection screen.';
    return detail || e.message || 'Google Ads returned an error (' + status + ').';
  }
  async function call(path, body, conn) {
    conn = conn || G.conn;
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + conn.accessToken, 'developer-token': conn.devToken };
    if (conn.loginId) headers['login-customer-id'] = conn.loginId;
    let res;
    try { res = await fetch(API + G.version + '/customers/' + conn.customerId + '/' + path, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('Could not reach Google Ads. Check your connection; an ad blocker may be blocking googleads.googleapis.com.'); }
    const j = await res.json().catch(() => null);
    if (!res.ok || (Array.isArray(j) && j[0] && j[0].error) || (j && j.error)) throw new Error(message(j, res.status));
    return j;
  }
  /** Runs a query and returns every row. */
  async function query(gaql, conn) {
    const chunks = await call('googleAds:searchStream', { query: gaql }, conn);
    return (Array.isArray(chunks) ? chunks : []).flatMap((c) => c.results || []);
  }
  G.query = query;

  /** Checks the credentials and returns the account's name and currency. */
  G.lookup = async function (conn) {
    const rows = await query('SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1', conn);
    const c = (rows[0] && rows[0].customer) || {};
    return { id: conn.customerId, name: c.descriptiveName || 'Google Ads ' + conn.customerId, currency: c.currencyCode || 'USD' };
  };

  const day = (m) => ({ spend: (Number(m.costMicros) || 0) / 1e6, impr: Number(m.impressions) || 0, clicks: Number(m.clicks) || 0, rev: Number(m.conversionsValue) || 0, conv: Number(m.conversions) || 0 });

  /** Reads campaigns, 60 days of daily results and ads. */
  G.fetch = async function () {
    const until = K.isoDay(-1), since = K.isoDay(-K.DAYS), live = "campaign.status IN ('ENABLED', 'PAUSED')";
    const metrics = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value';
    const [camps, rows, adRows] = await Promise.all([
      query(`SELECT campaign.id, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period FROM campaign WHERE ${live}`),
      query(`SELECT campaign.id, segments.date, ${metrics} FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' AND ${live}`),
      query(`SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, campaign.id, segments.date, ${metrics} FROM ad_group_ad WHERE segments.date BETWEEN '${K.isoDay(-30)}' AND '${until}' AND ad_group_ad.status != 'REMOVED'`).catch(() => []),
    ]);
    const byId = {};
    camps.forEach((r) => {
      const c = r.campaign, b = r.campaignBudget || {};
      // A shared budget feeds several campaigns, so Kestrel shows it but never edits it.
      const own = b.resourceName && b.amountMicros != null && !b.explicitlyShared && (!b.period || b.period === 'DAILY');
      byId[c.id] = { id: 'g' + c.id, gid: String(c.id), name: c.name, platform: 'google', status: c.status === 'ENABLED' ? 'active' : 'paused',
        budget: own ? Math.round(Number(b.amountMicros) / 1e6) : 0, noBudget: !own, budgetNote: b.explicitlyShared ? 'Shared budget' : 'Not a daily budget', budgetRef: own ? b.resourceName : '', days: K.blankDays(), spent: 0 };
    });
    rows.forEach((r) => { const c = byId[r.campaign.id]; if (c) { const d = day(r.metrics || {}); K.fillDay(c.days, r.segments.date, until, d); c.spent += d.spend; } });
    const adById = {};
    adRows.forEach((r) => {
      const ad = r.adGroupAd.ad, c = byId[r.campaign.id]; if (!c) return;
      const type = String(ad.type || 'AD').toLowerCase().replace(/_/g, ' ').replace(/\bad\b/g, '').trim();
      const a = adById[ad.id] || (adById[ad.id] = { id: 'g' + ad.id, name: ad.name || `${type ? type[0].toUpperCase() + type.slice(1) : 'Ad'} ${ad.id}`, campaign: c,
        format: /video/.test(type) ? 'Video' : /image|display/.test(type) ? 'Image' : 'Ad', hue: (Number(String(ad.id).slice(-3)) * 47) % 360, thumb: '', days: K.blankDays(), spent: 0 });
      const d = day(r.metrics || {}); K.fillDay(a.days, r.segments.date, until, d); a.spent += d.spend;
    });
    return {
      campaigns: Object.values(byId).filter((c) => c.status === 'active' || c.spent > 0),
      creatives: Object.values(adById).filter((a) => a.spent > 0),
    };
  };

  G.setStatus = (c, status) => call('campaigns:mutate', { operations: [{ updateMask: 'status',
    update: { resourceName: `customers/${G.conn.customerId}/campaigns/${c.gid}`, status: status === 'active' ? 'ENABLED' : 'PAUSED' } }] });
  G.setBudget = (c, budget) => call('campaignBudgets:mutate', { operations: [{ updateMask: 'amount_micros',
    update: { resourceName: c.budgetRef, amountMicros: String(Math.round(budget * 1e6)) } }] });

  G.restore = function () { G.conn = K.connStore.read(STORE); return !!(G.conn && G.conn.accessToken && G.conn.account); };
  /** details: { devToken, customerId, loginId, clientId, accessToken, expires } */
  G.connect = async function (details, remember) {
    const conn = { devToken: details.devToken.trim(), customerId: digits(details.customerId), loginId: digits(details.loginId), clientId: (details.clientId || '').trim(),
      accessToken: details.accessToken, expires: details.expires || 0, allow: false };
    conn.account = await G.lookup(conn);
    G.conn = conn;
    try { await K.loadLive(G); } catch (e) { G.conn = null; await K.loadLive().catch(() => K.useSample()); throw e; }
    K.connStore.write(STORE, G.conn, remember);
  };
  /** Swaps in a fresh sign-in after the old one expired. */
  G.renew = function (token) { G.conn.accessToken = token.accessToken; G.conn.expires = token.expires; K.connStore.write(STORE, G.conn, K.connStore.remembered(STORE)); };
  G.setAllow = function (on) { G.conn.allow = !!on; K.connStore.write(STORE, G.conn, K.connStore.remembered(STORE)); };
  G.disconnect = function () { G.conn = null; K.connStore.clear(STORE); };
})();
