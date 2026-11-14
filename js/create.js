/* Create ads in bulk (Meta). Pick an ad set, a starting point, then several images, texts and
   headlines; every combination becomes one ad, created paused unless told otherwise.
   Loaded before app.js; it uses K.ui (toast, render, blocked, live, esc), which app.js sets up. */
(function () {
  const K = window.K;
  const MAX_ADS = 50, MAX_IMAGE_MB = 8;
  const CTAS = [['LEARN_MORE', 'Learn more'], ['SHOP_NOW', 'Shop now'], ['SIGN_UP', 'Sign up'], ['BOOK_TRAVEL', 'Book now'], ['CONTACT_US', 'Contact us'], ['GET_OFFER', 'Get offer'], ['SUBSCRIBE', 'Subscribe'], ['DOWNLOAD', 'Download']];
  const fresh = () => ({ campaign: '', adset: '', adsets: null, ads: null, pages: null, mode: 'copy', template: '', page: '', link: '', cta: 'LEARN_MORE',
    images: [], texts: [''], headlines: [''], prefix: '', start: false, skip: {}, busy: '', error: '', done: null });
  let st = fresh();

  const $ = (s) => document.querySelector(s);
  const esc = (s) => K.ui.esc(s == null ? '' : s);
  const sample = () => K.mode === 'sample';
  const metaCampaigns = () => K.campaigns.filter((c) => c.platform === 'meta');
  const template = () => (st.ads || []).find((a) => a.id === st.template);
  const filled = (list) => list.map((s) => s.trim()).filter(Boolean);

  /* The sample account has no real ad sets or ads, so the screen can be tried with made-up ones. */
  const source = {
    adsets: (cid) => (sample() ? Promise.resolve(['Broad', 'Lookalike'].map((n, i) => ({ id: cid + '-as' + i, name: n + ' audience', paused: false }))) : K.meta.adsets(cid)),
    adsIn: (asid) => (sample()
      ? Promise.resolve([{ id: asid + '-ad0', name: 'Summer offer, image', thumb: '', spec: { page_id: '1', link_data: { link: 'https://example.com', message: 'Our summer offer is here.', name: 'Up to 30% off' } }, why: '', text: 'Our summer offer is here.', headline: 'Up to 30% off' },
        { id: asid + '-ad1', name: 'Product demo, video', thumb: '', spec: { video_data: {} }, why: 'it is a video ad', text: '', headline: '' }])
      : K.meta.adsIn(asid)),
    pages: () => (sample() ? Promise.resolve([{ id: '1', name: 'Sample Page' }]) : K.meta.pages()),
  };

  /** Every ad that would be created: one per image × text × headline. */
  function combos() {
    const t = template();
    const images = st.images.length ? st.images.map((im, i) => ({ im, label: 'image ' + (i + 1) })) : [{ im: null, label: '' }];
    const texts = filled(st.texts), heads = filled(st.headlines);
    const tl = texts.length ? texts : [st.mode === 'copy' && t ? t.text : ''], hl = heads.length ? heads : [st.mode === 'copy' && t ? t.headline : ''];
    const out = [];
    images.forEach((img) => tl.forEach((text, ti) => hl.forEach((headline, hi) => {
      const parts = [img.label, tl.length > 1 ? 'text ' + (ti + 1) : '', hl.length > 1 ? 'headline ' + (hi + 1) : ''].filter(Boolean);
      const key = [img.im ? st.images.indexOf(img.im) : 'x', ti, hi].join('-');
      out.push({ key, image: img.im, text, headline, name: ((st.prefix.trim() || (st.mode === 'copy' && t ? t.name : 'Ad')) + (parts.length ? ' | ' + parts.join(' | ') : '')).slice(0, 200) });
    })));
    return out;
  }
  /** What still stops creation, in plain words; '' when ready. */
  function problem(list) {
    if (!st.adset) return 'Choose a campaign and an ad set.';
    if (st.mode === 'copy') {
      const t = template();
      if (!t) return 'Choose an ad to copy.';
      if (t.why) return `"${t.name}" cannot be copied because ${t.why}. Pick another ad, or start a new website link ad.`;
      if (!st.images.length && !filled(st.texts).length && !filled(st.headlines).length) return 'Add at least one new image, text or headline, otherwise the new ad would be identical to the one you are copying.';
    } else {
      if (!st.page.trim()) return 'Choose the Facebook Page the ads run from.';
      if (!/^https?:\/\/\S+\.\S+/.test(st.link.trim())) return 'Enter the website address the ads link to, starting with https://';
      if (!st.images.length) return 'Add at least one image.';
      if (!filled(st.texts).length) return 'Add at least one text.';
    }
    const n = list.filter((c) => !st.skip[c.key]).length;
    if (!n) return 'Every ad is unticked. Tick at least one.';
    if (n > MAX_ADS) return `That is ${n} ads. Create at most ${MAX_ADS} at a time: untick some, or use fewer images, texts or headlines.`;
    return '';
  }

  function previewHtml() {
    const list = combos(), why = problem(list), n = list.filter((c) => !st.skip[c.key]).length;
    const rows = list.slice(0, 200).map((c) => `<tr>
      <td><input type="checkbox" data-c="skip" data-key="${c.key}" ${st.skip[c.key] ? '' : 'checked'} aria-label="Create ${esc(c.name)}"></td>
      <td>${c.image ? `<img class="c-thumb" src="${esc(c.image.url)}" alt="">` : '<span class="muted small">Same image</span>'}</td>
      <td class="left"><b>${esc(c.name)}</b><span class="c-copy">${esc(c.headline) || '<i>no headline</i>'}</span><span class="c-copy muted">${esc(c.text.slice(0, 140)) || '<i>no text</i>'}</span></td></tr>`).join('');
    return `<h2>${list.length} ad${list.length === 1 ? '' : 's'} from these combinations</h2>
      <div class="table-wrap"><table class="plain c-list"><tbody>${rows}</tbody></table></div>
      ${why ? `<p class="warn">${esc(why)}</p>` : ''}
      <label class="check"><input type="checkbox" data-c="start" ${st.start ? 'checked' : ''}> Start the ads straight away (otherwise they are created paused)</label>
      <p><button class="btn primary" data-c="go" ${why ? 'disabled' : ''}>Create ${n} ${st.start ? '' : 'paused '}ad${n === 1 ? '' : 's'}</button></p>`;
  }

  const listInputs = (key, label, hint, area) => `<div class="c-list-field"><span class="c-label">${label}</span>
    ${st[key].map((v, i) => `<div class="c-row">${area ? `<textarea rows="3" data-c="item" data-key="${key}" data-i="${i}" placeholder="${hint}">${esc(v)}</textarea>` : `<input type="text" data-c="item" data-key="${key}" data-i="${i}" value="${esc(v)}" placeholder="${hint}" maxlength="255">`}
      ${st[key].length > 1 ? `<button class="x" data-c="del-item" data-key="${key}" data-i="${i}" aria-label="Remove">×</button>` : ''}</div>`).join('')}
    <button class="btn sm ghost" data-c="add-item" data-key="${key}">Add another</button></div>`;
  const select = (id, items, val, empty) => `<select data-c="${id}"><option value="">${empty}</option>${items.map((x) => `<option value="${esc(x.id)}" ${x.id === val ? 'selected' : ''}>${esc(x.name)}${x.paused ? ' (paused)' : ''}${x.why ? ' (cannot be copied)' : ''}</option>`).join('')}</select>`;

  K.createView = function () {
    const main = $('#main'), camps = metaCampaigns();
    const head = `<header class="view-head"><h1>Create ads</h1><p class="muted">Make many Meta ads at once: every combination of your images, texts and headlines becomes one ad.</p></header>`;
    if (st.busy) { main.innerHTML = head + `<div class="panel"><p class="empty" role="status">${esc(st.busy)}</p></div>`; return; }
    if (st.done) {
      const ok = st.done.filter((d) => d.id), bad = st.done.filter((d) => !d.id);
      main.innerHTML = head + `<div class="panel"><h2>${ok.length} ad${ok.length === 1 ? '' : 's'} created${sample() ? ' (sample account, nothing was sent)' : st.done.started ? '' : ', paused'}${bad.length ? `, ${bad.length} failed` : ''}</h2>
        <div class="table-wrap"><table class="plain"><tbody>${st.done.map((d) => `<tr><td class="left">${esc(d.name)}</td><td class="left">${d.id ? 'Created' : '<b>Failed:</b> ' + esc(d.error)}</td></tr>`).join('')}</tbody></table></div>
        ${ok.length && !st.done.started && !sample() ? '<p class="hint">Review them in Meta Ads Manager and switch on the ones you want.</p>' : ''}
        <p><button class="btn" data-c="again">Create more ads</button></p></div>`;
      return;
    }
    if (!sample() && !K.meta.conn) { main.innerHTML = head + '<div class="panel"><p class="empty">Connect a Meta ad account on the Connection screen to create ads. Ad creation is available for Meta only for now.</p></div>'; return; }
    if (!camps.length) { main.innerHTML = head + '<div class="panel"><p class="empty">This Meta account has no campaigns to add ads to. Create a campaign and an ad set in Ads Manager first.</p></div>'; return; }
    const t = template();
    main.innerHTML = head + `
      ${sample() ? '<p class="warn">You are on the sample account, so this is a walk-through: the ad sets and ads below are made up and nothing is sent to Meta.</p>' : ''}
      ${st.error ? `<div class="panel error" role="alert">${esc(st.error)}</div>` : ''}
      <div class="panel c-form"><h2>1. Where the ads go</h2>
        <label class="field"><span>Campaign</span>${select('campaign', camps, st.campaign, 'Choose a campaign')}</label>
        ${st.adsets ? `<label class="field"><span>Ad set</span>${select('adset', st.adsets, st.adset, st.adsets.length ? 'Choose an ad set' : 'This campaign has no ad sets')}</label>` : ''}
      </div>
      ${st.adset ? `<div class="panel c-form"><h2>2. Starting point</h2>
        <label class="check"><input type="radio" name="c-mode" data-c="mode" value="copy" ${st.mode === 'copy' ? 'checked' : ''}> Copy an ad that is already in this ad set. The new ads keep its button, form and destination.</label>
        <label class="check"><input type="radio" name="c-mode" data-c="mode" value="new" ${st.mode === 'new' ? 'checked' : ''}> New website link ad</label>
        ${st.mode === 'copy'
          ? `<label class="field"><span>Ad to copy</span>${select('template', st.ads || [], st.template, (st.ads || []).length ? 'Choose an ad' : 'This ad set has no ads yet')}</label>
             ${t && t.why ? `<p class="warn">"${esc(t.name)}" cannot be copied because ${esc(t.why)}.</p>` : ''}
             ${t && !t.why ? `<p class="hint">Copying "${esc(t.name)}". Leave a list below empty to keep that part of the original.</p>` : ''}`
          : `<label class="field"><span>Facebook Page</span>${st.pages && st.pages.length ? select('page', st.pages, st.page, 'Choose a Page') : `<input type="text" data-c="page" value="${esc(st.page)}" placeholder="Page ID">`}</label>
             <label class="field"><span>Website address</span><input type="url" data-c="link" value="${esc(st.link)}" placeholder="https://"></label>
             <label class="field"><span>Button</span><select data-c="cta">${CTAS.map(([v, l]) => `<option value="${v}" ${v === st.cta ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
      </div>
      <div class="panel c-form"><h2>3. What changes between ads</h2>
        <div class="c-list-field"><span class="c-label">Images${st.mode === 'copy' ? ' (optional)' : ''}</span>
          <div class="c-images">${st.images.map((im, i) => `<figure><img src="${esc(im.url)}" alt="${esc(im.name)}"><button class="x" data-c="del-image" data-i="${i}" aria-label="Remove ${esc(im.name)}">×</button></figure>`).join('')}</div>
          <input type="file" id="c-files" accept="image/jpeg,image/png" multiple aria-label="Add images"><p class="hint">JPG or PNG, up to ${MAX_IMAGE_MB} MB each. Videos are not supported yet.</p></div>
        ${listInputs('texts', 'Texts', 'The main text shown above the image', true)}
        ${listInputs('headlines', 'Headlines', 'The bold line under the image', false)}
        <label class="field"><span>Start of each ad's name</span><input type="text" data-c="prefix" value="${esc(st.prefix)}" placeholder="${esc(st.mode === 'copy' && t ? t.name : 'Ad')}" maxlength="120"></label>
      </div>
      <div class="panel" id="c-preview">${previewHtml()}</div>` : ''}`;
  };

  const refreshPreview = () => { const el = $('#c-preview'); if (el) el.innerHTML = previewHtml(); };
  async function load(work, message) {
    st.busy = message; st.error = ''; K.ui.render();
    try { await work(); } catch (e) { st.error = e.message; }
    st.busy = ''; K.ui.render();
  }
  const readBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => fail(new Error('Could not read ' + file.name)); r.readAsDataURL(file); });

  async function create() {
    const list = combos().filter((c) => !st.skip[c.key]);
    if (problem(combos())) return;
    const adset = st.adsets.find((a) => a.id === st.adset), t = template();
    if (!sample()) {
      if (K.ui.blocked(K.campaigns.find((c) => c.id === st.campaign))) return;
      if (!window.confirm(`Create ${list.length} ${st.start ? 'ads that start running straight away' : 'paused ads'} in "${adset.name}"?\n\nThis adds ads to your live Meta ad account.`)) return;
    }
    const done = []; done.started = st.start;
    const hashes = new Map();
    st.busy = `Creating ${list.length} ads…`; K.ui.render();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const status = $('#main [role="status"]'); if (status) status.textContent = `Creating ad ${i + 1} of ${list.length}…`;
      try {
        if (sample()) { done.push({ name: c.name, id: 'sample-' + i }); continue; }
        let hash = '';
        if (c.image) { if (!hashes.has(c.image)) hashes.set(c.image, await K.meta.uploadImage(await readBase64(c.image.file))); hash = hashes.get(c.image); }
        let spec;
        if (st.mode === 'copy') {
          spec = JSON.parse(JSON.stringify(t.spec));
          if (hash) { spec.link_data.image_hash = hash; delete spec.link_data.picture; }
          if (c.text) spec.link_data.message = c.text;
          if (c.headline) spec.link_data.name = c.headline;
        } else {
          spec = { page_id: st.page.trim(), link_data: { image_hash: hash, link: st.link.trim(), message: c.text, call_to_action: { type: st.cta, value: { link: st.link.trim() } } } };
          if (c.headline) spec.link_data.name = c.headline;
        }
        const creative = await K.meta.createCreative(c.name, spec);
        const id = await K.meta.createAd(c.name, st.adset, creative, st.start);
        done.push({ name: c.name, id });
        K.log('You', K.campaigns.find((x) => x.id === st.campaign).name, `Ad created${st.start ? '' : ' (paused)'}: ${c.name}`);
      } catch (e) { done.push({ name: c.name, error: e.message }); }
    }
    K.save();
    st.busy = ''; st.done = done; K.ui.render();
    const ok = done.filter((d) => d.id).length;
    K.ui.toast(`${ok} ad${ok === 1 ? '' : 's'} created` + (done.length > ok ? `, ${done.length - ok} failed` : ''));
  }

  document.addEventListener('change', async (e) => {
    const t = e.target, c = t.dataset && t.dataset.c;
    if (t.id === 'c-files') {
      const tooBig = [];
      [...t.files].forEach((f) => { if (f.size > MAX_IMAGE_MB * 1024 * 1024) tooBig.push(f.name); else st.images.push({ file: f, name: f.name, url: URL.createObjectURL(f) }); });
      if (tooBig.length) K.ui.toast(`Too large, skipped: ${tooBig.join(', ')}`);
      st.skip = {}; K.ui.render(); return;
    }
    if (!c) return;
    if (c === 'campaign') { const keep = t.value; st = Object.assign(fresh(), { campaign: keep }); if (keep) await load(async () => { st.adsets = await source.adsets(keep); }, 'Loading ad sets…'); else K.ui.render(); }
    else if (c === 'adset') {
      st.adset = t.value; st.ads = null; st.template = ''; st.pages = null;
      if (st.adset) await load(async () => { [st.ads, st.pages] = await Promise.all([source.adsIn(st.adset), source.pages().catch(() => [])]); const first = st.ads.find((a) => !a.why); if (first) st.template = first.id; else st.mode = st.ads.length ? 'copy' : 'new'; }, 'Loading the ads in this ad set…');
      else K.ui.render();
    }
    else if (c === 'mode') { st.mode = t.value; st.skip = {}; K.ui.render(); }
    else if (c === 'template') { st.template = t.value; st.skip = {}; K.ui.render(); }
    else if (c === 'page' || c === 'cta') { st[c] = t.value; refreshPreview(); }
    else if (c === 'skip') { if (t.checked) delete st.skip[t.dataset.key]; else st.skip[t.dataset.key] = true; refreshPreview(); }
    else if (c === 'start') { st.start = t.checked; refreshPreview(); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target, c = t.dataset && t.dataset.c;
    if (c === 'item') { st[t.dataset.key][+t.dataset.i] = t.value; refreshPreview(); }
    else if (c === 'prefix' || c === 'link' || (c === 'page' && t.tagName === 'INPUT')) { st[c] = t.value; refreshPreview(); }
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-c]'); if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    const c = t.dataset.c;
    if (c === 'add-item') { st[t.dataset.key].push(''); st.skip = {}; K.ui.render(); }
    else if (c === 'del-item') { st[t.dataset.key].splice(+t.dataset.i, 1); st.skip = {}; K.ui.render(); }
    else if (c === 'del-image') { URL.revokeObjectURL(st.images[+t.dataset.i].url); st.images.splice(+t.dataset.i, 1); st.skip = {}; K.ui.render(); }
    else if (c === 'again') { st = fresh(); K.ui.render(); }
    else if (c === 'go') create().catch((err) => { st.busy = ''; st.error = err.message; K.ui.render(); });
  });
  /** Forget the form when the account shown changes, so a draft never targets the wrong account. */
  K.createReset = () => { st = fresh(); };
})();
