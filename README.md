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

## Connect a real TikTok Ads account

The Connection screen can also read a TikTok Ads account (`js/tiktok.js`). It can be connected
alongside Meta and Google Ads.

1. In TikTok for Business Developers, create an app and request the Ads Management and
   Reporting permissions. TikTok reviews new apps before they can be used.
2. Authorise the app for your ad account and copy the access token it gives you.
3. Set up the relay in [`relay/`](relay/README.md) and copy its address.
4. In the app, go to Connection, paste the token, the advertiser ID and the relay address,
   and connect.

What to know:

- TikTok's API refuses requests sent from a web page, so the app reaches it through the
  relay, a small server you host (the relay's README covers hosting it on Apify). The
  scheduler below runs outside the browser and calls TikTok directly, with no relay.
- "Purchases" and revenue for TikTok campaigns are complete-payment events from your TikTok
  pixel. If TikTok returns no purchase figures, those columns are empty and rules based on
  purchases, revenue, ROAS or cost per purchase skip TikTok campaigns instead of treating
  them as zero.
- Budget edits apply to campaigns with a daily campaign budget. Campaigns with a lifetime
  budget, or budgets set on ad groups, are shown but not changed.
- The Creatives screen lists TikTok ads by name, without previews.

## Connect a real Snapchat Ads account

The Connection screen can also read a Snapchat Ads account from the browser
(`js/snapchat.js`), alongside the other platforms. Snapchat's API accepts requests from web
pages, so no relay is needed.

1. In Snapchat Ads Manager, open Business Details and create an OAuth app. Add a redirect
   address and note the client ID and client secret.
2. Authorise the app with the `snapchat-marketing-api` scope and exchange the code it returns
   for a refresh token (Snapchat's Marketing API documentation walks through the two requests).
3. In the app, go to Connection, enter the client ID, client secret and refresh token, find
   your ad accounts, pick one and connect.

What to know:

- Snapchat access tokens last an hour. With the three values above, Kestrel renews the
  sign-in by itself. You can paste a one-hour access token instead, but it will stop working.
- The client secret and refresh token are kept in the browser with the connection, for the
  tab or on the device if "remember" is ticked.
- Clicks for Snapchat campaigns are swipe-ups. Purchases and revenue are purchase events from
  your Snap Pixel.
- Budget edits apply to campaigns with a campaign daily budget (Snapchat's minimum is 20 in
  the account's currency). Budgets set on ad sets are shown but not changed.
- Changing a Snapchat campaign means sending the whole campaign back to Snapchat with one
  field altered. Kestrel reads the current campaign first and changes only status or budget.
- The Creatives screen lists Snapchat ads by name, without previews.

## Connect a real Pinterest Ads account

The Connection screen can also read a Pinterest Ads account (`js/pinterest.js`), alongside the
other platforms.

1. In Pinterest Developers, create an app and ask for the ads scopes: `ads:read`, plus
   `ads:write` if Kestrel should pause campaigns or change budgets. Pinterest reviews new apps.
2. Generate an access token for your account from the app's page.
3. Set up the relay in [`relay/`](relay/README.md) and copy its address. The same relay serves
   TikTok and Pinterest.
4. In the app, go to Connection, enter the token and the relay address, find your ad
   accounts, pick one and connect.

What to know:

- Pinterest's API refuses requests sent from a web page, so the app reaches it through the
  relay. The scheduler below runs outside the browser and calls Pinterest directly.
- Access tokens last 30 days. Optionally add the app ID, app secret and a refresh token and
  Kestrel renews the sign-in by itself.
- Purchases and revenue for Pinterest campaigns are checkout events from your Pinterest tag.
- Budget edits apply to campaigns with a campaign daily spend cap. Lifetime budgets and
  budgets set on ad groups are shown but not changed.
- The Creatives screen lists Pinterest ads by name or Pin number, without previews.

## Results and cost per result

Not every account sells online. For lead, message and engagement campaigns there are no
purchases, so ROAS and cost per purchase are empty. Kestrel therefore also tracks **Results**
and **Cost per result**, which can be used in rules, reports and exports like any other metric.

- On **Meta**, a result is what each campaign is set up to get, as in Ads Manager: leads,
  messaging conversations, profile visits, purchases and so on. The campaign table names the
  result type under each campaign.
- On **Google Ads, TikTok, Snapchat and Pinterest**, a result is the same as a purchase or
  conversion for now.
- When none of the campaigns on screen report purchases, the Overview, Campaigns and
  Creatives screens switch to results automatically: Results and Cost per result replace
  Revenue, ROAS and Purchases.
- Rule templates for these accounts: "Pause expensive results", "Scale cheap results" and
  "Rising cost per result alert". Set the amounts to suit your own cost per result.
- If a campaign spent money but the platform gives no result figures for it (Meta does not
  report some messaging results, for example), Kestrel treats its results as unknown, not
  zero. Result-based rules skip it and the campaign table says so. A campaign that truly got
  no results in 60 days is treated the same way, so use a spend or click-rate rule for those.
- Totals that add up different result types (leads plus profile visits) are only a rough
  guide; the Overview says so when that happens.

## Alerts and notifications

A rule whose action is "send me an alert" changes nothing. It records which campaigns matched
and the numbers that triggered it, for example "CTR 0.52% over 3 days".

- **In the app**, alerts appear in the Activity log. With automatic runs switched on, the
  browser can also show a desktop notification when a run does something while the tab is in
  the background (it asks for permission the first time).
- **From the scheduler**, add a repository secret `KESTREL_WEBHOOK_URL` holding a Slack or
  Discord incoming-webhook address. A message is sent whenever a scheduled run changes a
  campaign, raises an alert, would change something in a dry run, or stops with an error such
  as an expired token. Runs where nothing happens send nothing.
- The message names campaigns in full, because a webhook is private. The public Actions log
  keeps hiding names unless `KESTREL_LOG_NAMES` is set.
- Alert rules send their alerts in dry-run mode as well, since an alert changes nothing.

## Safety

- **Read-only by default.** Each connected account starts read-only and is allowed to change
  on its own switch. On a live account every manual change asks for confirmation.
- **Undo.** The Activity screen has an Undo button next to each pause, restart and budget
  change, whether a rule or a person made it. Undo puts the campaign back as it was and is
  logged too. It is refused if the campaign has changed again since, so it never overwrites a
  newer change. Undo works from the browser that made the change; changes made by the
  scheduler are in the Actions log, not in the app's Activity screen.
- **Missing purchase tracking.** If an account spent money in the last 60 days but reports no
  purchases at all, Kestrel treats its purchase data as missing, not as zero. Rules based on
  purchases, revenue, ROAS or cost per purchase skip that account's campaigns, and the
  Connection and Automations screens say so. This check is per account: a single campaign
  with no purchases in an account that has some still counts as zero.

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
   - TikTok Ads: `TIKTOK_ACCESS_TOKEN` and `TIKTOK_ADVERTISER_ID`.
   - Snapchat Ads: `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`, `SNAPCHAT_REFRESH_TOKEN` and
     `SNAPCHAT_AD_ACCOUNT_ID`.
   - Pinterest Ads: `PINTEREST_ACCESS_TOKEN` and `PINTEREST_AD_ACCOUNT_ID`. The token lasts 30 days;
     replace the secret before it expires. To renew it automatically, add `PINTEREST_APP_ID`,
     `PINTEREST_APP_SECRET` and `PINTEREST_REFRESH_TOKEN` as well.
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
- To run it somewhere else, set the same environment variables and run
  `node automation/run.js` on any machine with Node 18 or later.

## Placeholders to replace before this is public

- The product name, pricing tiers and landing page copy are drafts.
