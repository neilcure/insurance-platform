import * as React from "react";
import { cn } from "@/lib/utils";
import { isRecent } from "@/lib/time/recent";

export function RecentHighlight({
	since,
	windowDays = 7,
	className,
	children,
}: {
	since?: string | number | Date;
	windowDays?: number;
	className?: string;
	children: React.ReactNode;
}) {
	const recent = isRecent(since, windowDays);
	return <span className={cn(className, recent ? "text-yellow-600 dark:text-yellow-400" : undefined)}>{children}</span>;
}

