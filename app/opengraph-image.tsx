import { ImageResponse } from "next/og";

import { bravoBPngDataUri } from "@/lib/bravo-b-png-base64";

/**
 * Default Open Graph / Twitter card preview image (1200x630).
 *
 * Used by Facebook, LinkedIn, Slack, Twitter / X, iMessage, WhatsApp,
 * Discord, etc. when someone shares a `bravogi.com` link. Without
 * this, those platforms render a generic preview (just the URL with
 * a neutral grey block) which is unbranded and easy to mistake for
 * spam.
 *
 * Routed by Next.js as `/opengraph-image` and automatically referenced
 * from the page's `<meta property="og:image">` and
 * `<meta name="twitter:image">` tags via the `metadataBase` set in
 * `app/layout.tsx` — no manual `<head>` plumbing required.
 *
 * Kept deliberately simple: brand mark + name + tagline on the same
 * neutral-900 background as the favicon, so all surfaces (browser
 * tab, iOS home-screen, social share) feel like the same product.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Bravo General Insurance Interface";

export default function OgImage() {
  const src = bravoBPngDataUri();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #171717 60%, #262626 100%)",
          color: "#ffffff",
          padding: "80px 100px",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 32,
            marginBottom: 36,
          }}
        >
          <div
            style={{
              width: 132,
              height: 132,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#ffffff",
              borderRadius: 28,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- OG renderer embed */}
            <img
              src={src}
              alt=""
              width={86}
              height={86}
              style={{ display: "block", objectFit: "contain" }}
            />
          </div>
          <div
            style={{
              fontSize: 78,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              display: "flex",
            }}
          >
            Bravo GI
          </div>
        </div>
        <div
          style={{
            fontSize: 36,
            color: "#d4d4d4",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.25,
            display: "flex",
            justifyContent: "center",
          }}
        >
          Insurance management, simplified — policies, clients, agents and
          documents in one place.
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 60,
            right: 80,
            fontSize: 24,
            color: "#a3a3a3",
            display: "flex",
          }}
        >
          bravogi.com
        </div>
      </div>
    ),
    size,
  );
}
