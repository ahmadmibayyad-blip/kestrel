/* Runs Kestrel rules against a Meta ad account with no browser open.
   Meant for the scheduled GitHub Actions workflow, but works anywhere Node 18+ runs.

   Settings (environment variables):
     META_ACCESS_TOKEN     token with ads_read, plus ads_management to apply changes
     META_AD_ACCOUNT_ID    the ad account number, with or without "act_"
     KESTREL_APPLY         "true" to change the account. Anything else is a dry run.
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
  return global.K;
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };

async function main(env, now) {
  const say = (s) => console.log(s);
  const token = (env.META_ACCESS_TOKEN || '').trim();
  const accountId = (env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/, '');
  if (!token || !accountId) { say('Not set up yet: add the META_ACCESS_TOKEN and META_AD_ACCOUNT_ID secrets. Nothing was run.'); return 0; }
  if (!/^\d+$/.test(accountId)) { say('META_AD_ACCOUNT_ID should be the ad account number, for example 1234567890.'); return 1; }

  const dir = __dirname;
  const rules = readJson(path.join(dir, 'rules.json'), []);
  const stateFile = path.join(dir, '.state.json');
  const state = readJson(stateFile, {});
  const apply = env.KESTREL_APPLY === 'true', names = env.KESTREL_LOG_NAMES === 'true', runAll = env.KESTREL_RUN_ALL === 'true';

  const K = loadEngine();
  const on = Array.isArray(rules) ? rules.filter((r) => r && r.enabled && Array.isArray(r.conditions) && r.action) : [];
  const due = on.filter((r) => runAll || K.isDue(r, state[r.id], now));
  say(`${on.length} rule${on.length === 1 ? ' is' : 's are'} on, ${due.length} due now. Mode: ${apply ? 'APPLY (changes are sent to Meta)' : 'dry run (nothing is changed)'}.`);
  if (!due.length) return 0;

  K.meta.conn = { token, account: { id: accountId, name: 'Ad account', currency: 'USD' }, allow: apply };
  const info = await K.meta.api('act_' + accountId, { fields: 'name,currency' });
  K.meta.conn.account = { id: accountId, name: info.name || 'Ad account', currency: info.currency || 'USD' };
  await K.meta.load();
  say(`Loaded ${K.campaigns.length} campaigns.`);

  const label = (c) => (names ? c.name : 'campaign …' + String(c.id).slice(-4));
  let failed = 0;
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
  if (failed) { say(`\n${failed} change${failed === 1 ? '' : 's'} failed.`); return 1; }
  return 0;
}

module.exports = { main };
if (require.main === module) {
  main(process.env, Date.now()).then((code) => process.exit(code), (err) => { console.error('Stopped: ' + err.message); process.exit(1); });
}
