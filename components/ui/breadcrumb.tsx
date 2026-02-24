import * as React from "react";
import { cn } from "@/lib/utils";

export function Breadcrumb({ children }: { children: React.ReactNode }) {
  return <nav aria-label="Breadcrumb">{children}</nav>;
}
export function BreadcrumbList({ children }: { children: React.ReactNode }) {
  return <ol className="flex items-center gap-1 text-sm text-neutral-600 dark:text-neutral-400">{children}</ol>;
}
export function BreadcrumbItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <li className={cn("inline-flex items-center", className)}>{children}</li>;
}
export function BreadcrumbSeparator({ className }: { className?: string }) {
  return <span className={cn("px-1", className)}>/</span>;
}
export function BreadcrumbLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="hover:underline" href={href}>
      {children}
    </a>
  );
}
export function BreadcrumbPage({ children }: { children: React.ReactNode }) {
  return <span aria-current="page" className="font-medium text-neutral-900 dark:text-neutral-100">{children}</span>;
}

















