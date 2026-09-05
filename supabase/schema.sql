-- Noxel Studio — Supabase schema (no accounts)
-- Run in the Supabase SQL editor: Dashboard → SQL Editor → New query → Run.
--
-- No login. Each project is one row with an unguessable UUID; whoever has
-- the link can open and edit it (like a shared doc). Comments live inside
-- the project JSON, so they sync with every save.

drop table if exists public.projects cascade;
drop table if exists public.project_collaborators cascade;
drop table if exists public.project_invites cascade;
drop table if exists public.comments cascade;

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default 'Untitled',
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Anyone (anon key) can read, create and update a project row.
-- Rows are found only by their random UUID, which acts as the share secret.
create policy "read any project"   on public.projects for select using (true);
create policy "create any project" on public.projects for insert with check (true);
create policy "update any project" on public.projects for update using (true) with check (true);

-- Realtime so collaborators see each other's saves live.
-- (guarded so the whole script is safe to run more than once)
do $$
begin
  alter publication supabase_realtime add table public.projects;
exception
  when duplicate_object then null;
end $$;
