"use strict";
const STORE = "noxel.studio.v1";
const TYPES = ["scene", "action", "character", "dialogue", "paren", "transition"];
const LABEL = { scene: "Scene Heading", action: "Action", character: "Character", dialogue: "Dialogue", paren: "Parenthetical", transition: "Transition" };
const UPPER = { scene: 1, character: 1, transition: 1 };
// what a fresh line becomes when you press Enter from a given type
const AFTER = { scene: "action", action: "action", character: "dialogue", dialogue: "action", paren: "dialogue", transition: "scene" };
const LINES_PER_PAGE = 55;
const CATS = [
  { key: "cast", label: "Cast" },
  { key: "extras", label: "Background / Extras" },
  { key: "props", label: "Props" },
  { key: "wardrobe", label: "Wardrobe" },
  { key: "makeup", label: "Hair / Makeup" },
  { key: "vehicles", label: "Vehicles" },
  { key: "setdressing", label: "Set Dressing" },
  { key: "sfx", label: "Special Effects" },
  { key: "vfx", label: "Visual Effects" },
  { key: "sound", label: "Sound" },
  { key: "stunts", label: "Stunts" },
  { key: "animals", label: "Animals" },
  { key: "equipment", label: "Special Equipment" }
];
const TIME_RE = /\b(DAY|NIGHT|DUSK|DAWN|MORNING|EVENING|AFTERNOON|CONTINUOUS|LATER|MOMENTS LATER|SAME TIME|SAME)\b/;

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------------- sample script ---------------- */
function sample() {
  return {
    id: uid(),
    title: "THE LAST SIGNAL",
    author: "Written by\nYour Name",
    contact: "hello@noxel.studio",
    updated: Date.now(),
    blocks: [
      { type: "scene", text: "INT. RADIO OBSERVATORY \u2014 CONTROL ROOM \u2014 NIGHT" },
      { type: "action", text: "Banks of dead monitors. One screen still glows. NADIA VOSS (40s), coat over pajamas, leans into a microphone like it might bite." },
      { type: "character", text: "NADIA" },
      { type: "paren", text: "(into mic)" },
      { type: "dialogue", text: "This is Green Bank, listening. If anyone is out there \u2014 we hear you." },
      { type: "action", text: "Static. Then a single, clean tone. Nadia freezes." },
      { type: "character", text: "NADIA" },
      { type: "dialogue", text: "That's not noise." },
      { type: "transition", text: "CUT TO:" },
      { type: "scene", text: "EXT. OBSERVATORY DISH \u2014 CONTINUOUS" },
      { type: "action", text: "The great white dish tilts a few degrees on its own. Snow slides off the rim in a slow avalanche." }
    ]
  };
}

/* ---------------- state ---------------- */
// Optional embedding host (e.g. the Supabase web build). Dormant when unset.
const HOST = (typeof window !== "undefined" && window.NoxelHost) || null;

let data = load();
let cur = data.projects.find(p => p.id === data.currentId) || data.projects[0];

function load() {
  if (HOST && HOST.initialLibrary && HOST.initialLibrary.projects) return HOST.initialLibrary;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.projects) && d.projects.length) return d;
    }
  } catch (e) {}
  const first = sample();
  return { projects: [first], currentId: first.id };
}

let saveTimer = null;
function save(now) {
  cur.updated = Date.now();
  data.currentId = cur.id;
  const write = () => {
    if (HOST && HOST.onSave) { try { HOST.onSave(data); } catch (e) {} }
    else { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) {} }
    $("#stSaved").textContent = "just now";
  };
  clearTimeout(saveTimer);
  if (now) write(); else saveTimer = setTimeout(write, 600);
  if (typeof cloud !== "undefined" && cloud.on && !cloud.applying) cloudPush();
}

/* ---------------- title page ---------------- */
function renderTitle() {
  const tp = $("#titlepage");
  tp.innerHTML = "";
  const t = el("div", "t");
  const ti = el("input"); ti.value = cur.title; ti.setAttribute("aria-label", "Script title");
  ti.oninput = () => { cur.title = ti.value; refreshProjSelect(); save(); };
  t.appendChild(ti);
  const by = el("div", "by");
  const bi = el("input"); bi.value = cur.author.replace(/\n/g, " \u00b7 "); bi.setAttribute("aria-label", "Author");
  bi.oninput = () => { cur.author = bi.value.replace(/ \u00b7 /g, "\n"); save(); };
  by.appendChild(bi);
  const c = el("div", "contact");
  const ci = el("input"); ci.value = cur.contact; ci.setAttribute("aria-label", "Contact");
  ci.style.fontSize = "11px";
  ci.oninput = () => { cur.contact = ci.value; save(); };
  c.appendChild(ci);
  tp.append(t, by, c);
}

/* ---------------- editor ---------------- */
const scriptEl = $("#script");

function makeBlock(b) {
  if (!b.id) b.id = uid();
  const d = el("div", "block");
  d.contentEditable = "true";
  d.spellcheck = true;
  d.dataset.type = b.type;
  d.dataset.id = b.id;
  d.textContent = b.text;
  if (!b.text) d.classList.add("empty");
  return d;
}

function renderScript() {
  scriptEl.innerHTML = "";
  if (!cur.blocks.length) cur.blocks.push({ type: "scene", text: "" });
  cur.blocks.forEach(b => scriptEl.appendChild(makeBlock(b)));
  syncStats();
  renderScenes();
  if (typeof renderScriptPeers === "function") renderScriptPeers();
}

function blockNodes() { return [...scriptEl.children]; }
function indexOf(node) { return blockNodes().indexOf(node); }

function syncFromDom() {
  cur.blocks = blockNodes().map(n => ({ id: n.dataset.id, type: n.dataset.type, text: n.textContent }));
}

function setType(node, type) {
  node.dataset.type = type;
  const i = indexOf(node);
  if (i > -1) cur.blocks[i].type = type;
  if (UPPER[type]) node.textContent = node.textContent.toUpperCase();
  toggleEmpty(node);
  flashTag(type);
  save();
  syncStats();
  renderScenes();
}

function toggleEmpty(node) { node.classList.toggle("empty", node.textContent.length === 0); }

function caretAtStart(node) {
  const s = window.getSelection();
  if (!s.rangeCount) return false;
  const r = s.getRangeAt(0);
  return r.startOffset === 0 && r.collapsed;
}
function placeCaret(node, atEnd) {
  node.focus();
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(!atEnd);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

scriptEl.addEventListener("input", e => {
  const node = e.target.closest(".block");
  if (!node) return;
  if (UPPER[node.dataset.type]) {
    const up = node.textContent.toUpperCase();
    if (up !== node.textContent) {
      const off = window.getSelection().getRangeAt(0).startOffset;
      node.textContent = up;
      try {
        const r = document.createRange();
        r.setStart(node.firstChild || node, Math.min(off, node.textContent.length));
        r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch (err) {}
    }
  }
  toggleEmpty(node);
  const i = indexOf(node);
  if (i > -1) cur.blocks[i].text = node.textContent;
  save();
  syncStats();
  scheduleScenes();
  if (live.peers && live.peers.length) renderScriptPeers();
});

scriptEl.addEventListener("keydown", e => {
  const node = document.activeElement.closest && document.activeElement.closest(".block");
  if (!node) return;
  const i = indexOf(node);

  if (e.key === "Tab") {
    e.preventDefault();
    const dir = e.shiftKey ? -1 : 1;
    const next = TYPES[(TYPES.indexOf(node.dataset.type) + dir + TYPES.length) % TYPES.length];
    setType(node, next);
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    const nextType = AFTER[node.dataset.type] || "action";
    const nb = { id: uid(), type: nextType, text: "" };
    cur.blocks.splice(i + 1, 0, nb);
    const dom = makeBlock(nb);
    node.after(dom);
    placeCaret(dom, false);
    flashTag(nextType);
    save();
    syncStats();
    renderScenes();
    return;
  }

  if (e.key === "Backspace" && caretAtStart(node) && node.textContent === "" && blockNodes().length > 1) {
    e.preventDefault();
    const prev = blockNodes()[i - 1];
    cur.blocks.splice(i, 1);
    node.remove();
    if (prev) placeCaret(prev, true);
    save();
    syncStats();
    renderScenes();
    return;
  }

  if ((e.key === "ArrowUp" || e.key === "ArrowDown")) {
    // let native handle within block; jump blocks at edges
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    if (e.key === "ArrowUp" && caretAtStart(node) && i > 0) {
      e.preventDefault(); placeCaret(blockNodes()[i - 1], true);
    } else if (e.key === "ArrowDown") {
      const r = sel.getRangeAt(0);
      if (r.startOffset === node.textContent.length && i < blockNodes().length - 1) {
        e.preventDefault(); placeCaret(blockNodes()[i + 1], false);
      }
    }
  }
});

scriptEl.addEventListener("focusin", e => {
  const node = e.target.closest(".block");
  if (node) {
    flashTag(node.dataset.type); markActiveScene(node);
    const i = indexOf(node);
    let sc = null;
    for (let k = i; k >= 0; k--) if (cur.blocks[k] && cur.blocks[k].type === "scene") { sc = cur.blocks[k].text; break; }
    live.block = node.dataset.id;
    live.scene = sc;
    pushPresence();
  }
});
scriptEl.addEventListener("paste", e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text.replace(/\r/g, ""));
});

