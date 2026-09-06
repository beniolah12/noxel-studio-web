// api/mcp.js — Model Context Protocol server for Noxel Studio.
//
// Lets Claude (or any MCP client) connect as a connector and read / write
// screenplays in a Noxel project. Stateless Streamable-HTTP transport:
// one JSON-RPC 2.0 response per POST, no sessions, no SSE.
//
// Connector URL:  https://noxel-web.vercel.app/api/mcp?key=<NOXEL_MCP_TOKEN>
// (the ?key is only required when NOXEL_MCP_TOKEN is set in the environment)

const SB_URL = process.env.SB_URL || "https://rdtvejebscvggfoqwjqx.supabase.co";
const SB_KEY = process.env.SB_KEY || "sb_publishable_GEs52kcMUf4F5Tvq-xz84g_RkW3mEkP";
const TOKEN = process.env.NOXEL_MCP_TOKEN || "";
const APP_ORIGIN = process.env.APP_ORIGIN || "https://noxel-web.vercel.app";

const PROTO_FALLBACK = "2025-06-18";
const SERVER_INFO = { name: "noxel-studio", version: "1.0.0" };

/* ------------------------------------------------------------------ helpers */
const uid = () => Math.random().toString(36).slice(2, 9);
const nowISO = () => new Date().toISOString();
const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. /]/i;

function scriptId(ref) {
  const s = String(ref || "").trim();
  const q = s.match(/[?&]p=([^&\s]+)/);
  if (q) return decodeURIComponent(q[1]);
  const u = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (u) return u[0];
  return s;
}
function shareUrl(id) { return APP_ORIGIN + "/?p=" + id; }

/* --------------------------------------------------------------- Supabase */
async function sbGet(id) {
  const r = await fetch(
    SB_URL + "/rest/v1/projects?id=eq." + encodeURIComponent(id) + "&select=id,title,data",
    { headers: { apikey: SB_KEY, authorization: "Bearer " + SB_KEY, accept: "application/json" } }
  );
  if (!r.ok) throw new Error("Supabase read failed (HTTP " + r.status + ")");
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function sbPatch(id, fields) {
  const r = await fetch(SB_URL + "/rest/v1/projects?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: {
      apikey: SB_KEY, authorization: "Bearer " + SB_KEY,
      "content-type": "application/json", prefer: "return=representation"
    },
    body: JSON.stringify(fields)
  });
  if (!r.ok) throw new Error("Supabase write failed (HTTP " + r.status + ")");
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function sbInsert(fields) {
  const r = await fetch(SB_URL + "/rest/v1/projects", {
    method: "POST",
    headers: {
      apikey: SB_KEY, authorization: "Bearer " + SB_KEY,
      "content-type": "application/json", prefer: "return=representation"
    },
    body: JSON.stringify(fields)
  });
  if (!r.ok) throw new Error("Supabase insert failed (HTTP " + r.status + ")");
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows[0]) throw new Error("Supabase insert returned no row");
  return rows[0];
}

/* -------------------------------------------------------- screenplay model */
function blankProject(title) {
  return {
    id: uid(),
    title: title || "UNTITLED",
    author: "Written by\nYour Name",
    contact: "",
    updated: Date.now(),
    blocks: [{ id: uid(), type: "scene", text: "" }],
    breakdown: null, shots: {}, days: [], dayOf: {}, callsheets: {}, budget: [], stripOrder: {},
    _comments: []
  };
}

