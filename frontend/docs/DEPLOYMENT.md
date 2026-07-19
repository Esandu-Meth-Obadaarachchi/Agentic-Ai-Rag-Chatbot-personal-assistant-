# Deployment

The app is hosted on **Netlify** as **Lune AI** at **https://luneai.site** (the `esa-ai-personal-assistant.netlify.app` subdomain still resolves). Manual deploys for now — no CI/CD. Firebase (Auth + Firestore) is the backend and is deployed separately with the Firebase CLI.

> Deploy flow used in practice: work merges into `develop`, then `develop` merges into `main`, then `netlify deploy --build --prod`. Rules ship separately (below). After adding a collection, deploy the rules or it 403s.

## The two things that deploy separately

| What | How | When |
|---|---|---|
| The app (Next.js) | `netlify deploy --build --prod` | after any code change you want live |
| Firestore rules | `firebase deploy --only firestore:rules` | after any change to `firestore.rules` |

**They are independent.** Netlify never touches Firestore rules. A new collection or a rule change is not live until you run the Firebase CLI, and until then that collection returns `Missing or insufficient permissions`.

## Netlify setup (already done)

- Site: `esa-ai-personal-assistant`, team `eobadaarachchi` ("Shona"). Linked via `.netlify/` (gitignored).
- `netlify.toml` declares the build command and `@netlify/plugin-nextjs`, which turns the App Router API routes into serverless functions and handles SSR. `NODE_VERSION = 20`.
- Env vars live on the Netlify site (Site settings -> Environment). They were imported from `.env.local` with `netlify env:import .env.local`, then the URL-based ones were repointed to the production domain:
  - `NEXT_PUBLIC_APP_URL = https://esa-ai-personal-assistant.netlify.app`
  - `GOOGLE_OAUTH_REDIRECT_URI = https://esa-ai-personal-assistant.netlify.app/api/calendar/callback`
  - `CALENDAR_WEBHOOK_URL = https://esa-ai-personal-assistant.netlify.app/api/calendar/webhook`
- `NEXT_PUBLIC_*` values are inlined at build time, so env changes need a rebuild (`--build`) to take effect.
- `CLAUDE_MODEL` sets the agent's generation model (default `claude-haiku-4-5`). Change it on the Netlify site and rebuild to move to Opus/Sonnet — no code change.

To redeploy: `netlify deploy --build --prod` from the repo root.

## Firebase setup for a new domain

Google sign-in only works from an authorised domain. When the hosting domain changes:

1. Add the domain to **Firebase Auth -> Settings -> Authorised domains** (Console), or programmatically via the Identity Platform Admin API (`identitytoolkit.googleapis.com/admin/v2/projects/{project}/config`, GET-merge-PATCH `authorizedDomains`) using the admin service account. `localhost` and `esa-ai-personal-assistant.netlify.app` are already authorised.
2. Redeploy the Firestore rules if any changed.

## Google Calendar on production (optional)

Calendar sync needs the production redirect URI registered on the OAuth client, which cannot be set with the admin key. In Google Cloud Console -> APIs & Services -> Credentials -> the OAuth client, add authorised redirect URI `https://esa-ai-personal-assistant.netlify.app/api/calendar/callback`. Everything else works without it.

## Gotchas learned the hard way

- **Firestore transport:** the client forces long-polling (`lib/firebase/client.ts`) and `reactStrictMode` is off — both to avoid a WebChannel watch-stream internal-assertion crash ("Unexpected state (ID: b815/ca9)") that the day planner and whiteboard listeners triggered.
- **Ad-blockers:** any client-hit route with `share` (or `ad`, `track`, `analytics`) in the path is silently blocked (`ERR_BLOCKED_BY_CLIENT`). The sharing endpoint is `/api/members` for this reason.
- **Not-yet-created docs:** a fresh page/whiteboard/dayPlan has no doc, so its read rule allows `resource == null && signedIn()` — otherwise the empty state 403s and the UI hangs on a spinner.
