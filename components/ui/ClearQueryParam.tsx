"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function ClearQueryParam({ name }: { name: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!searchParams) return;
    const has = searchParams.has(name);
    if (!has) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(name);
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    router.replace(url);
  }, [name, pathname, router, searchParams]);

  return null;
}

