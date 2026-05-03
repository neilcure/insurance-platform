import "server-only";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * CJK (Chinese / Japanese / Korean) font loader for the PDF Mail Merge
 * pipeline.
 *
 * Why this file exists
 * --------------------
 * `lib/pdf/generate.ts` uses `pdf-lib` with `StandardFonts.Helvetica`, which
 * only supports the WinAnsi (Latin-1) encoding. Any field value or static
 * text containing CJK glyphs would otherwise throw
 * `WinAnsi cannot encode "<char>"` and crash the entire PDF render. This
 * module supplies a CJK-capable TrueType font so we can route any string
 * containing CJK characters through it instead of Helvetica.
 *
 * Font choice — Noto Sans CJK TC (Traditional Chinese variant)
 * ------------------------------------------------------------
 * Chosen because:
 *   - Covers Hong Kong / Taiwan Traditional Chinese natively (this is an
 *     HK insurance platform — TC is the dominant script in source forms).
 *   - Has good fallback coverage for Simplified Chinese, Japanese, and
 *     Korean glyphs (CJK Unified Ideographs share most code points).
 *   - Designed by Adobe + Google with first-class Latin glyphs (literally
 *     Source Han Sans's Latin), so mixed strings like "Mr. 陳大文" look
 *     natural even when we use it for the whole string instead of
 *     per-character font switching.
 *   - OFL licensed — safe to redistribute embedded inside generated PDFs.
 *
 * Resolution strategy — three tiers, no setup required
 * ----------------------------------------------------
 * 1. **Repo bundle** — `lib/pdf/fonts/NotoSansCJK-Regular.otf` if a sysadmin
 *    wants to pre-bundle the font for offline / air-gapped deployments.
 *    Gitignored by default to keep the repo small.
 * 2. **OS tmpdir cache** — written on first successful CDN download so
 *    subsequent server starts have zero network dependency.
 * 3. **CDN download** — fetched from a *pinned commit* of the official
 *    notofonts/noto-cjk GitHub repo via jsDelivr. Pinned (not @main) to
 *    guarantee deterministic output across deployments.
 *
 * The result is cached at module scope so the bytes are loaded at most
 * once per Node process — even with 100 concurrent PDF generations.
 *
 * Bold / italic
 * -------------
 * Noto Sans CJK ships separate Bold weights but **no italic** variant
 * (CJK scripts traditionally don't use italic). Phase 1 ships only the
 * Regular weight; bold / italic CJK text falls back to Regular CJK with
 * a one-time warning. Latin bold / italic continue to use the Helvetica
 * variants in `generate.ts`. If admins later request a bold CJK weight,
 * adding a second tier-3 URL + a parallel embed is a ~10 line change.
 */

/**
 * Pinned to a specific commit SHA so a future force-push to the upstream
 * font repo can never silently change which glyphs we ship to clients.
 * To bump: pick a new commit from https://github.com/notofonts/noto-cjk
 * and update both the SHA and the file (verify the URL still 200s).
 */
const NOTO_SANS_TC_PINNED_SHA = "165c01b";
const CDN_URL = `https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@${NOTO_SANS_TC_PINNED_SHA}/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf`;

const FONT_FILENAME = "NotoSansCJK-Regular.otf";
const REPO_FONT_PATH = path.join(process.cwd(), "lib", "pdf", "fonts", FONT_FILENAME);
const TMP_FONT_DIR = path.join(os.tmpdir(), "insurance-platform-fonts");
const TMP_FONT_PATH = path.join(TMP_FONT_DIR, FONT_FILENAME);

/**
 * Unicode ranges that require the CJK font instead of Helvetica.
 *
 * Covers (in order):
 *   - CJK Radicals Supplement / Kangxi Radicals (2E80–2FDF)
 *   - CJK Symbols and Punctuation, Hiragana, Katakana (3000–30FF)
 *   - Bopomofo, Hangul Compatibility Jamo, Kanbun (3100–33FF)
 *   - CJK Unified Ideographs Extension A (3400–4DBF)
 *   - CJK Unified Ideographs (4E00–9FFF) — the vast majority of Chinese
 *   - Yi Syllables / Radicals (A000–A4CF)
 *   - Hangul Syllables (AC00–D7AF) — Korean
 *   - CJK Compatibility Ideographs (F900–FAFF)
 *   - CJK Compatibility Forms (FE30–FE4F)
 *   - Halfwidth and Fullwidth Forms (FF00–FFEF) — fullwidth digits / Latin
 *
 * NOT covered (intentional): Extension B–G ideographs (20000+), which need
 * UTF-16 surrogate handling. Vanishingly rare in HK/TW/CN insurance forms;
 * adding them is straightforward if a real document needs them.
 */
const CJK_RE =
  /[\u2E80-\u2FFF\u3000-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

/** Quick test — does any character in this string require the CJK font? */
export function containsCjk(text: string): boolean {
  return !!text && CJK_RE.test(text);
}

/**
 * Module-scoped promise so repeated callers (every PDF generation) share
 * the same in-flight load and the same resolved buffer. Cleared on
 * failure so the next attempt can retry from scratch.
 */
let cachedFontBytes: Promise<Buffer> | null = null;

async function tryReadFile(p: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

async function downloadAndCache(): Promise<Buffer> {
  const res = await fetch(CDN_URL);
  if (!res.ok) {
    throw new Error(
      `CJK font download failed: HTTP ${res.status} from ${CDN_URL}`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  // Best-effort tmpdir cache. Failure here is NOT fatal — we already
  // have the bytes in memory and the CACHED PROMISE will keep them for
  // the lifetime of this Node process. On the next server start we'd
  // just download again.
  try {
    await fs.mkdir(TMP_FONT_DIR, { recursive: true });
    await fs.writeFile(TMP_FONT_PATH, bytes);
  } catch (err) {
    console.warn(
      "[cjk-font] Could not write cache to tmpdir (non-fatal):",
      err,
    );
  }
  return bytes;
}

/**
 * Load the CJK font bytes, trying the bundled repo path first, then the
 * tmpdir cache, then a CDN download. Cached at module scope.
 *
 * This is async + lazy on purpose: PDFs that contain ONLY Latin text
 * never trigger this load, so English-only tenants pay zero overhead
 * and never hit the network.
 */
export async function loadCjkFontBytes(): Promise<Buffer> {
  if (cachedFontBytes) return cachedFontBytes;

  cachedFontBytes = (async () => {
    const fromRepo = await tryReadFile(REPO_FONT_PATH);
    if (fromRepo) return fromRepo;

    const fromCache = await tryReadFile(TMP_FONT_PATH);
    if (fromCache) return fromCache;

    return downloadAndCache();
  })();

  // If the load fails, drop the cached promise so the *next* PDF that
  // needs CJK can retry — otherwise one transient CDN blip would
  // permanently break every CJK render until a server restart.
  cachedFontBytes.catch(() => {
    cachedFontBytes = null;
  });

  return cachedFontBytes;
}
