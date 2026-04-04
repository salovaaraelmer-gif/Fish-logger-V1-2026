# Supabase SQL — how we document it

Schema changes and policies are **not** applied automatically from this repo. You run SQL in the **Supabase Dashboard** (usually **SQL Editor**).

## Where to run

1. Open your project in [Supabase](https://supabase.com/dashboard).
2. Go to **SQL** → **New query** (or **SQL Editor**).
3. Paste the snippet from the relevant doc (e.g. `SUPABASE_PROFILES_SESSION_ANGLERS.md`, `SUPABASE_CATCHES_SCHEMA.md`).
4. Run it; fix any errors (duplicate policy names, etc.).

## AI / Cursor summaries

When a coding assistant tells you to run SQL, it should call that out **very clearly** in the task summary using a short **ALL CAPS** line, for example:

**RUN IN SUPABASE SQL EDITOR:** …

That line points you to the exact file/section or the snippet to paste. The rest of the summary stays normal text.

The same expectation is encoded for Cursor in **`.cursor/rules/supabase-sql-summary.mdc`** so agents keep the habit.

## Related docs

| Doc | Contents |
|-----|----------|
| `SUPABASE_PROFILES_SESSION_ANGLERS.md` | `profiles`, `session_anglers`, RLS including search policy |
| `SUPABASE_CATCHES_SCHEMA.md` | `catches` columns and examples |
| `SUPABASE_AUTH_RLS.md` | Auth / RLS notes (if present) |
