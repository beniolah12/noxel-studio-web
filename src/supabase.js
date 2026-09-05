// Noxel Studio — Supabase data layer (no accounts)
// Each project is one row keyed by an unguessable UUID = the share link.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) console.warn("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");

export const supabase = createClient(url || "http://localhost", key || "anon", {
  auth: { persistSession: false }
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
// Returns one of: "ok" | "no_table"
//   | "blocked:<detail>"  (network/CORS/extension — the browser couldn't complete the request)
//   | "db:<detail>"       (reached the database, but it complained)
export async function preflight() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // 1. Can we even reach the REST endpoint with a raw fetch?
  let rawStatus = 0, rawErr = "";
  try {
    const r = await fetch(url + "/rest/v1/projects?select=id&limit=1", { headers: { apikey: key, Authorization: "Bearer " + key } });
    rawStatus = r.status;
    if (r.status === 200) {
      const body = await r.json().catch(() => null);
      if (Array.isArray(body)) return "ok";
    }
    const txt = await r.text().catch(() => "");
    if (/does not exist|could not find the table|schema cache/i.test(txt)) return "no_table";
    if (r.status === 401 || /invalid.*key|api key/i.test(txt)) return "db:API key rejected (status " + r.status + "). The VITE_SUPABASE_ANON_KEY may be wrong.";
    rawErr = "HTTP " + r.status + " " + txt.slice(0, 140);
  } catch (e) {
    return "blocked:" + (e && e.message ? e.message : "fetch failed") + " — a browser extension, VPN, proxy, or DNS filter is stopping the request to " + new URL(url).host + ".";
  }

  // 2. Raw fetch got through but not a clean 200 — fall back to the SDK for its error text
  try {
    const { error } = await supabase.from("projects").select("id").limit(1);
    if (!error) return "ok";
    const m = String(error.message || "");
    if (/does not exist|could not find the table|schema cache/i.test(m)) return "no_table";
    return "db:" + m + (rawErr ? "  (" + rawErr + ")" : "");
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
