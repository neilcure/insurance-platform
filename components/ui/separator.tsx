import * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-neutral-200 dark:bg-neutral-800",
        orientation === "horizontal" ? "my-4 h-px w-full" : "mx-4 h-full w-px",
        className
      )}
      {...props}
    />
  );
}










