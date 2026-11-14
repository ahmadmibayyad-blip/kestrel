# Kestrel relay

The TikTok and Pinterest ad APIs refuse requests that come from a web page, so the Kestrel app
cannot call them from the browser. This relay is a small server that passes the app's requests
on to them. Meta, Google Ads and Snapchat do not need it, and neither does the scheduler in
`automation/`.

It forwards only to those two APIs, stores nothing and logs no tokens. One relay serves both
platforms: use the same address in the TikTok and Pinterest panels.

## Host it on Apify

1. In Apify Console, go to Actors → Development → Create new, and choose to link a Git
   repository.
2. Set the Git URL to this repository followed by `#main:relay`, for example
   `https://github.com/ahmadmibayyad-blip/kestrel#main:relay`.
3. Build the Actor. In its Settings, check that the Server section shows the server
   interface as enabled (the Actor's `actor.json` turns it on).
4. Copy the Actor's server URL from its Server tab. It looks like
   `https://<your-username>--kestrel-relay.apify.actor`.
5. In Apify Console → Settings → API & Integrations, create an API token.
6. In Kestrel's Connection screen, paste the relay address with the token added, like this:
   `https://<your-username>--kestrel-relay.apify.actor?token=<your Apify token>`

What to know:

- The relay address contains your Apify token, so treat it like a password. Kestrel keeps
  it in your browser with each connection that uses it.
- Your TikTok and Pinterest tokens pass through the relay on their way to those platforms.
  Host your own; do not point Kestrel at a relay someone else runs.
- Apify starts the relay when a request arrives and stops it after it has been idle, so the
  first request after a pause takes a few seconds. Running time counts against your Apify
  usage.
- To allow only your own pages to use the relay, add an environment variable
  `KESTREL_ALLOWED_ORIGINS` to the Actor, for example
  `https://ahmadmibayyad-blip.github.io,http://localhost:8000`.
- After the relay code changes in the repository, rebuild the Actor to pick it up.

## Run it yourself

```bash
node relay/server.js
```

It listens on port 8787 (set `PORT` to change it). Use `http://localhost:8787` as the relay
address when you open Kestrel from the same computer. Any host that runs Node 18 or later
works the same way.
