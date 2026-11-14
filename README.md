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
- Rules run when you press Run while the page is open. Running on a schedule needs a server.
- Tokens from Meta's Graph API Explorer expire after an hour or two. A long-lived or system
  user token lasts longer.
- Requests use Meta's default API version. Set `K.meta.version` in `js/meta.js` to pin one.
- Google and TikTok are sample data only.

## Placeholders to replace before this is public

- The product name, pricing tiers and landing page copy are drafts.