/* ---------------- element tag pill ---------------- */
let tagTimer = null;
function flashTag(type) {
  const tag = $("#typetag");
  tag.textContent = LABEL[type];
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    let x = rect.left, y = rect.top - 26;
    if (rect.width === 0 && rect.height === 0) {
      const n = document.activeElement.getBoundingClientRect();
      x = n.left; y = n.top - 26;
    }
    tag.style.left = Math.max(12, x) + "px";
    tag.style.top = Math.max(8, y) + "px";
  }
  tag.classList.add("show");
  clearTimeout(tagTimer);
  tagTimer = setTimeout(() => tag.classList.remove("show"), 1400);
}

/* ---------------- scene navigator ---------------- */
let sceneTimer = null;
function scheduleScenes() { clearTimeout(sceneTimer); sceneTimer = setTimeout(renderScenes, 300); }

function sceneData() {
  const out = [];
  let line = 0, n = 0;
  cur.blocks.forEach((b, idx) => {
    const rows = estRows(b);
    if (b.type === "scene") {
      n++;
      out.push({ idx, id: b.id, n, slug: b.text || "(untitled scene)", page: Math.floor(line / LINES_PER_PAGE) + 1 });
    }
    line += rows;
  });
  return out;
}

function estRows(b) {
  const widths = { scene: 58, action: 60, character: 38, dialogue: 35, paren: 30, transition: 60 };
  const w = widths[b.type] || 60;
  const textRows = Math.max(1, Math.ceil((b.text || "").length / w));
  const lead = b.type === "scene" ? 2 : 1;
  return textRows + lead;
}

function renderScenes() {
  const list = $("#sceneList");
  const scenes = sceneData();
  list.innerHTML = "";
  if (!scenes.length) {
    const e = el("div", "nav-empty"); e.textContent = "No scene headings yet.";
    list.appendChild(e);
  }
  scenes.forEach(s => {
    const b = el("button", "scene-item");
    b.dataset.idx = s.idx;
    const openC = commentsForScene(s.id).filter(c => !c.resolved).length;
    b.innerHTML = `<span class="n">${String(s.n).padStart(2, "0")}</span><span class="slug"></span>` +
      (openC ? `<span class="cm">${openC}</span>` : `<span class="pg">p.${s.page}</span>`);
    b.querySelector(".slug").textContent = s.slug;
    b.onclick = () => {
      if (document.body.dataset.mode === "breakdown") {
        const card = document.getElementById("bd-" + s.id);
        if (card) card.scrollIntoView({ block: "start" });
        return;
      }
      const node = blockNodes()[s.idx];
      if (node) { node.scrollIntoView({ block: "center" }); placeCaret(node, true); }
    };
    list.appendChild(b);
  });
  syncStats(scenes.length);
}

function markActiveScene(node) {
  const i = indexOf(node);
  let target = -1;
  for (let k = i; k >= 0; k--) if (cur.blocks[k] && cur.blocks[k].type === "scene") { target = k; break; }
  [...$("#sceneList").children].forEach(c => c.classList.toggle("active", +c.dataset.idx === target));
}

/* ---------------- stats ---------------- */
function syncStats(sceneCount) {
  let line = 0, words = 0;
  cur.blocks.forEach(b => {
    line += estRows(b);
    const t = (b.text || "").trim();
    if (t) words += t.split(/\s+/).length;
  });
  $("#stPages").textContent = Math.max(1, Math.ceil(line / LINES_PER_PAGE));
  $("#stWords").textContent = words.toLocaleString();
  if (sceneCount === undefined) sceneCount = cur.blocks.filter(b => b.type === "scene").length;
  $("#stScenes").textContent = sceneCount;
}

/* ---------------- project switching ---------------- */
function refreshProjSelect() {
  const sel = $("#projSelect");
  sel.innerHTML = "";
  data.projects.forEach(p => {
    const o = el("option");
    o.value = p.id;
    o.textContent = p.title || "Untitled";
    if (p.id === cur.id) o.selected = true;
    sel.appendChild(o);
  });
}
$("#projSelect").addEventListener("change", e => {
  syncFromDom();
  save(true);
  cur = data.projects.find(p => p.id === e.target.value);
  boot();
});
$("#newBtn").addEventListener("click", () => {
  syncFromDom(); save(true);
  const p = { id: uid(), title: "UNTITLED", author: "Written by\nYour Name", contact: "", updated: Date.now(),
    blocks: [{ type: "scene", text: "" }] };
  data.projects.push(p);
  cur = p;
  boot();
  const first = blockNodes()[0];
  if (first) placeCaret(first, false);
});

/* ---------------- modals ---------------- */
const scrim = $("#scrim");
function closeModal() { scrim.classList.remove("open"); }
scrim.addEventListener("click", e => { if (e.target === scrim) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

$("#titleBtn").addEventListener("click", () => {
  $("#modal").innerHTML = `
    <h3>Title Page</h3>
    <label>Title</label><input type="text" id="mTitle">
    <label>Credit</label><input type="text" id="mAuthor">
    <label>Contact</label><input type="text" id="mContact">
    <div class="row"><button class="tbtn" id="mCancel">Close</button>
    <button class="tbtn primary" id="mSave">Save</button></div>`;
  $("#mTitle").value = cur.title;
  $("#mAuthor").value = cur.author.replace(/\n/g, " \u00b7 ");
  $("#mContact").value = cur.contact;
  $("#mCancel").onclick = closeModal;
  $("#mSave").onclick = () => {
    cur.title = $("#mTitle").value.trim() || "UNTITLED";
    cur.author = $("#mAuthor").value.replace(/ \u00b7 /g, "\n");
    cur.contact = $("#mContact").value.trim();
    renderTitle(); refreshProjSelect(); save(true); closeModal();
  };
  scrim.classList.add("open");
  $("#mTitle").focus();
});

$("#dataBtn").addEventListener("click", () => {
  syncFromDom(); save(true);
  $("#modal").classList.remove("wide");
  $("#modal").innerHTML = `
    <h3>Backup &amp; Formats</h3>
    <label>Your name (for comments &amp; collaboration)</label>
    <input type="text" id="mName" placeholder="e.g. Beni">
    <label style="margin-top:16px">Whole library — JSON backup</label>
    <textarea id="mJson" spellcheck="false"></textarea>
    <div class="row" style="margin-top:10px">
      <button class="tbtn" id="mCopy">Copy JSON</button>
      <button class="tbtn" id="mRestore">Restore from paste</button>
    </div>
    <label style="margin-top:18px">Fountain — the current script "<span id="mFT"></span>"</label>
    <textarea id="mFountain" spellcheck="false" placeholder="Paste .fountain text here to import as a new script"></textarea>
    <div class="row" style="margin-top:10px">
      <button class="tbtn" id="mFExport">Copy as Fountain</button>
      <button class="tbtn" id="mFImport">Import Fountain</button>
      <button class="tbtn primary" id="mClose">Done</button>
    </div>
    <div class="msg" id="mMsg"></div>`;
  $("#mName").value = live.name || "";
  $("#mName").oninput = () => { live.name = $("#mName").value.trim(); try { localStorage.setItem("noxel.name", live.name); } catch (e) {} pushPresence(); };
  $("#mFT").textContent = cur.title;
  $("#mJson").value = JSON.stringify(data, null, 2);
  $("#mClose").onclick = closeModal;
  $("#mCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#mJson").value); $("#mMsg").textContent = "Copied to clipboard."; }
    catch (e) { $("#mJson").select(); $("#mMsg").textContent = "Press Cmd/Ctrl+C to copy."; }
  };
  $("#mRestore").onclick = () => {
    try {
      const d = JSON.parse($("#mJson").value);
      if (!d.projects || !Array.isArray(d.projects) || !d.projects.length) throw new Error("no projects");
      data = d;
      cur = data.projects.find(p => p.id === d.currentId) || data.projects[0];
      save(true); boot(); closeModal();
    } catch (e) { $("#mMsg").textContent = "That doesn't look like a valid backup."; }
  };
  $("#mFExport").onclick = async () => {
    const ft = fountainExport();
    try { await navigator.clipboard.writeText(ft); $("#mMsg").textContent = "Fountain copied — paste into any screenwriting app."; }
    catch (e) { $("#mFountain").value = ft; $("#mFountain").select(); $("#mMsg").textContent = "Select-all + copy the Fountain text above."; }
  };
  $("#mFImport").onclick = () => {
    const r = fountainImport($("#mFountain").value);
    if (!r) { $("#mMsg").textContent = "Couldn't read that as Fountain."; return; }
    const p = {
      id: uid(),
      title: (r.meta.title || "IMPORTED SCRIPT").toUpperCase(),
      author: ((r.meta.credit || "Written by") + "\n" + (r.meta.author || r.meta.authors || "")).trim(),
      contact: r.meta.contact || "", updated: Date.now(), blocks: r.blocks,
      breakdown: null, shots: {}, days: [], dayOf: {}, callsheets: {}, budget: []
    };
    data.projects.push(p); cur = p; save(true); boot(); closeModal();
    flashToast("Imported " + r.blocks.length + " elements");
  };
  scrim.classList.add("open");
  setTimeout(() => $("#mName").focus(), 30);
});

