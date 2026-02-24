"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

const RadioGroup = RadioGroupPrimitive.Root;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "rg-item relative aspect-square h-4 w-4 rounded-full",
        // Subtle, theme-aware borders
        "border border-neutral-400 dark:border-neutral-600",
        // Remove loud rings per UX rules
        "focus-visible:outline-none focus-visible:ring-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/* Inner dot for checked state with proper dark/light contrast */}
      <RadioGroupPrimitive.Indicator
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center",
        )}
      >
        <span
          className={cn(
            "block h-2 w-2 rounded-full",
            "bg-neutral-900 dark:bg-white"
          )}
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
