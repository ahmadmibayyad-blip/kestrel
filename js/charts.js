/* Small SVG charts: a multi-series line chart with crosshair, and horizontal bars. No dependencies. */
(function () {
  const K = window.K;
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  K.esc = esc;

  let tip;
  function showTip(html, x, y) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); }
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + 'px';
    tip.style.top = Math.max(8, y - h - 12) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }
  K.showTip = showTip; K.hideTip = hideTip;

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function axisFmt(v, unit) {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(+v.toFixed(2));
    return unit === '$' ? K.sym() + s : s + (unit || '');
  }

  /** opts: { labels[], series[{name,color,values[]}], fmt, unit } */
  K.lineChart = function (el, opts) {
    const W = Math.max(300, el.clientWidth || 600), H = 250;
    const m = { l: 46, r: opts.series.length > 1 ? 76 : 16, t: 10, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = opts.labels.length;
    const max = niceMax(Math.max(...opts.series.flatMap((s) => s.values)));
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;

    let g = '';
    for (let t = 0; t <= 4; t++) {
      const v = (max / 4) * t, yy = y(v);
      g += `<line class="grid" x1="${m.l}" x2="${m.l + iw}" y1="${yy}" y2="${yy}"/><text class="axis" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${axisFmt(v, opts.unit)}</text>`;
    }
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
    for (let i = n - 1; i >= 0; i -= step) g += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(opts.labels[i])}</text>`;

    // end labels, nudged apart so they never overlap
    const ends = opts.series.map((s, i) => ({ i, y: y(s.values[n - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;

    opts.series.forEach((s, si) => {
      const d = s.values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (opts.series.length > 1) g += `<text class="endlabel" x="${m.l + iw + 8}" y="${ends.find((e) => e.i === si).y + 4}">${esc(s.name)}</text>`;
    });
    g += `<g class="hover" visibility="hidden"><line class="cross" y1="${m.t}" y2="${m.t + ih}"/>${opts.series.map((s) => `<circle r="4.5" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`).join('')}</g>`;
    g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;

    const legend = opts.series.length > 1
      ? `<div class="legend">${opts.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    el.innerHTML = `${legend}<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(opts.title || 'Line chart')}">${g}</svg>`;

    const svg = el.querySelector('svg'), hover = svg.querySelector('.hover'), hit = svg.querySelector('.hit');
    const dots = hover.querySelectorAll('circle'), cross = hover.querySelector('.cross');
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      hover.setAttribute('visibility', 'visible');
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      opts.series.forEach((s, si) => { dots[si].setAttribute('cx', x(i)); dots[si].setAttribute('cy', y(s.values[i])); });
      showTip(`<b>${esc(opts.labels[i])}</b>` + opts.series.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.name)}<em>${opts.fmt(s.values[i])}</em></div>`).join(''), e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); hideTip(); });
  };

  /** opts: { items[{label,value,color}], fmt } — horizontal bars, value labelled at the bar end. */
  K.barChart = function (el, opts) {
    const max = Math.max(...opts.items.map((i) => i.value), 0) || 1;
    el.innerHTML = `<div class="bars">${opts.items.map((it, i) => `
      <div class="bar-row" data-i="${i}">
        <span class="bar-label" title="${esc(it.label)}">${esc(it.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(0.5, (it.value / max) * 100)}%;background:${it.color}"></span></span>
        <span class="bar-value">${opts.fmt(it.value)}</span>
      </div>`).join('')}</div>`;
    el.querySelectorAll('.bar-row').forEach((row) => {
      const it = opts.items[+row.dataset.i];
      row.addEventListener('pointermove', (e) => showTip(`<b>${esc(it.label)}</b><div>${esc(opts.metric || '')}<em>${opts.fmt(it.value)}</em></div>`, e.clientX, e.clientY));
      row.addEventListener('pointerleave', hideTip);
    });
  };
  void NS;
})();
