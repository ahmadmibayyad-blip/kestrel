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

  function ago(t) {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
      <header class="view-head"><h1>Overview</h1><p class="muted">Sample account, last ${n} days${K.state.platform === 'all' ? '' : ', ' + K.PLATFORMS[K.state.platform].name + ' only'}.</p></header>
      <section class="tiles">${tiles}</section>
      <section class="grid-2">
        <div class="panel"><h2>Spend and revenue per day</h2><div id="ch-line"></div></div>
        <div class="panel"><h2>Top campaigns by revenue</h2><div class="legend">${Object.entries(K.PLATFORMS).map(([, p]) => `<span><i style="background:${p.color}"></i>${p.name}</span>`).join('')}</div><div id="ch-bar"></div></div>
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
            <td><span class="budget">$<input type="number" min="1" step="10" value="${c.budget}" data-budget="${c.id}" aria-label="Daily budget for ${esc(c.name)}"></span></td>
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
          ${budget ? `by ${numTok('action.pct', a.pct, 'Percent', 1)}% ${a.type === 'inc' ? 'up to' : 'no lower than'} $${numTok('action.cap', a.cap, 'Budget limit', 10)}` : ''}.
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
      </div>
      <div class="rules-layout">
        <ul class="rule-list">${K.state.rules.map((r) => {
          const hits = r.enabled ? K.evaluate(r).length : 0;
          return `<li class="rule ${ui.draft && ui.draft.id === r.id ? 'current' : ''} ${r.enabled ? '' : 'off'}">
            <button class="switch" role="switch" aria-checked="${r.enabled}" data-act="toggle-rule" data-id="${r.id}" aria-label="${esc(r.name)} is ${r.enabled ? 'on' : 'off'}"></button>
            <button class="rule-body" data-act="edit-rule" data-id="${r.id}">
              <strong>${esc(r.name)}</strong><span class="rule-text">${esc(K.ruleText(r))}</span>
              <span class="rule-meta">${r.enabled ? (hits ? `<b class="match">${hits} match now</b>` : 'No matches now') : 'Off'} <span>Last run: ${ago(r.lastRun)}</span></span>
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
          <div class="thumb" style="--h:${a.hue}"><span class="format">${a.format}</span><span class="hook">${esc(a.name)}</span></div>
          <div class="creative-body">
            <h3>${esc(a.name)}</h3>
            <p class="muted small">${pdot(a.campaign.platform)}${esc(a.campaign.name)}</p>
            <p class="badges">${m.roas === best ? '<span class="badge good">★ Best ROAS</span>' : ''}${drop < -20 ? `<span class="badge warn">▼ Tired, CTR down ${Math.abs(drop).toFixed(0)}%</span>` : ''}</p>
            <dl><div><dt>ROAS</dt><dd>${F.x(m.roas)}</dd></div><div><dt>Spend</dt><dd>${F.money(m.spend)}</dd></div><div><dt>CTR</dt><dd>${F.pct(m.ctr)}</dd></div><div><dt>Purchases</dt><dd>${F.int(m.conv)}</dd></div></dl>
          </div>
        </article>`).join('')}</div>`;
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
      <p><button class="btn ghost danger" data-act="reset">Reset the demo data</button></p>`;
  }

  /* ---------- shell ---------- */
  const VIEWS = { overview, campaigns, automations, creatives, reports, activity };
  function render() {
    const v = VIEWS[view()] ? view() : 'overview';
    document.querySelectorAll('.nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === '#' + v ? 'page' : 'false'));
    $('#range').value = range(); $('#platform').value = K.state.platform;
    K.hideTip(); VIEWS[v](); K.fitToks(main);
  }
  function runAll() {
    const on = K.state.rules.filter((r) => r.enabled);
    const n = on.reduce((s, r) => s + K.run(r), 0);
    toast(n ? `Ran ${on.length} rules, ${n} change${n === 1 ? '' : 's'} made` : `Ran ${on.length} rules, nothing needed changing`);
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

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    const c = id && K.campaigns.find((x) => x.id === id);
    const rule = id && K.state.rules.find((x) => x.id === id);
    if (act === 'sort') { const k = el.dataset.key; ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : k === 'name' ? 1 : -1 }; }
    else if (act === 'toggle') { c.status = c.status === 'active' ? 'paused' : 'active'; K.log('You', c.name, c.status === 'active' ? 'Turned back on' : 'Paused'); K.save(); }
    else if (act === 'sel') { el.checked ? ui.sel.add(id) : ui.sel.delete(id); }
    else if (act === 'sel-all') { ui.sel = new Set(el.checked ? visible().filter((x) => x.name.toLowerCase().includes(ui.q.toLowerCase())).map((x) => x.id) : []); }
    else if (act === 'bulk') {
      const op = el.dataset.op; let n = 0;
      K.campaigns.filter((x) => ui.sel.has(x.id)).forEach((x) => {
        if (op === 'pause' && x.status === 'active') { x.status = 'paused'; K.log('You', x.name, 'Paused'); n++; }
        if (op === 'activate' && x.status === 'paused') { x.status = 'active'; K.log('You', x.name, 'Turned back on'); n++; }
        if (op === 'up' || op === 'down') { const b = Math.max(1, Math.round(x.budget * (op === 'up' ? 1.1 : 0.9))); K.log('You', x.name, `Daily budget ${F.money(x.budget)} to ${F.money(b)}`); x.budget = b; n++; }
      });
      K.save(); toast(`${n} campaign${n === 1 ? '' : 's'} changed`);
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
      const n = K.run(saved); ui.draft = JSON.parse(JSON.stringify(saved));
      toast(n ? `"${saved.name}" changed ${n} campaign${n === 1 ? '' : 's'}` : `"${saved.name}" ran, nothing needed changing`);
    }
    else if (act === 'del-rule') { K.state.rules = K.state.rules.filter((x) => x.id !== ui.draft.id); toast(`Deleted "${ui.draft.name}"`); ui.draft = null; K.save(); }
    else if (act === 'csv') return csv();
    else if (act === 'reset') { K.reset(); ui.draft = null; ui.sel.clear(); toast('Demo data reset'); }
    render();
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
      const c = K.campaigns.find((x) => x.id === t.dataset.budget), b = Math.max(1, Math.round(+t.value || c.budget));
      if (b !== c.budget) { K.log('You', c.name, `Daily budget ${F.money(c.budget)} to ${F.money(b)}`); c.budget = b; K.save(); toast('Budget updated'); }
      render();
    }
    else if (t.dataset.d && ui.draft && t.tagName === 'SELECT') { setPath(ui.draft, t.dataset.d, t.value); $('#editor').innerHTML = editorHtml(); K.fitToks(main); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { ui.q = t.value; campaigns(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    else if (t.dataset.d && ui.draft && t.tagName === 'INPUT') { setPath(ui.draft, t.dataset.d, t.value); $('#preview').innerHTML = previewHtml(ui.draft); K.fitToks(main); }
  });
  window.addEventListener('hashchange', render);
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (['overview', 'reports'].includes(view())) render(); }, 150); });
  render();
})();
