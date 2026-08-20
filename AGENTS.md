# Agent notes

## Cursor Cloud specific instructions

### Product
AnglrLog is a static HTML/CSS/JS fishing catch log (no build step). Core flow: sign in → start a session with anglers → log catches. Local data lives in IndexedDB; auth and cloud sync use hosted Supabase (`js/supabase.js`).

### Run
- Dev server: `npm start` (serves the repo on **http://localhost:5050** via `npx serve`). Do **not** open `index.html` as `file://` — ES modules will not load.
- There is no separate backend process. Supabase Auth + API are remote; network access to `*.supabase.co`, `esm.sh`, and (for maps) Leaflet CDNs is required for a full UI session.

### Lint / test / build
- No ESLint, unit-test, or bundler scripts are defined in `package.json`. Validation is manual against the running static server.
- Dependency refresh: `npm install` (lockfile has no runtime deps; `serve` is pulled via `npx` on start).

### Auth gotcha
- The UI is behind `#auth-gate` until Supabase email/password sign-in succeeds. Signup currently depends on Supabase sending a confirmation email (`mailer_autoconfirm` is off); if confirmation email fails, use an existing confirmed test account.
- Schema/SQL changes: prefer Supabase MCP when connected (see `docs/SUPABASE_SQL.md`); do not paste SQL in the Dashboard unless MCP is unavailable.