// Port of the app's fountainImport() with no DOM. Returns [{id,type,text}].
function parseFountain(text) {
  if (!text || !text.trim()) return [];
  text = text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  let i = 0;
  // skip a leading title-page block ("Title:", "Author:", …)
  if (/^[A-Za-z][A-Za-z ]*:/.test(lines[0] || "")) {
    for (; i < lines.length; i++) if (lines[i].trim() === "") { i++; break; }
  }
  const blocks = [];
  const push = (type, txt) => blocks.push({ id: uid(), type, text: txt });
  let blank = true;
  for (; i < lines.length; i++) {
    const t = lines[i].replace(/\t/g, "  ").trim();
    if (t === "") { blank = true; continue; }
    const upper = t === t.toUpperCase() && /[A-Z]/.test(t);
    const lb = blocks[blocks.length - 1];
    if (/^\.[^.]/.test(t)) { push("scene", t.slice(1).trim().toUpperCase()); blank = false; continue; }
    if (SCENE_RE.test(t)) { push("scene", t.toUpperCase()); blank = false; continue; }
    if (/^>/.test(t)) { push("transition", t.replace(/^>\s*/, "").replace(/\s*<$/, "").toUpperCase()); blank = false; continue; }
    if (blank && upper && /(TO:|CUT|DISSOLVE|SMASH|MATCH|FADE)/.test(t) && t.length < 32) { push("transition", t); blank = false; continue; }
    if (/^\(.*\)$/.test(t) && lb && (lb.type === "character" || lb.type === "dialogue")) { push("paren", t); blank = false; continue; }
    const nextFilled = (lines[i + 1] || "").trim() !== "";
    if (blank && upper && nextFilled && t.length < 40 && !/[.!?,;:]$/.test(t)) {
      push("character", t.replace(/\s*\^$/, "").toUpperCase()); blank = false; continue;
    }
    if (!blank && lb && (lb.type === "character" || lb.type === "paren" || lb.type === "dialogue")) {
      push("dialogue", t); blank = false; continue;
    }
    push("action", t); blank = false;
  }
  return blocks;
}

function parseActionOnly(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map(s => s.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map(s => ({ id: uid(), type: "action", text: s }));
}

function toBlocks(content, format) {
  const b = format === "action" ? parseActionOnly(content) : parseFountain(content);
  return b.length ? b : parseActionOnly(content);
}

// Port of the app's fountainExport().
function toFountain(proj) {
  const out = ["Title: " + (proj.title || "Untitled")];
  (proj.author || "").split("\n").forEach((l, idx) => { if (l.trim()) out.push((idx === 0 ? "Credit: " : "Author: ") + l.trim()); });
  if (proj.contact) out.push("Contact: " + proj.contact);
  out.push("");
  (proj.blocks || []).forEach(bl => {
    const t = (bl.text || "").trim();
    if (bl.type === "scene") out.push("", (SCENE_RE.test(t) ? "" : ".") + t.toUpperCase());
    else if (bl.type === "action") out.push("", t);
    else if (bl.type === "character") out.push("", t.toUpperCase());
    else if (bl.type === "paren") out.push(/^\(.*\)$/.test(t) ? t : "(" + t + ")");
    else if (bl.type === "dialogue") out.push(t);
    else if (bl.type === "transition") out.push("", "> " + t.toUpperCase());
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function stats(proj) {
  const blocks = proj.blocks || [];
  const chars = [...new Set(
    blocks.filter(b => b.type === "character")
      .map(b => (b.text || "").trim().toUpperCase().replace(/\s*\(.*\)\s*$/, ""))
      .filter(Boolean)
  )];
  const words = blocks.reduce((n, b) => n + ((b.text || "").trim() ? b.text.trim().split(/\s+/).length : 0), 0);
  const rows = blocks.reduce((n, b) => {
    const w = { scene: 58, action: 60, character: 38, dialogue: 35, paren: 30, transition: 60 }[b.type] || 60;
    return n + Math.max(1, Math.ceil((b.text || "").length / w)) + (b.type === "scene" ? 2 : 1);
  }, 0);
  return {
    scenes: blocks.filter(b => b.type === "scene").length,
    pagesApprox: Math.max(1, Math.round(rows / 56)),
    characters: chars,
    words
  };
}

async function loadProj(ref) {
  const id = scriptId(ref);
  const row = await sbGet(id);
  if (!row) throw new Error('No script found for "' + ref + '". Double-check the share link.');
  const proj = row.data && typeof row.data === "object" ? row.data : blankProject(row.title);
  if (!Array.isArray(proj.blocks)) proj.blocks = [];
  return { id, proj };
}

async function saveProj(id, proj) {
  proj.updated = Date.now();
  proj._w = "mcp:" + Date.now(); // so the live editor treats this as an external write
  await sbPatch(id, { title: proj.title || "Untitled", data: proj, updated_at: nowISO() });
}

/* --------------------------------------------------------------- MCP tools */
const TOOLS = [
  {
    name: "create_script",
    description:
      "Create a brand-new Noxel screenplay and return its shareable link. Optionally seed it with content — Fountain screenplay text, or plain paragraphs.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Script title" },
        content: { type: "string", description: "Optional initial screenplay text (Fountain by default)." },
        format: {
          type: "string", enum: ["fountain", "action"],
          description: "'fountain' (default) parses scene headings / characters / dialogue; 'action' turns each paragraph into an action line."
        }
      },
      required: ["title"]
    }
  },
  {
    name: "get_script",
    description:
      "Read an existing Noxel script. Returns the title, the full screenplay as Fountain text, and stats (scenes, approx pages, characters).",
    inputSchema: {
      type: "object",
      properties: { script: { type: "string", description: "The script's share link or id" } },
      required: ["script"]
    }
  },
  {
    name: "append_scenes",
    description:
      "Append screenplay content to the END of an existing Noxel script, leaving everything already there untouched. Use for adding new scenes, dialogue or action.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "Share link or id" },
        content: { type: "string", description: "Screenplay text to append (Fountain by default)." },
        format: { type: "string", enum: ["fountain", "action"] }
      },
      required: ["script", "content"]
    }
  },
  {
    name: "replace_script",
    description:
      "Replace the ENTIRE body of an existing Noxel script with new content. Overwrites every existing scene. Optionally also set a new title.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string" },
        content: { type: "string", description: "The full new screenplay text." },
        format: { type: "string", enum: ["fountain", "action"] },
        title: { type: "string", description: "Optional new title" }
      },
      required: ["script", "content"]
    }
  },
  {
    name: "set_title",
    description: "Rename an existing Noxel script.",
    inputSchema: {
      type: "object",
      properties: { script: { type: "string" }, title: { type: "string" } },
      required: ["script", "title"]
    }
  },
  {
    name: "add_note",
    description:
      "Attach a note/comment to a scene in a Noxel script (appears in the Notes panel). Identify the scene by its 1-based number or a keyword from its heading; omit to attach to the first scene.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string" },
        text: { type: "string", description: "The note text" },
        scene: { type: "string", description: "Scene number (e.g. '3') or a keyword from the scene heading" }
      },
      required: ["script", "text"]
    }
  }
];

