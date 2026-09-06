// Tiny always-fresh endpoint so the app can tell when a newer build is live
// (defeats any intermediate cache that serves a stale index.html).
export default function handler(req, res) {
  res.setHeader("cache-control", "no-store, max-age=0");
  res.status(200).json({
    build: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev"
  });
}
