-- Noxel Studio — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- It creates the storage for cloud projects + public/external sharing,
-- which is the one thing the artifact's built-in `db` capability can't do
-- (that store is organisation-internal only).

-- ─────────────────────────────────────────────────────────────
-- 1. Projects: one row per screenplay project. `data` holds the
--    exact same JSON object the single-file app keeps in localStorage
--    for that project (blocks, breakdown, shots, days, budget, …).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Untitled',
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

create index if not exists projects_owner_idx on public.projects (owner);

-- ─────────────────────────────────────────────────────────────
-- 2. Collaborators: grant another account access to a project.
--    role: 'viewer' (read-only) | 'editor' (read + write).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_collaborators (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'editor' check (role in ('viewer', 'editor')),
  invited_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Pending invites by email (the invitee may not have an account yet).
create table if not exists public.project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  email       text not null,
  role        text not null default 'editor' check (role in ('viewer', 'editor')),
  invited_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (project_id, email)
);

-- ─────────────────────────────────────────────────────────────
-- 3. Scene comments (mirrors the artifact's `comments/<projectId>` doc).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  scene_id    text not null,
  author      uuid references auth.users (id),
  author_name text,
  body        text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists comments_project_idx on public.comments (project_id);

-- ─────────────────────────────────────────────────────────────
-- 4. Helper: does the current user have access to a project?
-- ─────────────────────────────────────────────────────────────
create or replace function public.has_project_access(pid uuid, min_role text default 'viewer')
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1 from public.project_collaborators c
    where c.project_id = pid
      and c.user_id = auth.uid()
      and (min_role = 'viewer' or c.role = 'editor')
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. Row-level security
-- ─────────────────────────────────────────────────────────────
alter table public.projects              enable row level security;
alter table public.project_collaborators enable row level security;
alter table public.project_invites       enable row level security;
alter table public.comments              enable row level security;

-- projects
create policy "read own or shared projects" on public.projects
  for select using (has_project_access(id, 'viewer'));
create policy "insert own projects" on public.projects
  for insert with check (owner = auth.uid());
create policy "update own or editor projects" on public.projects
  for update using (has_project_access(id, 'editor'));
create policy "delete own projects" on public.projects
  for delete using (owner = auth.uid());

-- collaborators: owner manages, everyone on the project can see the list
create policy "see collaborators of accessible projects" on public.project_collaborators
  for select using (has_project_access(project_id, 'viewer'));
create policy "owner manages collaborators" on public.project_collaborators
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid()));

-- invites: owner manages
create policy "owner manages invites" on public.project_invites
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid()));

-- comments: anyone with project access reads; editors write; author or owner edits/deletes
create policy "read comments of accessible projects" on public.comments
  for select using (has_project_access(project_id, 'viewer'));
create policy "editors add comments" on public.comments
  for insert with check (has_project_access(project_id, 'editor'));
create policy "author or owner updates comments" on public.comments
  for update using (
    author = auth.uid()
    or exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );
create policy "author or owner deletes comments" on public.comments
  for delete using (
    author = auth.uid()
    or exists (select 1 from public.projects p where p.id = project_id and p.owner = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- 6. Realtime: broadcast row changes to subscribed clients
-- ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.comments;

-- ─────────────────────────────────────────────────────────────
-- 7. When a new user signs up, auto-accept any invites for their email
-- ─────────────────────────────────────────────────────────────
create or replace function public.claim_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_collaborators (project_id, user_id, role, invited_by)
  select i.project_id, new.id, i.role, i.invited_by
  from public.project_invites i
  where lower(i.email) = lower(new.email)
  on conflict do nothing;

  delete from public.project_invites where lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_claim_invites on auth.users;
create trigger on_auth_user_created_claim_invites
  after insert on auth.users
  for each row execute function public.claim_invites();
