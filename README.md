# Fashion Nails & Spa VIP — Review Intelligence Dashboard

Self-refreshing monthly review dashboard. Apify pulls reviews monthly, a webhook
ingests them into a Google Sheet, Claude labels sentiment/staff mentions and writes
a monthly narrative, and a password-protected dashboard (Cloudflare Pages) reads
the Sheet to render the page. See the full spec for architecture and rules.

Stack: Cloudflare Pages + Pages Functions (TypeScript), googleapis, @anthropic-ai/sdk,
Resend for alert emails, Vitest for tests. No database — the Sheet is the only store.

## Local dev prerequisites

- Node.js **22+** (Wrangler, Vitest, and `npm install` itself all require it — installing
  with an older Node silently skips native optional deps and breaks things later).
  If your default `node` is older, install a second version via Homebrew without
  touching your default: `brew install node@22` (it installs keg-only, so nothing
  else on your machine changes), then prefix every command below with
  `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
- `PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm install`

## Manual setup (Paul — this can't be automated)

1. **Google Cloud service account**
   - In Google Cloud Console, create a project (or reuse one) and enable the
     Google Sheets API.
   - Create a service account, create a JSON key for it, download it.
   - Base64-encode the whole key file and put it in `GOOGLE_SERVICE_ACCOUNT_JSON`
     (local: `.dev.vars`; production: a Cloudflare Pages secret — see below).
     `base64 -i service-account.json | tr -d '\n'`

2. **Google Sheet**
   - Create a new Sheet. Copy its ID from the URL into `SHEET_ID`.
   - Add tabs exactly named: `reviews`, `labels`, `roster`, `unmatched_names`,
     `monthly_analysis`. Put the header row in each (see spec for columns).
   - Share the Sheet with the service account's `client_email` (from the JSON key),
     with Editor access — ingest needs to write, not just read.

3. **Apify**
   - Get an API token from Apify and put it in `APIFY_TOKEN`.
   - Set `PLACE_URL` to the salon's Google Maps URL.
   - `APIFY_ACTOR_ID` is pre-filled with a guess (`compass~google-maps-reviews-scraper`);
     Block 1 confirms this is the right actor.

4. **Anthropic**
   - Get an API key, put it in `ANTHROPIC_API_KEY`.

5. **Resend**
   - Get an API key, put it in `ALERT_EMAIL_API_KEY`. Set `ALERT_EMAIL_TO` to
     Paul's email.

6. **Secrets you make up yourself**
   - `INGEST_SECRET` — any long random string; shared between Apify's webhook and
     `/api/ingest`.
   - `DASHBOARD_PASSWORD` — the password for viewing the dashboard.

Copy `.env.example` to a local reference and fill in real values. For **local dev**,
Wrangler reads secrets from a `.dev.vars` file (gitignored, same `KEY=value` format,
never commit it). For **production**, set each one with
`wrangler pages secret put <NAME>` (or the Cloudflare dashboard) — `wrangler.toml`
is public (it's committed), so secrets never go there.

## Running locally

```
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npx wrangler pages dev public
```

Then `curl localhost:8788/api/health` — it should return the roster tab's rows.

## Pulling reviews

```
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run pull
```

Runs the Apify actor, waits for it to finish, fetches every review, and upserts them
into the `reviews` tab (keyed by `review_id`; edited reviews are detected by a
changed `text_hash`; no row is ever deleted). Reads credentials from `.dev.vars`.

## Tests

```
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm test
```

## Layout

- `public/` — static dashboard, served as-is by Cloudflare Pages (data-driven as of Block 4)
- `functions/api/` — Pages Functions, one file per `/api/*` route
- `lib/` — shared backend code (Sheets client, metrics, etc.)
- `scripts/` — one-off/local scripts (pull, backfill, spot-check)
- `reference/index.original.html` — the original hardcoded dashboard, kept only as a design reference
