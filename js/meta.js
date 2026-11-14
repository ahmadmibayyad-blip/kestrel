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

  const M = (K.meta = K.sources.meta = {
    platform: 'meta', label: 'Meta',
    version: '',        // empty uses Meta's default API version; set e.g. 'v24.0' to pin one
    conn: null,         // { token, account: { id, name, currency }, allow }
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

  const pick = (list) => {
    if (!Array.isArray(list)) return 0;
    for (const t of PURCHASE) { const a = list.find((x) => x.action_type === t); if (a) return parseFloat(a.value) || 0; }
    return 0;
  };
  const day = (row) => ({ spend: parseFloat(row.spend) || 0, impr: parseFloat(row.impressions) || 0, clicks: parseFloat(row.clicks) || 0, rev: pick(row.action_values), conv: pick(row.actions) });
  const factor = () => (WHOLE.includes(M.conn.account.currency) ? 1 : 100);

  /** Ad accounts this token can see. */
  M.accounts = async function (token) {
    const list = await all('me/adaccounts', { fields: 'name,account_id,currency,account_status', limit: 100, _token: token });
    return list.map((a) => ({ id: a.account_id, name: a.name || 'Ad account ' + a.account_id, currency: a.currency || 'USD', active: a.account_status === 1 }));
  };

  /** Turns Meta's result indicator, such as "actions:onsite_conversion.messaging_conversation_started_7d", into words. */
  function resultName(indicator) {
    const key = String(indicator).replace(/^actions:/, '').split('.').pop();
    const known = { lead: 'Leads', lead_grouped: 'Leads', messaging_conversation_started_7d: 'Messaging conversations', total_profile_visits: 'Profile visits',
      link_click: 'Link clicks', landing_page_view: 'Landing page views', post_engagement: 'Post engagements', omni_purchase: 'Purchases', purchase: 'Purchases',
      fb_pixel_purchase: 'Purchases', video_thruplay_watched_actions: 'ThruPlays', reach: 'Reach', like: 'Page likes', mobile_app_install: 'App installs' };
    if (known[key]) return known[key];
    const words = key.replace(/_/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : '';
  }

  /** Reads campaigns, 60 days of daily results and ads. */
  M.fetch = async function () {
    const act = 'act_' + M.conn.account.id, until = K.isoDay(-1), since = K.isoDay(-K.DAYS);
    const status = '["ACTIVE","PAUSED"]';
    const metrics = 'spend,impressions,clicks,actions,action_values';
    const range = (from) => JSON.stringify({ since: from, until });
    const insights = (level, from, fields) => all(act + '/insights', { level, time_increment: 1, time_range: range(from), fields, limit: 500 });
    // "Results" is Meta's own count of whatever each campaign is set up to get (leads, messages,
    // purchases, profile visits). It is asked for separately so that, if it is unavailable, the
    // rest still loads and results fall back to purchases.
    // Ad sets and ads are optional extras: if any of their requests fails, campaigns still load.
    const [camps, rows, ads, adRows, resRows, adResRows, sets, setRows, setResRows] = await Promise.all([
      all(act + '/campaigns', { fields: 'id,name,status,daily_budget,lifetime_budget,objective', effective_status: status, limit: 200 }),
      insights('campaign', since, 'campaign_id,' + metrics),
      all(act + '/ads', { fields: 'id,name,status,campaign_id,adset_id,creative{thumbnail_url,object_type}', effective_status: status, limit: 200 }).catch(() => []),
      insights('ad', K.isoDay(-30), 'ad_id,' + metrics).catch(() => []),
      insights('campaign', since, 'campaign_id,results').catch(() => null),
      insights('ad', K.isoDay(-30), 'ad_id,results').catch(() => null),
      all(act + '/adsets', { fields: 'id,name,status,campaign_id,daily_budget,lifetime_budget', effective_status: status, limit: 200 }).catch(() => []),
      insights('adset', since, 'adset_id,' + metrics).catch(() => []),
      insights('adset', since, 'adset_id,results').catch(() => null),
    ]);
    const f = factor();
    const byId = {};
    camps.forEach((c) => {
      const has = c.daily_budget != null && c.daily_budget !== '';
      byId[c.id] = { id: c.id, name: c.name, platform: 'meta', status: c.status === 'ACTIVE' ? 'active' : 'paused',
        budget: has ? Math.round(parseFloat(c.daily_budget) / f) : 0, noBudget: !has, budgetNote: c.lifetime_budget ? 'Lifetime budget' : 'Set on ad sets', days: K.blankDays(), spent: 0 };
    });
    // results by "<id>|<date>", plus what each entity's result is and whether Meta gave a number for it
    const index = (list, idKey) => {
      if (!list) return null;
      const map = {}, seen = {};
      list.forEach((r) => {
        const x = [].concat(r.results || [])[0]; if (!x) return;
        const v = parseFloat(x.values ? (x.values[0] || {}).value : x.value), s = seen[r[idKey]] || (seen[r[idKey]] = { indicator: x.indicator || '', numeric: false });
        if (isFinite(v)) { map[r[idKey] + '|' + r.date_start] = v; s.numeric = true; }
      });
      return { map, seen };
    };
    const res = index(resRows, 'campaign_id'), adRes = index(adResRows, 'ad_id');
    const withRes = (idx, id, r) => { const d = day(r); if (idx) d.res = idx.map[id + '|' + r.date_start] || 0; return d; };
    rows.forEach((r) => { const c = byId[r.campaign_id]; if (c) { K.fillDay(c.days, r.date_start, until, withRes(res, r.campaign_id, r)); c.spent += parseFloat(r.spend) || 0; } });
    if (res) Object.keys(byId).forEach((id) => {
      const s = res.seen[id]; if (!s) return;
      byId[id].resultName = resultName(s.indicator);
      if (!s.numeric) byId[id].noResults = true; // Meta names the result but gives no number (some messaging results in Europe, for example)
    });
    const adById = {};
    ads.forEach((a, k) => {
      const c = byId[a.campaign_id]; if (!c) return;
      const type = (a.creative && a.creative.object_type) || '';
      adById[a.id] = { id: a.id, name: a.name, campaign: c, format: type === 'VIDEO' ? 'Video' : type === 'PHOTO' ? 'Image' : 'Ad',
        hue: (k * 47) % 360, thumb: (a.creative && a.creative.thumbnail_url) || '', days: K.blankDays(), spent: 0,
        level: 'ad', parent: c, platform: 'meta', status: a.status === 'ACTIVE' ? 'active' : 'paused', budget: 0, noBudget: true, budgetNote: 'Ads have no budget', resultName: c.resultName };
    });
    adRows.forEach((r) => { const a = adById[r.ad_id]; if (a) { K.fillDay(a.days, r.date_start, until, withRes(adRes, r.ad_id, r)); a.spent += parseFloat(r.spend) || 0; } });
    const setById = {}, setRes = index(setResRows, 'adset_id');
    sets.forEach((a) => {
      const c = byId[a.campaign_id]; if (!c) return;
      const has = a.daily_budget != null && a.daily_budget !== '';
      setById[a.id] = { id: a.id, name: a.name, level: 'adset', parent: c, platform: 'meta', status: a.status === 'ACTIVE' ? 'active' : 'paused',
        budget: has ? Math.round(parseFloat(a.daily_budget) / f) : 0, noBudget: !has, budgetNote: a.lifetime_budget ? 'Lifetime budget' : 'Set on the campaign',
        resultName: c.resultName, days: K.blankDays(), spent: 0 };
    });
    setRows.forEach((r) => { const a = setById[r.adset_id]; if (a) { K.fillDay(a.days, r.date_start, until, withRes(setRes, r.adset_id, r)); a.spent += parseFloat(r.spend) || 0; } });
    const kept = (e) => e.status === 'active' || e.spent > 0;
    return {
      campaigns: Object.values(byId).filter(kept),
      adsets: Object.values(setById).filter(kept),
      ads: Object.values(adById).filter(kept),   // ads carry 30 days of results, enough for every rule window
      creatives: Object.values(adById).filter((a) => a.spent > 0),
    };
  };

  /* ---------- creating ads (used by the Create ads screen, js/create.js) ---------- */
  const acct = () => 'act_' + M.conn.account.id;
  /** Ad sets of a campaign. */
  M.adsets = async (campaignId) => (await all(campaignId + '/adsets', { fields: 'id,name,status', limit: 200 })).map((a) => ({ id: a.id, name: a.name, paused: a.status !== 'ACTIVE' }));
  /** Ads in an ad set, each with the creative details needed to copy it. */
  M.adsIn = async function (adsetId) {
    const list = await all(adsetId + '/ads', { fields: 'id,name,creative{id,name,object_story_spec,object_story_id,asset_feed_spec,thumbnail_url}', limit: 100 });
    return list.map((a) => {
      const cr = a.creative || {}, spec = cr.object_story_spec || null, link = spec && spec.link_data;
      // Only single-image link ads can be copied for now. Say why the others cannot.
      const why = !spec ? (cr.object_story_id ? 'it promotes an existing post' : 'its creative could not be read')
        : cr.asset_feed_spec ? 'it uses several texts or images that Meta mixes automatically'
        : !link ? (spec.video_data ? 'it is a video ad' : 'it is not a single-image link ad')
        : link.child_attachments ? 'it is a carousel' : '';
      return { id: a.id, name: a.name, thumb: cr.thumbnail_url || '', spec, why, text: (link && link.message) || '', headline: (link && link.name) || '' };
    });
  };
  /** Facebook Pages this ad account can advertise for. */
  M.pages = async () => (await all(acct() + '/promote_pages', { fields: 'id,name', limit: 100 })).map((p) => ({ id: p.id, name: p.name }));
  /** Uploads an image (base64, no data: prefix) to the account's library and returns its hash. */
  M.uploadImage = async function (base64) {
    const res = await api(acct() + '/adimages', { bytes: base64 }, 'POST');
    const img = Object.values(res.images || {})[0];
    if (!img || !img.hash) throw new Error('Meta did not accept the image.');
    return img.hash;
  };
  M.createCreative = async (name, spec) => (await api(acct() + '/adcreatives', { name, object_story_spec: JSON.stringify(spec) }, 'POST')).id;
  M.createAd = async (name, adsetId, creativeId, start) => (await api(acct() + '/ads', { name, adset_id: adsetId, creative: JSON.stringify({ creative_id: creativeId }), status: start ? 'ACTIVE' : 'PAUSED' }, 'POST')).id;

  M.setStatus = (c, status) => api(c.id, { status: status === 'active' ? 'ACTIVE' : 'PAUSED' }, 'POST');
  M.setBudget = (c, budget) => api(c.id, { daily_budget: Math.round(budget * factor()) }, 'POST');

  /* The connection is kept for this tab only, or on this device if "remember" was ticked. */
  M.restore = function () { M.conn = K.connStore.read(STORE); return !!(M.conn && M.conn.token && M.conn.account); };
  M.connect = async function (token, account, remember) {
    M.conn = { token, account, allow: false };
    try { await K.loadLive(M); } catch (e) { M.conn = null; await K.loadLive().catch(() => K.useSample()); throw e; }
    K.connStore.write(STORE, M.conn, remember);
  };
  M.setAllow = function (on) { M.conn.allow = !!on; K.connStore.write(STORE, M.conn, K.connStore.remembered(STORE)); };
  M.disconnect = function () { M.conn = null; K.connStore.clear(STORE); };
})();
