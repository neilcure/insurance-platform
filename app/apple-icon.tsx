import { ImageResponse } from "next/og";

/**
 * Apple touch icon (`<link rel="apple-touch-icon" sizes="180x180">`).
 *
 * iOS Safari uses this when the user taps "Add to Home Screen" — and
 * Google Search occasionally pulls it as a higher-resolution fallback
 * for site-icon rendering when no other suitable square icon is found.
 *
 * Same brand mark as `app/icon.tsx` (ShieldCheck on neutral-900),
 * just larger (180x180 with 32px corner radius to mimic iOS rounded
 * app icons) so it looks crisp on a Retina home screen.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const SHIELD_PATH =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";
const CHECK_PATH = "m9 12 2 2 4-4";

export default function AppleIcon() {
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
          borderRadius: 32,
        }}
      >
        <svg
          width="120"
          height="120"
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
