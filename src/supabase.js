// Noxel Studio — Supabase data layer (no accounts)
// Each project is one row keyed by an unguessable UUID = the share link.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "https://rdtvejebscvggfoqwjqx.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_GEs52kcMUf4F5Tvq-xz84g_RkW3mEkP";
const SB_HOST = new URL(url).host;

// Route every REST/Auth call through our own /api/db proxy (same origin), so
// DNS filters, ad-blockers and corporate proxies can't stop it. WebSocket
// (realtime) still connects directly and simply stays quiet if blocked.
function proxyFetch(input, init) {
  let u = typeof input === "string" ? input : (input && input.url) || "";
  const cut = u.indexOf(SB_HOST);
  if (cut >= 0) {
    const path = u.slice(cut + SB_HOST.length);           // "/rest/v1/projects?..."
    if (path.startsWith("/rest/") || path.startsWith("/auth/")) {
      return fetch("/api/db" + path, init);               // plain path, no encoding
    }
  }
  return fetch(input, init);
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: { fetch: proxyFetch }
});

// A per-browser tag so we can ignore the echo of our own writes.
export const clientTag = (() => {
  try {
    let t = localStorage.getItem("noxel.web.tag");
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("noxel.web.tag", t); }
    return t;
  } catch (e) { return Math.random().toString(36).slice(2); }
})();

export async function loadProject(id) {
  const { data, error } = await supabase
    .from("projects").select("id, title, data, updated_at").eq("id", id).maybeSingle();
  if (error) throw error;
  return data; // null if not found
}

// Preflight the connection so the UI can show a specific message.
// Returns: "ok" | "no_table" | "blocked:<detail>" | "db:<detail>"
export async function preflight() {
  try {
    const { error } = await supabase.from("projects").select("id").limit(1);
    if (!error) return "ok";
    const m = String(error.message || "");
    if (/does not exist|could not find the table|schema cache/i.test(m)) return "no_table";
    if (/failed to fetch|load failed|networkerror|502|upstream/i.test(m)) return "blocked:" + m;
    return "db:" + m;
  } catch (e) {
    return "blocked:" + (e && e.message ? e.message : "request failed");
  }
}

export async function createProject(projectObj) {
  const { data, error } = await supabase
    .from("projects")
    .insert({ title: projectObj.title || "Untitled", data: projectObj })
    .select("id").single();
  if (error) throw error;
  return data.id;
}

export async function saveProject(id, projectObj) {
  const { error } = await supabase
    .from("projects")
    .update({
      title: projectObj.title || "Untitled",
      data: projectObj,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
  if (error) throw error;
}

export function subscribeProject(id, onChange) {
  const ch = supabase
    .channel("project:" + id)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "projects", filter: "id=eq." + id },
      (payload) => onChange(payload.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// Ephemeral presence over a per-project Realtime channel — no auth needed.
export function joinPresence(id, me, onPeers) {
  let current = Object.assign({}, me);
  const ch = supabase.channel("presence:" + id, { config: { presence: { key: me.id } } });
  ch.on("presence", { event: "sync" }, () => {
    onPeers(Object.values(ch.presenceState()).flat());
  });
  const track = () => ch.track(current).catch(() => {});
  ch.subscribe((status) => { if (status === "SUBSCRIBED") track(); });
  const hb = setInterval(track, 15000);              // keep the entry alive across reconnects
  window.addEventListener("beforeunload", () => { try { supabase.removeChannel(ch); } catch (e) {} });
  return {
    update: (patch) => { current = Object.assign({}, current, patch); return track(); },
    leave: () => { clearInterval(hb); return supabase.removeChannel(ch); }
  };
}
