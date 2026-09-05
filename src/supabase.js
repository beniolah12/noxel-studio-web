// Noxel Studio — Supabase data layer
// This is the seam the single-file editor plugs into. It exposes the same
// operations the artifact's `db`/`room` capabilities gave it, but backed by
// Supabase so projects can be shared publicly and with external accounts.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local");
}

export const supabase = createClient(url || "http://localhost", key || "anon", {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ─────────────── auth ─────────────── */
export async function signInWithEmail(email, redirectTo) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.origin }
  });
}
export async function signUpWithPassword(email, password, redirectTo) {
  return supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: redirectTo || window.location.origin }
  });
}
export async function signInWithPassword(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
export async function signInWithGitHub(redirectTo) {
  return supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: redirectTo || window.location.origin }
  });
}
export async function signOut() { return supabase.auth.signOut(); }
export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session?.user || null));
}

/* ─────────────── projects ─────────────── */
// List every project the signed-in user owns or collaborates on.
export async function listProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, updated_at, owner")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Load one project's full JSON payload (the object the editor renders from).
export async function loadProject(id) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, data, updated_at, updated_by, owner")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

// Create a project from the editor's in-memory project object.
export async function createProject(projectObj) {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner: u.user.id,
      title: projectObj.title || "Untitled",
      data: projectObj,
      updated_by: u.user.id
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// Save (debounce this in the editor — 1 write / second is plenty).
export async function saveProject(id, projectObj) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("projects")
    .update({
      title: projectObj.title || "Untitled",
      data: projectObj,
      updated_at: new Date().toISOString(),
      updated_by: u.user?.id
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

// Live updates: fires whenever another collaborator saves this project.
// Returns an unsubscribe function.
export function subscribeProject(id, onChange) {
  const ch = supabase
    .channel("project:" + id)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "projects", filter: "id=eq." + id },
      (payload) => onChange(payload.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/* ─────────────── sharing ─────────────── */
// Invite by email. If the person already has an account they get access
// immediately; otherwise the invite is claimed automatically on signup
// (see claim_invites() trigger in schema.sql).
export async function shareProject(projectId, email, role = "editor") {
  const { data: existing } = await supabase
    .from("profiles_lookup") // optional view; falls back to invite
    .select("id")
    .eq("email", email)
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));

  if (existing?.id) {
    const { error } = await supabase
      .from("project_collaborators")
      .upsert({ project_id: projectId, user_id: existing.id, role });
    if (error) throw error;
    return { status: "added" };
  }
  const { error } = await supabase
    .from("project_invites")
    .upsert({ project_id: projectId, email: email.toLowerCase(), role });
  if (error) throw error;
  return { status: "invited" };
}

export async function listCollaborators(projectId) {
  const [{ data: collabs }, { data: invites }] = await Promise.all([
    supabase.from("project_collaborators").select("user_id, role").eq("project_id", projectId),
    supabase.from("project_invites").select("email, role").eq("project_id", projectId)
  ]);
  return { collaborators: collabs || [], invites: invites || [] };
}

export async function removeCollaborator(projectId, userId) {
  const { error } = await supabase
    .from("project_collaborators")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw error;
}

/* ─────────────── comments ─────────────── */
export async function listComments(projectId) {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw error;
  return data;
}
export async function addComment(projectId, sceneId, body, authorName) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("comments").insert({
    project_id: projectId, scene_id: sceneId, body,
    author: u.user?.id, author_name: authorName
  });
  if (error) throw error;
}
export async function setCommentResolved(id, resolved) {
  const { error } = await supabase.from("comments").update({ resolved }).eq("id", id);
  if (error) throw error;
}
export function subscribeComments(projectId, onChange) {
  const ch = supabase
    .channel("comments:" + projectId)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "comments", filter: "project_id=eq." + projectId },
      () => onChange())
    .subscribe();
  return () => supabase.removeChannel(ch);
}

/* ─────────────── presence (replaces the `room` capability) ─────────────── */
// Broadcast-based presence over a per-project Supabase Realtime channel.
export function joinPresence(projectId, me, onPeers) {
  const ch = supabase.channel("presence:" + projectId, {
    config: { presence: { key: me.id } }
  });
  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState();
    const peers = Object.values(state).flat();
    onPeers(peers);
  });
  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") await ch.track(me);
  });
  return {
    update: (patch) => ch.track({ ...me, ...patch }),
    leave: () => supabase.removeChannel(ch)
  };
}
