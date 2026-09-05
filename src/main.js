// Noxel Studio — Cloud dashboard
// Auth + project list + sharing. Opening a project hands off to the editor
// (editor.html), which loads its JSON through the same src/supabase.js layer.

import {
  currentUser, onAuthChange, signInWithEmail, signOut,
  listProjects, createProject, deleteProject,
  shareProject, listCollaborators
} from "./supabase.js";

const app = document.getElementById("app");
const who = document.getElementById("who");
const signoutBtn = document.getElementById("signout");

signoutBtn.onclick = async () => { await signOut(); location.reload(); };

onAuthChange((user) => render(user));
currentUser().then(render);

async function render(user) {
  if (!user) return renderSignIn();
  who.textContent = user.email;
  signoutBtn.hidden = false;

  app.innerHTML = `
    <h1>Your scripts</h1>
    <p class="muted">Stored in Supabase — shareable by link and with other accounts.</p>
    <div id="list">Loading…</div>
    <button class="primary" id="new" style="margin-top:14px">+ New script</button>
  `;
  document.getElementById("new").onclick = async () => {
    const id = await createProject(blankProject());
    location.href = `editor.html?id=${id}`;
  };

  try {
    const rows = await listProjects();
    const list = document.getElementById("list");
    if (!rows.length) { list.innerHTML = `<p class="muted">No scripts yet.</p>`; return; }
    list.innerHTML = "";
    rows.forEach((p) => {
      const el = document.createElement("div");
      el.className = "proj";
      el.innerHTML = `
        <span class="t"></span>
        <span class="m">${new Date(p.updated_at).toLocaleDateString()}</span>
        <button data-open>Open</button>
        <button data-share>Share</button>
        ${p.owner === user.id ? '<button data-del>Delete</button>' : '<span class="m">shared</span>'}
      `;
      el.querySelector(".t").textContent = p.title || "Untitled";
      el.querySelector("[data-open]").onclick = () => location.href = `editor.html?id=${p.id}`;
      el.querySelector("[data-share]").onclick = () => openShare(p);
      const del = el.querySelector("[data-del]");
      if (del) del.onclick = async () => {
        if (confirm(`Delete "${p.title}"? This cannot be undone.`)) { await deleteProject(p.id); render(user); }
      };
      list.appendChild(el);
    });
  } catch (e) {
    document.getElementById("list").innerHTML =
      `<p class="muted">Couldn't load projects: ${e.message}. Did you run supabase/schema.sql?</p>`;
  }
}

function renderSignIn() {
  who.textContent = "";
  signoutBtn.hidden = true;
  app.innerHTML = `
    <h1>Sign in</h1>
    <p class="muted">We'll email you a magic link — no password.</p>
    <form id="f" style="display:flex;gap:8px;margin-top:12px">
      <input id="email" type="email" placeholder="you@example.com" required style="flex:1" />
      <button class="primary">Send link</button>
    </form>
    <p id="msg" class="muted"></p>
  `;
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const { error } = await signInWithEmail(email);
    document.getElementById("msg").textContent = error ? error.message : "Check your inbox.";
  };
}

async function openShare(p) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `
    <form method="dialog" style="padding:18px;display:flex;flex-direction:column;gap:10px">
      <b>Share "${p.title}"</b>
      <p class="muted">Public link (anyone signed in with the link, read-only):<br>
        <code>${location.origin}/editor.html?id=${p.id}</code></p>
      <label>Invite by email
        <input id="inv" type="email" placeholder="collaborator@example.com" style="width:100%;margin-top:4px" />
      </label>
      <label>Role
        <select id="role"><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
      </label>
      <div id="clist" class="muted"></div>
      <menu style="display:flex;gap:8px;justify-content:flex-end;margin:0;padding:0">
        <button value="cancel">Close</button>
        <button id="do" value="default" class="primary">Invite</button>
      </menu>
    </form>`;
  document.body.appendChild(dlg);
  dlg.showModal();

  const refresh = async () => {
    const { collaborators, invites } = await listCollaborators(p.id);
    dlg.querySelector("#clist").innerHTML =
      `On this project: ${collaborators.length} collaborator(s), ${invites.length} pending invite(s).`;
  };
  refresh();

  dlg.querySelector("#do").onclick = async (e) => {
    e.preventDefault();
    const email = dlg.querySelector("#inv").value.trim();
    const role = dlg.querySelector("#role").value;
    if (!email) return;
    try { const r = await shareProject(p.id, email, role); dlg.querySelector("#clist").textContent = r.status === "invited" ? "Invite sent." : "Access granted."; }
    catch (err) { dlg.querySelector("#clist").textContent = err.message; }
    refresh();
  };
  dlg.addEventListener("close", () => dlg.remove());
}

function blankProject() {
  return {
    id: crypto.randomUUID().slice(0, 8),
    title: "UNTITLED",
    author: "Written by\nYour Name",
    contact: "",
    updated: Date.now(),
    blocks: [{ id: crypto.randomUUID().slice(0, 8), type: "scene", text: "" }],
    breakdown: null, shots: {}, days: [], dayOf: {}, callsheets: {}, budget: [], stripOrder: {}
  };
}
