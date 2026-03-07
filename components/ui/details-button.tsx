"use client";

import { Button } from "@/components/ui/button";
import { Info, Loader2 } from "lucide-react";

export function DetailsButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      className="inline-flex items-center gap-2 transition-transform active:scale-95"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin sm:hidden lg:inline" />
      ) : (
        <Info className="h-4 w-4 sm:hidden lg:inline" />
      )}
      <span className="hidden sm:inline">
        {loading ? "Opening\u2026" : "Details"}
      </span>
    </Button>
  );
}
