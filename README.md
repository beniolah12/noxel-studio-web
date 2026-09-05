# Noxel Studio — Cloud (no accounts)

The standalone artifact already does everything offline. This is the version
with **shareable cloud links**: open it, get a URL, send that URL to anyone —
they open the same script and edit it live, like a shared doc. No sign-up,
no email, no passwords.

- **Live:** https://noxel-web.vercel.app
- Each script is one row in Supabase, keyed by an unguessable UUID.
  That UUID *is* the share secret — whoever has `/?p=<uuid>` can edit.
- Comments live inside the project JSON, so they sync on every save.
- Presence (who's editing which scene, live cursors) rides a Supabase
  Realtime channel keyed by the project id.

## Setup — one step

1. Supabase → **SQL Editor → New query** → paste [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   (It drops the old auth tables and creates one `projects` table with open
   access.)
2. Reload https://noxel-web.vercel.app — done.

The Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are already set.

## Local dev

```sh
cp .env.example .env.local   # fill in URL + publishable key
npm install && npm run dev
```

## Layout

| file | what |
|---|---|
| `index.html` | the editor page (markup + styles lifted from the artifact) |
| `public/app.js` | the editor logic, verbatim from the artifact's `<script>` |
| `src/adapter.js` | wires `app.js` to Supabase via the `window.NoxelHost` bridge |
| `src/supabase.js` | `loadProject` / `createProject` / `saveProject` / `subscribeProject` / `joinPresence` |
| `supabase/schema.sql` | the one `projects` table + open RLS + realtime |

`public/app.js` is a copy — if you change the editor in the artifact, re-copy
the `<script>` body over it. Its `NoxelHost` hooks are already in that source
and stay dormant in the standalone artifact.

## Note on the open-access model

Anyone with a project's UUID can read and write that row. UUIDs are random and
never listed anywhere, so in practice a script is private until you share its
link — same trust model as an unlisted document link. If you later want real
accounts and per-user permissions, the git history has the auth version
(`project_collaborators`, RLS by `auth.uid()`).
