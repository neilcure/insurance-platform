"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  FloatingTooltip,
  useSidebar,
} from "@/components/ui/sidebar";

function CollapsedGroupHeader({
  title,
  icon: Icon,
  open,
  onToggle,
}: {
  title: string;
  icon?: LucideIcon;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = React.useRef<HTMLLIElement | null>(null);
  if (!Icon) return null;
  return (
    <li ref={ref} className="flex items-center justify-center py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 shadow-sm transition-opacity hover:opacity-80 dark:bg-blue-900"
      >
        <Icon className="h-4.5 w-4.5 text-neutral-900 dark:text-white" />
      </button>
      <FloatingTooltip text={title} anchorRef={ref} />
    </li>
  );
}

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: LucideIcon;
    isActive?: boolean;
    items?: { title: string; url: string; icon?: LucideIcon }[];
  }[];
}) {
  const { collapsed, isMobile } = useSidebar();
  const isCollapsed = collapsed && !isMobile;

  const [collapsedOpen, setCollapsedOpen] = React.useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const item of items) {
      if (item.isActive) init[item.title] = true;
    }
    return init;
  });

  if (isCollapsed) {
    return (
      <SidebarGroup>
        <SidebarMenu>
          {items.map((item) => (
            <React.Fragment key={item.title}>
              <CollapsedGroupHeader
                title={item.title}
                icon={item.icon}
                open={!!collapsedOpen[item.title]}
                onToggle={() => setCollapsedOpen((s) => ({ ...s, [item.title]: !s[item.title] }))}
              />
              {collapsedOpen[item.title] && (item.items ?? []).map((subItem) => (
                <SidebarMenuItem key={subItem.title}>
                  <SidebarMenuButton tooltip={subItem.title} asChild>
                    <Link href={subItem.url}>
                      {subItem.icon ? <subItem.icon className="h-3.5 w-3.5 shrink-0" /> : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </React.Fragment>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <Collapsible asChild className="group/collapsible" defaultOpen={item.isActive}>
              <div>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="ml-4 grid gap-1 py-1">
                    {item.items?.map((subItem) => (
                      <li key={subItem.title}>
                        <SidebarMenuButton tooltip={subItem.title} asChild>
                          <Link href={subItem.url}>
                            {subItem.icon ? <subItem.icon className="h-4 w-4 shrink-0" /> : null}
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}


