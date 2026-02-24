"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelLeft } from "lucide-react";

type SidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const handle = (e: MediaQueryListEvent) => setCollapsed(e.matches);

    let legacy: (MediaQueryList & {
      addListener: (fn: (e: MediaQueryListEvent) => void) => void;
      removeListener: (fn: (e: MediaQueryListEvent) => void) => void;
    }) | null = null;

    // Set initial collapsed state on mount to avoid SSR/client mismatch
    setCollapsed(mql.matches);

    if (mql.addEventListener) {
      mql.addEventListener("change", handle);
    } else {
      legacy = mql as MediaQueryList & {
        addListener: (fn: (e: MediaQueryListEvent) => void) => void;
        removeListener: (fn: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener(handle);
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener("change", handle);
      } else {
        legacy?.removeListener(handle);
      }
    };
  }, []);
  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <div className="flex min-h-screen">{children}</div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  collapsible = "icon",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { collapsible?: "icon" | "none" }) {
  const ctx = React.useContext(SidebarContext)!;
  return (
    <div
      data-collapsible={collapsible}
      data-collapsed={ctx.collapsed ? "true" : "false"}
      className={cn(
        "group/sidebar-wrapper sticky top-0 h-screen shrink-0 border-r border-neutral-200 bg-white transition-[width] dark:border-neutral-800 dark:bg-neutral-950 flex flex-col",
        ctx.collapsed ? "w-24 md:w-24" : "w-80",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarTrigger({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(SidebarContext)!;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => ctx.setCollapsed(!ctx.collapsed)}
      className={cn("shrink-0", className)}
      {...props}
    >
      <PanelLeft className="h-4 w-4" />
    </Button>
  );
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-1 flex-col">{children}</div>;
}

export function SidebarHeader({ children }: { children: React.ReactNode }) {
  return <div className="p-3">{children}</div>;
}
export function SidebarContent({ children }: { children: React.ReactNode }) {
  return <div className="px-2">{children}</div>;
}
export function SidebarFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto p-2">{children}</div>;
}
export function SidebarRail() {
  return null;
}

export function SidebarGroup({ children }: { children: React.ReactNode }) {
  return <div className="mb-3">{children}</div>;
}
export function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 text-xs font-semibold text-neutral-500 group-data-[collapsed=true]/sidebar-wrapper:hidden">{children}</div>;
}
export function SidebarMenu({ children }: { children: React.ReactNode }) {
  return <ul className="grid gap-1">{children}</ul>;
}
export function SidebarMenuItem({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}
export function SidebarMenuButton({
  tooltip,
  className,
  children,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string; asChild?: boolean }) {
  const ctx = React.useContext(SidebarContext)!;
  const cls = cn(
    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900",
    className
  );
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<Record<string, unknown>>;
    return React.cloneElement(child, {
      ...child.props,
      className: cn((child.props as { className?: string })?.className, cls),
      title: ctx.collapsed ? tooltip : undefined,
    });
  }
  return (
    <button className={cls} title={ctx.collapsed ? tooltip : undefined} {...props}>
      {children}
    </button>
  );
}
export function SidebarMenuSub({ children }: { children: React.ReactNode }) {
  return <ul className="ml-4 grid gap-1 py-1">{children}</ul>;
}
export function SidebarMenuSubItem({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}
export function SidebarMenuSubButton({
  children,
  asChild,
}: React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }) {
  const Comp: React.ElementType = asChild ? "div" : "div";
  return (
    <Comp className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900">
      {children}
    </Comp>
  );
}


