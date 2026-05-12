"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LocalUpdatedBadge } from "@/components/LocalUpdatedBadge";

interface WelcomeCardProps {
  name?: string | null;
  email?: string | null;
  userType?: string | null;
  accountComplete: boolean;
  updatedAtIso?: string;
  userTimeZone?: string;
}

const FADE_DELAY_MS = 20_000;
const FADE_DURATION_MS = 800;

export function WelcomeCard({
  name,
  email,
  userType,
  accountComplete,
  updatedAtIso,
  userTimeZone,
}: WelcomeCardProps) {
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
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            Signed in as{" "}
            <span className="font-medium">{name ?? email}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Role</span>
            <Badge>{userType ?? "user"}</Badge>
            {accountComplete ? (
              <Badge variant="success">Account setup complete</Badge>
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
