/* Runs Kestrel rules against Meta, Google Ads, TikTok Ads, Snapchat Ads and Pinterest Ads accounts with no browser open.
   Meant for the scheduled GitHub Actions workflow, but works anywhere Node 18+ runs.

   Meta (optional):
     META_ACCESS_TOKEN              token with ads_read, plus ads_management to apply changes
     META_AD_ACCOUNT_ID             the ad account number, with or without "act_"
   Google Ads (optional):
     GOOGLE_ADS_DEVELOPER_TOKEN     developer token from the manager account's API Center
     GOOGLE_ADS_CUSTOMER_ID         the ad account's customer ID
     GOOGLE_ADS_LOGIN_CUSTOMER_ID   manager account ID, only if access goes through a manager
     GOOGLE_ADS_CLIENT_ID           OAuth client ID
     GOOGLE_ADS_CLIENT_SECRET       OAuth client secret
     GOOGLE_ADS_REFRESH_TOKEN       refresh token with the adwords scope
   Pinterest Ads (optional):
     PINTEREST_ACCESS_TOKEN         access token with ads:read, plus ads:write to apply changes
     PINTEREST_AD_ACCOUNT_ID        the ad account ID
     PINTEREST_APP_ID, PINTEREST_APP_SECRET, PINTEREST_REFRESH_TOKEN
                                    optional, to renew the access token instead of supplying one
   Snapchat Ads (optional):
     SNAPCHAT_CLIENT_ID             OAuth app client ID
     SNAPCHAT_CLIENT_SECRET         OAuth app client secret
     SNAPCHAT_REFRESH_TOKEN         refresh token with the snapchat-marketing-api scope
     SNAPCHAT_AD_ACCOUNT_ID         the ad account ID
   TikTok Ads (optional):
     TIKTOK_ACCESS_TOKEN            access token with Ads Management and Reporting permissions
     TIKTOK_ADVERTISER_ID           the advertiser ID
   Notifications (optional):
     KESTREL_WEBHOOK_URL            Slack or Discord incoming-webhook address. A summary is sent when a
                                    run changes something, raises an alert or fails.
   Behaviour:
     KESTREL_APPLY         "true" to change the accounts. Anything else is a dry run.
     KESTREL_LOG_NAMES     "true" to print campaign names. Off by default: logs may be public.
     KESTREL_RUN_ALL       "true" to run every enabled rule now, ignoring its interval.

   Rules come from automation/rules.json (download it from the app's Automations screen).
   automation/.state.json remembers when each rule last ran. */
const fs = require('fs');
const path = require('path');

function loadEngine() {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
  global.window = global;
  global.localStorage = mem(); global.sessionStorage = mem();
  require('../js/data.js');
  require('../js/meta.js');
  require('../js/google.js');
  require('../js/tiktok.js');
  require('../js/snapchat.js');
  require('../js/pinterest.js');
  return global.K;
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
const digits = (s) => String(s || '').replace(/\D/g, '');

async function connectMeta(K, env, apply) {
  const token = (env.META_ACCESS_TOKEN || '').trim(), id = (env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/, '');
  if (!token || !id) return false;
  if (!/^\d+$/.test(id)) throw new Error('META_AD_ACCOUNT_ID should be the ad account number, for example 1234567890.');
  K.meta.conn = { token, account: { id, name: 'Meta', currency: 'USD' }, allow: apply };
  const info = await K.meta.api('act_' + id, { fields: 'name,currency' });
  K.meta.conn.account = { id, name: info.name || 'Meta', currency: info.currency || 'USD' };
  return true;
}
async function connectGoogle(K, env, apply) {
  const devToken = (env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(), customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID);
  const refresh = (env.GOOGLE_ADS_REFRESH_TOKEN || '').trim(), clientId = (env.GOOGLE_ADS_CLIENT_ID || '').trim(), secret = (env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
  if (!devToken || !customerId) return false;
  if (!refresh || !clientId || !secret) throw new Error('Google Ads needs GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_REFRESH_TOKEN as well.');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: secret }) });
  const tok = await res.json().catch(() => ({}));
  if (!tok.access_token) throw new Error('Google would not issue an access token: ' + String(tok.error_description || tok.error || res.status).replace(/\.$/, '') + '. The refresh token may be revoked or expired.');
  const conn = { devToken, customerId, loginId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID), accessToken: tok.access_token, allow: apply };
  conn.account = await K.google.lookup(conn);
  K.google.conn = conn;
  return true;
}

