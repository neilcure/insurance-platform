"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelLeft, X } from "lucide-react";

type SidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  isMobile: boolean;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

const MOBILE_BREAKPOINT = 768;
const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedRaw] = React.useState<boolean>(false);
  const [isMobile, setIsMobile] = React.useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = React.useState<boolean>(false);

  const setCollapsed = React.useCallback((v: boolean) => {
    setCollapsedRaw(v);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(v)); } catch {}
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);

    const handle = (e: MediaQueryListEvent | MediaQueryList) => {
      const mobile = "matches" in e ? e.matches : false;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsedRaw(true);
        setMobileOpen(false);
      } else {
        setCollapsedRaw(saved === "true");
      }
    };
    handle(mql);

    const onChange = (e: MediaQueryListEvent) => {
      const mobile = e.matches;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsedRaw(true);
        setMobileOpen(false);
      } else {
        const current = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        setCollapsedRaw(current === "true");
      }
    };

    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
    } else {
      (mql as any).addListener(onChange);
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener("change", onChange);
      } else {
        (mql as any).removeListener(onChange);
      }
    };
  }, []);

  const pathname = usePathname();
  React.useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [pathname, isMobile]);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, isMobile, mobileOpen, setMobileOpen }}>
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

  if (ctx.isMobile) {
    return (
      <>
        {ctx.mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 transition-opacity"
            onClick={() => ctx.setMobileOpen(false)}
            aria-label="Close sidebar"
          />
        )}
        <div
          data-collapsible={collapsible}
          data-collapsed="false"
          className={cn(
            "group/sidebar-wrapper fixed left-0 top-0 z-50 h-full w-72 border-r border-neutral-200 bg-white shadow-xl transition-transform duration-300 ease-out dark:border-neutral-800 dark:bg-neutral-950/40 dark:backdrop-blur-xl flex flex-col",
            ctx.mobileOpen ? "translate-x-0" : "-translate-x-full",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </>
    );
  }

  return (
    <div
      data-collapsible={collapsible}
      data-collapsed={ctx.collapsed ? "true" : "false"}
      className={cn(
        "group/sidebar-wrapper sticky top-0 h-screen shrink-0 border-r border-neutral-200 bg-white transition-[width] dark:border-neutral-800 dark:bg-neutral-950/40 dark:backdrop-blur-xl flex flex-col",
        ctx.collapsed ? "w-20" : "w-56",
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
      onClick={() => {
        if (ctx.isMobile) {
          ctx.setMobileOpen(!ctx.mobileOpen);
        } else {
          ctx.setCollapsed(!ctx.collapsed);
        }
      }}
      className={cn("shrink-0", className)}
      {...props}
    >
      <PanelLeft className="h-4 w-4" />
    </Button>
  );
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-1 flex-col overflow-x-hidden">{children}</div>;
}

export function SidebarHeader({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(SidebarContext);
  return (
    <div className="flex items-center gap-2 p-3">
      <div className="min-w-0 flex-1">{children}</div>
      {ctx?.isMobile && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => ctx.setMobileOpen(false)}
          aria-label="Close sidebar"
          className="h-8 w-8 shrink-0 text-neutral-900 dark:text-white"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
export function SidebarContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-2">
      {children}
    </div>
  );
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
export function FloatingTooltip({ text, anchorRef }: { text: string; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const show = () => {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
      setVisible(true);
    };
    const hide = () => setVisible(false);
    el.addEventListener("mouseenter", show);
    el.addEventListener("mouseleave", hide);
    return () => {
      el.removeEventListener("mouseenter", show);
      el.removeEventListener("mouseleave", hide);
    };
  }, [anchorRef]);

  if (!visible || !pos) return null;

  return ReactDOM.createPortal(
    <div
      className="pointer-events-none fixed z-9999 -translate-y-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-md dark:bg-neutral-100 dark:text-neutral-900"
      style={{ top: pos.top, left: pos.left }}
    >
      {text}
    </div>,
    document.body
  );
}

export function SidebarMenuButton({
  tooltip,
  className,
  children,
  asChild,
  isActive: isActiveProp,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip?: string;
  asChild?: boolean;
  /** Force active state. When omitted, auto-detected from the wrapped <Link> href. */
  isActive?: boolean;
}) {
  const ctx = React.useContext(SidebarContext)!;
  const pathname = usePathname();
  const showTooltip = ctx.collapsed && !ctx.isMobile && !!tooltip;
  const ref = React.useRef<HTMLElement | null>(null);

  // Auto-detect active state from the asChild <Link>'s href so callers don't
  // need to pass anything. Highlight on exact OR sub-route match (deep pages
  // still feel "in" their section). No-op only on EXACT match — from a deep
  // page like /dashboard/agents/123/logs, clicking "Agents" must still go to
  // the list view.
  let derivedActive = false;
  let derivedExact = false;
  let childHref: string | undefined;
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ href?: string }>;
    childHref = typeof child.props.href === "string" ? child.props.href : undefined;
    if (pathname && childHref && childHref !== "#") {
      derivedExact = pathname === childHref;
      derivedActive = derivedExact || pathname.startsWith(childHref + "/");
    }
  }
  const active = isActiveProp ?? derivedActive;

  const cls = cn(
    "flex w-full items-center rounded-md text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900",
    active &&
      "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50",
    ctx.collapsed && !ctx.isMobile
      ? "justify-center px-1 py-1.5 [&_svg]:h-5 [&_svg]:w-5"
      : "gap-2 px-2 py-2 text-left",
    className
  );

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      href?: string;
      onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
      className?: string;
    }>;
    const childOnClick = child.props.onClick;
    // Only block the navigation when we're already on the exact same URL.
    // Always preserve modifier-click semantics (Cmd/Ctrl/Shift/middle-click
    // → open in new tab) so power users aren't punished.
    const handleClick = derivedExact
      ? (e: React.MouseEvent<HTMLAnchorElement>) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
            childOnClick?.(e);
            return;
          }
          e.preventDefault();
          // On mobile, close the overlay so the tap feels like it did
          // something — otherwise the menu just stays open silently.
          if (ctx.isMobile) ctx.setMobileOpen(false);
          childOnClick?.(e);
        }
      : childOnClick;
    return (
      <div ref={ref as React.RefObject<HTMLDivElement>}>
        {React.cloneElement(child, {
          ...child.props,
          className: cn(child.props.className, cls),
          onClick: handleClick,
          "aria-current": derivedExact ? "page" : undefined,
        } as React.HTMLAttributes<HTMLAnchorElement> & { href?: string })}
        {showTooltip && <FloatingTooltip text={tooltip} anchorRef={ref} />}
      </div>
    );
  }
  return (
    <button ref={ref as React.RefObject<HTMLButtonElement>} className={cls} {...props}>
      {children}
      {showTooltip && <FloatingTooltip text={tooltip} anchorRef={ref} />}
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
