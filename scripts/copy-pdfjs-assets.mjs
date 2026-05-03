/**
 * Copies pdf.js CMaps + standard fonts from `pdfjs-dist` into `public/pdfjs/`
 * so the in-browser PDF preview (PdfTemplateEditor, PdfMergePreviewCanvas) can
 * render CJK / non-Latin glyphs in source PDFs.
 *
 * Without these, pdf.js silently fails to decode PDFs that reference the
 * Adobe-GB1 / Adobe-CNS1 / Adobe-Japan1 / Adobe-Korea1 character collections
 * — i.e. virtually every Chinese / Japanese / Korean PDF.
 *
 * Wired up via the `postinstall` script in `package.json` so a fresh `npm i`
 * always provisions the right files. Re-run manually with:
 *   node scripts/copy-pdfjs-assets.mjs
 *
 * The destination is gitignored (see `public/pdfjs/.gitignore`) — install
 * regenerates it deterministically.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SOURCES = [
  { src: "node_modules/pdfjs-dist/cmaps", dest: "public/pdfjs/cmaps" },
  { src: "node_modules/pdfjs-dist/standard_fonts", dest: "public/pdfjs/standard_fonts" },
];

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function main() {
  for (const { src, dest } of SOURCES) {
    const absSrc = path.join(repoRoot, src);
    const absDest = path.join(repoRoot, dest);
    try {
      await fs.access(absSrc);
    } catch {
      // pdfjs-dist may not be installed yet (e.g. running before deps).
      // Don't fail the install — just skip; users without the in-browser
      // preview won't notice, and the fix can be re-run manually.
      console.warn(`[copy-pdfjs-assets] source missing, skipping: ${src}`);
      continue;
    }
    await fs.rm(absDest, { recursive: true, force: true });
    await copyDir(absSrc, absDest);
    const fileCount = (await fs.readdir(absDest)).length;
    console.log(`[copy-pdfjs-assets] ${src} → ${dest} (${fileCount} files)`);
  }
}

main().catch((err) => {
  console.error("[copy-pdfjs-assets] failed:", err);
  process.exit(1);
});
