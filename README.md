# Kestrel

A prototype of an ad automation product: a marketing page plus a working app.
Static HTML, CSS and JavaScript with no build step and no dependencies.

- `index.html` is the landing page, with a live rule demo in the hero.
- `app.html` is the app: overview, campaigns (bulk edits), automations (rule builder
  with preview), creatives, reports (CSV export), an activity log and a Connection screen.

By default the app shows sample data generated in the browser by `js/data.js`. Changes made
in the sample account are kept in that browser's local storage; "Reset the demo data" on the
Activity screen clears them.

## Run it

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/ or open `index.html` directly.

## Connect a real Meta ad account

The Connection screen reads a Meta ad account directly from the browser (`js/meta.js`).

1. In Meta for Developers, create an app and add the Marketing API.
2. Create an access token with `ads_read`. Add `ads_management` only if Kestrel should
   pause campaigns or change budgets.
3. Open the app, go to Connection, paste the token, pick the ad account.

What to know:

- The token stays in the browser and is sent only to `graph.facebook.com`. It is kept for
  the tab, or on the device if "remember" is ticked. Anyone using that browser profile can
  use a remembered token.
- The app starts read-only. "Allow changes" must be turned on before anything is sent to
  Meta, and each change asks for confirmation. Changes affect live spend.
- It loads active and paused campaigns, 60 days of daily results, and ads with spend in the
  last 30 days. Purchases and revenue come from the account's purchase events.
- Budget edits apply to campaigns with a campaign-level daily budget. Campaigns whose
  budgets are set on ad sets are shown but not changed.
- Rules run when you press Run, or automatically (see below).
- Tokens from Meta's Graph API Explorer expire after an hour or two. A long-lived or system
  user token lasts longer.
- Requests use Meta's default API version. Set `K.meta.version` in `js/meta.js` to pin one.
- TikTok is sample data only.

## Connect a real Google Ads account

The Connection screen can also read a Google Ads account from the browser (`js/google.js`).
Meta and Google Ads can be connected at the same time; campaigns from both appear together.
Google asks for more setup than Meta:

1. **Developer token.** In a Google Ads manager account, open API Center and copy the
   developer token. A test-level token works only on test accounts. For a real account, apply
   for Basic access there; Google reviews the request.
2. **OAuth client ID.** In Google Cloud, enable the Google Ads API, set up the consent screen,
   and create an OAuth client ID of type "Web application". Add the address you open Kestrel
   from as an authorised JavaScript origin, for example
   `https://ahmadmibayyad-blip.github.io` or `http://localhost:8000`.
3. In the app, go to Connection, enter the developer token, the ad account's customer ID, the
   manager account ID if you reach the account through a manager, and the client ID. Then
   click "Sign in with Google and connect".

What to know:

- A Google sign-in lasts about an hour. When it expires the Connection screen says so and
  offers "Sign in to Google again". Meta data keeps loading in the meantime.
- "Purchases" and revenue for Google campaigns are the account's conversions and conversion
  value, whatever conversion actions the account counts.
- Budget edits apply to campaigns with their own daily budget. Campaigns on a shared budget
  are shown but not changed, because the change would affect other campaigns.
- The Creatives screen lists Google ads by type and ID, without previews.
- If the two accounts use different currencies, amounts are not converted. The Connection
  screen warns about this; filter by platform to read totals correctly.
- Calling the Google Ads API from a browser is allowed by Google's servers but is not an
  officially supported setup. Requests use API version `v26` (`K.google.version` in
  `js/google.js`); Google retires versions about a year after release.

## Run rules automatically

There are two ways. Both run each enabled rule at its own "check every" interval.

**While the app is open.** On the Automations screen, turn on "Run rules automatically while
this page is open". It stops when the tab is closed. On a live account it only acts
when "Allow changes" is on.

**With no browser open (GitHub Actions).** The workflow in
`.github/workflows/kestrel-rules.yml` runs `automation/run.js` every 15 minutes.

1. In the app, build your rules, then click "Download rules for the scheduler" and commit
   the file as `automation/rules.json`. Only rules that are switched on will run.
2. In the repository, go to Settings → Secrets and variables → Actions and add secrets for
   the platforms you want. Either or both work.
   - Meta: `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` (the account number). Use a
     long-lived or system user token; a short-lived one stops working within hours.
   - Google Ads: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`,
     `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, and
     `GOOGLE_ADS_LOGIN_CUSTOMER_ID` if access goes through a manager account. The refresh
     token must be issued for the same OAuth client with the `adwords` scope (Google's
     OAuth Playground can create one). Refresh tokens of an app left in "Testing" on the
     consent screen expire after 7 days.
3. Open the Actions tab, run "Run Kestrel rules" by hand, and read the log. It is a dry run:
   it prints what each rule would change and changes nothing.
4. When the dry run looks right, add a repository variable `KESTREL_APPLY` set to `true`.
   From then on the scheduler pauses campaigns and changes budgets in the live account.

What to know:

- Remove `KESTREL_APPLY` (or set it to anything else) to go back to dry runs. Disable the
  workflow in the Actions tab to stop it completely.
- The scheduler uses the rules in the repository, not the ones in your browser. After you
  edit rules in the app, download and commit `rules.json` again.
- Logs of a public repository are public. Campaigns are shown by the last four digits of
  their ID unless you add a variable `KESTREL_LOG_NAMES` set to `true`. Rule names are
  always shown.
- GitHub can start scheduled runs several minutes late, and pauses schedules in repositories
  with no activity for 60 days. A failed run (for example an expired token) shows as a
  failed workflow, which GitHub emails you about.
- "Send me an alert" rules only write a line in the log; no message is sent.
- To run it somewhere else, set the same environment variables and run
  `node automation/run.js` on any machine with Node 18 or later.

## Placeholders to replace before this is public

- The product name, pricing tiers and landing page copy are drafts.
