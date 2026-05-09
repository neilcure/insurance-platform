import { ImageResponse } from "next/og";

/**
 * Dynamic favicon generated at build / request time.
 *
 * Why a `.tsx` (not a static `.png`) icon
 * ---------------------------------------
 * The previous `app/icon.png` was 1024x768 (a 4:3 wordmark, NOT
 * square). Google rejects non-square favicons in search results
 * and falls back to a generic letter avatar — which is why
 * "bravogi.com" was showing a "B" placeholder in Google instead
 * of our brand mark.
 *
 * Generating the icon dynamically guarantees:
 *
 *   1. Perfectly square output (`size = { 32, 32 }`).
 *   2. A vector-quality render at any DPI (no aliasing on Retina).
 *   3. The icon stays in sync with the in-app brand mark — both
 *      use the lucide ShieldCheck glyph, so a tab favicon and the
 *      `<ShieldCheck>` you see at the top of the sign-in page are
 *      visually identical.
 *
 * If you ever need a static PNG instead (e.g. for a deploy target
 * that can't run edge runtime), pre-generate one and place it at
 * `app/icon.png` — but ensure it's SQUARE.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Lucide `ShieldCheck` SVG path (24x24 viewbox). Kept inline so
// the icon route has no runtime dependency on the lucide-react
// component tree (which is React-DOM only and not available in
// the edge ImageResponse renderer).
const SHIELD_PATH =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";
const CHECK_PATH = "m9 12 2 2 4-4";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
          borderRadius: 6,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={SHIELD_PATH} />
          <path d={CHECK_PATH} />
        </svg>
      </div>
    ),
    size,
  );
}