async function connectTikTok(K, env, apply) {
  const token = (env.TIKTOK_ACCESS_TOKEN || '').trim(), advertiserId = digits(env.TIKTOK_ADVERTISER_ID);
  if (!token || !advertiserId) return false;
  const conn = { token, advertiserId, allow: apply };
  conn.account = await K.tiktok.lookup(conn);
  K.tiktok.conn = conn;
  return true;
}

async function connectSnapchat(K, env, apply) {
  const clientId = (env.SNAPCHAT_CLIENT_ID || '').trim(), clientSecret = (env.SNAPCHAT_CLIENT_SECRET || '').trim();
  const refreshToken = (env.SNAPCHAT_REFRESH_TOKEN || '').trim(), id = (env.SNAPCHAT_AD_ACCOUNT_ID || '').trim();
  if (!refreshToken || !id) return false;
  if (!clientId || !clientSecret) throw new Error('Snapchat needs SNAPCHAT_CLIENT_ID and SNAPCHAT_CLIENT_SECRET as well.');
  const conn = { accessToken: '', expires: 0, clientId, clientSecret, refreshToken, allow: apply, account: { id, name: 'Snapchat', currency: 'USD' } };
  const info = await K.snapchat.call('GET', 'adaccounts/' + id, null, conn);
  const a = ((info.adaccounts || [])[0] || {}).adaccount || {};
  conn.account = { id, name: a.name || 'Snapchat', currency: a.currency || 'USD' };
  K.snapchat.conn = conn;
  return true;
}

async function connectPinterest(K, env, apply) {
  const accessToken = (env.PINTEREST_ACCESS_TOKEN || '').trim(), refreshToken = (env.PINTEREST_REFRESH_TOKEN || '').trim();
  const clientId = (env.PINTEREST_APP_ID || '').trim(), clientSecret = (env.PINTEREST_APP_SECRET || '').trim(), id = digits(env.PINTEREST_AD_ACCOUNT_ID);
  if (!id || (!accessToken && !refreshToken)) return false;
  if (!accessToken && !(clientId && clientSecret)) throw new Error('Pinterest needs PINTEREST_APP_ID and PINTEREST_APP_SECRET to use a refresh token.');
  const conn = { accessToken, expires: 0, clientId, clientSecret, refreshToken: clientId && clientSecret ? refreshToken : '', allow: apply, account: { id, name: 'Pinterest', currency: 'USD' } };
  const a = await K.pinterest.call('GET', 'ad_accounts/' + id, null, conn);
  conn.account = { id, name: a.name || 'Pinterest', currency: a.currency && a.currency !== 'UNK' ? a.currency : 'USD' };
  K.pinterest.conn = conn;
  return true;
}

