/* Kestrel app shell: routing, views and actions. */
(function () {
  const K = window.K, F = K.fmt, esc = K.esc, M = K.METRICS;
  const $ = (s, r) => (r || document).querySelector(s);
  const main = $('#main');
  const ui = { sort: { key: 'spend', dir: -1 }, sel: new Set(), q: '', draft: null, cSort: 'roas', rGroup: 'platform', rMetric: 'roas' };

  const visible = () => K.campaigns.filter((c) => K.state.platform === 'all' || c.platform === K.state.platform);
  const pdot = (p) => `<i class="pdot" style="background:${K.PLATFORMS[p].color}" title="${K.PLATFORMS[p].name}"></i>`;
  const range = () => K.state.range;
  const view = () => (location.hash.replace('#', '') || 'overview');
  const live = () => K.mode === 'meta';
  ui.conn = { token: '', accounts: null, error: '', busy: '', remember: false };

  function ago(t) {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function until(t) {
    const m = Math.round((t - Date.now()) / 60e3);
    return m <= 1 ? 'within a minute' : m < 90 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
  }
  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }
  function delta(cur, prev, goodWhen) {
    if (!isFinite(cur) || !isFinite(prev) || !prev) return '';
    const d = ((cur - prev) / prev) * 100;
    const up = d >= 0;
    const cls = !goodWhen || Math.abs(d) < 0.5 ? 'flat' : (goodWhen === 'up') === up ? 'good' : 'bad';
    return `<span class="delta ${cls}">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}% <span class="vs">vs previous ${range()} days</span></span>`;
  }
  function logRows(list) {
    return list.map((e) => `<tr><td class="muted nowrap">${ago(e.t)}</td><td>${esc(e.campaign)}</td><td>${esc(e.text)}</td><td class="muted">${esc(e.source)}</td></tr>`).join('');
  }

  /* ---------- overview ---------- */
  function overview() {
    const cs = visible(), n = range();
    const cur = K.sum(cs.map((c) => K.agg(c.days, n))), prev = K.sum(cs.map((c) => K.agg(c.days, n, n)));
    const tiles = ['spend', 'revenue', 'roas', 'cpa', 'ctr'].map((k) => `
      <div class="tile"><div class="tile-label">${M[k].label}</div><div class="tile-value">${M[k].fmt(cur[k])}</div>${delta(cur[k], prev[k], M[k].goodWhen)}</div>`).join('');
    const on = K.state.rules.filter((r) => r.enabled);
    const pending = new Set(on.flatMap((r) => K.evaluate(r).map((h) => h.c.id))).size;
    main.innerHTML = `
      <header class="view-head"><h1>Overview</h1><p class="muted">${live() ? esc(K.account.name) : 'Sample account'}, last ${n} days${K.state.platform === 'all' ? '' : ', ' + K.PLATFORMS[K.state.platform].name + ' only'}.</p></header>
      ${live() && !K.campaigns.length ? '<div class="panel"><p class="empty">This ad account has no active campaigns and no spend in the last 60 days.</p></div>' : ''}
      <section class="tiles">${tiles}</section>
      <section class="grid-2">
        <div class="panel"><h2>Spend and revenue per day</h2><div id="ch-line"></div></div>
        <div class="panel"><h2>Top campaigns by revenue</h2><div class="legend">${Object.entries(K.PLATFORMS).filter(([k]) => cs.some((c) => c.platform === k)).map(([, p]) => `<span><i style="background:${p.color}"></i>${p.name}</span>`).join('')}</div><div id="ch-bar"></div></div>
      </section>
      <section class="grid-2">
        <div class="panel"><h2>Automations</h2>
          <p class="big-line">${on.length} of ${K.state.rules.length} rules are on. ${pending ? `<b>${pending} campaign${pending === 1 ? '' : 's'}</b> match a rule right now.` : 'Nothing matches a rule right now.'}</p>
          <p><a class="btn" href="#automations">Review rules</a> <button class="btn ghost" data-act="run-all">Run all rules now</button></p>
        </div>
        <div class="panel"><h2>Latest changes</h2>
          ${K.state.log.length ? `<div class="table-wrap"><table class="plain"><tbody>${logRows(K.state.log.slice(0, 5))}</tbody></table></div><p><a href="#activity">See all changes</a></p>`
            : '<p class="empty">No changes yet. Run a rule to see what it did here.</p>'}
        </div>
      </section>`;
    const idx = Array.from({ length: n }, (_, i) => K.DAYS - n + i);
    K.lineChart($('#ch-line'), {
      title: 'Spend and revenue per day', labels: idx.map(K.dayLabel), unit: '$', fmt: F.money,
      series: [
        { name: 'Revenue', color: 'var(--s1)', values: idx.map((i) => cs.reduce((s, c) => s + c.days[i].rev, 0)) },
        { name: 'Spend', color: 'var(--s2)', values: idx.map((i) => cs.reduce((s, c) => s + c.days[i].spend, 0)) },
      ],
    });
    K.barChart($('#ch-bar'), {
      metric: 'Revenue', fmt: F.money,
      items: cs.map((c) => ({ label: c.name, value: K.agg(c.days, n).revenue, color: K.PLATFORMS[c.platform].color })).sort((a, b) => b.value - a.value).slice(0, 7),
    });
  }

  /* ---------- campaigns ---------- */
  const COLS = ['spend', 'revenue', 'roas', 'cpa', 'ctr', 'conv'];
  function campaigns() {
    const n = range(), q = ui.q.toLowerCase();
    const rows = visible().filter((c) => c.name.toLowerCase().includes(q)).map((c) => ({ c, m: K.agg(c.days, n) }));
    const k = ui.sort.key;
    rows.sort((a, b) => (k === 'name' ? a.c.name.localeCompare(b.c.name) : k === 'budget' ? a.c.budget - b.c.budget : a.m[k] - b.m[k]) * ui.sort.dir);
    const th = (key, label, cls) => `<th class="${cls || ''}"><button class="th" data-act="sort" data-key="${key}" aria-label="Sort by ${label}">${label}${ui.sort.key === key ? (ui.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    const total = K.sum(rows.map((r) => r.m));
    main.innerHTML = `
      <header class="view-head"><h1>Campaigns</h1><p class="muted">Turn campaigns on or off, edit budgets, or select several and change them together.</p></header>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search campaigns" value="${esc(ui.q)}" aria-label="Search campaigns">
        <div class="bulk" ${ui.sel.size ? '' : 'hidden'}>
          <span>${ui.sel.size} selected</span>
          <button class="btn sm" data-act="bulk" data-op="pause">Pause</button>
          <button class="btn sm" data-act="bulk" data-op="activate">Turn on</button>
          <button class="btn sm" data-act="bulk" data-op="up">Budget +10%</button>
          <button class="btn sm" data-act="bulk" data-op="down">Budget −10%</button>
        </div>
      </div>
      <div class="panel flush"><div class="table-wrap"><table class="data">
        <thead><tr><th><input type="checkbox" data-act="sel-all" aria-label="Select all" ${rows.length && rows.every((r) => ui.sel.has(r.c.id)) ? 'checked' : ''}></th><th>On</th>
          ${th('name', 'Campaign', 'left')}${th('budget', 'Daily budget')}${COLS.map((c) => th(c, c === 'cpa' ? 'Cost / purchase' : M[c].label)).join('')}</tr></thead>
        <tbody>${rows.map(({ c, m }) => `
          <tr class="${c.status === 'paused' ? 'is-paused' : ''}">
            <td><input type="checkbox" data-act="sel" data-id="${c.id}" aria-label="Select ${esc(c.name)}" ${ui.sel.has(c.id) ? 'checked' : ''}></td>
            <td><button class="switch" role="switch" aria-checked="${c.status === 'active'}" data-act="toggle" data-id="${c.id}" aria-label="${esc(c.name)} is ${c.status}"></button></td>
            <td class="left name">${pdot(c.platform)}${esc(c.name)}${c.status === 'paused' ? ' <span class="tag">Paused</span>' : ''}</td>
            <td>${c.noBudget ? '<span class="muted small" title="This campaign sets budgets on its ad sets">Set on ad sets</span>'
              : `<span class="budget">${esc(K.sym())}<input type="number" min="1" step="10" value="${c.budget}" data-budget="${c.id}" aria-label="Daily budget for ${esc(c.name)}"></span>`}</td>
            ${COLS.map((k2) => `<td>${M[k2].fmt(m[k2])}</td>`).join('')}
          </tr>`).join('') || `<tr><td colspan="${4 + COLS.length}" class="empty">No campaigns match "${esc(ui.q)}". Clear the search to see them all.</td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr><td></td><td></td><td class="left">${rows.length} campaigns</td><td>${F.money(rows.filter((r) => r.c.status === 'active').reduce((s, r) => s + r.c.budget, 0))}</td>${COLS.map((k2) => `<td>${M[k2].fmt(total[k2])}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div></div>`;
  }

  /* ---------- automations ---------- */
  const opt = (pairs, val) => pairs.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('');
  const tok = (path, pairs, val, label) => `<select class="tok" data-d="${path}" aria-label="${label}">${opt(pairs, val)}</select>`;
  const numTok = (path, val, label, step) => `<input class="tok num" type="number" step="${step || 'any'}" min="0" data-d="${path}" value="${val}" aria-label="${label}">`;

  function previewHtml(r) {
    const hits = K.evaluate(r);
    if (!r.conditions.length) return '<p class="empty">Add a condition to see which campaigns this rule would change.</p>';
    if (!hits.length) return `<p class="empty">No ${r.action.type === 'activate' ? 'paused' : 'active'} campaigns meet these conditions right now.</p>`;
    return `<p><b>${hits.length} campaign${hits.length === 1 ? '' : 's'}</b> would change if this rule ran now.</p>
      <div class="table-wrap"><table class="plain"><thead><tr><th class="left">Campaign</th>${r.conditions.map((cd) => `<th>${M[cd.metric].label}, ${cd.window}d</th>`).join('')}<th class="left">Change</th></tr></thead><tbody>
      ${hits.map((h) => `<tr><td class="left name">${pdot(h.c.platform)}${esc(h.c.name)}</td>${h.values.map((v, i) => `<td class="${v.hit ? 'hit' : ''}">${M[r.conditions[i].metric].fmt(v.v)}</td>`).join('')}
        <td class="left">${r.action.type === 'pause' ? 'Pause' : r.action.type === 'activate' ? 'Turn on' : r.action.type === 'notify' ? 'Alert' : F.money(h.c.budget) + ' to ' + F.money(K.nextBudget(h.c, r.action))}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function editorHtml() {
    const r = ui.draft;
    if (!r) return `<div class="panel editor"><p class="empty">Pick a rule on the left to edit it, or start a new one from a template.</p></div>`;
    const metrics = Object.entries(M).map(([k, m]) => [k, m.label]);
    const windows = [1, 3, 7, 14, 30].map((d) => [d, d === 1 ? 'day' : d + ' days']);
    const a = r.action, budget = a.type === 'inc' || a.type === 'dec';
    const saved = K.state.rules.some((x) => x.id === r.id);
    return `<div class="panel editor">
      <label class="field"><span>Rule name</span><input type="text" data-d="name" value="${esc(r.name)}" maxlength="60"></label>
      <div class="sentence">
        <p>On ${tok('platform', [['all', 'all platforms'], ...Object.entries(K.PLATFORMS).map(([k, p]) => [k, p.name])], r.platform, 'Platform')} campaigns, when
          ${tok('match', [['all', 'all'], ['any', 'any']], r.match, 'Match all or any')} of these are true:</p>
        <ul class="conds">${r.conditions.map((cd, i) => `<li>
          ${tok(`conditions.${i}.metric`, metrics, cd.metric, 'Metric')} ${tok(`conditions.${i}.op`, Object.entries(K.OPS), cd.op, 'Comparison')}
          ${numTok(`conditions.${i}.value`, cd.value, 'Value')} over the last ${tok(`conditions.${i}.window`, windows, cd.window, 'Time window')}
          <button class="x" data-act="del-cond" data-i="${i}" aria-label="Remove condition">×</button></li>`).join('')}</ul>
        <p><button class="btn sm ghost" data-act="add-cond">Add condition</button></p>
        <p>then ${tok('action.type', Object.entries(K.ACTIONS), a.type, 'Action')}
          ${budget ? `by ${numTok('action.pct', a.pct, 'Percent', 1)}% ${a.type === 'inc' ? 'up to' : 'no lower than'} ${esc(K.sym())}${numTok('action.cap', a.cap, 'Budget limit', 10)}` : ''}.
          Check every ${tok('freq', [['15 minutes', '15 minutes'], ['30 minutes', '30 minutes'], ['hour', 'hour'], ['6 hours', '6 hours'], ['day', 'day']], r.freq, 'Frequency')}.</p>
      </div>
      <div id="preview" class="preview">${previewHtml(r)}</div>
      <div class="actions">
        <button class="btn primary" data-act="save-rule">Save rule</button>
        <button class="btn" data-act="run-rule">Save and run now</button>
        ${saved ? '<button class="btn ghost danger" data-act="del-rule">Delete rule</button>' : ''}
      </div>
      <p class="hint">In this demo a rule runs when you press Run. Connected to a live ad account it would run on the schedule above.</p>
    </div>`;
  }

  function automations() {
    main.innerHTML = `
      <header class="view-head"><h1>Automations</h1><p class="muted">Rules read like a sentence. Preview what each one would change before it runs.</p></header>
      <div class="toolbar">
        <select id="tpl" aria-label="Start from a template"><option value="">New rule from template…</option>${K.TEMPLATES.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select>
        <button class="btn ghost" data-act="run-all">Run all rules now</button>
        <button class="btn ghost" data-act="export-rules">Download rules for the scheduler</button>
      </div>
      <div class="auto ${K.state.auto ? 'on' : ''}">
        <button class="switch" role="switch" aria-checked="${K.state.auto}" data-act="toggle-auto" aria-label="Run rules automatically while this page is open"></button>
        <span><b>Run rules automatically while this page is open.</b> ${!K.state.auto ? 'Each rule that is on runs at its own "check every" interval.'
          : live() && !K.meta.allowChanges ? 'Paused: this Meta account is read-only. Allow changes on the Connection screen to let rules act.'
          : 'On. Rules run at their own interval as long as this tab stays open.'}
          To run them with no browser open, use the scheduler described in the README.</span>
      </div>
      <div class="rules-layout">
        <ul class="rule-list">${K.state.rules.map((r) => {
          const hits = r.enabled ? K.evaluate(r).length : 0;
          return `<li class="rule ${ui.draft && ui.draft.id === r.id ? 'current' : ''} ${r.enabled ? '' : 'off'}">
            <button class="switch" role="switch" aria-checked="${r.enabled}" data-act="toggle-rule" data-id="${r.id}" aria-label="${esc(r.name)} is ${r.enabled ? 'on' : 'off'}"></button>
            <button class="rule-body" data-act="edit-rule" data-id="${r.id}">
              <strong>${esc(r.name)}</strong><span class="rule-text">${esc(K.ruleText(r))}</span>
              <span class="rule-meta">${r.enabled ? (hits ? `<b class="match">${hits} match now</b>` : 'No matches now') : 'Off'} <span>Last run: ${ago(r.lastRun)}</span>${r.enabled && K.state.auto ? `<span>Next run: ${until(K.nextRun(r, r.lastRun))}</span>` : ''}</span>
            </button></li>`;
        }).join('') || '<li class="empty">No rules yet. Start one from a template above.</li>'}</ul>
        <div id="editor">${editorHtml()}</div>
      </div>`;
  }

  /* ---------- creatives ---------- */
  function creatives() {
    const n = range();
    const list = K.creatives.filter((a) => K.state.platform === 'all' || a.campaign.platform === K.state.platform).map((a) => {
      const m = K.agg(a.days, n), recent = K.agg(a.days, 3).ctr, before = K.agg(a.days, 14, 3).ctr;
      return { a, m, drop: ((recent - before) / before) * 100 };
    });
    const best = Math.max(...list.map((x) => x.m.roas));
    list.sort((x, y) => (ui.cSort === 'fatigue' ? x.drop - y.drop : y.m[ui.cSort] - x.m[ui.cSort]));
    main.innerHTML = `
      <header class="view-head"><h1>Creatives</h1><p class="muted">Which ads earn their spend, and which are wearing out. Tired means click rate fell more than 20% against the two weeks before.</p></header>
      <div class="toolbar"><label>Sort by <select id="csort">${opt([['roas', 'ROAS'], ['spend', 'Spend'], ['ctr', 'CTR'], ['conv', 'Purchases'], ['fatigue', 'Most tired first']], ui.cSort)}</select></label></div>
      <div class="creative-grid">${list.map(({ a, m, drop }) => `
        <article class="creative">
          <div class="thumb" style="--h:${a.hue}">${a.thumb ? `<img src="${esc(a.thumb)}" alt="" loading="lazy">` : `<span class="hook">${esc(a.name)}</span>`}<span class="format">${esc(a.format)}</span></div>
          <div class="creative-body">
            <h3>${esc(a.name)}</h3>
            <p class="muted small">${pdot(a.campaign.platform)}${esc(a.campaign.name)}</p>
            <p class="badges">${m.roas === best ? '<span class="badge good">★ Best ROAS</span>' : ''}${drop < -20 ? `<span class="badge warn">▼ Tired, CTR down ${Math.abs(drop).toFixed(0)}%</span>` : ''}</p>
            <dl><div><dt>ROAS</dt><dd>${F.x(m.roas)}</dd></div><div><dt>Spend</dt><dd>${F.money(m.spend)}</dd></div><div><dt>CTR</dt><dd>${F.pct(m.ctr)}</dd></div><div><dt>Purchases</dt><dd>${F.int(m.conv)}</dd></div></dl>
          </div>
        </article>`).join('')}</div>
      ${list.length ? '' : '<div class="panel"><p class="empty">No ads with spend in the last 30 days.</p></div>'}`;
  }

  /* ---------- reports ---------- */
  function reportRows() {
    const n = range(), cs = visible();
    if (ui.rGroup === 'campaign') return cs.map((c) => ({ label: c.name, color: K.PLATFORMS[c.platform].color, m: K.agg(c.days, n) }));
    if (ui.rGroup === 'platform') return Object.entries(K.PLATFORMS).map(([k, p]) => ({ label: p.name, color: p.color, m: K.sum(cs.filter((c) => c.platform === k).map((c) => K.agg(c.days, n))) })).filter((r) => r.m.spend > 0);
    return Array.from({ length: n }, (_, j) => {
      const i = K.DAYS - n + j, t = { spend: 0, impr: 0, clicks: 0, revenue: 0, conv: 0 };
      cs.forEach((c) => { const d = c.days[i]; t.spend += d.spend; t.impr += d.impr; t.clicks += d.clicks; t.revenue += d.rev; t.conv += d.conv; });
      return { label: K.dayLabel(i), color: 'var(--s1)', m: K.derive(t) };
    });
  }
  function reports() {
    const rows = reportRows(), keys = Object.keys(M), m = M[ui.rMetric];
    main.innerHTML = `
      <header class="view-head"><h1>Reports</h1><p class="muted">Break results down, then export the table as a CSV file.</p></header>
      <div class="toolbar">
        <label>Break down by <select id="rgroup">${opt([['platform', 'Platform'], ['campaign', 'Campaign'], ['day', 'Day']], ui.rGroup)}</select></label>
        <label>Chart <select id="rmetric">${opt(keys.map((k) => [k, M[k].label]), ui.rMetric)}</select></label>
        <button class="btn" data-act="csv">Export CSV</button>
      </div>
      <div class="panel"><h2>${m.label} by ${ui.rGroup}</h2><div id="ch-report"></div></div>
      <div class="panel flush"><div class="table-wrap"><table class="data"><thead><tr><th class="left">${ui.rGroup[0].toUpperCase() + ui.rGroup.slice(1)}</th>${keys.map((k) => `<th>${k === 'cpa' ? 'Cost / purchase' : M[k].label}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="left name">${esc(r.label)}</td>${keys.map((k) => `<td>${M[k].fmt(r.m[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    if (ui.rGroup === 'day') K.lineChart($('#ch-report'), { title: m.label + ' per day', labels: rows.map((r) => r.label), unit: m.unit, fmt: m.fmt, series: [{ name: m.label, color: 'var(--s1)', values: rows.map((r) => r.m[ui.rMetric] || 0) }] });
    else K.barChart($('#ch-report'), { metric: m.label, fmt: m.fmt, items: rows.map((r) => ({ label: r.label, value: r.m[ui.rMetric] || 0, color: r.color })).sort((a, b) => b.value - a.value) });
  }
  function csv() {
    const rows = reportRows(), keys = Object.keys(M);
    const cell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const text = [[ui.rGroup, ...keys.map((k) => M[k].label)].map(cell).join(',')]
      .concat(rows.map((r) => [cell(r.label), ...keys.map((k) => (isFinite(r.m[k]) ? r.m[k].toFixed(2) : ''))].join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `kestrel-report-by-${ui.rGroup}-${range()}d.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    toast('Exported CSV');
  }

  /* ---------- activity ---------- */
  function activity() {
    main.innerHTML = `
      <header class="view-head"><h1>Activity</h1><p class="muted">Every change made to a campaign, by a rule or by hand.</p></header>
      ${K.state.log.length ? `<div class="panel flush"><div class="table-wrap"><table class="data"><thead><tr><th class="left">When</th><th class="left">Campaign</th><th class="left">Change</th><th class="left">Made by</th></tr></thead><tbody class="left-all">${logRows(K.state.log)}</tbody></table></div></div>`
        : '<div class="panel"><p class="empty">No changes yet. Run a rule from Automations, or edit a campaign, and it shows up here.</p></div>'}
      <p><button class="btn ghost danger" data-act="reset">${live() ? 'Clear the rules and log for this account' : 'Reset the demo data'}</button></p>`;
  }

  /* ---------- connection ---------- */
  function connection() {
    const cn = ui.conn, a = K.account;
    const head = `<header class="view-head"><h1>Connection</h1><p class="muted">Use the sample account, or read your own campaigns from Meta.</p></header>`;
    if (cn.busy) { main.innerHTML = head + `<div class="panel"><p class="empty">${esc(cn.busy)}</p></div>`; return; }
    if (live()) {
      main.innerHTML = head + `
        <div class="panel"><h2>Connected to ${esc(a.name)}</h2>
          <p>Ad account ${esc(a.id)}, ${esc(a.currency)}. Showing ${K.campaigns.length} campaigns and the last ${K.DAYS} days of results, loaded ${ago(K.meta.loadedAt)}.</p>
          <p><button class="btn" data-act="refresh">Load the latest data</button> <button class="btn ghost danger" data-act="disconnect">Disconnect</button></p>
        </div>
        <div class="panel"><h2>Changes to your Meta account</h2>
          <p class="allow"><button class="switch" role="switch" aria-checked="${K.meta.allowChanges}" data-act="toggle-allow" aria-label="Allow changes"></button>
            <span><b>${K.meta.allowChanges ? 'Changes are allowed.' : 'Read-only.'}</b> ${K.meta.allowChanges
              ? 'Pausing, turning on and budget edits here are sent to Meta and affect live spend. Each one asks you to confirm first.'
              : 'Kestrel only reads. Rules still show what they would change, but nothing is sent to Meta until you turn this on.'}</span></p>
          <p class="hint">Changes need a token with the ads_management permission. Rules run when you press Run while this page is open. Running them on a schedule needs a server, which this version does not have.</p>
        </div>`;
      return;
    }
    main.innerHTML = head + `
      ${cn.error ? `<div class="panel error" role="alert"><b>Could not connect.</b> ${esc(cn.error)}</div>` : ''}
      <div class="panel"><h2>Connect a Meta ad account</h2>
        <ol class="how">
          <li>In Meta for Developers, create an app and add the Marketing API.</li>
          <li>Create an access token with the <b>ads_read</b> permission. Add <b>ads_management</b> only if you want Kestrel to pause campaigns or change budgets.</li>
          <li>Paste the token here.</li>
        </ol>
        <label class="field"><span>Access token</span><input type="password" id="token" autocomplete="off" spellcheck="false" value="${esc(cn.token)}" placeholder="Paste your Meta access token"></label>
        ${cn.accounts ? (cn.accounts.length ? `
          <label class="field"><span>Ad account</span><select id="acct">${cn.accounts.map((x, i) => `<option value="${i}">${esc(x.name)} (${esc(x.id)}, ${esc(x.currency)})${x.active ? '' : ', not active'}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="remember" ${cn.remember ? 'checked' : ''}> Remember this connection on this device</label>
          <p><button class="btn primary" data-act="connect">Connect this account</button> <button class="btn ghost" data-act="find-accounts">Look again</button></p>`
          : `<p class="empty">This token cannot see any ad accounts. Check it was created by someone with access to the account.</p><p><button class="btn" data-act="find-accounts">Look again</button></p>`)
          : `<p><button class="btn primary" data-act="find-accounts">Find my ad accounts</button></p>`}
        <p class="hint">The token stays in this browser and is sent only to graph.facebook.com. Unless you tick "remember", it is forgotten when you close this tab. Kestrel starts read-only.</p>
      </div>`;
  }

  /* ---------- shell ---------- */
  const VIEWS = { overview, campaigns, automations, creatives, reports, activity, connection };
  function render() {
    const v = VIEWS[view()] ? view() : 'overview';
    document.querySelectorAll('.nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === '#' + v ? 'page' : 'false'));
    $('#range').value = range(); $('#platform').value = K.state.platform;
    $('#platform').closest('label').hidden = live();
    $('#side-note').textContent = live()
      ? `Connected to ${K.account.name}. ${K.meta.allowChanges ? 'Changes are sent to Meta.' : 'Read-only.'}`
      : 'Demo account with sample data. Nothing here touches a real ad account.';
    K.hideTip(); VIEWS[v](); K.fitToks(main);
  }
  /** True when a change must not go ahead: the live account is read-only. */
  function blocked() {
    if (K.canWrite()) return false;
    toast('Read-only. Allow changes on the Connection screen to change your Meta account.');
    return true;
  }
  const sure = (msg) => !live() || window.confirm(msg + '\n\nThis changes your live Meta ad account.');
  function summary(what, r) {
    return r.changed || r.failed
      ? `${what}: ${r.changed} change${r.changed === 1 ? '' : 's'} made` + (r.failed ? `, ${r.failed} failed (see Activity)` : '')
      : `${what}: nothing needed changing`;
  }
  async function runAll() {
    const on = K.state.rules.filter((r) => r.enabled);
    if (!on.length) { toast('No rules are turned on'); return; }
    const pending = on.reduce((s, r) => s + K.evaluate(r).length, 0);
    if (pending && (blocked() || !sure(`Run ${on.length} rules? Up to ${pending} changes will be made.`))) return;
    const total = { changed: 0, failed: 0 };
    for (const r of on) { const x = await K.run(r); total.changed += x.changed; total.failed += x.failed; }
    toast(summary(`Ran ${on.length} rules`, total));
    render();
  }
  function setPath(obj, path, val) {
    const parts = path.split('.'); const last = parts.pop();
    const target = parts.reduce((o, p) => o[p], obj);
    target[last] = ['value', 'window', 'pct', 'cap'].includes(last) ? (parseFloat(val) || 0) : val;
  }
  function saveDraft() {
    const r = ui.draft; if (!r) return false;
    r.name = r.name.trim() || 'Untitled rule';
    if (!r.conditions.length) { toast('Add at least one condition before saving'); return false; }
    const i = K.state.rules.findIndex((x) => x.id === r.id);
    const copy = JSON.parse(JSON.stringify(r));
    if (i >= 0) K.state.rules[i] = copy; else K.state.rules.push(copy);
    K.save(); return true;
  }

  /** Reads the account from Meta, showing progress on the Connection screen. */
  async function loadLive(work, message) {
    ui.conn.busy = message; ui.conn.error = ''; render();
    try { await work(); ui.draft = null; ui.sel.clear(); }
    catch (err) { ui.conn.error = err.message; if (!live()) location.hash = '#connection'; }
    ui.conn.busy = ''; render();
  }

  async function onClick(el) {
    const act = el.dataset.act, id = el.dataset.id;
    const c = id && K.campaigns.find((x) => x.id === id);
    const rule = id && K.state.rules.find((x) => x.id === id);
    if (act === 'sort') { const k = el.dataset.key; ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : k === 'name' ? 1 : -1 }; }
    else if (act === 'toggle') {
      const to = c.status === 'active' ? 'paused' : 'active';
      if (blocked() || !sure(`${to === 'paused' ? 'Pause' : 'Turn on'} "${c.name}"?`)) return;
      await K.applyStatus(c, to); K.log('You', c.name, to === 'active' ? 'Turned back on' : 'Paused'); K.save();
    }
    else if (act === 'sel') { el.checked ? ui.sel.add(id) : ui.sel.delete(id); }
    else if (act === 'sel-all') { ui.sel = new Set(el.checked ? visible().filter((x) => x.name.toLowerCase().includes(ui.q.toLowerCase())).map((x) => x.id) : []); }
    else if (act === 'bulk') {
      const op = el.dataset.op, r = { changed: 0, failed: 0 };
      const label = { pause: 'Pause', activate: 'Turn on', up: 'Raise the budget of', down: 'Cut the budget of' }[op];
      if (blocked() || !sure(`${label} ${ui.sel.size} selected campaign${ui.sel.size === 1 ? '' : 's'}?`)) return;
      for (const x of K.campaigns.filter((y) => ui.sel.has(y.id))) {
        try {
          if (op === 'pause' && x.status === 'active') { await K.applyStatus(x, 'paused'); K.log('You', x.name, 'Paused'); r.changed++; }
          else if (op === 'activate' && x.status === 'paused') { await K.applyStatus(x, 'active'); K.log('You', x.name, 'Turned back on'); r.changed++; }
          else if ((op === 'up' || op === 'down') && !x.noBudget) {
            const from = x.budget, b = Math.max(1, Math.round(from * (op === 'up' ? 1.1 : 0.9)));
            await K.applyBudget(x, b); K.log('You', x.name, `Daily budget ${F.money(from)} to ${F.money(b)}`); r.changed++;
          }
        } catch (err) { r.failed++; K.log('You', x.name, 'Failed: ' + err.message); }
      }
      K.save(); toast(summary('Bulk edit', r));
    }
    else if (act === 'run-all') return runAll();
    else if (act === 'toggle-rule') { rule.enabled = !rule.enabled; if (ui.draft && ui.draft.id === id) ui.draft.enabled = rule.enabled; K.save(); }
    else if (act === 'edit-rule') { ui.draft = JSON.parse(JSON.stringify(rule)); }
    else if (act === 'add-cond') { ui.draft.conditions.push({ metric: 'spend', op: 'gt', value: 100, window: 7 }); }
    else if (act === 'del-cond') { ui.draft.conditions.splice(+el.dataset.i, 1); }
    else if (act === 'save-rule') { if (saveDraft()) toast(`Saved "${ui.draft.name}"`); }
    else if (act === 'run-rule') {
      if (!saveDraft()) return;
      const saved = K.state.rules.find((x) => x.id === ui.draft.id);
      const n = K.evaluate(saved).length;
      if (n && (blocked() || !sure(`Run "${saved.name}"? It will change ${n} campaign${n === 1 ? '' : 's'}.`))) return;
      const r = await K.run(saved); ui.draft = JSON.parse(JSON.stringify(saved));
      toast(summary(`"${saved.name}"`, r));
    }
    else if (act === 'del-rule') { K.state.rules = K.state.rules.filter((x) => x.id !== ui.draft.id); toast(`Deleted "${ui.draft.name}"`); ui.draft = null; K.save(); }
    else if (act === 'csv') return csv();
    else if (act === 'toggle-auto') {
      if (!K.state.auto && live() && !window.confirm('Run rules automatically while this page is open?\n\nRules that are on will change your live Meta ad account without asking each time.')) return;
      K.state.auto = !K.state.auto; K.save();
      toast(K.state.auto ? 'Automatic runs are on' : 'Automatic runs are off');
      if (K.state.auto) autoTick();
    }
    else if (act === 'export-rules') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(K.state.rules, null, 2) + '\n'], { type: 'application/json' }));
      a.download = 'rules.json'; a.click(); URL.revokeObjectURL(a.href);
      toast('Downloaded rules.json');
      return;
    }
    else if (act === 'reset') { K.reset(); ui.draft = null; ui.sel.clear(); toast(live() ? 'Rules and log cleared' : 'Demo data reset'); }
    else if (act === 'find-accounts') {
      const token = ui.conn.token.trim();
      if (!token) { toast('Paste an access token first'); return; }
      ui.conn.busy = 'Looking for your ad accounts…'; ui.conn.error = ''; render();
      try { ui.conn.accounts = await K.meta.accounts(token); } catch (err) { ui.conn.error = err.message; ui.conn.accounts = null; }
      ui.conn.busy = '';
    }
    else if (act === 'connect') {
      const account = ui.conn.accounts[+$('#acct').value], remember = $('#remember').checked, token = ui.conn.token.trim();
      ui.conn.remember = remember;
      await loadLive(() => K.meta.connect(token, account, remember), `Reading ${account.name} from Meta…`);
      if (live()) { ui.conn.token = ''; ui.conn.accounts = null; toast(`Connected to ${account.name}`); }
      return;
    }
    else if (act === 'refresh') { await loadLive(() => K.meta.load(), 'Loading the latest data from Meta…'); if (!ui.conn.error) toast('Data updated'); else toast(ui.conn.error); return; }
    else if (act === 'disconnect') { K.meta.disconnect(); ui.draft = null; ui.sel.clear(); toast('Disconnected. Showing the sample account.'); }
    else if (act === 'toggle-allow') {
      if (!K.meta.allowChanges && !window.confirm('Allow Kestrel to pause campaigns and change budgets in your live Meta ad account?\n\nEach change will still ask you to confirm.')) return;
      K.meta.setAllow(!K.meta.allowChanges);
    }
    render();
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    onClick(el).catch((err) => { toast(err.message); render(); });
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'range') { K.state.range = +t.value; K.save(); render(); }
    else if (t.id === 'platform') { K.state.platform = t.value; ui.sel.clear(); K.save(); render(); }
    else if (t.id === 'csort') { ui.cSort = t.value; render(); }
    else if (t.id === 'rgroup') { ui.rGroup = t.value; render(); }
    else if (t.id === 'rmetric') { ui.rMetric = t.value; render(); }
    else if (t.id === 'tpl' && t.value !== '') { ui.draft = K.newRule(K.TEMPLATES[+t.value]); render(); }
    else if (t.dataset.budget) {
      const c = K.campaigns.find((x) => x.id === t.dataset.budget), from = c.budget, b = Math.max(1, Math.round(+t.value || from));
      if (b === from || blocked() || !sure(`Change the daily budget of "${c.name}" from ${F.money(from)} to ${F.money(b)}?`)) { render(); return; }
      K.applyBudget(c, b)
        .then(() => { K.log('You', c.name, `Daily budget ${F.money(from)} to ${F.money(b)}`); K.save(); toast('Budget updated'); })
        .catch((err) => toast(err.message))
        .then(render);
    }
    else if (t.dataset.d && ui.draft && t.tagName === 'SELECT') { setPath(ui.draft, t.dataset.d, t.value); $('#editor').innerHTML = editorHtml(); K.fitToks(main); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { ui.q = t.value; campaigns(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    else if (t.id === 'token') { ui.conn.token = t.value; }
    else if (t.dataset.d && ui.draft && t.tagName === 'INPUT') { setPath(ui.draft, t.dataset.d, t.value); $('#preview').innerHTML = previewHtml(ui.draft); K.fitToks(main); }
  });
  /* Automatic runs: every minute, run each enabled rule whose interval has passed. */
  let ticking = false;
  async function autoTick() {
    if (ticking || !K.state.auto || !K.canWrite() || ui.conn.busy) return;
    ticking = true;
    try {
      const total = { changed: 0, failed: 0 }; let ran = 0;
      for (const r of K.state.rules.filter((x) => x.enabled && K.isDue(x, x.lastRun, Date.now()))) {
        const x = await K.run(r); total.changed += x.changed; total.failed += x.failed; ran++;
      }
      if (total.changed || total.failed) { toast(summary('Automatic run', total)); render(); }
      else if (ran && view() === 'automations' && !ui.draft) render();
    } finally { ticking = false; }
  }
  setInterval(autoTick, 60e3);
  window.addEventListener('hashchange', render);
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (['overview', 'reports'].includes(view())) render(); }, 150); });
  // Reopen the last Meta connection if there is one; otherwise show the sample account.
  if (K.meta.restore()) loadLive(() => K.meta.load(), `Reading ${K.meta.conn.account.name} from Meta…`).then(autoTick);
  else { render(); autoTick(); }
})();
