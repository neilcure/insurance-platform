/**
 * Writes `app/favicon.ico` + `public/favicon.ico` from the PNG in `lib/bravo-b-png-base64.ts`.
 *
 * `public/favicon.ico` matters for Docker (`Dockerfile` copies `./public` into the runner) and
 * ensures GET `/favicon.ico` serves the Bravo “B” — not a stale default or cached triangle asset.
 *
 * Square-pads non-square source (matches apple-icon neutral `#171717`).
 * Run after `scripts/extract-bravo-b-png-module.mjs` when icon.svg changes.
 *
 * Usage: node scripts/generate-bravo-favicon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const tsPath = path.join(root, "lib", "bravo-b-png-base64.ts");
const outIcoApp = path.join(root, "app", "favicon.ico");
const outIcoPublic = path.join(root, "public", "favicon.ico");
const tmpPng = path.join(root, "scripts", ".tmp-bravo-favicon.png");

const ts = fs.readFileSync(tsPath, "utf8");
const m = ts.match(/BRAVO_B_PNG_BASE64 = "([^"]+)"/);
if (!m) {
  console.error("Could not parse BRAVO_B_PNG_BASE64 from lib/bravo-b-png-base64.ts");
  process.exit(1);
}

fs.writeFileSync(tmpPng, Buffer.from(m[1], "base64"));

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, shell: true, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`${label} failed`);
    process.exit(r.status ?? 1);
  }
}

run("sharp-cli", "npx", [
  "--yes",
  "sharp-cli",
  "-i",
  tmpPng,
  "-o",
  path.join(root, "scripts"),
  "resize",
  "256",
  "256",
  "--fit",
  "contain",
  "--background",
  "#171717",
  "-f",
  "png",
]);

run("png-to-ico", "npx", ["--yes", "png-to-ico", tmpPng, outIcoApp]);
fs.copyFileSync(outIcoApp, outIcoPublic);

try {
  fs.unlinkSync(tmpPng);
} catch {
  /* ignore */
}

console.log(`Wrote ${outIcoApp}`);
console.log(`Wrote ${outIcoPublic}`);