async function run(env, now) {
  const say = (s) => console.log(s);
  const dir = __dirname;
  const rules = readJson(path.join(dir, 'rules.json'), []);
  const stateFile = path.join(dir, '.state.json');
  const state = readJson(stateFile, {});
  const apply = env.KESTREL_APPLY === 'true', names = env.KESTREL_LOG_NAMES === 'true', runAll = env.KESTREL_RUN_ALL === 'true';

  const K = loadEngine();
  K.meta.conn = null; K.google.conn = null; K.tiktok.conn = null; K.snapchat.conn = null; K.pinterest.conn = null;
  const hasMeta = !!(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID), hasGoogle = !!(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CUSTOMER_ID);
  const hasTikTok = !!(env.TIKTOK_ACCESS_TOKEN && env.TIKTOK_ADVERTISER_ID);
  const hasSnapchat = !!(env.SNAPCHAT_REFRESH_TOKEN && env.SNAPCHAT_AD_ACCOUNT_ID);
  const hasPinterest = !!(env.PINTEREST_AD_ACCOUNT_ID && (env.PINTEREST_ACCESS_TOKEN || env.PINTEREST_REFRESH_TOKEN));
  if (!hasMeta && !hasGoogle && !hasTikTok && !hasSnapchat && !hasPinterest) { say('Not set up yet: add the secrets for at least one ad platform, as described in the README. Nothing was run.'); return 0; }

  const on = Array.isArray(rules) ? rules.filter((r) => r && r.enabled && Array.isArray(r.conditions) && r.action) : [];
  const due = on.filter((r) => runAll || K.isDue(r, state[r.id], now));
  say(`${on.length} rule${on.length === 1 ? ' is' : 's are'} on, ${due.length} due now. Mode: ${apply ? 'APPLY (changes are sent to the ad platforms)' : 'dry run (nothing is changed)'}.`);
  if (!due.length) return 0;

  if (hasMeta) await connectMeta(K, env, apply);
  if (hasGoogle) await connectGoogle(K, env, apply);
  if (hasTikTok) await connectTikTok(K, env, apply);
  if (hasSnapchat) await connectSnapchat(K, env, apply);
  if (hasPinterest) await connectPinterest(K, env, apply);
  await K.loadLive();
  say(`Loaded ${K.campaigns.length} campaigns from ${K.account.name}.`);
  let failed = K.liveErrors.length;
  K.liveErrors.forEach((e) => say('Could not load ' + e));
  K.connected().forEach((s) => { if (s.note) say('Note: ' + s.note); });

  // The run log may be public, so it hides campaign names unless asked. The notification goes
  // to a private webhook, so it always uses them.
  const label = (c) => `${K.sources[c.platform].label} ` + (names ? `"${K.label(c)}"` : K.NOUN[K.levelOf(c)] + ' …' + String(c.id).slice(-4));
  const full = (c) => `${K.label(c)} (${K.sources[c.platform].label})`;
  const note = [];
  for (const rule of due) {
    const hits = K.evaluate(rule);
    say(`\n"${rule.name}": ${hits.length} campaign${hits.length === 1 ? '' : 's'} match.`);
    const lines = [];
    if (rule.action.type === 'notify') {
      // An alert changes nothing, so it is sent in a dry run as well.
      hits.forEach((h) => { say(`  ${label(h.c)}: alert, ${K.hitText(rule, h)}`); lines.push(`${full(h.c)}: ${K.hitText(rule, h)}`); });
    } else if (apply) {
      const before = K.state.log.length;
      const r = await K.run(rule);
      failed += r.failed;
      K.state.log.slice(0, K.state.log.length - before).reverse().forEach((e) => {
        const c = K.find(e.cid);
        say(`  ${c ? label(c) : 'campaign'}: ${e.text}`);
        lines.push(`${c ? full(c) : e.campaign}: ${e.text}`);
      });
    } else {
      hits.forEach(({ c }) => {
        const a = rule.action;
        const what = a.type === 'pause' ? 'would pause' : a.type === 'activate' ? 'would turn on'
          : `would change daily budget ${K.fmt.money(c.budget)} to ${K.fmt.money(K.nextBudget(c, a))}`;
        say(`  ${label(c)}: ${what}`);
        lines.push(`${full(c)}: ${what}`);
      });
    }
    if (lines.length) note.push(`${rule.name}${rule.action.type === 'notify' ? ' (alert)' : ''}`, ...lines.map((l) => '  • ' + l));
    state[rule.id] = now;
  }
  fs.writeFileSync(stateFile, JSON.stringify(state) + '\n');
  K.liveErrors.forEach((e) => note.push('Could not load ' + e));
  if (note.length) await post(env, [`Kestrel${apply ? '' : ' dry run (nothing was changed)'} on ${K.account.name}`, ...note].join('\n'));
  if (failed) { say(`\n${failed} problem${failed === 1 ? '' : 's'} in this run.`); return 1; }
  return 0;
}

/** Sends a message to KESTREL_WEBHOOK_URL (Slack, Discord or any service that accepts {"text": ...}). Never fails the run. */
async function post(env, text) {
  const url = (env.KESTREL_WEBHOOK_URL || '').trim();
  if (!url) return;
  try {
    const discord = /(^|\.)discord(app)?\.com$/.test(new URL(url).hostname);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(discord ? { content: text.slice(0, 1900) } : { text }) });
    console.log(res.ok ? 'Notification sent.' : 'The notification was not accepted (' + res.status + ').');
  } catch (e) { console.log('Could not send the notification.'); }
}

async function main(env, now) {
  try { return await run(env, now); }
  catch (err) { await post(env, 'Kestrel scheduler stopped: ' + err.message); throw err; }
}

module.exports = { main };
if (require.main === module) {
  main(process.env, Date.now()).then((code) => process.exit(code), (err) => { console.error('Stopped: ' + err.message); process.exit(1); });
}
