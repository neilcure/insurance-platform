import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "success" | "custom";

const variantClasses: Record<Variant, string> = {
  default: "bg-black text-white dark:bg-white dark:text-black",
  secondary: "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
  outline: "border border-neutral-300 text-neutral-900 dark:border-neutral-700 dark:text-neutral-100",
  success: "bg-green-600 text-white dark:bg-green-600",
  custom: "",
};

export function Badge({
  className,
  variant = "secondary",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

