$("#pdfBtn").addEventListener("click", () => {
  const m = document.body.dataset.mode;
  if (m === "breakdown") { printReport(buildBreakdownReport); return; }
  if (m === "shots") { printReport(buildShotsReport); return; }
  if (m === "budget") { printReport(buildBudgetReport); return; }
  if (m === "schedule") { printCallSheet(); return; }
  syncFromDom(); save(true); window.print();
});

function printReport(build) {
  syncFromDom();
  const p = $("#callsheet-print");
  p.innerHTML = "";
  build(p);
  document.body.classList.add("printing-cs");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-cs"), 400);
}
function buildBreakdownReport(p) {
  const scenes = sceneData();
  const h = el("h1"); h.textContent = cur.title + " — Breakdown"; p.appendChild(h);
  const t = el("table");
  const head = ["#", "Set", "I/E", "D/N", "Pg", "Synopsis"].concat(CATS.map(c => c.label));
  t.innerHTML = "<tr>" + head.map(x => "<th>" + x + "</th>").join("") + "</tr>";
  scenes.forEach(s => {
    const bd = ensureBd(s.id);
    const cells = [s.n, bd.set || s.slug, bd.ie, bd.dn, bd.eighths, bd.synopsis]
      .concat(CATS.map(c => bd.cats[c.key].map(i => i.v).join(", ")));
    const tr = el("tr");
    cells.forEach(v => { const td = el("td"); td.textContent = v || ""; tr.appendChild(td); });
    t.appendChild(tr);
  });
  p.appendChild(t);
}
function buildShotsReport(p) {
  const scenes = sceneData();
  const h = el("h1"); h.textContent = cur.title + " — Shot List"; p.appendChild(h);
  scenes.forEach(s => {
    const list = (cur.shots && cur.shots[s.id]) || [];
    if (!list.length) return;
    const h2 = el("h2"); h2.textContent = String(s.n).padStart(2, "0") + "  " + s.slug; p.appendChild(h2);
    const t = el("table");
    t.innerHTML = "<tr><th>#</th><th>Size</th><th>Move</th><th>Lens</th><th>Subject / action</th><th>Notes</th></tr>";
    list.forEach((sh, i) => {
      const tr = el("tr");
      [i + 1, sh.size, sh.move, sh.lens, sh.subj, sh.notes].forEach(v => { const td = el("td"); td.textContent = v || ""; tr.appendChild(td); });
      t.appendChild(tr);
    });
    p.appendChild(t);
    const withImg = list.filter(sh => sh.img);
    if (withImg.length) {
      const row = el("div"); row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px";
      withImg.forEach((sh, i) => {
        const fig = el("div"); fig.style.cssText = "font-size:9px";
        const im = el("img"); im.src = sh.img; im.style.cssText = "height:96px;border:1px solid #999;display:block";
        const cap = el("div"); cap.textContent = (list.indexOf(sh) + 1) + ". " + (sh.size || "") + " " + (sh.move || "");
        fig.append(im, cap); row.appendChild(fig);
      });
      p.appendChild(row);
    }
  });
}
function buildBudgetReport(p) {
  const h = el("h1"); h.textContent = cur.title + " — Budget"; p.appendChild(h);
  const t = el("table");
  t.innerHTML = "<tr><th>Category</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Total</th></tr>";
  let grand = 0;
  BUDGET_CATS.forEach(cat => {
    const rows = ensureBudget().filter(r => r.cat === cat);
    if (!rows.length) return;
    let sub = 0;
    rows.forEach(r => {
      const amt = (r.qty || 0) * (r.rate || 0); sub += amt;
      const tr = el("tr");
      [r.cat, r.desc, r.qty, r.unit, r.rate, money(amt)].forEach(v => { const td = el("td"); td.textContent = (v == null ? "" : v); tr.appendChild(td); });
      t.appendChild(tr);
    });
    grand += sub;
    const sr = el("tr");
    sr.innerHTML = "<td colspan='5' style='text-align:right'><b>" + cat + " subtotal</b></td><td><b>" + money(sub) + "</b></td>";
    t.appendChild(sr);
  });
  const gr = el("tr");
  gr.innerHTML = "<td colspan='5' style='text-align:right'><b>TOTAL</b></td><td><b>" + money(grand) + "</b></td>";
  t.appendChild(gr);
  p.appendChild(t);
}

/* ---------------- breakdown ---------------- */
function parseSlug(raw) {
  let s = (raw || "").toUpperCase().replace(/[\u2013\u2014]/g, "-").trim();
  let ie = "";
  const m = s.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\.?\/E\.?|INT\.?|EXT\.?)\s+/);
  if (m) { ie = m[1].replace(/[.\s]/g, ""); s = s.slice(m[0].length); }
  if (ie === "IE" || ie === "EXT/INT") ie = "INT/EXT";
  let dn = "";
  const parts = s.split(/\s+-\s+/);
  if (parts.length > 1 && TIME_RE.test(parts[parts.length - 1])) {
    dn = parts.pop().trim();
    s = parts.join(" - ");
  }
  const set = s.replace(/^-+|-+$/g, "").trim();
  return { ie, set, dn };
}

