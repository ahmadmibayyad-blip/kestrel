/* Kestrel demo data, state and rule engine. Everything is sample data generated in the browser. */
(function () {
  const K = (window.K = {});
  const DAYS = 60;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  K.PLATFORMS = {
    meta: { name: 'Meta', color: 'var(--s1)' },
    google: { name: 'Google', color: 'var(--s2)' },
    tiktok: { name: 'TikTok', color: 'var(--s3)' },
  };

  let money, money2, symbol = '$';
  K.setCurrency = function (cur) {
    try {
      money = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 });
      money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 });
    } catch (e) { return K.setCurrency('USD'); }
    K.currency = cur;
    symbol = money.formatToParts(0).find((x) => x.type === 'currency').value;
  };
  K.sym = () => symbol;
  K.setCurrency('USD');
  K.mode = 'sample'; // 'sample' or 'meta'
  const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  K.fmt = {
    money: (v) => money.format(v),
    money2: (v) => (isFinite(v) ? money2.format(v) : '–'),
    int: (v) => int.format(v),
    x: (v) => (isFinite(v) ? v.toFixed(2) + 'x' : '–'),
    pct: (v) => (isFinite(v) ? v.toFixed(2) + '%' : '–'),
  };

  // goodWhen: which direction is an improvement, used for period-over-period deltas.
  K.METRICS = {
    spend: { label: 'Spend', fmt: K.fmt.money, unit: '$' },
    revenue: { label: 'Revenue', fmt: K.fmt.money, unit: '$', goodWhen: 'up' },
    roas: { label: 'ROAS', fmt: K.fmt.x, unit: 'x', goodWhen: 'up' },
    cpa: { label: 'Cost per purchase', fmt: K.fmt.money2, unit: '$', goodWhen: 'down' },
    ctr: { label: 'CTR', fmt: K.fmt.pct, unit: '%', goodWhen: 'up' },
    cpc: { label: 'CPC', fmt: K.fmt.money2, unit: '$', goodWhen: 'down' },
    cpm: { label: 'CPM', fmt: K.fmt.money2, unit: '$', goodWhen: 'down' },
    conv: { label: 'Purchases', fmt: K.fmt.int, unit: '', goodWhen: 'up' },
    impr: { label: 'Impressions', fmt: K.fmt.int, unit: '' },
    clicks: { label: 'Clicks', fmt: K.fmt.int, unit: '' },
  };

  // name, platform, daily budget, base ROAS, ROAS drift across the period, CTR %, CPM, order value, status
  const SEED = [
    ['Prospecting – Broad US', 'meta', 600, 2.4, 0.05, 1.4, 14, 62],
    ['Retargeting – 30 day visitors', 'meta', 250, 4.1, -0.05, 2.3, 22, 68],
    ['Lookalike 1% – Purchasers', 'meta', 400, 3.3, 0.25, 1.7, 16, 64],
    ['Catalog – All products', 'meta', 800, 2.9, 0, 1.2, 12, 58],
    ['Summer Sale – Video', 'meta', 300, 1.1, -0.35, 0.7, 11, 55],
    ['Brand Search', 'google', 150, 6.2, 0, 8.5, 60, 70],
    ['Non-brand Search – Shoes', 'google', 500, 1.9, -0.1, 3.9, 48, 66],
    ['Performance Max – All products', 'google', 900, 3.1, 0.1, 1.1, 9, 61],
    ['YouTube – Product demo', 'google', 200, 0.9, -0.2, 0.5, 8, 59],
    ['Shopping – Best sellers', 'google', 350, 3.6, 0.15, 1.6, 13, 63],
    ['Spark Ads – Creator UGC', 'tiktok', 450, 2.6, 0.3, 1.3, 7, 44],
    ['TopView Test', 'tiktok', 300, 0.8, -0.1, 0.6, 6, 42],
    ['Video Shopping Ads', 'tiktok', 250, 2.1, 0, 1.0, 7, 46],
    ['Retargeting – Cart abandoners', 'tiktok', 120, 3.8, -0.15, 1.9, 10, 48, 'paused'],
  ];

  function series(r, budget, roas, drift, ctr, cpm, aov, ctrDecay) {
    const out = [];
    for (let d = 0; d < DAYS; d++) {
      const p = (d - DAYS / 2) / (DAYS / 2); // -1 .. 1 across the period
      const spend = budget * (0.82 + r() * 0.22);
      const impr = (spend / cpm) * 1000 * (0.9 + r() * 0.2);
      const clicks = impr * (ctr / 100) * (1 - (ctrDecay || 0) * (p + 1) / 2) * (0.85 + r() * 0.3);
      const rev = spend * Math.max(0.1, roas * (1 + drift * p)) * (0.75 + r() * 0.5);
      out.push({ spend, impr, clicks, rev, conv: rev / aov });
    }
    return out;
  }

  function build() {
    const r = rng(20261114);
    K.campaigns = SEED.map((s, i) => ({
      id: 'c' + (i + 1), name: s[0], platform: s[1], budget: s[2], status: s[8] || 'active',
      days: series(r, s[2], s[3], s[4], s[5], s[6], s[7]),
    }));
    const hooks = ['Unboxing in 15 seconds', 'Before and after', 'Founder story', '3 reasons to switch', 'Customer review montage',
      'Price comparison', 'How it is made', 'Limited drop teaser', 'Problem and solution', 'Lifestyle stills', 'Size guide walkthrough', 'Free shipping offer'];
    const formats = ['Video', 'Image', 'Carousel'];
    K.creatives = [];
    K.campaigns.forEach((c, i) => {
      const s = SEED[i];
      const n = i % 3 === 0 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const k = K.creatives.length;
        K.creatives.push({
          id: 'a' + (k + 1), name: hooks[k % hooks.length], campaign: c, format: formats[k % 3], hue: (k * 47) % 360,
          days: series(r, s[2] / (n + 1), s[3] * (0.7 + r() * 0.7), s[4], s[5] * (0.8 + r() * 0.5), s[6], s[7], k % 4 === 1 ? 0.6 : 0.05),
        });
      }
    });
  }

  /** Totals and derived metrics for `n` days, ending `offset` days before today. */
  K.agg = function (days, n, offset) {
    offset = offset || 0;
    const t = { spend: 0, impr: 0, clicks: 0, revenue: 0, conv: 0 };
    for (let i = DAYS - n - offset; i < DAYS - offset; i++) {
      const d = days[i];
      t.spend += d.spend; t.impr += d.impr; t.clicks += d.clicks; t.revenue += d.rev; t.conv += d.conv;
    }
    return K.derive(t);
  };
  K.derive = function (t) {
    t.roas = t.revenue / t.spend; t.cpa = t.spend / t.conv; t.ctr = (t.clicks / t.impr) * 100;
    t.cpc = t.spend / t.clicks; t.cpm = (t.spend / t.impr) * 1000;
    return t;
  };
  K.sum = function (list) {
    const t = { spend: 0, impr: 0, clicks: 0, revenue: 0, conv: 0 };
    list.forEach((m) => { for (const k in t) t[k] += m[k]; });
    return K.derive(t);
  };
  K.dayLabel = function (i) { // i = index into days, DAYS-1 is yesterday
    const d = new Date(); d.setDate(d.getDate() - (DAYS - i));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  K.DAYS = DAYS;

  /* ---------- rules ---------- */
  K.OPS = { lt: 'is below', gt: 'is above' };
  K.ACTIONS = {
    pause: 'pause the campaign', activate: 'turn the campaign back on',
    inc: 'increase the daily budget', dec: 'decrease the daily budget', notify: 'send me an alert',
  };
  K.TEMPLATES = [
    { name: 'Stop losing campaigns', platform: 'all', match: 'all', freq: '30 minutes',
      conditions: [{ metric: 'roas', op: 'lt', value: 1.2, window: 3 }, { metric: 'spend', op: 'gt', value: 150, window: 3 }],
      action: { type: 'pause', pct: 20, cap: 0 } },
    { name: 'Scale winners', platform: 'all', match: 'all', freq: 'day',
      conditions: [{ metric: 'roas', op: 'gt', value: 3, window: 7 }, { metric: 'conv', op: 'gt', value: 20, window: 7 }],
      action: { type: 'inc', pct: 20, cap: 1500 } },
    { name: 'Trim rising cost per purchase', platform: 'all', match: 'all', freq: '6 hours',
      conditions: [{ metric: 'cpa', op: 'gt', value: 30, window: 3 }],
      action: { type: 'dec', pct: 15, cap: 50 } },
    { name: 'Tired creative alert', platform: 'all', match: 'all', freq: 'day',
      conditions: [{ metric: 'ctr', op: 'lt', value: 0.8, window: 3 }],
      action: { type: 'notify', pct: 20, cap: 0 } },
    { name: 'Bring back recovered campaigns', platform: 'all', match: 'all', freq: 'day',
      conditions: [{ metric: 'roas', op: 'gt', value: 2.5, window: 14 }],
      action: { type: 'activate', pct: 20, cap: 0 } },
  ];

  K.newRule = function (tpl) {
    const r = JSON.parse(JSON.stringify(tpl || K.TEMPLATES[0]));
    r.id = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    r.enabled = true; r.runs = 0; r.lastRun = null;
    return r;
  };

  /** Campaigns a rule would act on right now, with the measured value for each condition. */
  K.evaluate = function (rule) {
    const want = rule.action.type === 'activate' ? 'paused' : 'active';
    return K.campaigns
      .filter((c) => c.status === want && (rule.platform === 'all' || c.platform === rule.platform))
      .map((c) => {
        const values = rule.conditions.map((cd) => {
          const v = K.agg(c.days, cd.window)[cd.metric];
          return { v, hit: cd.op === 'lt' ? v < cd.value : v > cd.value };
        });
        const hit = rule.match === 'any' ? values.some((x) => x.hit) : values.every((x) => x.hit);
        return { c, values, hit };
      })
      .filter((m) => m.hit && (rule.conditions.length > 0))
      .filter((m) => {
        const a = rule.action;
        if ((a.type === 'inc' || a.type === 'dec') && m.c.noBudget) return false; // budget is set on its ad sets
        if (a.type === 'inc' && a.cap > 0 && m.c.budget >= a.cap) return false; // already at the ceiling
        if (a.type === 'dec' && a.cap > 0 && m.c.budget <= a.cap) return false; // already at the floor
        return true;
      });
  };

  K.nextBudget = function (c, a) {
    if (a.type === 'inc') { const b = c.budget * (1 + a.pct / 100); return Math.round(a.cap > 0 ? Math.min(b, a.cap) : b); }
    if (a.type === 'dec') { const b = c.budget * (1 - a.pct / 100); return Math.round(a.cap > 0 ? Math.max(b, a.cap) : b); }
    return c.budget;
  };

  K.conditionText = function (cd) {
    const m = K.METRICS[cd.metric];
    const val = m.unit === '$' ? symbol + cd.value : cd.value + m.unit;
    return `${m.label} ${K.OPS[cd.op]} ${val} over the last ${cd.window} ${cd.window === 1 ? 'day' : 'days'}`;
  };
  K.actionText = function (a) {
    if (a.type === 'inc') return `increase the daily budget by ${a.pct}%` + (a.cap > 0 ? `, up to ${symbol}${a.cap}` : '');
    if (a.type === 'dec') return `decrease the daily budget by ${a.pct}%` + (a.cap > 0 ? `, no lower than ${symbol}${a.cap}` : '');
    return K.ACTIONS[a.type];
  };
  K.ruleText = function (r) {
    const joiner = r.match === 'any' ? ' or ' : ' and ';
    return `When ${r.conditions.map(K.conditionText).join(joiner)}, ${K.actionText(r.action)}.`;
  };

  K.log = function (source, campaign, text) {
    K.state.log.unshift({ t: Date.now(), source, campaign, text });
    if (K.state.log.length > 200) K.state.log.length = 200;
  };

  /* Changes go to the sample data, or to the connected Meta account when there is one. */
  K.canWrite = () => K.mode === 'sample' || K.meta.allowChanges;
  K.applyStatus = async function (c, status) { if (K.mode === 'meta') await K.meta.setStatus(c, status); c.status = status; };
  K.applyBudget = async function (c, budget) { if (K.mode === 'meta') await K.meta.setBudget(c, budget); c.budget = budget; };

  /** Applies a rule. Returns how many campaigns changed and how many changes Meta refused. */
  K.run = async function (rule) {
    const hits = K.evaluate(rule);
    let changed = 0, failed = 0;
    for (const { c } of hits) {
      const a = rule.action;
      try {
        if (a.type === 'pause') { await K.applyStatus(c, 'paused'); K.log(rule.name, c.name, 'Paused'); }
        else if (a.type === 'activate') { await K.applyStatus(c, 'active'); K.log(rule.name, c.name, 'Turned back on'); }
        else if (a.type === 'notify') { K.log(rule.name, c.name, 'Alert sent'); }
        else { const from = c.budget, b = K.nextBudget(c, a); await K.applyBudget(c, b); K.log(rule.name, c.name, `Daily budget ${K.fmt.money(from)} to ${K.fmt.money(b)}`); }
        changed++;
      } catch (e) { failed++; K.log(rule.name, c.name, 'Failed: ' + e.message); }
    }
    rule.runs += 1; rule.lastRun = Date.now();
    K.save();
    return { changed, failed };
  };

  /* ---------- persistence (per browser; the page works without it) ---------- */
  const key = () => (K.mode === 'meta' ? 'kestrel-meta-' + K.account.id : 'kestrel-demo-v1');
  K.save = function () {
    const o = { rules: K.state.rules, log: K.state.log, range: K.state.range, platform: K.state.platform, c: {} };
    if (K.mode === 'sample') K.campaigns.forEach((c) => (o.c[c.id] = [c.status, c.budget]));
    try { localStorage.setItem(key(), JSON.stringify(o)); } catch (e) { /* storage unavailable */ }
  };
  /** Rules, log and filters for the current account. A live account starts with every rule off. */
  K.loadState = function () {
    K.state = { rules: [], log: [], range: 7, platform: 'all' };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key())); } catch (e) { saved = null; }
    if (saved && Array.isArray(saved.rules)) {
      K.state.rules = saved.rules; K.state.log = saved.log || [];
      K.state.range = saved.range || 7;
      if (K.mode === 'sample') {
        K.state.platform = saved.platform || 'all';
        K.campaigns.forEach((c) => { const x = saved.c && saved.c[c.id]; if (x) { c.status = x[0]; c.budget = x[1]; } });
      }
    } else {
      K.state.rules = K.TEMPLATES.slice(0, 4).map((t, i) => { const r = K.newRule(t); r.id = 'r-default-' + i; r.enabled = K.mode === 'sample' && i !== 2; return r; });
    }
  };
  K.useSample = function () { K.mode = 'sample'; K.account = null; K.setCurrency('USD'); build(); K.loadState(); };
  K.reset = function () {
    try { localStorage.removeItem(key()); } catch (e) { /* storage unavailable */ }
    if (K.mode === 'sample') K.useSample(); else K.loadState();
  };
  /** Size inline rule tokens to their current value, so a rule reads as a sentence. */
  K.fitToks = function (root) {
    (root || document).querySelectorAll('.tok').forEach((el) => {
      const text = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : String(el.value);
      el.style.width = `calc(${(Math.max(3, text.length) * 0.62).toFixed(2)}em + ${el.tagName === 'SELECT' ? 30 : 20}px)`;
    });
  };
  K.useSample();
})();
