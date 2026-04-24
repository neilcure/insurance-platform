/**
 * Inject a captured signature image into the document HTML at the
 * client-signature slot.
 *
 * The slot is a single `<div data-client-signature-slot=""></div>`
 * emitted by `generateEmailHtml()` in DocumentsTab — see
 * `client_sig_slot` marker. We replace ONLY the inner content of
 * that div (we keep the surrounding div + min-height so the
 * signature line position stays identical to the un-signed PDF).
 *
 * Kept in `/lib` (not co-located with the API route) so the
 * `/sign` flow and any future internal flow that injects a
 * signature can share the exact same regex + escape rules.
 */
export function injectClientSignature(
  documentHtml: string,
  pngDataUrl: string,
): string {
  if (!pngDataUrl.startsWith("data:image")) {
    // Defensive — caller should already pass a data: URL. Bail out
    // rather than risk leaving an `src=""` in the rendered PDF.
    return documentHtml;
  }

  // The slot looks like:
  //   <div data-client-signature-slot="" style="...">...</div>
  // We rewrite only the INNER (between the opening tag and its
  // matching `</div>`). A non-greedy `[\s\S]*?` is enough because
  // the slot is rendered empty (no nested divs) — see the
  // `clientCell` constant in DocumentsTab.
  const slotRegex = /(<div\s+data-client-signature-slot="?"?[^>]*>)([\s\S]*?)(<\/div>)/i;

  // The signature image must rest on the line just above the
  // "Client Signature" label, so we constrain its height to fit
  // the reserve area and let the surrounding flex container
  // (align-items:flex-end) push it to the bottom.
  const sigImg =
    `<img src="${pngDataUrl}" alt="Signature" ` +
    `style="max-height:48px;max-width:200px;display:block;object-fit:contain;" />`;

  if (!slotRegex.test(documentHtml)) {
    // No slot present (e.g. a template that doesn't show the
    // client signature line). Nothing to inject — return as-is.
    return documentHtml;
  }
  return documentHtml.replace(slotRegex, (_match, open, _inner, close) => `${open}${sigImg}${close}`);
}

/**
 * Render a typed signature ("John Doe") to a PNG data URL using a
 * cursive script font. Runs in Node (no DOM) — we just emit an
 * inline SVG that Puppeteer will rasterise when generating the
 * signed PDF. Returning an SVG-as-data-URL keeps the call site in
 * `injectClientSignature` (which expects `data:image/...`).
 */
export function typedSignatureToDataUrl(name: string): string {
  const escaped = name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // Approximate width based on character count; SVG will scale via
  // CSS `max-width` set in injectClientSignature, so the exact
  // viewBox here just needs to preserve aspect ratio.
  const widthPx = Math.max(120, escaped.length * 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} 60" width="${widthPx}" height="60">` +
    `<text x="6" y="42" font-family="'Brush Script MT','Lucida Handwriting',cursive" font-size="36" fill="#1a1a1a">${escaped}</text>` +
    `</svg>`;
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Render a "click-to-accept" confirmation as a small SVG that we
 * still place in the signature slot — a visual cue that the
 * recipient confirmed (rather than leaving the slot empty, which
 * would look identical to the un-signed PDF).
 */
export function acceptedSignatureToDataUrl(displayName: string): string {
  const safeName = displayName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const widthPx = Math.max(180, safeName.length * 9 + 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} 48" width="${widthPx}" height="48">` +
    `<text x="6" y="22" font-family="Arial,sans-serif" font-size="14" font-style="italic" fill="#1a1a1a">Accepted by ${safeName}</text>` +
    `<text x="6" y="40" font-family="Arial,sans-serif" font-size="11" fill="#555">Confirmed online</text>` +
    `</svg>`;
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}