function sceneRange(id) {
  const a = cur.blocks.findIndex(b => b.id === id);
  let z = cur.blocks.length;
  for (let k = a + 1; k < cur.blocks.length; k++) if (cur.blocks[k].type === "scene") { z = k; break; }
  return [a, z];
}
function sceneCast(id) {
  const [a, z] = sceneRange(id);
  const out = [];
  for (let k = a + 1; k < z; k++) {
    if (cur.blocks[k].type !== "character") continue;
    let name = cur.blocks[k].text.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
    name = name.replace(/\s+(V\.?O\.?|O\.?S\.?|CONT'?D|SUBTITLE)\.?$/i, "").trim();
    if (name && !out.some(x => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}
function ensureBd(id) {
  if (!cur.breakdown) cur.breakdown = {};
  if (!cur.breakdown[id]) {
    const b = { synopsis: "", eighths: "", ie: "", set: "", dn: "", cats: {} };
    CATS.forEach(c => b.cats[c.key] = []);
    cur.breakdown[id] = b;
  } else {
    CATS.forEach(c => { if (!cur.breakdown[id].cats[c.key]) cur.breakdown[id].cats[c.key] = []; });
  }
  return cur.breakdown[id];
}
function addItem(arr, v, auto) {
  v = v.trim();
  if (!v) return;
  const hit = arr.find(x => x.v.toLowerCase() === v.toLowerCase());
  if (hit) { if (!auto) hit.auto = false; return; }
  arr.push({ v, auto: !!auto });
}
function autoScanScene(s, force) {
  const bd = ensureBd(s.id);
  const p = parseSlug(s.slug);
  if (force || !bd.ie) bd.ie = p.ie;
  if (force || !bd.set) bd.set = p.set;
  if (force || !bd.dn) bd.dn = p.dn;
  sceneCast(s.id).forEach(n => addItem(bd.cats.cast, n, true));
}

function buildCatRow(bd, cat) {
  const wrap = el("div", "bd-cat" + (cat.key === "cast" ? " wide" : ""));
  wrap.dataset.key = cat.key;
  const lab = el("span"); lab.textContent = cat.label; wrap.appendChild(lab);
  const chips = el("div", "chips");
  bd.cats[cat.key].forEach((item, i) => {
    const c = el("span", "chip" + (item.auto ? " auto" : ""));
    c.append(document.createTextNode(item.v));
    const x = el("button"); x.type = "button"; x.textContent = "\u00d7"; x.setAttribute("aria-label", "Remove " + item.v);
    x.onclick = () => { bd.cats[cat.key].splice(i, 1); save(); refreshRow(wrap, bd, cat); };
    c.appendChild(x);
    chips.appendChild(c);
  });
  const inp = el("input", "chip-in");
  inp.placeholder = bd.cats[cat.key].length ? "add\u2026" : "add item, Enter";
  inp.onkeydown = e => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      inp.value.split(",").forEach(v => addItem(bd.cats[cat.key], v, false));
      inp.value = ""; save(); refreshRow(wrap, bd, cat);
    } else if (e.key === "Backspace" && inp.value === "" && bd.cats[cat.key].length) {
      bd.cats[cat.key].pop(); save(); refreshRow(wrap, bd, cat);
    }
  };
  inp.onblur = () => {
    if (!inp.value.trim()) return;
    inp.value.split(",").forEach(v => addItem(bd.cats[cat.key], v, false));
    inp.value = ""; save(); refreshRow(wrap, bd, cat);
  };
  chips.appendChild(inp);
  wrap.appendChild(chips);
  return wrap;
}
function refreshRow(oldNode, bd, cat) {
  const fresh = buildCatRow(bd, cat);
  oldNode.replaceWith(fresh);
  const inp = fresh.querySelector(".chip-in");
  if (inp) inp.focus();
  updateBdFooter();
}

function bdMeta(bd, key, cls, ph) {
  const l = el("label"); l.textContent = ({ ie: "I/E", set: "Set", dn: "Time", eighths: "Pages" })[key];
  const i = el("input", cls); i.value = bd[key] || ""; i.placeholder = ph || "";
  i.oninput = () => { bd[key] = i.value; save(); };
  l.appendChild(i);
  return l;
}

function renderBreakdown() {
  const wrap = $("#breakdown");
  wrap.innerHTML = "";
  const scenes = sceneData();

  const bar = el("div", "bd-bar");
  const ttl = el("div", "ttl"); ttl.textContent = "Scene Breakdown \u2014 " + cur.title;
  const grow = el("div", "grow");
  const scan = el("button", "tbtn"); scan.textContent = "\u21bb Auto-scan from script";
  scan.onclick = () => { sceneData().forEach(s => autoScanScene(s, false)); save(true); renderBreakdown(); };
  const csv = el("button", "tbtn primary"); csv.textContent = "Copy sheet (CSV)";
  csv.onclick = copyBreakdownCsv;
  bar.append(ttl, grow, scan, csv);
  wrap.appendChild(bar);

  if (!scenes.length) {
    const e = el("div", "bd-empty");
    e.textContent = "Add scene headings in the script to build a breakdown.";
    wrap.appendChild(e);
    return;
  }

  scenes.forEach(s => {
    const bd = ensureBd(s.id);
    const card = el("div", "bd-card"); card.id = "bd-" + s.id;

    const head = el("div", "bd-head");
    const sn = el("span", "sn"); sn.textContent = String(s.n).padStart(2, "0");
    const slug = el("span", "slug"); slug.textContent = s.slug;
    const pg = el("span", "pg"); pg.textContent = "p. " + s.page;
    head.append(sn, slug, pg);
    card.appendChild(head);

    const meta = el("div", "bd-meta");
    meta.append(
      bdMeta(bd, "ie", "ie", "INT"),
      bdMeta(bd, "set", "set", "location"),
      bdMeta(bd, "dn", "dn", "DAY"),
      bdMeta(bd, "eighths", "eig", "1 2/8")
    );
    card.appendChild(meta);

    const syn = el("textarea", "bd-syn");
    syn.placeholder = "One-line scene synopsis\u2026";
    syn.value = bd.synopsis || "";
    syn.oninput = () => { bd.synopsis = syn.value; save(); };
    card.appendChild(syn);

    const cats = el("div", "bd-cats");
    CATS.forEach(c => cats.appendChild(buildCatRow(bd, c)));
    card.appendChild(cats);

    wrap.appendChild(card);
  });
  updateBdFooter();
}

function updateBdFooter() {
  let elements = 0;
  const bd = cur.breakdown || {};
  Object.keys(bd).forEach(k => CATS.forEach(c => elements += (bd[k].cats[c.key] || []).length));
  $("#stWords").textContent = elements.toLocaleString();
}

function csvCell(v) {
  v = (v == null ? "" : String(v));
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function copyBreakdownCsv() {
  syncFromDom();
  const scenes = sceneData();
  const head = ["#", "Page", "I/E", "Set", "Time", "Pages", "Synopsis"].concat(CATS.map(c => c.label));
  const rows = [head];
  scenes.forEach(s => {
    const bd = ensureBd(s.id);
    const row = [s.n, s.page, bd.ie, bd.set || s.slug, bd.dn, bd.eighths, bd.synopsis];
    CATS.forEach(c => row.push(bd.cats[c.key].map(i => i.v).join("; ")));
    rows.push(row);
  });
  const text = rows.map(r => r.map(csvCell).join(",")).join("\n");
  navigator.clipboard.writeText(text).then(
    () => flashToast("Breakdown CSV copied \u2014 paste into a spreadsheet"),
    () => flashToast("Copy failed \u2014 try again")
  );
  save(true);
}

let toastTimer = null;
function flashToast(msg) {
  let t = $("#toast");
  if (!t) {
    t = el("div"); t.id = "toast";
    t.style.cssText = "position:fixed;left:50%;bottom:52px;transform:translateX(-50%);background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:12px;padding:9px 16px;border-radius:8px;z-index:60;box-shadow:var(--shadow)";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2200);
}

/* ================= PHASE 3 — SHOTS & STORYBOARD ================= */
const SHOT_SIZES = ["", "EWS", "WS", "MWS", "MS", "MCU", "CU", "ECU", "INSERT", "POV", "OTS", "2-SHOT"];
const SHOT_MOVES = ["", "STATIC", "PAN", "TILT", "DOLLY", "TRACK", "CRANE", "HANDHELD", "STEADICAM", "GIMBAL", "ZOOM"];

function ensureShots(id) {
  if (!cur.shots) cur.shots = {};
  if (!cur.shots[id]) cur.shots[id] = [];
  return cur.shots[id];
}
function loadThumb(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => {
      const max = 460, sc = Math.min(1, max / im.width);
      const c = el("canvas"); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      try { cb(c.toDataURL("image/jpeg", 0.7)); } catch (e) { flashToast("Could not read that image"); }
    };
    im.onerror = () => flashToast("Could not read that image");
    im.src = r.result;
  };
  r.readAsDataURL(file);
}

function selectEl(opts, val, onChange) {
  const s = el("select");
  opts.forEach(o => { const op = el("option"); op.value = o; op.textContent = o || "–"; if (o === val) op.selected = true; s.appendChild(op); });
  s.onchange = () => onChange(s.value);
  return s;
}
function field(label, node) {
  const w = el("div", "cell");
  const l = el("label"); l.textContent = label;
  w.append(l, node);
  return w;
}

function buildShot(sid, list, shot, i) {
  const row = el("div", "shot" + (shot.done ? " done" : ""));
  const num = el("div", "num"); num.textContent = String(i + 1);
  row.appendChild(num);

  row.appendChild(field("Size", selectEl(SHOT_SIZES, shot.size || "", v => { shot.size = v; save(); })));
  row.appendChild(field("Move", selectEl(SHOT_MOVES, shot.move || "", v => { shot.move = v; save(); })));
  const lens = el("input"); lens.value = shot.lens || ""; lens.placeholder = "35mm";
  lens.oninput = () => { shot.lens = lens.value; save(); };
  row.appendChild(field("Lens", lens));

  const st = selectEl(["todo", "done"], shot.done ? "done" : "todo", v => { shot.done = (v === "done"); save(); renderShots(); });
  row.appendChild(field("Status", st));

  const desc = el("div", "cell desc");
  const dl = el("label"); dl.textContent = "Subject / action";
  const ta = el("textarea"); ta.value = shot.subj || ""; ta.rows = 2;
  ta.oninput = () => { shot.subj = ta.value; save(); };
  const nt = el("input"); nt.value = shot.notes || ""; nt.placeholder = "notes — gear, blocking, VFX";
  nt.style.marginTop = "5px"; nt.style.fontFamily = "var(--mono)";
  nt.oninput = () => { shot.notes = nt.value; save(); };
  desc.append(dl, ta, nt);
  row.appendChild(desc);

  const sb = el("div", "sb");
  if (shot.img) {
    const img = el("img"); img.src = shot.img; img.alt = "storyboard frame";
    sb.appendChild(img);
  }
  const pick = el("label", "thumb-btn");
  pick.textContent = shot.img ? "Replace frame" : "+ Storyboard frame";
  const fi = el("input"); fi.type = "file"; fi.accept = "image/*"; fi.hidden = true;
  fi.onchange = () => { if (fi.files[0]) loadThumb(fi.files[0], d => { shot.img = d; save(); renderShots(); }); };
  pick.appendChild(fi);
  sb.appendChild(pick);
  if (shot.img) {
    const rm = el("button", "icon-btn"); rm.textContent = "Remove frame";
    rm.onclick = () => { delete shot.img; save(); renderShots(); };
    sb.appendChild(rm);
  }
  const tools = el("div", "shot-row-tools");
  const up = el("button", "icon-btn"); up.textContent = "↑"; up.title = "Move up";
  up.onclick = () => { if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); save(); renderShots(); } };
  const del = el("button", "icon-btn"); del.textContent = "Delete"; del.title = "Delete shot";
  del.onclick = () => { list.splice(i, 1); save(); renderShots(); };
  tools.append(up, del);
  sb.appendChild(tools);
  row.appendChild(sb);

  return row;
}

function renderShots() {
  const wrap = $("#shots"); wrap.innerHTML = "";
  const scenes = sceneData();

  const bar = el("div", "panel-bar");
  const ttl = el("div", "ttl"); ttl.textContent = "Shot List — " + cur.title;
  bar.append(ttl);
  wrap.appendChild(bar);

  if (!scenes.length) {
    const e = el("div", "panel-empty"); e.textContent = "Add scene headings in the script to plan shots.";
    wrap.appendChild(e); updateShotFooter(); return;
  }

  scenes.forEach(s => {
    const list = ensureShots(s.id);
    const sec = el("div", "shot-scene");
    const h = el("h3");
    h.innerHTML = '<span class="sn"></span><span class="sl"></span><span class="pg"></span>';
    h.querySelector(".sn").textContent = String(s.n).padStart(2, "0");
    h.querySelector(".sl").textContent = s.slug;
    h.querySelector(".pg").textContent = "p. " + s.page + " · " + list.length + " shot" + (list.length === 1 ? "" : "s");
    sec.appendChild(h);
    list.forEach((shot, i) => sec.appendChild(buildShot(s.id, list, shot, i)));
    const add = el("button", "tbtn"); add.textContent = "+ Add shot";
    add.onclick = () => { list.push({ id: uid(), size: "", move: "", lens: "", subj: "", notes: "", done: false }); save(); renderShots(); };
    sec.appendChild(add);
    wrap.appendChild(sec);
  });
  updateShotFooter();
}
function updateShotFooter() {
  let n = 0, done = 0;
  Object.values(cur.shots || {}).forEach(l => l.forEach(sh => { n++; if (sh.done) done++; }));
  $("#stWords").textContent = done + " / " + n;
}

/* ================= PHASE 4a — SCHEDULE / STRIPBOARD ================= */
function stripClass(bd) {
  const ie = (bd.ie || "").toUpperCase();
  const night = /NIGHT|DUSK|DAWN/.test((bd.dn || "").toUpperCase());
  const ext = ie.indexOf("EXT") === 0 || ie === "I/E" || ie === "INT/EXT";
  if (!ie) return "unset";
  if (ext && night) return "ext-night";
  if (ext) return "ext-day";
  if (night) return "int-night";
  return "int-day";
}
function ensureDays() { if (!cur.days) cur.days = []; if (!cur.dayOf) cur.dayOf = {}; return cur.days; }
function eighthsToNum(v) {
  v = (v || "").trim(); if (!v) return 0;
  const m = v.match(/^(?:(\d+)\s+)?(?:(\d+)\/8)?$/);
  if (!m) { const f = parseFloat(v); return isNaN(f) ? 0 : f; }
  return (parseInt(m[1] || 0, 10)) + (parseInt(m[2] || 0, 10)) / 8;
}
function fmtEighths(n) {
  const whole = Math.floor(n), e = Math.round((n - whole) * 8);
  return (whole || e ? (whole ? whole + " " : "") + (e ? e + "/8" : "") : "0").trim();
}

function buildStrip(s, bd, days, key) {
  const st = el("div", "strip " + stripClass(bd));
  st.draggable = true;
  st.dataset.sid = s.id;
  const n = el("span", "st-n"); n.textContent = String(s.n).padStart(2, "0");
  const ie = el("span"); ie.textContent = (bd.ie || "?");
  const slug = el("span", "st-slug"); slug.textContent = bd.set || s.slug;
  const pg = el("span"); pg.textContent = (bd.eighths ? bd.eighths + " pg" : "–");
  const sel = selectEl(["", ...days.map(d => d.id)], cur.dayOf[s.id] || "", v => { moveStrip(s.id, v || "_pool"); });
  [...sel.options].forEach(o => { if (o.value === "") o.textContent = "Unscheduled"; else { const d = days.find(x => x.id === o.value); o.textContent = d ? d.label : o.value; } });
  st.append(n, ie, slug, pg, sel);
  st.addEventListener("dragstart", e => { dragSid = s.id; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", s.id); } catch (x) {} });
  st.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; st.classList.add("drag-over"); });
  st.addEventListener("dragleave", () => st.classList.remove("drag-over"));
  st.addEventListener("drop", e => {
    e.preventDefault(); e.stopPropagation(); st.classList.remove("drag-over");
    if (dragSid && dragSid !== s.id) moveStrip(dragSid, key, s.id);
    dragSid = null;
  });
  return st;
}
function makeDropZone(col, key) {
  col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drop-hot"); });
  col.addEventListener("dragleave", e => { if (e.target === col) col.classList.remove("drop-hot"); });
  col.addEventListener("drop", e => {
    e.preventDefault(); col.classList.remove("drop-hot");
    if (dragSid) moveStrip(dragSid, key, null);
    dragSid = null;
  });
}

function renderSchedule() {
  const wrap = $("#schedule"); wrap.innerHTML = "";
  const days = ensureDays();
  const scenes = sceneData();
  const bdOf = id => ensureBd(id);

  const bar = el("div", "panel-bar");
  const ttl = el("div", "ttl"); ttl.textContent = "Stripboard — " + cur.title;
  const grow = el("div", "grow");
  const addDay = el("button", "tbtn"); addDay.textContent = "+ Shooting day";
  addDay.onclick = () => { days.push({ id: uid(), label: "Day " + (days.length + 1), date: "" }); save(); renderSchedule(); };
  const cs = el("button", "tbtn primary"); cs.textContent = "Print call sheet";
  cs.onclick = printCallSheet;
  bar.append(ttl, grow, addDay, cs);
  wrap.appendChild(bar);

  const legend = el("div", "strip-legend");
  legend.innerHTML = '<span><i style="background:#f4f1e9"></i>INT day</span><span><i style="background:#cdd9e8"></i>INT night</span><span><i style="background:#f2e4a8"></i>EXT day</span><span><i style="background:#cbe0c0"></i>EXT night</span>';
  wrap.appendChild(legend);

  if (!scenes.length) { const e = el("div", "panel-empty"); e.textContent = "Add scene headings to build a schedule."; wrap.appendChild(e); return; }

  const grid = el("div", "sched-grid");

  const dayBlock = (day) => {
    const col = el("div", "day-col");
    const head = el("div", "day-head");
    const li = el("input", "dl"); li.value = day.label; li.oninput = () => { day.label = li.value; save(); };
    const di = el("input", "dd"); di.type = "date"; di.value = day.date || ""; di.onchange = () => { day.date = di.value; save(); };
    const tot = el("span", "tot");
    const del = el("button", "icon-btn"); del.textContent = "Delete day";
    del.onclick = () => {
      scenes.forEach(s => { if (cur.dayOf[s.id] === day.id) cur.dayOf[s.id] = ""; });
      cur.days = cur.days.filter(d => d.id !== day.id);
      delete (cur.callsheets || {})[day.id];
      save(); renderSchedule();
    };
    head.append(li, di, tot, del);
    col.appendChild(head);
    const mine = bucketOrder(day.id, scenes.filter(s => cur.dayOf[s.id] === day.id));
    let e8 = 0;
    mine.forEach(s => { const bd = bdOf(s.id); e8 += eighthsToNum(bd.eighths); col.appendChild(buildStrip(s, bd, days, day.id)); });
    tot.textContent = mine.length + " sc · " + fmtEighths(e8) + " pg";
    if (!mine.length) { const p = el("div", "panel-empty"); p.style.padding = "10px 0"; p.textContent = "Drag scenes here"; col.appendChild(p); }
    makeDropZone(col, day.id);
    return col;
  };

  days.forEach(d => grid.appendChild(dayBlock(d)));
  if (!days.length) { const e = el("div", "panel-empty"); e.textContent = "No shooting days yet — add one above."; grid.appendChild(e); }

  const pool = el("div", "day-col pool");
  const ph = el("div", "day-head"); const pt = el("span", "tot");
  const pl = el("span"); pl.style.cssText = "font-family:var(--mono);font-size:12px;font-weight:600";
  pl.textContent = "Unscheduled"; ph.append(pl, pt); pool.appendChild(ph);
  const un = bucketOrder("_pool", scenes.filter(s => !cur.dayOf[s.id]));
  let ue = 0;
  un.forEach(s => { const bd = bdOf(s.id); ue += eighthsToNum(bd.eighths); pool.appendChild(buildStrip(s, bd, days, "_pool")); });
  pt.textContent = un.length + " sc · " + fmtEighths(ue) + " pg";
  makeDropZone(pool, "_pool");
  grid.appendChild(pool);

  wrap.appendChild(grid);

  if (days.length) {
    const csWrap = el("div"); csWrap.style.marginTop = "26px";
    const h = el("div", "ttl"); h.style.marginBottom = "10px"; h.textContent = "Call Sheet";
    const pick = selectEl(days.map(d => d.id), csDayId || days[0].id, v => { csDayId = v; renderSchedule(); });
    [...pick.options].forEach(o => { const d = days.find(x => x.id === o.value); o.textContent = d ? d.label + (d.date ? " · " + d.date : "") : o.value; });
    pick.style.cssText = "font-family:var(--mono);font-size:12px;margin-bottom:12px;background:var(--page);border:1px solid var(--rule);border-radius:6px;padding:5px 8px;color:var(--ink)";
    const day = days.find(d => d.id === (csDayId || days[0].id)) || days[0];
    csWrap.append(h, pick, csEditor(day));
    const pr = el("button", "tbtn primary"); pr.textContent = "Print this call sheet";
    pr.style.marginTop = "12px";
    pr.onclick = () => { csDayId = day.id; printCallSheet(); };
    csWrap.appendChild(pr);
    wrap.appendChild(csWrap);
  }
}

/* ================= PHASE 4b — CALL SHEET ================= */
const CS_FIELDS = [
  ["unitCall", "Unit call"], ["shootCall", "Shooting call"], ["wrap", "Est. wrap"],
  ["location", "Location"], ["address", "Address"], ["parking", "Crew parking"],
  ["hospital", "Nearest hospital"], ["sunrise", "Sunrise"], ["sunset", "Sunset"], ["weather", "Weather"]
];
function ensureCs(dayId) {
  if (!cur.callsheets) cur.callsheets = {};
  if (!cur.callsheets[dayId]) cur.callsheets[dayId] = { notes: "" };
  return cur.callsheets[dayId];
}
function csEditor(day) {
  const cs = ensureCs(day.id);
  const box = el("div");
  const g = el("div", "cs-grid");
  CS_FIELDS.forEach(([k, label]) => {
    const l = el("label"); l.textContent = label;
    const inp = el("input"); inp.value = cs[k] || "";
    inp.oninput = () => { cs[k] = inp.value; save(); };
    l.appendChild(inp); g.appendChild(l);
  });
  box.appendChild(g);
  const nl = el("label", "cs-full"); nl.textContent = "Notes to crew";
  const nt = el("textarea"); nt.value = cs.notes || "";
  nt.oninput = () => { cs.notes = nt.value; save(); };
  nl.appendChild(nt); box.appendChild(nl);
  return box;
}
let csDayId = null;
function printCallSheet() {
  syncFromDom();
  const days = ensureDays();
  if (!days.length) { flashToast("Add a shooting day first"); return; }
  const day = days.find(d => d.id === csDayId) || days[0];
  const cs = ensureCs(day.id);
  const scenes = sceneData().filter(s => cur.dayOf[s.id] === day.id);
  const cast = new Set();
  scenes.forEach(s => ensureBd(s.id).cats.cast.forEach(c => cast.add(c.v)));

  const p = $("#callsheet-print");
  p.innerHTML = "";
  const h1 = el("h1"); h1.textContent = cur.title + " — " + day.label + (day.date ? "  (" + day.date + ")" : "");
  p.appendChild(h1);
  const kv = el("div", "kv");
  CS_FIELDS.forEach(([k, label]) => { if (cs[k]) { const s = el("span"); s.innerHTML = "<b>" + label + ":</b> " + cs[k]; kv.appendChild(s); } });
  p.appendChild(kv);

  const h2 = el("h2"); h2.textContent = "Scenes"; p.appendChild(h2);
  const tb = el("table");
  tb.innerHTML = "<tr><th>#</th><th>Set</th><th>I/E</th><th>D/N</th><th>Pages</th><th>Synopsis</th><th>Cast</th></tr>";
  scenes.forEach(s => {
    const bd = ensureBd(s.id);
    const tr = el("tr");
    [s.n, bd.set || s.slug, bd.ie, bd.dn, bd.eighths, bd.synopsis, bd.cats.cast.map(c => c.v).join(", ")]
      .forEach(v => { const td = el("td"); td.textContent = v || ""; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  p.appendChild(tb);

  if (cast.size) { const h3 = el("h2"); h3.textContent = "Cast"; p.appendChild(h3);
    const cl = el("div", "kv"); cl.textContent = [...cast].join("  ·  "); p.appendChild(cl); }
  if (cs.notes) { const h4 = el("h2"); h4.textContent = "Notes"; p.appendChild(h4);
    const nn = el("div"); nn.style.fontSize = "11px"; nn.style.whiteSpace = "pre-wrap"; nn.textContent = cs.notes; p.appendChild(nn); }

  document.body.classList.add("printing-cs");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-cs"), 400);
}

/* ================= PHASE 4c — BUDGET ================= */
const BUDGET_CATS = ["Story & Rights", "Producers", "Direction", "Cast", "Production Staff",
  "Set Construction", "Set Operations", "Camera", "Electrical / Grip", "Sound", "Wardrobe",
  "Makeup & Hair", "Locations", "Transportation", "Picture Vehicles / Animals", "Media / Stock",
  "Editing", "Music", "Post Sound", "Visual Effects", "Insurance", "Legal & Accounting",
  "Publicity", "Contingency", "Other"];
function ensureBudget() { if (!cur.budget) cur.budget = []; return cur.budget; }
function money(n) { return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); }

function renderBudget() {
  const wrap = $("#budget"); wrap.innerHTML = "";
  const rows = ensureBudget();

  const bar = el("div", "panel-bar");
  const ttl = el("div", "ttl"); ttl.textContent = "Budget — " + cur.title;
  const grow = el("div", "grow");
  const add = el("button", "tbtn"); add.textContent = "+ Line item";
  add.onclick = () => { rows.push({ id: uid(), cat: BUDGET_CATS[0], desc: "", qty: 1, unit: "flat", rate: 0 }); save(); renderBudget(); };
  const csv = el("button", "tbtn primary"); csv.textContent = "Copy CSV";
  csv.onclick = copyBudgetCsv;
  bar.append(ttl, grow, add, csv);
  wrap.appendChild(bar);

  if (!rows.length) { const e = el("div", "panel-empty"); e.textContent = "No line items yet. Add your first cost."; wrap.appendChild(e); updateBudgetFooter(); return; }

  const wrapT = el("div"); wrapT.style.overflowX = "auto";
  const t = el("table", "bg-table");
  t.innerHTML = "<thead><tr><th>Description</th><th style='width:70px'>Qty</th><th style='width:90px'>Unit</th><th style='width:110px'>Rate</th><th style='width:110px' class='num'>Total</th><th style='width:34px'></th></tr></thead>";
  const tbody = el("tbody");
  let grand = 0;
  BUDGET_CATS.forEach(cat => {
    const inCat = rows.filter(r => r.cat === cat);
    if (!inCat.length) return;
    const cr = el("tr", "bg-cat-row");
    const ctd = el("td"); ctd.colSpan = 6; ctd.textContent = cat;
    cr.appendChild(ctd); tbody.appendChild(cr);
    let sub = 0;
    inCat.forEach(r => {
      const tr = el("tr");
      const dtd = el("td");
      const di = el("input"); di.value = r.desc; di.placeholder = "item";
      di.oninput = () => { r.desc = di.value; save(); };
      const catSel = selectEl(BUDGET_CATS, r.cat, v => { r.cat = v; save(); renderBudget(); });
      catSel.style.cssText = "font-size:8px;margin-top:2px;color:var(--faint)";
      dtd.append(di, catSel);
      const qtd = el("td");
      const qi = el("input"); qi.className = "r"; qi.value = r.qty; qi.inputMode = "decimal";
      qi.oninput = () => { r.qty = parseFloat(qi.value) || 0; total(); save(); };
      qi.onchange = () => renderBudget();
      qtd.appendChild(qi);
      const utd = el("td");
      const ui = el("input"); ui.value = r.unit || ""; ui.placeholder = "day";
      ui.oninput = () => { r.unit = ui.value; save(); };
      utd.appendChild(ui);
      const rtd = el("td");
      const ri = el("input"); ri.className = "r"; ri.value = r.rate; ri.inputMode = "decimal";
      ri.oninput = () => { r.rate = parseFloat(ri.value) || 0; total(); save(); };
      ri.onchange = () => renderBudget();
      rtd.appendChild(ri);
      const ttd = el("td", "num"); ttd.textContent = money((r.qty || 0) * (r.rate || 0));
      const xtd = el("td");
      const x = el("button", "icon-btn"); x.textContent = "×";
      x.onclick = () => { cur.budget = cur.budget.filter(z => z.id !== r.id); save(); renderBudget(); };
      xtd.appendChild(x);
      function total() { ttd.textContent = money((r.qty || 0) * (r.rate || 0)); updateBudgetFooter(); }
      tr.append(dtd, qtd, utd, rtd, ttd, xtd);
      tbody.appendChild(tr);
      sub += (r.qty || 0) * (r.rate || 0);
    });
    grand += sub;
    const sr = el("tr");
    const s1 = el("td"); s1.colSpan = 4; s1.style.textAlign = "right"; s1.style.color = "var(--faint)"; s1.textContent = cat + " subtotal";
    const s2 = el("td", "num"); s2.textContent = money(sub); s2.style.fontWeight = "600";
    sr.append(s1, s2, el("td"));
    tbody.appendChild(sr);
  });
  t.appendChild(tbody);
  wrapT.appendChild(t);
  wrap.appendChild(wrapT);

  const tot = el("div", "bg-total");
  tot.innerHTML = '<span style="color:var(--faint);text-transform:uppercase;font-size:10px;letter-spacing:.1em">Total below the line</span><span class="amt"></span>';
  tot.querySelector(".amt").textContent = money(grand);
  wrap.appendChild(tot);
  updateBudgetFooter();
}
function budgetTotal() { return ensureBudget().reduce((a, r) => a + (r.qty || 0) * (r.rate || 0), 0); }
function updateBudgetFooter() { $("#stWords").textContent = money(budgetTotal()); }
function copyBudgetCsv() {
  const rows = [["Category", "Description", "Qty", "Unit", "Rate", "Total"]];
  ensureBudget().forEach(r => rows.push([r.cat, r.desc, r.qty, r.unit, r.rate, (r.qty || 0) * (r.rate || 0)]));
  rows.push([]); rows.push(["", "", "", "", "TOTAL", budgetTotal()]);
  const text = rows.map(r => r.map(csvCell).join(",")).join("\n");
  navigator.clipboard.writeText(text).then(
    () => flashToast("Budget CSV copied to clipboard"),
    () => flashToast("Copy failed — try again")
  );
}

/* ================= PHASE 5 — CLOUD SYNC (db) ================= */
const cloud = { db: null, on: false, unsub: null, cid: uid() + uid(), rev: 0, applying: false, pushT: null };
function stripImages(d) {
  const c = JSON.parse(JSON.stringify(d));
  (c.projects || []).forEach(p => Object.values(p.shots || {}).forEach(l => l.forEach(s => { delete s.img; })));
  return c;
}
function mergeLocalImages(remote) {
  const imgs = {};
  (data.projects || []).forEach(p => Object.values(p.shots || {}).forEach(l => l.forEach(s => { if (s.img) imgs[s.id] = s.img; })));
  (remote.projects || []).forEach(p => Object.values(p.shots || {}).forEach(l => l.forEach(s => { if (imgs[s.id]) s.img = imgs[s.id]; })));
  return remote;
}
function updateCloudPill() {
  const pill = $("#cloudPill"), txt = $("#cloudTxt");
  pill.classList.toggle("on", cloud.on);
  txt.textContent = !cloud.db ? "Local only" : cloud.on ? "Cloud synced" : "Local";
}
function cloudPush() {
  if (!cloud.on || !cloud.db) return;
  clearTimeout(cloud.pushT);
  cloud.pushT = setTimeout(async () => {
    cloud.rev++;
    const body = stripImages(data);
    body._cid = cloud.cid; body._rev = cloud.rev; body._t = Date.now();
    try {
      await cloud.db.doc("library/main").set(body);
    } catch (e) {
      if (e && e.code === "invalid_argument") flashToast("Project too large for cloud sync — still saved locally");
      else flashToast("Cloud save failed — saved locally");
    }
  }, 900);
}
async function enableCloud(on) {
  if (!cloud.db) { flashToast("Cloud sync isn't available in this view"); return; }
  cloud.on = on;
  try { localStorage.setItem("noxel.cloud", on ? "on" : "off"); } catch (e) {}
  updateCloudPill();
  if (cloud.unsub) { cloud.unsub(); cloud.unsub = null; }
  if (!on) return;
  const doc = cloud.db.doc("library/main");
  try {
    const snap = await doc.get();
    if (snap.exists && snap.data()) {
      const remote = snap.data();
      if (confirm("Cloud copy found. Load it into this browser?\n\nOK = use the cloud version   ·   Cancel = upload this browser's version")) {
        cloud.rev = remote._rev || 0;
        data = mergeLocalImages(JSON.parse(JSON.stringify(remote)));
        cur = data.projects.find(p => p.id === data.currentId) || data.projects[0];
        save(true); boot();
      } else { cloudPush(); }
    } else { cloudPush(); }
  } catch (e) { flashToast("Couldn't reach the cloud"); cloud.on = false; updateCloudPill(); return; }
  cloud.unsub = doc.onSnapshot(snap => {
    if (!snap.exists) return;
    const r = snap.data();
    if (!r || r._cid === cloud.cid) return;
    if ((r._rev || 0) <= cloud.rev) return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable)) return;
    cloud.rev = r._rev || 0;
    cloud.applying = true;
    data = mergeLocalImages(JSON.parse(JSON.stringify(r)));
    cur = data.projects.find(p => p.id === data.currentId) || data.projects[0];
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) {}
    boot();
    cloud.applying = false;
    flashToast("Updated from cloud");
  }, err => { flashToast("Cloud sync stopped"); cloud.on = false; updateCloudPill(); });
}
$("#cloudPill").addEventListener("click", () => enableCloud(!cloud.on));
async function initCloud() {
  try { cloud.db = await claude.use("db"); } catch (e) { cloud.db = null; }
  updateCloudPill();
  if (cloud.db) openCommentsDoc();
  let want = false;
  try { want = localStorage.getItem("noxel.cloud") === "on"; } catch (e) {}
  if (cloud.db && want) enableCloud(true);
}
if (typeof claude !== "undefined" && claude && typeof claude.use === "function") { initCloud(); initRoom(); }
else updateCloudPill();

/* ================= FOUNTAIN IMPORT / EXPORT ================= */
function fountainExport() {
  syncFromDom();
  const out = ["Title: " + cur.title];
  (cur.author || "").split("\n").forEach((l, i) => { if (l.trim()) out.push((i === 0 ? "Credit: " : "Author: ") + l.trim()); });
  if (cur.contact) out.push("Contact: " + cur.contact);
  out.push("");
  cur.blocks.forEach(b => {
    const t = (b.text || "").trim();
    if (b.type === "scene") { out.push("", (/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. /]/i.test(t) ? "" : ".") + t.toUpperCase()); }
    else if (b.type === "action") { out.push("", t); }
    else if (b.type === "character") { out.push("", t.toUpperCase()); }
    else if (b.type === "paren") { out.push(/^\(.*\)$/.test(t) ? t : "(" + t + ")"); }
    else if (b.type === "dialogue") { out.push(t); }
    else if (b.type === "transition") { out.push("", "> " + t.toUpperCase()); }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
function fountainImport(text) {
  if (!text || !text.trim()) return null;
  text = text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const meta = {};
  let i = 0;
  if (/^[A-Za-z][A-Za-z ]*:/.test(lines[0] || "")) {
    let key = null;
    for (; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim() === "") { i++; break; }
      const m = ln.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
      if (m) { key = m[1].toLowerCase().trim(); meta[key] = m[2].trim(); }
      else if (key) meta[key] += (meta[key] ? "\n" : "") + ln.trim();
    }
  }
  const blocks = [];
  const push = (type, txt) => blocks.push({ id: uid(), type, text: txt });
  let blank = true;
  for (; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\t/g, "  ").trim();
    if (trimmed === "") { blank = true; continue; }
    const upper = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
    const lb = blocks[blocks.length - 1];
    if (/^\.[^.]/.test(trimmed)) { push("scene", trimmed.slice(1).trim().toUpperCase()); blank = false; continue; }
    if (/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. /]/i.test(trimmed)) { push("scene", trimmed.toUpperCase()); blank = false; continue; }
    if (/^>/.test(trimmed)) { push("transition", trimmed.replace(/^>\s*/, "").replace(/\s*<$/, "").toUpperCase()); blank = false; continue; }
    if (blank && upper && /(TO:|CUT|DISSOLVE|SMASH|MATCH|FADE)/.test(trimmed) && trimmed.length < 32) { push("transition", trimmed); blank = false; continue; }
    if (/^\(.*\)$/.test(trimmed) && lb && (lb.type === "character" || lb.type === "dialogue")) { push("paren", trimmed); blank = false; continue; }
    const nextFilled = (lines[i + 1] || "").trim() !== "";
    if (blank && upper && nextFilled && trimmed.length < 40 && !/[.!?,;:]$/.test(trimmed)) { push("character", trimmed.replace(/\s*\^$/, "").toUpperCase()); blank = false; continue; }
    if (!blank && lb && (lb.type === "character" || lb.type === "paren" || lb.type === "dialogue")) { push("dialogue", trimmed); blank = false; continue; }
    push("action", trimmed); blank = false;
  }
  return blocks.length ? { meta, blocks } : null;
}

