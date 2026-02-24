"use client";

import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { LucideIcon } from "lucide-react";

export function NavProjects({
  projects,
}: {
  projects: { name: string; url: string; icon: LucideIcon }[];
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((p) => (
          <SidebarMenuItem key={p.name}>
            <SidebarMenuButton asChild>
              <a href={p.url} className="flex items-center gap-2" title={p.name}>
                <p.icon className="h-4 w-4" />
                <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">{p.name}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}


