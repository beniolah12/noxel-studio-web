// Regenerate index.html + public/app.js from the standalone artifact.
// Run:  node scripts/gen.mjs  (or npm run gen)
import { readFileSync, writeFileSync } from "node:fs";

const ART = process.env.ART || "../../noxel-studio/index.html";
const src = readFileSync(new URL(ART, import.meta.url), "utf8");

const m = src.match(/^([\s\S]*?)<script>([\s\S]*)<\/script>([\s\S]*)$/);
if (!m) throw new Error("Could not split the artifact into head / script / tail");
const [, head, js, tail] = m;

// editor logic → served as a plain script the adapter injects after setup
writeFileSync(new URL("../public/app.js", import.meta.url), js.trim() + "\n");

// split head at </style>: CSS+meta go in <head>, the markup goes in <body>
const i = head.indexOf("</style>") + "</style>".length;
const headCss = head.slice(0, i);
const markup = head.slice(i);

const doc = `<!doctype html>
<html lang="en">
<head>
${headCss}
</head>
<body>
${markup}<script type="module" src="/src/adapter.js"></script>
${tail}
</body>
</html>
`;
writeFileSync(new URL("../index.html", import.meta.url), doc);
console.log("wrote index.html + public/app.js from", ART);