async function callTool(name, args) {
  args = args || {};

  if (name === "create_script") {
    const proj = blankProject(args.title);
    const seeded = args.content ? toBlocks(args.content, args.format) : [];
    if (seeded.length) proj.blocks = seeded;
    proj.updated = Date.now();
    proj._w = "mcp:" + Date.now();
    const row = await sbInsert({ title: proj.title || "Untitled", data: proj });
    const st = stats(proj);
    return 'Created "' + proj.title + '".\nShare link: ' + shareUrl(row.id) +
      "\n" + st.scenes + " scene(s), ~" + st.pagesApprox + " page(s).";
  }

  if (name === "get_script") {
    const { id, proj } = await loadProj(args.script);
    const st = stats(proj);
    return "Title: " + proj.title +
      "\nLink: " + shareUrl(id) +
      "\nScenes: " + st.scenes + " · ~" + st.pagesApprox + " pages · Words: " + st.words +
      "\nCharacters: " + (st.characters.join(", ") || "—") +
      "\n\n----- FOUNTAIN -----\n" + toFountain(proj);
  }

  if (name === "append_scenes") {
    const { id, proj } = await loadProj(args.script);
    const add = toBlocks(args.content, args.format);
    if (!add.length) throw new Error("Nothing to append — content was empty or unparseable.");
    if (proj.blocks.length === 1 && proj.blocks[0].type === "scene" && !(proj.blocks[0].text || "").trim()) {
      proj.blocks = []; // drop the lone empty starter scene
    }
    proj.blocks = proj.blocks.concat(add);
    await saveProj(id, proj);
    const st = stats(proj);
    return "Appended " + add.length + ' block(s) to "' + proj.title + '". Now ' +
      st.scenes + " scene(s), ~" + st.pagesApprox + " page(s).\nOpen: " + shareUrl(id);
  }

  if (name === "replace_script") {
    const { id, proj } = await loadProj(args.script);
    const next = toBlocks(args.content, args.format);
    if (!next.length) throw new Error("Refusing to replace with empty content.");
    proj.blocks = next;
    if (args.title) proj.title = args.title;
    await saveProj(id, proj);
    const st = stats(proj);
    return 'Replaced "' + proj.title + '" — ' + st.scenes + " scene(s), ~" +
      st.pagesApprox + " page(s).\nOpen: " + shareUrl(id);
  }

  if (name === "set_title") {
    const { id, proj } = await loadProj(args.script);
    proj.title = args.title || proj.title;
    await saveProj(id, proj);
    return 'Renamed to "' + proj.title + '".\nOpen: ' + shareUrl(id);
  }

  if (name === "add_note") {
    const { id, proj } = await loadProj(args.script);
    const scenes = proj.blocks.filter(b => b.type === "scene");
    let target = scenes[0];
    const q = args.scene != null ? String(args.scene).trim() : "";
    if (q) {
      if (/^\d+$/.test(q)) target = scenes[+q - 1] || target;
      else {
        const hit = scenes.find(s => (s.text || "").toUpperCase().includes(q.toUpperCase()));
        if (hit) target = hit;
      }
    }
    if (!target) throw new Error("This script has no scenes yet — add a scene first.");
    if (!target.id) target.id = uid();
    const items = Array.isArray(proj._comments) ? proj._comments.slice() : [];
    items.push({
      id: uid(), sceneId: target.id, text: String(args.text || "").trim(),
      author: "Claude", ts: Date.now(), resolved: false
    });
    proj._comments = items;
    await saveProj(id, proj);
    return 'Note added to "' + (target.text || "scene 1") + '".\nOpen: ' + shareUrl(id);
  }

  throw new Error("Unknown tool: " + name);
}

