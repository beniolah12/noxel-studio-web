// Same-origin proxy to Supabase REST/Auth.
// The client calls /api/db?p=/rest/v1/... so the request never leaves the
// noxel-web.vercel.app origin — DNS filters, ad-blockers, corporate proxies
// and CORS all stop mattering. Runs on Vercel's servers, not the viewer's.

const SB_URL = process.env.SB_URL || "https://rdtvejebscvggfoqwjqx.supabase.co";
const SB_KEY = process.env.SB_KEY || "sb_publishable_GEs52kcMUf4F5Tvq-xz84g_RkW3mEkP";

const PASS_REQ = ["accept", "content-type", "prefer", "range", "accept-profile", "content-profile", "x-client-info", "x-upsert"];
const PASS_RES = ["content-type", "content-range", "range-unit", "prefer-applied"];

export default async function handler(req, res) {
  const p = typeof req.query.p === "string" ? req.query.p : "";
  if (!p.startsWith("/rest/") && !p.startsWith("/auth/")) {
    res.status(400).json({ error: "bad path" });
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
    r = await fetch(SB_URL + p, { method: req.method, headers, body });
  } catch (e) {
    res.status(502).json({ error: "upstream unreachable", detail: String(e && e.message || e) });
    return;
  }

  const buf = Buffer.from(await r.arrayBuffer());
  for (const h of PASS_RES) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
  res.setHeader("cache-control", "no-store");
  res.status(r.status).send(buf);
}
