"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LocalUpdatedBadge } from "@/components/LocalUpdatedBadge";
import { useT } from "@/lib/i18n";

interface WelcomeCardProps {
  name?: string | null;
  email?: string | null;
  userType?: string | null;
  accountComplete: boolean;
  updatedAtIso?: string;
  userTimeZone?: string;
}

const FADE_DELAY_MS = 3_000;
const FADE_DURATION_MS = 800;

export function WelcomeCard({
  name,
  email,
  userType,
  accountComplete,
  updatedAtIso,
  userTimeZone,
}: WelcomeCardProps) {
  const t = useT();
  const [visible, setVisible] = React.useState(true);
  const [fading, setFading] = React.useState(false);

  React.useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFading(true);
      const hideTimer = setTimeout(() => setVisible(false), FADE_DURATION_MS);
      return () => clearTimeout(hideTimer);
    }, FADE_DELAY_MS);
    return () => clearTimeout(fadeTimer);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        transition: `opacity ${FADE_DURATION_MS}ms ease-out, max-height ${FADE_DURATION_MS}ms ease-out, margin-bottom ${FADE_DURATION_MS}ms ease-out`,
        opacity: fading ? 0 : 1,
        maxHeight: fading ? 0 : "200px",
        overflow: "hidden",
        marginBottom: fading ? 0 : undefined,
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.welcomeTitle", "Welcome")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            {t("dashboard.welcomeSignedInAs", "Signed in as")}{" "}
            <span className="font-medium">{name ?? email}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">{t("dashboard.welcomeRole", "Role")}</span>
            {/*
              `userType` itself is the raw enum value (`admin`, `agent`, ...)
              — it stays as-is. The fallback label when the field is
              missing comes from the dictionary so a missing role
              doesn't render the literal English word "user" in zh-HK.
            */}
            <Badge>{userType ?? t("dashboard.welcomeFallbackRole", "user")}</Badge>
            {accountComplete ? (
              <Badge variant="success">{t("dashboard.welcomeAccountSetupComplete", "Account setup complete")}</Badge>
            ) : null}
            {updatedAtIso ? (
              <LocalUpdatedBadge ts={updatedAtIso} timeZone={userTimeZone} />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
