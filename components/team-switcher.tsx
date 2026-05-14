"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n";

export function TeamSwitcher({
  teams,
  size = "sm",
}: {
  teams: { name: string; logo: LucideIcon; plan: string }[];
  size?: "sm" | "xs";
}) {
  const t = useT();
  const [active, setActive] = React.useState(0);
  const T = teams[active];
  const Logo = T.logo;
  const textSize = size === "xs" ? "text-xs" : "text-sm";
  const nameWeight = size === "xs" ? "font-normal" : "font-medium";
  return (
    <button
      type="button"
      onClick={() => setActive((i) => (i + 1) % teams.length)}
      className={`flex w-full items-center gap-2 rounded-md border border-neutral-300 px-2 py-2 ${textSize} hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900 group-data-[collapsed=true]/sidebar-wrapper:justify-center`}
      title={t("sidebar.switchTeam", "Switch team")}
    >
      <Logo className="h-4 w-4" />
      <span className={`flex-1 ${nameWeight} text-left whitespace-normal wrap-break-word leading-tight group-data-[collapsed=true]/sidebar-wrapper:hidden`}>
        {T.name}
      </span>
      {T.plan ? (
        <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-400 group-data-[collapsed=true]/sidebar-wrapper:hidden">
          {T.plan}
        </span>
      ) : null}
    </button>
  );
}


