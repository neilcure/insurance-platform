import { ImageResponse } from "next/og";

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

const SHIELD_PATH =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";
const CHECK_PATH = "m9 12 2 2 4-4";

export default function OgImage() {
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
            <svg
              width="86"
              height="86"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#171717"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={SHIELD_PATH} />
              <path d={CHECK_PATH} />
            </svg>
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
