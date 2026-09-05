// Same-origin proxy to Supabase. The client calls
//   /api/db/rest/v1/projects?select=...        (a plain-looking path)
// and this forwards it to Supabase server-side, adding the key. Keeping the
// path ordinary (no encoded slashes, no nested query) avoids web filters /
// WAFs that reject API-shaped query strings.

const SB_URL = process.env.SB_URL || "https://rdtvejebscvggfoqwjqx.supabase.co";
const SB_KEY = process.env.SB_KEY || "sb_publishable_GEs52kcMUf4F5Tvq-xz84g_RkW3mEkP";

const PASS_REQ = ["accept", "content-type", "prefer", "range", "accept-profile", "content-profile", "x-client-info", "x-upsert"];
const PASS_RES = ["content-type", "content-range", "range-unit", "prefer-applied"];

export default async function handler(req, res) {
  // req.url looks like /api/db/rest/v1/projects?select=id — strip the prefix.
  const rel = req.url.replace(/^\/api\/db\//, "/");
  if (!rel.startsWith("/rest/") && !rel.startsWith("/auth/")) {
    res.status(400).json({ error: "bad path", rel });
    return;
  }

  const headers = { apikey: SB_KEY, authorization: "Bearer " + SB_KEY };
  for (const h of PASS_REQ) if (req.headers[h]) headers[h] = req.headers[h];

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await new Promise((resolve) => {
      let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d || undefined));
    });
  }

  let r;
  try {
    r = await fetch(SB_URL + rel, { method: req.method, headers, body });
  } catch (e) {
    res.status(502).json({ error: "upstream unreachable", detail: String((e && e.message) || e) });
    return;
  }

  const buf = Buffer.from(await r.arrayBuffer());
  for (const h of PASS_RES) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
  res.setHeader("cache-control", "no-store");
  res.status(r.status).send(buf);
}
