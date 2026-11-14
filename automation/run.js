/* Runs Kestrel rules against Meta and Google Ads accounts with no browser open.
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

async function main(env, now) {
  const say = (s) => console.log(s);
  const dir = __dirname;
  const rules = readJson(path.join(dir, 'rules.json'), []);
  const stateFile = path.join(dir, '.state.json');
  const state = readJson(stateFile, {});
  const apply = env.KESTREL_APPLY === 'true', names = env.KESTREL_LOG_NAMES === 'true', runAll = env.KESTREL_RUN_ALL === 'true';

  const K = loadEngine();
  K.meta.conn = null; K.google.conn = null;
  const hasMeta = !!(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID), hasGoogle = !!(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CUSTOMER_ID);
  if (!hasMeta && !hasGoogle) { say('Not set up yet: add the Meta or Google Ads secrets described in the README. Nothing was run.'); return 0; }

  const on = Array.isArray(rules) ? rules.filter((r) => r && r.enabled && Array.isArray(r.conditions) && r.action) : [];
  const due = on.filter((r) => runAll || K.isDue(r, state[r.id], now));
  say(`${on.length} rule${on.length === 1 ? ' is' : 's are'} on, ${due.length} due now. Mode: ${apply ? 'APPLY (changes are sent to the ad platforms)' : 'dry run (nothing is changed)'}.`);
  if (!due.length) return 0;

  if (hasMeta) await connectMeta(K, env, apply);
  if (hasGoogle) await connectGoogle(K, env, apply);
  await K.loadLive();
  say(`Loaded ${K.campaigns.length} campaigns from ${K.account.name}.`);
  let failed = K.liveErrors.length;
  K.liveErrors.forEach((e) => say('Could not load ' + e));

  const label = (c) => `${K.sources[c.platform].label} ` + (names ? `"${c.name}"` : 'campaign …' + String(c.id).slice(-4));
  for (const rule of due) {
    const hits = K.evaluate(rule);
    say(`\n"${rule.name}": ${hits.length} campaign${hits.length === 1 ? '' : 's'} match.`);
    if (apply) {
      const before = K.state.log.length;
      const r = await K.run(rule);
      failed += r.failed;
      K.state.log.slice(0, K.state.log.length - before).reverse().forEach((e) => {
        const c = K.campaigns.find((x) => x.name === e.campaign);
        say(`  ${c ? label(c) : 'campaign'}: ${e.text}`);
      });
    } else {
      hits.forEach(({ c }) => {
        const a = rule.action;
        const what = a.type === 'pause' ? 'would pause' : a.type === 'activate' ? 'would turn on' : a.type === 'notify' ? 'would alert'
          : `would change daily budget ${K.fmt.money(c.budget)} to ${K.fmt.money(K.nextBudget(c, a))}`;
        say(`  ${label(c)}: ${what}`);
      });
    }
    state[rule.id] = now;
  }
  fs.writeFileSync(stateFile, JSON.stringify(state) + '\n');
  if (failed) { say(`\n${failed} problem${failed === 1 ? '' : 's'} in this run.`); return 1; }
  return 0;
}

module.exports = { main };
if (require.main === module) {
  main(process.env, Date.now()).then((code) => process.exit(code), (err) => { console.error('Stopped: ' + err.message); process.exit(1); });
}
