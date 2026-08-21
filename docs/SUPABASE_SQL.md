# Supabase SQL — how we apply it

Schema changes and policies are applied from Cursor via the **Supabase MCP** connection (`.cursor/mcp.json`), scoped to project `jmorifdjtmmmobilhaxm`. You should not need to paste SQL in the Dashboard for routine work.

## First-time setup

1. Cursor Settings → **Tools & MCP**.
2. Find **supabase** and click **Connect** / **Authenticate**.
3. Log in to the Supabase org that owns this project.

After that, the agent can list tables, run SQL, and apply migrations from chat.

## Fallback (MCP unavailable)

If MCP is not connected, run SQL in the **Supabase Dashboard**:

1. Open your project in [Supabase](https://supabase.com/dashboard).
2. Go to **SQL** → **New query** (or **SQL Editor**).
3. Paste the snippet from the relevant doc (e.g. `SUPABASE_PROFILES_SESSION_ANGLERS.md`, `SUPABASE_CATCHES_SCHEMA.md`).
4. Run it; fix any errors (duplicate policy names, etc.).

When the agent cannot apply SQL itself, it should call that out with a short **ALL CAPS** line:

**RUN IN SUPABASE SQL EDITOR:** …

The same expectation is encoded for Cursor in **`.cursor/rules/supabase-sql-summary.mdc`**.

## Related docs

| Doc | Contents |
|-----|----------|
| `SUPABASE_AVATARS.sql` | Profile pictures: `profiles.avatar_url` + Storage bucket `avatars` |
| `SUPABASE_CATCHES_SCHEMA.md` | `catches` columns and examples |
| `SUPABASE_AUTH_RLS.md` | Auth / RLS notes (if present) |
| `docs/SUPABASE_SESSION_LOCATIONS_TARGETS.md` | Session locations, target species, `started_at`, GRANTs |
| `supabase/migrations/20260820120000_catches_handheld_prep.sql` | Catch `source`, `device_id`, `client_event_id`, salmon species CHECK |
| `supabase/migrations/20260821120000_session_metadata_owner_or_participant_rls.sql` | Session owner can write fishing spots / target species before roster exists |
