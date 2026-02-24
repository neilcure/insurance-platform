"use client";

import * as React from "react";
import { signOut } from "next-auth/react";

function getInitials(nameOrEmail: string): string {
  if (!nameOrEmail) return "?";
  const s = nameOrEmail.trim();
  const at = s.indexOf("@");
  const base = at > 0 ? s.slice(0, at) : s;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base[0]?.toUpperCase() ?? "?";
}

export function NavUser({ user }: { user: { name?: string | null; email?: string | null } }) {
  const [open, setOpen] = React.useState(false);
  const label = (user.name || user.email || "User") as string;
  const initials = getInitials(label);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-neutral-200 p-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900 group-data-[collapsed=true]/sidebar-wrapper:justify-center"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100">
          {initials}
        </div>
        <div className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
          <div className="font-medium leading-none">{user.name || label}</div>
          <div className="text-xs text-neutral-500">{user.email || ""}</div>
        </div>
      </button>
      {open ? (
        <div className="absolute left-full top-1/2 z-20 ml-2 min-w-40 -translate-y-1/2 transform overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md dark:border-neutral-800 dark:bg-neutral-900">
          <button
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign out
          </button>
        </div>
      ) : null}
      <div
        className={open ? "fixed inset-0 z-10 block" : "hidden"}
        onClick={() => setOpen(false)}
      />
    </div>
  );
}


