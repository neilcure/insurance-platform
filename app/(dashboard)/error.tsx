"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = error?.message || "Something went wrong";
    toast.error(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  return (
    <main className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Error</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        An error occurred in the dashboard. We’ve shown a toast with details.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}

