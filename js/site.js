/* Landing page hero: a live rule evaluated against the sample campaigns. */
(function () {
  const K = window.K, M = K.METRICS;
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { roas: 1.5, cpa: 30, ctr: 0.8 };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // A fixed, pristine set so the hero is the same for everyone, whatever they did in the demo app.
  const picks = ['c1', 'c2', 'c5', 'c7', 'c9', 'c11', 'c12'].map((id) => K.campaigns.find((c) => c.id === id));
  const base = { c1: 600, c2: 250, c5: 300, c7: 500, c9: 200, c11: 450, c12: 300 };

  function draw() {
    const metric = $('d-metric').value, op = $('d-op').value, win = +$('d-window').value, act = $('d-action').value;
    const value = parseFloat($('d-value').value) || 0;
    let hits = 0, moved = 0;
    const rows = picks.map((c) => {
      const v = K.agg(c.days, win)[metric];
      const hit = op === 'lt' ? v < value : v > value;
      const b = base[c.id];
      let change = 'No change';
      if (hit) {
        hits++;
        if (act === 'pause') { change = 'Pause'; moved += b; }
        else { const nb = Math.round(b * (act === 'inc' ? 1.2 : 0.8)); change = K.fmt.money(b) + ' to ' + K.fmt.money(nb); moved += Math.abs(nb - b); }
      }
      return `<tr class="${hit ? 'hit' : ''}"><td class="left"><i class="pdot" style="background:${K.PLATFORMS[c.platform].color}"></i>${esc(c.name)}</td><td>${K.fmt.money(b)}</td><td class="val">${M[metric].fmt(v)}</td><td class="left">${change}</td></tr>`;
    }).join('');
    $('d-table').innerHTML = `<thead><tr><th class="left">Campaign</th><th>Daily budget</th><th>${M[metric].label}, ${win} days</th><th class="left">What the rule does</th></tr></thead><tbody>${rows}</tbody>`;
    const verb = act === 'pause' ? 'paused, taking' : act === 'inc' ? 'scaled, adding' : 'trimmed, taking';
    $('d-result').innerHTML = hits
      ? `<b>${hits} of ${picks.length} campaigns</b> would be ${verb} <b>${K.fmt.money(moved)} a day</b> ${act === 'inc' ? 'to' : 'out of'} spend.`
      : 'No campaigns match. Try a different number.';
    K.fitToks();
  }
  $('d-metric').addEventListener('change', () => { $('d-value').value = DEFAULTS[$('d-metric').value]; draw(); });
  ['d-op', 'd-window', 'd-action'].forEach((id) => $(id).addEventListener('change', draw));
  $('d-value').addEventListener('input', draw);
  draw();
})();
