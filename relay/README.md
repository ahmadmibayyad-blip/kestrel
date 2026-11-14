# Kestrel TikTok relay

TikTok's Marketing API refuses requests that come from a web page, so the Kestrel app cannot
call it from the browser. This relay is a small server that passes the app's requests on to
TikTok. Meta and Google Ads do not need it, and neither does the scheduler in `automation/`.

It forwards only to TikTok's Marketing API, stores nothing and logs no tokens.

## Host it on Apify

1. In Apify Console, go to Actors → Development → Create new, and choose to link a Git
   repository.
2. Set the Git URL to this repository followed by `#main:relay`, for example
   `https://github.com/ahmadmibayyad-blip/kestrel#main:relay`.
3. Build the Actor. In its Settings, check that the Server section shows the server
   interface as enabled (the Actor's `actor.json` turns it on).
4. Copy the Actor's server URL from its Server tab. It looks like
   `https://<your-username>--kestrel-tiktok-relay.apify.actor`.
5. In Apify Console → Settings → API & Integrations, create an API token.
6. In Kestrel's Connection screen, paste the relay address with the token added, like this:
   `https://<your-username>--kestrel-tiktok-relay.apify.actor?token=<your Apify token>`

What to know:

- The relay address contains your Apify token, so treat it like a password. Kestrel keeps
  it in your browser with the TikTok connection.
- Apify starts the relay when a request arrives and stops it after it has been idle, so the
  first request after a pause takes a few seconds. Running time counts against your Apify
  usage.
- To allow only your own pages to use the relay, add an environment variable
  `KESTREL_ALLOWED_ORIGINS` to the Actor, for example
  `https://ahmadmibayyad-blip.github.io,http://localhost:8000`.

## Run it yourself

```bash
node relay/server.js
```

It listens on port 8787 (set `PORT` to change it). Use `http://localhost:8787` as the relay
address when you open Kestrel from the same computer. Any host that runs Node 18 or later
works the same way.
