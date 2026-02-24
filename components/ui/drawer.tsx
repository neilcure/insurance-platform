"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DrawerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
	overlayClassName?: string;
};

export function Drawer({ open, onOpenChange, children, overlayClassName }: DrawerProps) {
	React.useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onOpenChange(false);
		}
		if (open) document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onOpenChange]);
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50">
			<div
				className={cn("absolute inset-0 bg-black", overlayClassName)}
				onClick={() => onOpenChange(false)}
				aria-hidden="true"
			/>
			{children}
		</div>
	);
}

export function DrawerContent({
	className,
	children,
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				"absolute inset-y-0 left-0 h-full transform will-change-transform border-r border-neutral-200 bg-white shadow-xl transition-transform duration-300 ease-out dark:border-neutral-800 dark:bg-neutral-950",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function DrawerHeader({ children }: { children: React.ReactNode }) {
	return <div className="mb-2 border-b border-neutral-200 p-4 dark:border-neutral-800">{children}</div>;
}

export function DrawerTitle({ children }: { children: React.ReactNode }) {
	return <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{children}</h3>;
}

