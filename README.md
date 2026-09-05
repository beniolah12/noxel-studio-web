# Noxel Studio — Cloud (Supabase shell)

The single-file artifact (`../noxel-studio/index.html`) already does cloud sync,
live presence and comments through Claude's built-in `db` / `room` capabilities.
The **one** thing it can't do is share a project **publicly** or with **accounts
outside your organisation** — that store is org-internal by design.

This folder is the shell that adds exactly that: Supabase auth, a project
dashboard, email invites, public share links, plus a drop-in data layer
(`src/supabase.js`) that mirrors every operation the editor needs.

## What's included

`npm install && npm run dev`:

- **Magic-link sign-in** (no passwords)
- **Dashboard** (`index.html`) — list / create / delete scripts, all in Supabase
- **Share dialog** — public link + invite collaborators by email (editor /
  viewer). Invites for people without an account are auto-claimed on signup
  (`claim_invites()` trigger).
- **Editor** (`editor.html?id=<uuid>`) — the full Noxel Studio editor (Write,
  Breakdown, Shots, Schedule, Budget, PDF export, Fountain) with storage,
  scene comments and live presence wired to Supabase through the `NoxelHost`
  bridge in `public/app.js`. Realtime: another collaborator's save reloads the
  project in place; presence shows who's editing which scene.
- **`src/supabase.js`** — the data API: `loadProject`, `saveProject`,
  `subscribeProject`, `joinPresence`, sharing + comments helpers.

## Architecture

`public/app.js` is the editor logic, lifted verbatim from the standalone
artifact. It runs on browser `localStorage` by default; when a page sets
`window.NoxelHost` before loading it, `load` / `save` / comments / presence
route through that object instead. `editor.html`'s module does exactly that:
fetches the project from Supabase, sets `NoxelHost`, then injects `app.js`.
Comments ride along inside the project JSON (`data._comments`) so they sync
with every save — no separate table wiring needed (the `comments` table in
the schema is reserved for a future dedicated thread view).

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL editor → New query →** paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. **Authentication → Providers →** enable **Email** (magic link is on by default).
   Under **URL Configuration** set **Site URL** to your deployed origin and add
   both `http://localhost:5273/**` and `https://<your-app>.vercel.app/**` to
   **Redirect URLs** (the `/**` matters — the magic link must be allowed to
   land on `/editor.html`).
4. `cp .env.example .env.local` and fill `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**.
5. `npm install && npm run dev`.

## Keeping `public/app.js` in sync with the artifact

`public/app.js` is the JS block extracted from the standalone editor. If you
change the editor there, re-extract:

```sh
# from the artifact index.html, take everything between <script> and </script>
```

The editor's `NoxelHost` hooks are already in that source (dormant unless a host
sets `window.NoxelHost`), so no post-processing is needed.

## Data model

| table | purpose |
|---|---|
| `projects` | one row per script; `data` jsonb = the editor's project object |
| `project_collaborators` | granted access (`viewer` / `editor`) |
| `project_invites` | pending email invites, claimed on signup |
| `comments` | scene comment threads |

RLS: owners full access; editors read+write `data` and add comments; viewers
read-only. Realtime is enabled on `projects` and `comments`.

## Deploy

Any static host (Vercel / Netlify / Cloudflare Pages). Set the two `VITE_`
env vars, add the deployed origin to Supabase redirect URLs, `npm run build`,
serve `dist/`.
