# Kestrel

A prototype of an ad automation product: a marketing page plus a working demo app.
Static HTML, CSS and JavaScript with no build step and no dependencies.

- `index.html` is the landing page, with a live rule demo in the hero.
- `app.html` is the demo app: overview, campaigns (bulk edits), automations (rule builder
  with preview), creatives, reports (CSV export) and an activity log.

All numbers are sample data generated in the browser by `js/data.js`. Nothing connects to a
real ad account. Changes you make in the demo are kept in that browser's local storage;
"Reset the demo data" on the Activity screen clears them.

## Run it

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/ or open `index.html` directly.

## Placeholders to replace before this is public

- The product name, pricing tiers and landing page copy are drafts.
- "Connect your ad accounts" describes the intended product. The prototype has no
  integration with Meta, Google or TikTok yet.