/* ----------------------------------------------------------- JSON-RPC / MCP */
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRpc(msg, clientProto) {
  const { id, method, params } = msg || {};

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: (params && params.protocolVersion) || clientProto || PROTO_FALLBACK,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        "Create and edit screenplays in Noxel Studio. Pass a script's share link " +
        "(https://noxel-web.vercel.app/?p=…) as the `script` argument. Content is Fountain format by default."
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "resources/list") return rpcResult(id, { resources: [] });
  if (method === "prompts/list") return rpcResult(id, { prompts: [] });
  if (method === "tools/call") {
    try {
      const text = await callTool(params && params.name, params && params.arguments);
      return rpcResult(id, { content: [{ type: "text", text }] });
    } catch (e) {
      return rpcResult(id, { content: [{ type: "text", text: "Error: " + (e && e.message ? e.message : e) }], isError: true });
    }
  }
  if (id === undefined || id === null) return null;
  return rpcError(id, -32601, "Method not found: " + method);
}

/* ------------------------------------------------------------------- HTTP */
async function readJson(req) {
  if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString("utf8")); } catch (e) { return null; } }
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) { try { return JSON.parse(req.body); } catch (e) { return null; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return null; }
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key, Mcp-Session-Id, Mcp-Protocol-Version");
}

function authed(req) {
  if (!TOKEN) return true;
  const h = String(req.headers["authorization"] || "");
  if (h === "Bearer " + TOKEN || h === TOKEN) return true;
  if (String(req.headers["x-api-key"] || "") === TOKEN) return true;
  try {
    const u = new URL(req.url, "http://x");
    if (u.searchParams.get("key") === TOKEN) return true;
  } catch (e) {}
  return false;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!authed(req)) {
    res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized — append ?key=<token> to the connector URL." } });
    return;
  }

  if (req.method === "GET") {
    const accept = String(req.headers["accept"] || "");
    if (accept.includes("text/event-stream")) { res.setHeader("Allow", "POST"); res.status(405).end("Method Not Allowed"); return; }
    res.status(200).json({
      name: SERVER_INFO.name, version: SERVER_INFO.version,
      transport: "streamable-http", spec: "MCP 2025-06-18",
      note: "POST JSON-RPC 2.0 requests to this URL. Add it as a custom connector in Claude."
    });
    return;
  }

  if (req.method !== "POST") { res.setHeader("Allow", "POST, GET, OPTIONS"); res.status(405).end("Method Not Allowed"); return; }

  const body = await readJson(req);
  if (!body) { res.status(400).json(rpcError(null, -32700, "Parse error")); return; }

  const clientProto = String(req.headers["mcp-protocol-version"] || "") || null;

  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) { const r = await handleRpc(m, clientProto); if (r) out.push(r); }
    if (!out.length) { res.status(202).end(); return; }
    res.status(200).json(out);
    return;
  }

  const r = await handleRpc(body, clientProto);
  if (r === null) { res.status(202).end(); return; }
  res.status(200).json(r);
}
