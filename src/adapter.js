import { loadProject, createProject, saveProject, subscribeProject, joinPresence, clientTag, schemaReady } from "/src/supabase.js";

const qs = new URLSearchParams(location.search);
let pid = qs.get("p");

const RECENT = "noxel.web.recent";
function recent() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (e) { return []; } }
function remember(id, title) {
  const list = recent().filter((r) => r.id !== id);
  list.unshift({ id, title: title || "Untitled" });
  try { localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 20))); localStorage.setItem("noxel.web.last", id); } catch (e) {}
}
function blank() {
  const u = () => Math.random().toString(36).slice(2, 9);
  return { id: u(), title: "UNTITLED", author: "Written by\nYour Name", contact: "", updated: Date.now(),
    blocks: [{ id: u(), type: "scene", text: "" }],
    breakdown: null, shots: {}, days: [], dayOf: {}, callsheets: {}, budget: [], stripOrder: {}, _comments: [] };
}

let api = null, comments = [], lastJson = "", saveT = null, pres = null, saving = false;

function scheduleSave() {
  clearTimeout(saveT);
  document.getElementById("__savest") && (document.getElementById("__savest").textContent = "saving…");
  saveT = setTimeout(async () => {
    if (!api) return;
    const d = api.currentLibrary();
    const proj = Object.assign({}, d.projects[0], { _comments: comments });
    lastJson = JSON.stringify(proj);
    saving = true;
    try { await saveProject(pid, proj); remember(pid, proj.title); }
    catch (e) { console.warn("save failed", e); }
    saving = false;
    const s = document.getElementById("__savest"); if (s) s.textContent = "saved to cloud";
  }, 900);
}

function bar() {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:80;display:flex;gap:10px;align-items:center;padding:6px 14px;background:var(--page);border-top:1px solid var(--rule);font:11px/1 'IBM Plex Mono',monospace;color:var(--muted)";
  const list = recent();
  const opts = list.map((r) => `<option value="${r.id}"${r.id === pid ? " selected" : ""}>${(r.title || "Untitled").replace(/</g, "")}</option>`).join("");
  wrap.innerHTML = `
    <select id="__recent" style="font:inherit;background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:4px 6px;color:var(--ink);max-width:200px">${opts || '<option>this script</option>'}</select>
    <button id="__new" style="font:inherit;background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:5px 9px;color:var(--ink);cursor:pointer">+ New</button>
    <button id="__share" style="font:inherit;background:var(--accent);border:0;border-radius:6px;padding:5px 9px;color:#fff;cursor:pointer">Copy share link</button>
    <span id="__savest" style="margin-left:auto">saved to cloud</span>`;
  document.body.appendChild(wrap);
  document.getElementById("__recent").onchange = (e) => { location.search = "?p=" + e.target.value; };
  document.getElementById("__new").onclick = async () => {
    const p = blank();
    try { const id = await createProject(p); remember(id, p.title); location.search = "?p=" + id; } catch (e) { alert("Could not create: " + e.message); }
  };
  document.getElementById("__share").onclick = async () => {
    const link = location.origin + "/?p=" + pid;
    try { await navigator.clipboard.writeText(link); document.getElementById("__savest").textContent = "link copied — anyone with it can edit"; }
    catch (e) { prompt("Share link:", link); }
  };
}

window.NoxelHost = {
  initialLibrary: null,
  onSave() { scheduleSave(); },
  onComments(items) { comments = items || []; scheduleSave(); },
  onPresence(state) { if (pres) pres.update(state); },
  onReady(a) { api = a; a.setComments(comments); bar(); }
};

function fatal(msg, detail) {
  document.body.innerHTML =
    "<div style=\"font:14px/1.6 system-ui;padding:48px;max-width:600px;margin:auto\">" +
    "<h2 style=\"font:600 16px/1 'IBM Plex Mono',monospace;color:#b0402a\">Noxel Studio — setup needed</h2>" +
    "<p>" + msg + "</p>" + (detail ? "<pre style=\"background:#f1ede3;padding:10px;border-radius:6px;overflow:auto;font-size:12px\">" + detail + "</pre>" : "") +
    "</div>";
}

(async () => {
  if (!(await schemaReady())) {
    fatal("Run <code>supabase/schema.sql</code> once in your Supabase project (SQL Editor → New query → paste → Run), then reload this page.");
    return;
  }
  let row = null;
  if (pid) { try { row = await loadProject(pid); } catch (e) { console.warn(e); } }
  if (!row) {
    const p = blank();
    try {
      pid = await createProject(p);
      history.replaceState(null, "", "?p=" + pid);
      row = { id: pid, title: p.title, data: p };
    } catch (e) {
      fatal("Couldn't create a script. Make sure you ran the latest <code>supabase/schema.sql</code> (it drops the old tables and sets open access — no login).", e.message);
      return;
    }
  }
  remember(pid, row.data.title || row.title);
  comments = Array.isArray(row.data._comments) ? row.data._comments : [];
  window.NoxelHost.initialLibrary = { projects: [row.data], currentId: row.data.id };

  subscribeProject(pid, (fresh) => {
    if (saving) return;
    const j = JSON.stringify(Object.assign({}, fresh.data, { _comments: fresh.data._comments || [] }));
    if (j === lastJson) return;
    comments = Array.isArray(fresh.data._comments) ? fresh.data._comments : comments;
    if (api) { api.reload({ projects: [fresh.data], currentId: fresh.data.id }); api.setComments(comments); }
  });

  let name = "Guest";
  try { name = localStorage.getItem("noxel.web.name") || ("Guest " + Math.floor(Math.random() * 90 + 10)); localStorage.setItem("noxel.web.name", name); } catch (e) {}
  const me = { id: clientTag, name, color: "#e0714f" };
  pres = joinPresence(pid, me, (peers) => {
    if (api) api.setPeers(peers.filter((p) => p.id !== clientTag).map((p) => ({ peer: p.id, presence: p })));
  });

  const s = document.createElement("script");
  s.src = "/app.js";
  document.body.appendChild(s);
})();