/* ================= PRESENCE (room) ================= */
const PCOLORS = ["#e0714f", "#4f9de0", "#63b463", "#c98bdb", "#d8a13a", "#3ec7c0"];
const live = { room: null, peers: [], name: "", color: PCOLORS[Math.floor(Math.random() * 6)], scene: null, pT: 0 };
try { live.name = localStorage.getItem("noxel.name") || ""; } catch (e) {}
async function initRoom() {
  try { live.room = await claude.use("room"); } catch (e) { live.room = null; }
  if (!live.room) return;
  if (!live.name) live.name = "Guest " + Math.floor(Math.random() * 90 + 10);
  pushPresence();
  live.room.onPeers(ch => {
    live.peers = ch.peers.filter(p => !p.isMe && p.kind === "viewer");
    renderPeers();
    renderScriptPeers();
  }, () => { live.peers = []; renderPeers(); renderScriptPeers(); });
}
function pushPresence() {
  const now = Date.now();
  if (now - live.pT < 250) return;
  live.pT = now;
  const state = {
    name: live.name || "Guest", color: live.color,
    mode: document.body.dataset.mode || "write",
    project: cur ? cur.id : null, projectTitle: cur ? cur.title : null,
    scene: live.scene || null, block: live.block || null
  };
  if (HOST && HOST.onPresence) { try { HOST.onPresence(state); } catch (e) {} }
  if (!live.room) return;
  try {
    live.room.presence({
      name: live.name || "Guest", color: live.color,
      mode: document.body.dataset.mode || "write",
      project: cur ? cur.id : null, projectTitle: cur ? cur.title : null,
      scene: live.scene || null, block: live.block || null
    });
  } catch (e) {}
}
function renderScriptPeers() {
  const layer = $("#cursorLayer");
  if (!layer) return;
  layer.innerHTML = "";
  if (document.body.dataset.mode !== "write") return;
  const seen = new Set();
  live.peers.forEach(p => {
    if (seen.has(p.peer)) return; seen.add(p.peer);
    const pr = p.presence || {};
    if (!cur || pr.project !== cur.id || !pr.block) return;
    let b; try { b = scriptEl.querySelector('.block[data-id="' + (window.CSS && CSS.escape ? CSS.escape(pr.block) : pr.block) + '"]'); } catch (e) { b = null; }
    if (!b) return;
    const top = b.offsetTop;
    const bar = el("div", "peer-bar"); bar.style.background = pr.color || "#888";
    bar.style.top = top + "px"; bar.style.height = b.offsetHeight + "px";
    const flag = el("div", "peer-flag"); flag.textContent = pr.name || "Someone";
    flag.style.background = pr.color || "#888"; flag.style.top = Math.max(0, top - 12) + "px";
    layer.append(bar, flag);
  });
}

