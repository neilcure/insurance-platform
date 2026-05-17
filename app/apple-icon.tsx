import { ImageResponse } from "next/og";

import { bravoBPngDataUri } from "@/lib/bravo-b-png-base64";

/**
 * Apple touch icon (`<link rel="apple-touch-icon" sizes="180x180">`).
 *
 * iOS Safari uses this when the user taps "Add to Home Screen" — and
 * Google Search occasionally pulls it as a higher-resolution fallback
 * for site-icon rendering when no other suitable square icon is found.
 *
 * Same PNG mark as `app/icon.svg` / `opengraph-image.tsx` on neutral-900.
 * Tab/wizard branding may additionally use `app/icon.svg`, `app/favicon.ico`,
 * and `public/favicon.ico` (Docker/static copy).
 * just larger (180x180 with 32px corner radius to mimic iOS rounded
 * app icons) so it looks crisp on a Retina home screen.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const src = bravoBPngDataUri();
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
        {/* eslint-disable-next-line @next/next/no-img-element -- OG renderer embed */}
        <img
          src={src}
          alt=""
          width={120}
          height={120}
          style={{ display: "block", objectFit: "contain" }}
        />
      </div>
    ),
    size,
  );
}
