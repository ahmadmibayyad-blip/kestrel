/* Live connection to a TikTok Ads account through the TikTok Marketing API.
   The access token never leaves this browser except in requests to business-api.tiktok.com. */
(function () {
  const K = window.K;
  const API = 'https://business-api.tiktok.com/open_api/';
  const STORE = 'kestrel-tiktok-connection';

  const T = (K.tiktok = K.sources.tiktok = {
    platform: 'tiktok', label: 'TikTok Ads',
    version: 'v1.3',
    conn: null,         // { token, advertiserId, relay, account: { id, name, currency }, allow }
    get allowChanges() { return !!(T.conn && T.conn.allow); },
  });

  /** GET sends params in the address (lists as JSON text, as TikTok expects); POST sends JSON. */
  /* TikTok refuses requests sent from web pages, so in the browser every call goes through a
     relay (see relay/README.md). The scheduler runs outside a browser and calls TikTok directly. */
  function endpoint(conn, path) {
    if (!conn.relay) return new URL(API + T.version + '/' + path);
    const u = new URL(conn.relay);
    u.pathname = u.pathname.replace(/\/$/, '') + '/open_api/' + T.version + '/' + path;
    return u;
  }
  async function call(method, path, params, conn) {
    conn = conn || T.conn;
    const url = endpoint(conn, path);
    const opt = { method, headers: { 'Access-Token': conn.token } };
    if (method === 'GET') Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v));
    else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(params); }
    let res;
    try { res = await fetch(url, opt); }
    catch (e) {
      throw new Error(conn.relay ? 'Could not reach the relay. Check the relay address and that the relay is running.'
        : typeof document !== 'undefined' ? 'TikTok does not accept requests from web pages. Add a relay address (see relay/README.md in the repository).'
        : 'Could not reach TikTok.');
    }
    const j = await res.json().catch(() => null);
    if (!j || typeof j.code !== 'number') {
      const why = j && j.error && j.error.message ? ': ' + j.error.message : ' (' + res.status + ').';
      throw new Error(conn.relay ? 'The relay did not pass on an answer from TikTok' + why + ' Check the relay address and the token in it.' : 'TikTok returned an unreadable response' + why);
    }
    if (j.code === -1) throw new Error('Relay: ' + j.message);
    if (j.code !== 0) {
      if (j.code === 40105 || j.code === 40104) throw new Error('Your TikTok access token is invalid or was revoked. Create a new one and connect again.');
      if (j.code === 40002 || j.code === 40001 && /permission/i.test(j.message || '')) throw new Error('This TikTok token is not allowed to do that. Check the app has the Ads Management and Reporting permissions for this advertiser. (' + j.message + ')');
      throw new Error(j.message || 'TikTok returned an error (' + j.code + ').');
    }
    return j.data || {};
  }
  T.call = call;
  /** Follows TikTok's page numbers and returns every item. */
  async function pages(path, params, conn) {
    let out = [];
    for (let page = 1; page <= 50; page++) {
      const d = await call('GET', path, Object.assign({}, params, { page, page_size: 1000 }), conn);
      out = out.concat(d.list || []);
      const info = d.page_info || {};
      if (!info.total_page || page >= info.total_page) break;
    }
    return out;
  }

  /** Checks the token and returns the advertiser's name and currency. */
  T.lookup = async function (conn) {
    const d = await call('GET', 'advertiser/info/', { advertiser_ids: [conn.advertiserId] }, conn);
    const a = (d.list || [])[0];
    if (!a) throw new Error('This token cannot see advertiser ' + conn.advertiserId + '. Check the advertiser ID.');
    return { id: conn.advertiserId, name: a.name || 'TikTok ' + conn.advertiserId, currency: a.currency || 'USD' };
  };

  /* Daily reports cover at most 30 days per request, so longer periods are read in pieces. */
  async function report(level, idField, metrics, days) {
    const jobs = [];
    for (let end = 1; end <= days; end += 30) {
      jobs.push(pages('report/integrated/get/', { advertiser_id: T.conn.advertiserId, report_type: 'BASIC', data_level: level,
        dimensions: [idField, 'stat_time_day'], metrics, start_date: K.isoDay(-Math.min(days, end + 29)), end_date: K.isoDay(-end) }));
    }
    return (await Promise.all(jobs)).flat();
  }
  const num = (v) => parseFloat(v) || 0;

  /** Reads campaigns, 60 days of daily results and ads. */
  T.fetch = async function () {
    const until = K.isoDay(-1), adv = T.conn.advertiserId;
    const [camps, rows, sales, adRows] = await Promise.all([
      pages('campaign/get/', { advertiser_id: adv }),
      report('AUCTION_CAMPAIGN', 'campaign_id', ['spend', 'impressions', 'clicks'], K.DAYS),
      // Purchase figures are asked for separately so a missing pixel or metric does not block the rest.
      report('AUCTION_CAMPAIGN', 'campaign_id', ['spend', 'complete_payment', 'complete_payment_roas'], K.DAYS).catch(() => null),
      report('AUCTION_AD', 'ad_id', ['spend', 'impressions', 'clicks', 'complete_payment', 'complete_payment_roas', 'ad_name', 'campaign_id'], 30).catch(() => []),
    ]);
    T.note = sales ? '' : 'TikTok did not return purchase figures, so purchases, revenue and ROAS are empty for TikTok campaigns and rules that depend on them skip those campaigns.';
    const date = (r) => String(r.dimensions.stat_time_day).slice(0, 10);
    const byId = {};
    camps.forEach((c) => {
      const daily = c.budget_mode === 'BUDGET_MODE_DAY' && num(c.budget) > 0;
      byId[c.campaign_id] = { id: 't' + c.campaign_id, tid: String(c.campaign_id), name: c.campaign_name, platform: 'tiktok',
        status: c.operation_status === 'ENABLE' ? 'active' : 'paused', budget: daily ? Math.round(num(c.budget)) : 0, noBudget: !daily,
        noSales: !sales, budgetNote: c.budget_mode === 'BUDGET_MODE_TOTAL' ? 'Lifetime budget' : 'Set on ad groups', days: K.blankDays(), spent: 0 };
    });
    const extra = {};
    (sales || []).forEach((r) => { const m = r.metrics; extra[r.dimensions.campaign_id + '|' + date(r)] = { conv: num(m.complete_payment), rev: num(m.complete_payment_roas) * num(m.spend) }; });
    rows.forEach((r) => {
      const c = byId[r.dimensions.campaign_id]; if (!c) return;
      const m = r.metrics, x = extra[r.dimensions.campaign_id + '|' + date(r)] || { conv: 0, rev: 0 };
      K.fillDay(c.days, date(r), until, { spend: num(m.spend), impr: num(m.impressions), clicks: num(m.clicks), rev: x.rev, conv: x.conv });
      c.spent += num(m.spend);
    });
    const adById = {};
    adRows.forEach((r) => {
      const m = r.metrics, id = r.dimensions.ad_id, c = byId[m.campaign_id]; if (!c) return;
      const a = adById[id] || (adById[id] = { id: 't' + id, name: m.ad_name || 'Ad ' + id, campaign: c, format: 'Video', hue: (Number(String(id).slice(-3)) * 47) % 360, thumb: '', days: K.blankDays(), spent: 0 });
      K.fillDay(a.days, date(r), until, { spend: num(m.spend), impr: num(m.impressions), clicks: num(m.clicks), rev: num(m.complete_payment_roas) * num(m.spend), conv: num(m.complete_payment) });
      a.spent += num(m.spend);
    });
    return {
      campaigns: Object.values(byId).filter((c) => c.status === 'active' || c.spent > 0),
      creatives: Object.values(adById).filter((a) => a.spent > 0),
    };
  };

  T.setStatus = (c, status) => call('POST', 'campaign/status/update/', { advertiser_id: T.conn.advertiserId, campaign_ids: [c.tid], operation_status: status === 'active' ? 'ENABLE' : 'DISABLE' });
  T.setBudget = (c, budget) => call('POST', 'campaign/update/', { advertiser_id: T.conn.advertiserId, campaign_id: c.tid, budget });

  T.restore = function () { T.conn = K.connStore.read(STORE); return !!(T.conn && T.conn.token && T.conn.account); };
  T.connect = async function (token, advertiserId, relay, remember) {
    const conn = { token: token.trim(), advertiserId: String(advertiserId).replace(/\D/g, ''), relay: (relay || '').trim(), allow: false };
    if (conn.relay && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(conn.relay)) throw new Error('The relay address should start with https://');
    conn.account = await T.lookup(conn);
    T.conn = conn;
    try { await K.loadLive(T); } catch (e) { T.conn = null; await K.loadLive().catch(() => K.useSample()); throw e; }
    K.connStore.write(STORE, T.conn, remember);
  };
  T.setAllow = function (on) { T.conn.allow = !!on; K.connStore.write(STORE, T.conn, K.connStore.remembered(STORE)); };
  T.disconnect = function () { T.conn = null; K.connStore.clear(STORE); };
})();
