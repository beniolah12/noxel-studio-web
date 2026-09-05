# Noxel Studio — Cloud (Supabase shell)

The single-file artifact (`../noxel-studio/index.html`) already does cloud sync,
live presence and comments through Claude's built-in `db` / `room` capabilities.
The **one** thing it can't do is share a project **publicly** or with **accounts
outside your organisation** — that store is org-internal by design.

This folder is the shell that adds exactly that: Supabase auth, a project
dashboard, email invites, public share links, plus a drop-in data layer
(`src/supabase.js`) that mirrors every operation the editor needs.

## What works out of the box

`npm install && npm run dev` gives you:

- **Magic-link sign-in** (no passwords)
- **Dashboard** — list / create / delete your scripts, all stored in Supabase
- **Share dialog** — public read-only link + invite collaborators by email
  (editor / viewer). Invites for people without an account yet are auto-claimed
  when they sign up (`claim_invites()` trigger).
- **`src/supabase.js`** — the full data API the editor calls:
  `loadProject`, `saveProject`, `subscribeProject` (realtime),
  `listComments` / `addComment` / `subscribeComments`,
  `joinPresence` (replaces the `room` capability).

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL editor → New query →** paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. **Authentication → Providers →** enable **Email** (magic link is on by default).
   Add your dev URL (`http://localhost:5273`) under **URL Configuration →
   Redirect URLs**.
4. `cp .env.example .env.local` and fill `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**.
5. `npm install && npm run dev`.

## Wiring the editor view (the remaining step)

`editor.html?id=<projectId>` should load the existing single-file app and swap
its storage. The app keeps everything in three seams — override them and nothing
else changes:

```js
// editor.html — after the app's <script> has defined its globals
import { loadProject, saveProject, subscribeProject } from "/src/supabase.js";

const id = new URLSearchParams(location.search).get("id");

// 1. initial load: replace the body of load() (which reads localStorage)
const row = await loadProject(id);
window.__seedLibrary = { projects: [row.data], currentId: row.data.id };

// 2. persistence: in save(), the `write` closure calls
//    localStorage.setItem(STORE, JSON.stringify(data)).
//    Add:  saveProject(id, data.projects[0]);   // debounced ~1s

// 3. realtime: in boot(), after render, add
subscribeProject(id, (fresh) => {
  if (fresh.updated_by === myUserId) return;      // ignore own echo
  data.projects[0] = fresh.data; cur = data.projects[0]; boot();
});
```

The app's JSON project object is already the exact shape stored in
`projects.data` (see `blankProject()` in `src/main.js`), so no transform is
needed. Comments and presence map the same way:
`comments/<projectId>` doc → `comments` table; `room.presence()` →
`joinPresence()`.

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
