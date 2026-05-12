"use client";

/**
 * Shadcn-style wrapper around `react-day-picker` v10's `<DayPicker>`.
 *
 * Why this exists
 * ---------------
 * The third-party `<DayPicker>` ships with its own minimal CSS classes
 * (`rdp-*`). To match the rest of our shadcn UI vocabulary (button
 * variants, neutral palette, dark-mode pairs) we override every
 * `classNames` slot with Tailwind utilities. The `Calendar` API is
 * intentionally a pass-through of `DayPickerProps` so callers can
 * keep using `mode`, `selected`, `onSelect`, `modifiers`,
 * `modifiersClassNames`, etc. directly.
 *
 * Dark-mode rule (per `.cursor/rules/dark-mode.mdc`): every visible
 * colour has a `dark:` counterpart. Dot/badge colours used by
 * consumers (e.g. `policy-expiry-calendar`) live in the consumer file
 * — only the chrome is themed here.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components: consumerComponents,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-3",
        month_caption:
          "flex justify-center pt-1 relative items-center text-sm font-medium text-neutral-900 dark:text-neutral-100",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "absolute left-1 top-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "absolute right-1 top-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-neutral-500 dark:text-neutral-400 rounded-md w-8 font-normal text-[0.8rem] uppercase",
        week: "flex w-full mt-1",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "h-8 w-8 [&:has([aria-selected])]:bg-neutral-100 dark:[&:has([aria-selected])]:bg-neutral-800",
          "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "h-8 w-8 p-0 font-normal aria-selected:opacity-100",
        ),
        range_start: "rounded-l-md",
        range_end: "rounded-r-md",
        selected:
          "bg-blue-600 text-white hover:bg-blue-600 hover:text-white focus:bg-blue-600 focus:text-white dark:bg-blue-500 dark:text-white",
        today:
          "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 font-semibold",
        outside:
          "text-neutral-400 dark:text-neutral-600 aria-selected:bg-neutral-100/50 aria-selected:text-neutral-400 dark:aria-selected:bg-neutral-800/50",
        disabled: "text-neutral-300 dark:text-neutral-700 opacity-50",
        range_middle:
          "aria-selected:bg-neutral-100 aria-selected:text-neutral-900 dark:aria-selected:bg-neutral-800 dark:aria-selected:text-neutral-100",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevClassName, ...rest }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          // `text-inherit` ensures the icon stroke picks up currentColor
          // from the parent button rather than any SVG-level default.
          return <Icon className={cn("h-4 w-4 text-inherit", chevClassName)} {...rest} />;
        },
        // Merge consumer components AFTER defaults so the Chevron
        // override above is never silently dropped when a consumer
        // passes their own DayButton or other slot overrides.
        ...consumerComponents,
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";