function renderPeers() {
  const bar = $("#peers");
  bar.innerHTML = "";
  const seen = new Set();
  live.peers.forEach(p => {
    if (seen.has(p.peer)) return; seen.add(p.peer);
    const pr = p.presence || {};
    const d = el("span", "peer");
    d.style.setProperty("--pc", pr.color || "#8a8178");
    d.textContent = (pr.name || "??").replace(/[^A-Za-z ]/g, "").trim().slice(0, 2).toUpperCase() || "?";
    let where = pr.projectTitle && cur && pr.project !== cur.id ? " · on “" + pr.projectTitle + "”" : "";
    if (pr.scene) where += " · " + pr.scene;
    d.title = (pr.name || "Someone") + " · " + (pr.mode || "write") + where;
    bar.appendChild(d);
  });
  bar.hidden = !bar.children.length;
}

/* ================= COMMENTS (db) ================= */
const notes = { ref: null, unsub: null, items: [] };
function commentsForScene(sid) { return notes.items.filter(c => c.sceneId === sid); }
function openCommentsDoc() {
  if (!cloud.db || !cur) return;
  if (notes.unsub) { notes.unsub(); notes.unsub = null; }
  notes.items = [];
  try {
    notes.ref = cloud.db.doc("comments/" + cur.id);
  } catch (e) { notes.ref = null; return; }
  notes.unsub = notes.ref.onSnapshot(snap => {
    notes.items = (snap.exists && Array.isArray(snap.data().items)) ? snap.data().items : [];
    if (document.body.dataset.mode === "write" || document.body.dataset.mode === "breakdown") renderScenes();
    if (scrim.classList.contains("open") && $("#cmBody")) renderCommentPanel();
  }, () => {});
}
async function saveComments(items) {
  notes.items = items;
  if (HOST && HOST.onComments) { try { HOST.onComments(items); } catch (e) {} return; }
  if (!notes.ref) return;
  try { await notes.ref.set({ items }); } catch (e) { flashToast("Comment didn't sync"); }
}
function addComment(sceneId, text) {
  text = (text || "").trim(); if (!text) return;
  const item = { id: uid(), sceneId, text, author: live.name || "Guest", ts: Date.now(), resolved: false };
  saveComments(notes.items.concat([item]));
}
function toggleResolve(id) {
  saveComments(notes.items.map(c => c.id === id ? Object.assign({}, c, { resolved: !c.resolved }) : c));
}
function deleteComment(id) { saveComments(notes.items.filter(c => c.id !== id)); }

