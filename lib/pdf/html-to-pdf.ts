import "server-only";
import puppeteer, { type Browser } from "puppeteer";
import { wrapHtmlForPrint } from "./print-styles";

/**
 * Convert an HTML document body fragment into an A4 PDF using a
 * headless Chromium via Puppeteer.
 *
 * Why Puppeteer (vs jsPDF/html2canvas, vs a hosted service):
 *
 *   - The same `generateEmailHtml()` output that drives the in-app
 *     "Print / PDF" preview is re-used here. Puppeteer renders it
 *     with real Chromium, so the emailed PDF attachment is byte-
 *     identical to what the user sees when they print the document
 *     from the dialog. No layout drift between preview and email.
 *   - Multi-page A4 pagination, page-break logic, and font fallback
 *     are handled by Chrome's print engine — we don't have to math
 *     out page breaks like jsPDF does.
 *   - CJK characters in addresses (e.g. 香港, 九龍) render with the
 *     OS font fallback chain rather than an unknown-glyph box, as
 *     long as the host has CJK fonts installed (on the Hostinger
 *     VPS: `apt install -y fonts-noto-cjk`).
 *
 * On Windows / macOS dev machines, the `puppeteer` package downloads
 * a matching Chromium build at `npm install` time. On the Hostinger
 * VPS (Linux), the same install downloads a Linux Chromium but the
 * OS must have the shared libs Chromium links against. Install:
 *
 *   apt install -y \
 *     libnss3 libatk-bridge2.0-0 libxkbcommon0 libxcomposite1 \
 *     libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
 *     libasound2 libxshmfence1 fonts-noto-cjk
 *
 * The browser is launched lazily and KEPT ALIVE between requests via
 * a module-scoped singleton — this matters a lot in production, where
 * a cold-start launch costs ~300-500ms while a reuse costs ~5ms. The
 * singleton handle is invalidated automatically if Chromium dies
 * (crash, OOM-kill), so the next request transparently launches a
 * fresh instance instead of failing forever.
 */

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.connected !== false) return existing;
    } catch {
      // Fall through and re-launch.
    }
  }
  browserPromise = puppeteer
    .launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      // `--no-sandbox` is required when running as root inside a
      // Docker container or some VPS images that don't ship a
      // user-namespace-enabled kernel. It's a known small attack-
      // surface trade-off and is the standard config for headless
      // PDF rendering. `--disable-dev-shm-usage` prevents Chromium
      // from running out of /dev/shm space on small VPS instances.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    })
    .then((b) => {
      // If Chromium dies for any reason, drop the cached promise so
      // the next call re-launches instead of returning a dead handle.
      b.on("disconnected", () => {
        browserPromise = null;
      });
      return b;
    })
    .catch((err) => {
      // Reset on failure so the next call can retry.
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

/**
 * Render an HTML body fragment to a PDF Buffer.
 *
 * @param bodyHtml  The `<body>` content, exactly as emitted by the
 *                  client's `generateEmailHtml()` AFTER any image
 *                  inlining (so Puppeteer doesn't need to make
 *                  authenticated requests back to the app).
 * @param title     Used for the `<title>` and Chromium's print
 *                  metadata. Falls back to "Document".
 */
export async function renderHtmlToPdf(
  bodyHtml: string,
  title = "Document",
): Promise<Buffer> {
  const fullHtml = wrapHtmlForPrint(bodyHtml, title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // `setContent` waits for parsing; `waitUntil: "networkidle0"`
    // makes sure any remote `<img>`s (we don't expect any after
    // inlining, but the public template-image endpoint is a
    // possible exception) have finished loading before we snapshot.
    // 30s is generous — typical render is well under a second.
    await page.setContent(fullHtml, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });
    // `printBackground: true` makes Chromium honor inline
    // `background-color` styles (e.g. the section-header band) the
    // same way the on-screen preview does. Default `false` would
    // strip them and the PDF would look stripped-down compared to
    // the user's preview.
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    // Always close the page so we don't leak tabs in the long-lived
    // browser process. The browser itself stays alive for reuse.
    await page.close().catch(() => {});
  }
}
