import { loadProject, createProject, saveProject, subscribeProject, joinPresence, schemaReady } from "/src/supabase.js";

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

let api = null, comments = [], lastJson = "", saveT = null, pres = null, saving = false, settled = false, pendingLocal = false, lastPeers = [];

const COLORS = ["#e0714f", "#4f9de0", "#63b463", "#c98bdb", "#d8a13a", "#3ec7c0"];
const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
const tabPeerId = Math.random().toString(36).slice(2);
let myName = "";
try { myName = localStorage.getItem("noxel.web.name") || ""; } catch (e) {}
function setMyName(n) {
  myName = (n || "").trim() || myName;
  try { localStorage.setItem("noxel.web.name", myName); } catch (e) {}
  if (api) api.setName(myName);
  if (pres) pres.update({ name: myName });
}

function cloud(txt, state) {
  const t = document.getElementById("__cloudtxt");
  const p = document.getElementById("__cloud");
  if (t) t.textContent = txt;
  if (p) p.classList.toggle("sync", state === "saving");
}

function scheduleSave() {
  clearTimeout(saveT);
  pendingLocal = true;
  if (settled) cloud("Saving…", "saving");
  saveT = setTimeout(async () => {
    if (!api) return;
    const d = api.currentLibrary();
    const proj = Object.assign({}, d.projects[0], { _comments: comments });
    const j = JSON.stringify(proj);
    if (j === lastJson) { pendingLocal = false; cloud("Synced"); return; }
    lastJson = j;
    saving = true;
    try { await saveProject(pid, proj); remember(pid, proj.title); refreshRecent(); cloud("Synced"); pendingLocal = false; }
    catch (e) { console.warn("save failed", e); cloud("Offline — retrying"); setTimeout(scheduleSave, 3000); }
    saving = false;
    settled = true;
  }, 900);
}

function refreshRecent() {
  const sel = document.getElementById("__recent");
  if (!sel) return;
  const list = recent();
  sel.hidden = list.length < 2;
  sel.innerHTML = list.map((r) =>
    `<option value="${r.id}"${r.id === pid ? " selected" : ""}>${(r.title || "Untitled").replace(/[<>&"]/g, "")}</option>`
  ).join("") || `<option selected>this script</option>`;
}

function bar() {
  const tb = document.querySelector(".topbar");
  const brand = tb.querySelector(".brand");
  const grp = document.createElement("div");
  grp.style.cssText = "display:flex;gap:8px;align-items:center;flex-shrink:0";
  grp.innerHTML = `
    <select id="__recent" class="proj-select" style="font-size:12.5px;max-width:150px;padding-top:6px;padding-bottom:6px" title="Your scripts"></select>
    <button id="__new" class="tbtn">+ New</button>
    <button id="__share" class="tbtn primary">Share</button>
    <span id="__cloud" class="cloud-pill on" title="Every change saves to the cloud"><span class="dot"></span><span id="__cloudtxt">Synced</span></span>`;
  brand.after(grp);
  refreshRecent();

  document.getElementById("__recent").onchange = (e) => { location.search = "?p=" + e.target.value; };
  document.getElementById("__new").onclick = async () => {
    const p = blank();
    try { const id = await createProject(p); remember(id, p.title); location.search = "?p=" + id; }
    catch (e) { alert("Could not create a new script: " + e.message); }
  };
  document.getElementById("__share").onclick = async (ev) => {
    const link = location.origin + "/?p=" + pid;
    try {
      await navigator.clipboard.writeText(link);
      const b = ev.currentTarget; const was = b.textContent;
      b.textContent = "Link copied ✓"; setTimeout(() => (b.textContent = was), 1600);
    } catch (e) { prompt("Share this link — anyone with it can edit:", link); }
  };
}

window.NoxelHost = {
  initialLibrary: null,
  onSave() { scheduleSave(); },
  onComments(items) { comments = items || []; scheduleSave(); if (api) api.setComments(comments); },
  onPresence(state) { if (pres) pres.update(Object.assign({}, state, { name: myName, color: myColor })); },
  onName(n) { setMyName(n); },
  onReady(a) {
    api = a;
    if (myName) a.setName(myName);
    a.setComments(comments);
    a.setPeers(lastPeers);
    bar();
    // Adopt the post-boot state as the sync baseline so on-load migrations
    // (block ids, empty breakdown, …) don't trigger a full-document write
    // that could clobber a collaborator mid-edit.
    try {
      const d = a.currentLibrary();
      lastJson = JSON.stringify(Object.assign({}, d.projects[0], { _comments: comments }));
    } catch (e) {}
    pendingLocal = false;
    settled = true;
  }
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
  lastJson = JSON.stringify(Object.assign({}, row.data, { _comments: comments }));

  subscribeProject(pid, (fresh) => {
    if (saving || pendingLocal) return;            // don't clobber unsaved local edits
    const activelyEditing = document.activeElement &&
      (document.activeElement.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (activelyEditing) return;
    const j = JSON.stringify(Object.assign({}, fresh.data, { _comments: fresh.data._comments || [] }));
    if (j === lastJson) return;
    lastJson = j;
    comments = Array.isArray(fresh.data._comments) ? fresh.data._comments : comments;
    if (api) {
      const mode = document.body.dataset.mode;
      const scrollY = document.getElementById("main") ? document.getElementById("main").scrollTop : 0;
      settled = false;
      api.reload({ projects: [fresh.data], currentId: fresh.data.id });
      api.setComments(comments);
      api.setPeers(lastPeers);
      if (mode && mode !== "write") { const mb = document.getElementById("mode-" + mode); if (mb) mb.click(); }
      const mn = document.getElementById("main"); if (mn) mn.scrollTop = scrollY;
      pendingLocal = false;
      cloud("Updated by collaborator");
      setTimeout(() => { settled = true; cloud("Synced"); }, 1600);
    }
  });

  if (!myName) myName = "Guest " + Math.floor(Math.random() * 90 + 10);
  const me = { id: tabPeerId, name: myName, color: myColor };
  pres = joinPresence(pid, me, (peers) => {
    lastPeers = peers.filter((p) => p.id !== tabPeerId).map((p) => ({ peer: p.id, presence: p }));
    if (api) api.setPeers(lastPeers);
  });

  const s = document.createElement("script");
  s.src = "/app.js";
  document.body.appendChild(s);
})();