function renderCommentPanel() {
  const body = $("#cmBody");
  const scenes = sceneData();
  body.innerHTML = "";
  if (!cloud.db && !(HOST && HOST.onComments)) {
    const p = el("div"); p.style.cssText = "font-size:13px;color:var(--muted)";
    p.textContent = "Comments sync through the shared store, which isn't available in this view.";
    body.appendChild(p); return;
  }
  if (!scenes.length) { body.innerHTML = '<div style="font-size:13px;color:var(--muted)">Add scenes first.</div>'; return; }
  scenes.forEach(s => {
    const list = commentsForScene(s.id);
    const sec = el("div", "cm-scene");
    const h = el("h4"); h.textContent = String(s.n).padStart(2, "0") + "  " + s.slug;
    sec.appendChild(h);
    list.forEach(c => {
      const it = el("div", "cm-item" + (c.resolved ? " resolved" : ""));
      const m = el("div", "meta");
      const who = el("span"); who.textContent = c.author + " · " + new Date(c.ts).toLocaleDateString();
      const rb = el("button"); rb.textContent = c.resolved ? "reopen" : "resolve";
      rb.onclick = () => toggleResolve(c.id);
      const db_ = el("button"); db_.textContent = "delete"; db_.onclick = () => deleteComment(c.id);
      m.append(who, rb, db_);
      const tx = el("div"); tx.textContent = c.text;
      it.append(m, tx);
      sec.appendChild(it);
    });
    const add = el("div", "cm-add");
    const inp = el("input"); inp.placeholder = "Comment on this scene…";
    const go = el("button", "tbtn"); go.textContent = "Post";
    const post = () => { if (inp.value.trim()) { addComment(s.id, inp.value); inp.value = ""; } };
    go.onclick = post;
    inp.onkeydown = e => { if (e.key === "Enter") post(); };
    add.append(inp, go);
    sec.appendChild(add);
    body.appendChild(sec);
  });
}
$("#notesBtn").addEventListener("click", () => {
  syncFromDom();
  const m = $("#modal");
  m.classList.add("wide");
  m.innerHTML = '<h3>Scene Notes &amp; Comments</h3><div class="cm-body" id="cmBody"></div><div class="row"><button class="tbtn primary" id="cmClose">Done</button></div>';
  $("#cmClose").onclick = closeModal;
  renderCommentPanel();
  scrim.classList.add("open");
});

