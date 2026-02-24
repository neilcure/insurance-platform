"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type CollapsibleContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
};

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

export function Collapsible({
  asChild,
  defaultOpen,
  open: controlledOpen,
  onOpenChange,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const isControlled = typeof controlledOpen === "boolean";
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState<boolean>(!!defaultOpen);
  const open = isControlled ? (controlledOpen as boolean) : uncontrolledOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) {
      onOpenChange?.(v);
    } else {
      setUncontrolledOpen(v);
    }
  };
  const Comp: any = asChild ? "div" : "div";
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <Comp
        data-state={open ? "open" : "closed"}
        className={cn(className)}
        {...props}
      >
        {children}
      </Comp>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleTrigger({
  asChild,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const ctx = React.useContext(CollapsibleContext)!;
  // If asChild, enhance the single child instead of rendering another button
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>;
    const originalOnClick = child.props?.onClick as
      | ((e: React.MouseEvent<any>) => void)
      | undefined;
    return React.cloneElement(child, {
      ...child.props,
      ...props,
      "data-state": ctx.open ? "open" : "closed",
      onClick: (e: React.MouseEvent<any>) => {
        originalOnClick?.(e);
        ctx.setOpen(!ctx.open);
      },
    });
  }
  // Fallback: render a native button
  return (
    <button
      type="button"
      onClick={() => ctx.setOpen(!ctx.open)}
      data-state={ctx.open ? "open" : "closed"}
      {...props}
    >
      {children}
    </button>
  );
}

export function CollapsibleContent({
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(CollapsibleContext)!;
  return (
    <div hidden={!ctx.open} data-state={ctx.open ? "open" : "closed"} {...props}>
      {children}
    </div>
  );
}


