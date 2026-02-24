"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";

export function UserMenu({ nameOrEmail }: { nameOrEmail: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        {nameOrEmail}
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 min-w-40 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md dark:border-neutral-800 dark:bg-neutral-900">
          <button
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}