/* ================= STRIPBOARD DRAG & DROP ================= */
let dragSid = null;
function bucketOrder(key, arr) {
  const ord = (cur.stripOrder && cur.stripOrder[key]) || [];
  return arr.slice().sort((a, b) => {
    const ia = ord.indexOf(a.id), ib = ord.indexOf(b.id);
    if (ia < 0 && ib < 0) return a.n - b.n;
    if (ia < 0) return 1; if (ib < 0) return -1;
    return ia - ib;
  });
}
function moveStrip(srcId, key, beforeId) {
  if (!cur.stripOrder) cur.stripOrder = {};
  cur.dayOf[srcId] = (key === "_pool" ? "" : key);
  Object.keys(cur.stripOrder).forEach(k => { cur.stripOrder[k] = (cur.stripOrder[k] || []).filter(x => x !== srcId); });
  const a = cur.stripOrder[key] = (cur.stripOrder[key] || []);
  const idx = beforeId ? a.indexOf(beforeId) : -1;
  if (idx >= 0) a.splice(idx, 0, srcId); else a.push(srcId);
  save(); renderSchedule();
}

/* ---------------- mode switching ---------------- */
const MODES = ["write", "breakdown", "shots", "schedule", "budget"];
function setMode(mode) {
  if (!MODES.includes(mode)) mode = "write";
  syncFromDom(); save();
  document.body.dataset.mode = mode;
  MODES.forEach(m => {
    const b = $("#mode-" + m);
    b.classList.toggle("active", m === mode);
    b.setAttribute("aria-selected", m === mode ? "true" : "false");
  });
  $("#pdfBtn").textContent = mode === "schedule" ? "Print call sheet" : "Export PDF";
  $("#stWordsK").textContent = mode === "breakdown" ? "Elements"
    : mode === "shots" ? "Shots done"
    : mode === "budget" ? "Total" : "Words";
  renderScenes();
  if (mode === "breakdown") renderBreakdown();
  else if (mode === "shots") renderShots();
  else if (mode === "schedule") renderSchedule();
  else if (mode === "budget") renderBudget();
  else syncStats();
  renderScriptPeers();
  $("#main").scrollTop = 0;
  pushPresence();
}
MODES.forEach(m => $("#mode-" + m).addEventListener("click", () => setMode(m)));

/* ---------------- boot ---------------- */
function boot() {
  cur.blocks.forEach(b => { if (!b.id) b.id = uid(); });
  if (!cur.shots) cur.shots = {};
  if (!cur.days) cur.days = [];
  if (!cur.dayOf) cur.dayOf = {};
  if (!cur.callsheets) cur.callsheets = {};
  if (!cur.budget) cur.budget = [];
  if (!cur.stripOrder) cur.stripOrder = {};
  refreshProjSelect();
  renderTitle();
  renderScript();
  if (!cur.breakdown) {
    cur.breakdown = {};
    sceneData().forEach(s => autoScanScene(s, false));
  }
  openCommentsDoc();
  setMode("write");
  pushPresence();
  const d = new Date(cur.updated);
  $("#stSaved").textContent = isToday(d) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}
function isToday(d) { const n = new Date(); return d.toDateString() === n.toDateString(); }

window.addEventListener("beforeunload", () => { syncFromDom(); save(true); });

// Bridge for an embedding host (Supabase web build). No-op in the standalone artifact.
window.__noxel = {
  reload(lib) {
    data = lib || load();
    cur = data.projects.find(p => p.id === data.currentId) || data.projects[0];
    boot();
  },
  currentLibrary() { syncFromDom(); return data; },
  setComments(items) {
    notes.items = Array.isArray(items) ? items : [];
    const m = document.body.dataset.mode;
    if (m === "write" || m === "breakdown") renderScenes();
    if (scrim.classList.contains("open") && $("#cmBody")) renderCommentPanel();
  },
  setPeers(list) { live.peers = Array.isArray(list) ? list : []; renderPeers(); renderScriptPeers(); },
  setName(n) { live.name = n || live.name; },
  onReady: null
};
if (HOST) {
  document.getElementById("cloudPill").hidden = true;
  document.getElementById("newBtn").hidden = true;
  document.getElementById("projSelect").hidden = true;
}

boot();
if (HOST && typeof HOST.onReady === "function") { try { HOST.onReady(window.__noxel); } catch (e) {} }
