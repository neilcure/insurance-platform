/**
 * GET  /api/admin/landing-page   — public, no auth required (page.tsx is public)
 * POST /api/admin/landing-page   — admin only, saves to app_settings
 */

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const SETTINGS_KEY = "landing_page";
const ASSETS_DIR = path.join(process.cwd(), ".uploads", "assets");

async function logoVariantUrl(variant: "light" | "dark"): Promise<string> {
  try {
    const files = await fs.readdir(ASSETS_DIR);
    return files.some((f) => f.startsWith(`logo-${variant}.`))
      ? `/api/admin/assets/logo?variant=${variant}`
      : "";
  } catch {
    return "";
  }
}

export type FeatureCard = {
  title: string;
  description: string;
};

export type LandingPageSettings = {
  /** URL for the light-mode logo. "/api/admin/assets/logo?variant=light" when uploaded, "" when none. */
  logoUrl: string;
  /** URL for the dark-mode logo. "/api/admin/assets/logo?variant=dark" when uploaded, "" when none. */
  logoUrlDark: string;
  brandName: string;
  heroHeading: string;
  heroHeadingAccent: string;
  heroDescription: string;
  heroCta: string;
  featuresHeading: string;
  featuresSubheading: string;
  featureCards: FeatureCard[];
  highlightsHeading: string;
  highlights: string[];
  ctaHeading: string;
  ctaSubheading: string;
  footerName: string;
};

export const DEFAULT_LANDING: LandingPageSettings = {
  logoUrl: "",
  logoUrlDark: "",
  brandName: "Bravo General Insurance Interface",
  heroHeading: "Insurance management,",
  heroHeadingAccent: "simplified.",
  heroDescription:
    "Bravo General Insurance Interface is a modern platform for managing policies, clients, agents, and documents — all in one place. Built for teams that need clarity and speed.",
  heroCta: "Get started",
  featuresHeading: "Everything you need to run your book of business",
  featuresSubheading:
    "From quoting to renewals, Bravo General Insurance Interface keeps your workflows organized and your data accessible.",
  featureCards: [
    {
      title: "Policy Management",
      description:
        "Create, track, and manage policies across every line of business with configurable workflows.",
    },
    {
      title: "Client & Agent Portal",
      description:
        "Keep client records, agent assignments, and communication history in one central hub.",
    },
    {
      title: "Documents & Reporting",
      description:
        "Generate policy documents from templates and get visibility into your portfolio at a glance.",
    },
  ],
  highlightsHeading: "Built for modern insurance teams",
  highlights: [
    "Configurable policy flows and form fields — no code changes needed",
    "Role-based access for admins, agents, and internal staff",
    "PDF template generation with dynamic data binding",
    "Automated reminders and workflow actions",
    "Dark mode and responsive design for work from anywhere",
  ],
  ctaHeading: "Ready to get started?",
  ctaSubheading:
    "Sign in to your account or contact your administrator for access.",
  footerName: "Bravo General Insurance Interface",
};

export async function GET() {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTINGS_KEY))
      .limit(1);
    const stored = (row?.value as LandingPageSettings | undefined) ?? null;
    const base = stored ? { ...DEFAULT_LANDING, ...stored } : { ...DEFAULT_LANDING };
    // Always reflect real on-disk state so callers don't need a separate check
    const [lightUrl, darkUrl] = await Promise.all([
      logoVariantUrl("light"),
      logoVariantUrl("dark"),
    ]);
    base.logoUrl = lightUrl;
    base.logoUrlDark = darkUrl;
    return NextResponse.json(base);
  } catch {
    return NextResponse.json(DEFAULT_LANDING);
  }
}

export async function POST(request: NextRequest) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as Partial<LandingPageSettings>;

    const next: LandingPageSettings = {
      logoUrl: "",     // derived from disk at GET time; not persisted
      logoUrlDark: "", // derived from disk at GET time; not persisted
      brandName: String(body.brandName ?? DEFAULT_LANDING.brandName).trim(),
      heroHeading: String(body.heroHeading ?? DEFAULT_LANDING.heroHeading).trim(),
      heroHeadingAccent: String(body.heroHeadingAccent ?? DEFAULT_LANDING.heroHeadingAccent).trim(),
      heroDescription: String(body.heroDescription ?? DEFAULT_LANDING.heroDescription).trim(),
      heroCta: String(body.heroCta ?? DEFAULT_LANDING.heroCta).trim(),
      featuresHeading: String(body.featuresHeading ?? DEFAULT_LANDING.featuresHeading).trim(),
      featuresSubheading: String(body.featuresSubheading ?? DEFAULT_LANDING.featuresSubheading).trim(),
      featureCards: Array.isArray(body.featureCards)
        ? body.featureCards.slice(0, 6).map((c) => ({
            title: String(c?.title ?? "").trim(),
            description: String(c?.description ?? "").trim(),
          }))
        : DEFAULT_LANDING.featureCards,
      highlightsHeading: String(body.highlightsHeading ?? DEFAULT_LANDING.highlightsHeading).trim(),
      highlights: Array.isArray(body.highlights)
        ? body.highlights.map((h) => String(h).trim()).filter(Boolean)
        : DEFAULT_LANDING.highlights,
      ctaHeading: String(body.ctaHeading ?? DEFAULT_LANDING.ctaHeading).trim(),
      ctaSubheading: String(body.ctaSubheading ?? DEFAULT_LANDING.ctaSubheading).trim(),
      footerName: String(body.footerName ?? DEFAULT_LANDING.footerName).trim(),
    };

    await db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value: next })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
