import * as React from "react";
import { cn } from "@/lib/utils";

export function SettingsBlock({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="space-y-1">
        <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100">{title}</h3>
        {description ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}


