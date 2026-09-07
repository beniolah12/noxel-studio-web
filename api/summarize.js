// api/summarize.js — turn a Fountain screenplay into a short synopsis.
//
// With ANTHROPIC_API_KEY set (Vercel env), it asks Claude for a written
// logline + synopsis. Without a key it falls back to a structural outline
// built from the scene headings and first action lines — always returns
// something, never errors on the client.

const KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.SUMMARY_MODEL || "claude-haiku-4-5-20251001";
const MAX_CHARS = 24000;

const PROMPT =
  "You are a sharp script analyst. Below is a screenplay in Fountain format. " +
  "Using ONLY what is actually written, reply in EXACTLY this shape and nothing else:\n\n" +
  "LOGLINE: <one sentence, max 28 words — the hook of the story>\n" +
  "SYNOPSIS: <3 to 5 sentences, present tense: the setup, what drives the story, and how it ends. " +
  "No preamble. Do not write \"this screenplay\" or \"the story follows\".>\n\n" +
  "If the script is only fragments or very short, give one or two plain sentences about what is there.\n\n" +
  "--- SCREENPLAY ---\n";

function parseShape(t) {
  t = (t || "").trim();
  let logline = "", synopsis = "";
  const lm = t.match(/LOGLINE:\s*([\s\S]*?)(?:\n\s*SYNOPSIS:|$)/i);
  const sm = t.match(/SYNOPSIS:\s*([\s\S]*)$/i);
  if (lm) logline = lm[1].trim().replace(/\s+/g, " ");
  if (sm) synopsis = sm[1].trim();
  if (!logline && !synopsis) synopsis = t;
  return { logline, synopsis };
}

// No-AI fallback: a beat outline from scene headings + first action lines.
function outline(ft) {
  const lines = String(ft).replace(/\r/g, "").split("\n");
  const scenes = [];
  const chars = {};
  let cur = null, prevCue = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^(Title|Credit|Author|Authors|Contact|Source|Draft date):/i.test(t)) continue;
    if (/^\.[^.]/.test(t) || /^(INT|EXT|EST|I\/E|INT\.?\/EXT)[. ]/i.test(t)) {
      cur = { slug: t.replace(/^\./, "").trim(), beat: "" };
      scenes.push(cur); prevCue = false; continue;
    }
    const isCue = /^[A-Z][A-Z0-9 .'’\-]{1,28}$/.test(t) && !/[.!?]$/.test(t)
      && !/^(FADE|CUT|DISSOLVE|SMASH|MATCH|BACK TO|END)/.test(t);
    if (isCue) {
      const nm = t.replace(/\s*\(.*\)\s*$/, "").trim();
      if (nm) chars[nm] = (chars[nm] || 0) + 1;
      prevCue = true; continue;
    }
    if (/^\(.*\)$/.test(t)) { prevCue = true; continue; }
    if (/^>/.test(t) || /\bTO:$/.test(t)) { prevCue = false; continue; }
    if (cur && !cur.beat && !prevCue && /[a-z]/.test(t)) {
      cur.beat = t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, "") + "…" : t;
    }
    prevCue = false;
  }
  const top = Object.keys(chars).sort((a, b) => chars[b] - chars[a]).slice(0, 3);
  const locs = [...new Set(scenes.map(s =>
    s.slug.replace(/^(INT\.?|EXT\.?|EST\.?|I\/E|INT\.?\/EXT)\s*/i, "").split(/\s[-–—]\s/)[0].trim()
  ))].filter(Boolean);
  const n = scenes.length;
  const logline =
    (n ? n + "-scene screenplay" : "An early-stage screenplay") +
    (top.length ? " centred on " + top.join(", ") : "") +
    (locs.length ? ", moving through " + locs.slice(0, 4).join(", ") : "") + ".";
  const beats = scenes.filter(s => s.beat).slice(0, 8).map((s, i) => (i + 1) + ". " + s.beat);
  const synopsis = beats.length
    ? "Beat outline (no AI key connected):\n" + beats.join("\n")
    : "The script has " + n + " scene(s) but not enough written action yet to outline.";
  return { logline, synopsis };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : (typeof req.body === "string" ? req.body : "");
  if (!raw) { const c = []; for await (const x of req) c.push(x); raw = Buffer.concat(c).toString("utf8"); }
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const body = await readBody(req);
  const fountain = body && typeof body.fountain === "string" ? body.fountain : "";
  if (!fountain.trim()) { res.status(400).json({ error: "no script text" }); return; }
  const src = fountain.slice(0, MAX_CHARS);

  if (!KEY) { res.status(200).json({ engine: "outline", ...outline(src) }); return; }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: PROMPT + src }]
      })
    });
    const j = await r.json();
    if (!r.ok) {
      res.status(200).json({ engine: "outline", note: "ai " + r.status, ...outline(src) });
      return;
    }
    const text = (j.content || []).map(b => b.text || "").join("").trim();
    res.status(200).json({ engine: "ai", ...parseShape(text) });
  } catch (e) {
    res.status(200).json({ engine: "outline", note: "ai unreachable", ...outline(src) });
  }
}
