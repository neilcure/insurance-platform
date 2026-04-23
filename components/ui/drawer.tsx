"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DrawerSide = "left" | "right";

type DrawerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
	overlayClassName?: string;
	/**
	 * Which edge the panel slides in from. Defaults to "left" to keep
	 * existing usages unchanged. Pass "right" for ad-hoc settings panels
	 * (e.g. template Layout & Style) that should not push the main view.
	 */
	side?: DrawerSide;
};

// Shared between Drawer (controls overlay click) and DrawerContent (border /
// alignment) so both stay in lock-step when a caller picks a side.
const DrawerSideContext = React.createContext<DrawerSide>("left");

export function Drawer({ open, onOpenChange, children, overlayClassName, side = "left" }: DrawerProps) {
	React.useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onOpenChange(false);
		}
		if (open) document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onOpenChange]);
	if (!open) return null;
	return (
		<DrawerSideContext.Provider value={side}>
			<div className="fixed inset-0 z-50">
				<div
					className={cn("absolute inset-0 bg-black", overlayClassName)}
					onClick={() => onOpenChange(false)}
					aria-hidden="true"
				/>
				{children}
			</div>
		</DrawerSideContext.Provider>
	);
}

export function DrawerContent({
	className,
	children,
}: React.HTMLAttributes<HTMLDivElement>) {
	const side = React.useContext(DrawerSideContext);
	const sideClass =
		side === "right"
			? "right-0 border-l border-neutral-200 dark:border-neutral-800"
			: "left-0 border-r border-neutral-200 dark:border-neutral-800";
	return (
		<div
			className={cn(
				"absolute inset-y-0 h-full transform will-change-transform bg-white shadow-xl transition-transform duration-300 ease-out dark:bg-neutral-950",
				sideClass,
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

