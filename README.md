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

## Connect Claude (MCP connector)

`api/mcp.js` is a small [Model Context Protocol](https://modelcontextprotocol.io)
server so Claude can read and write your scripts from a chat.

1. In Claude → **Settings → Connectors → Add custom connector**.
2. URL: `https://noxel-web.vercel.app/api/mcp?key=<NOXEL_MCP_TOKEN>`
   (the token is the Vercel env var `NOXEL_MCP_TOKEN`; drop `?key=…` if it's unset).
3. In any chat, ask Claude to *"create a Noxel script…"* or paste a share link and
   *"add a scene to this"*.

Tools: `create_script`, `get_script`, `append_scenes`, `replace_script`,
`set_title`, `add_note`. Content is [Fountain](https://fountain.io) by default
(`format: "action"` turns plain paragraphs into action lines).

Writes land straight in the Supabase row, so an open editor tab picks them up
live (or on next focus). Claude's edit can be lost if you're typing in the same
script at that exact moment — last write wins.

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
| `api/db.js` | same-origin REST proxy to Supabase (defeats ad-blockers / filters) |
| `api/mcp.js` | MCP server — lets Claude create/read/edit scripts as a connector |
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
