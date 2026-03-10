"use client";

import * as React from "react";
// import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Shield,
  UserCog,
  IdCard,
  Frame,
  GalleryVerticalEnd,
  Hash,
  Map,
  PieChart,
  LayoutDashboard,
  Folder,
  Package,
  GitBranch,
  UserPlus,
  User,
  type LucideIcon,
} from "lucide-react";
import { getIcon } from "@/lib/icons";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  FloatingTooltip,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

function CollapsedGroupBadge({
  title,
  icon: Icon,
  onToggle,
}: {
  title: string;
  icon: LucideIcon;
  onToggle: () => void;
}) {
  const ref = React.useRef<HTMLLIElement | null>(null);
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

type SidebarPackage = { label: string; value: string; meta?: Record<string, unknown> | null };
type SidebarFlow = {
  label: string;
  value: string;
  sortOrder: number;
  meta?: { showInDashboard?: boolean; icon?: string; dashboardLabel?: string } | null;
};

// In-memory cache to prevent sidebar package list disappearing between navigations
let packagesCache: SidebarPackage[] | null = null;
let flowsCache: SidebarFlow[] | null = null;
let adminOpenCache: boolean | null = null;
let policyOpenCache: boolean | null = null;
let pkgOpenCache: Record<string, boolean> | null = null;

const STATIC_DASHBOARD_ITEMS: { title: string; url: string; icon: LucideIcon }[] = [
  { title: "Agents", url: "/dashboard/agents", icon: UserPlus },
  { title: "Membership", url: "/dashboard/membership", icon: IdCard },
  { title: "Account", url: "/dashboard/account", icon: User },
];

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  projects: [
    { name: "Design Engineering", url: "#", icon: Frame },
    { name: "Sales & Marketing", url: "#", icon: PieChart },
    { name: "Travel", url: "#", icon: Map },
  ],
};

export function AppSidebar(
  props: React.ComponentProps<typeof Sidebar> & {
    isAdmin?: boolean;
    canManageSettings?: boolean;
    user?: { name?: string | null; email?: string | null };
  }
) {
  const { isAdmin = false, canManageSettings = false, user, ...sidebarProps } = props as {
    isAdmin?: boolean;
    canManageSettings?: boolean;
    user?: { name?: string | null; email?: string | null };
  };
  const userKey = React.useMemo(() => (user?.email || user?.name || "anon") as string, [user?.email, user?.name]);
  const [flows, setFlows] = React.useState<SidebarFlow[]>(() => flowsCache ?? []);
  const [packages, setPackages] = React.useState<SidebarPackage[]>(
    () => packagesCache ?? []
  );
  // Persist collapsible open states to keep sidebar from folding on navigation
  const [adminOpen, setAdminOpen] = React.useState<boolean>(adminOpenCache ?? true);
  const [policyOpen, setPolicyOpen] = React.useState<boolean>(policyOpenCache ?? true);
  const [pkgOpen, setPkgOpen] = React.useState<Record<string, boolean>>(pkgOpenCache ?? {});
  const [orgName, setOrgName] = React.useState<string | null>(null);

  const navItems = React.useMemo(() => {
    const dashboardFlowItems = flows
      .filter((f) => f.meta?.showInDashboard)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        title: f.meta?.dashboardLabel || f.label,
        url: `/dashboard/flows/${f.value}`,
        icon: getIcon(f.meta?.icon),
      }));
    return [
      {
        title: "Dashboard",
        url: "/dashboard",
        icon: LayoutDashboard,
        isActive: true,
        items: [...dashboardFlowItems, ...STATIC_DASHBOARD_ITEMS],
      },
      {
        title: "Docs",
        url: "#",
        icon: BookOpen,
        items: [{ title: "Guide", url: "#" }],
      },
    ];
  }, [flows]);

  const loadFlowsOnce = React.useCallback(async () => {
    try {
      const res = await fetch("/api/form-options?groupKey=flows", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as SidebarFlow[];
      const list = Array.isArray(rows) ? rows : [];
      setFlows(list);
      try { sessionStorage.setItem("sidebar.flows", JSON.stringify(list)); } catch {}
      flowsCache = list;
    } catch {}
  }, []);

  // Fetch helper reused by effects and custom events
  const loadPackagesOnce = React.useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as SidebarPackage[];
      const list = Array.isArray(rows) ? rows : [];
      setPackages(list);
      try {
        sessionStorage.setItem("sidebar.packages", JSON.stringify(list));
      } catch {
        // ignore
      }
      packagesCache = list;
      // Ensure we have a stable open-state map per package (default true)
      setPkgOpen((prev) => {
        const next = { ...prev };
        for (const p of list) {
          // default collapsed (closed)
          if (typeof next[p.value] === "undefined") next[p.value] = false;
        }
        // Drop states for removed packages
        for (const k of Object.keys(next)) {
          if (!list.some((p) => p.value === k)) delete next[k];
        }
        return next;
      });
    } catch {
      // ignore
    }
  }, [isAdmin]);

  // Restore persisted open states
  React.useEffect(() => {
    try {
      if (!flowsCache) {
        const cachedFlows = sessionStorage.getItem("sidebar.flows");
        if (cachedFlows) {
          const list = JSON.parse(cachedFlows) as SidebarFlow[];
          if (Array.isArray(list)) {
            setFlows(list);
            flowsCache = list;
          }
        }
      }
      if (!packagesCache) {
        const cachedPackages = sessionStorage.getItem("sidebar.packages");
        if (cachedPackages) {
          const list = JSON.parse(cachedPackages) as SidebarPackage[];
          if (Array.isArray(list)) {
            setPackages(list);
            packagesCache = list;
          }
        }
      }
      const a = sessionStorage.getItem("sidebar.adminOpen");
      const p = sessionStorage.getItem("sidebar.policyOpen");
      const pkg = sessionStorage.getItem("sidebar.pkgOpen");
      if (a !== null) {
        const v = a === "true";
        setAdminOpen(v);
        adminOpenCache = v;
      }
      if (p !== null) {
        const v = p === "true";
        setPolicyOpen(v);
        policyOpenCache = v;
      }
      if (pkg) {
        const obj = JSON.parse(pkg) as Record<string, boolean>;
        if (obj && typeof obj === "object") {
          setPkgOpen(obj);
          pkgOpenCache = obj;
        }
      }
    } catch {
      // ignore
    }
  }, []);
  // Persist open states
  React.useEffect(() => {
    try {
      sessionStorage.setItem("sidebar.adminOpen", String(adminOpen));
      sessionStorage.setItem("sidebar.policyOpen", String(policyOpen));
      sessionStorage.setItem("sidebar.pkgOpen", JSON.stringify(pkgOpen));
      // update in-memory cache too
      adminOpenCache = adminOpen;
      policyOpenCache = policyOpen;
      pkgOpenCache = pkgOpen;
    } catch {
      // ignore
    }
  }, [adminOpen, policyOpen, pkgOpen]);

  const fetchOrgName = React.useCallback(async () => {
    try {
      const cached = sessionStorage.getItem(`sidebar.orgName:${userKey}`);
      if (cached) setOrgName(cached);
    } catch {}
    try {
      const res = await fetch("/api/account/info", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          organisation?: { name?: string | null } | null;
        };
        const name = (data?.organisation?.name ?? "") as string;
        setOrgName(name || null);
        try {
          if (name && name.trim().length > 0) {
            sessionStorage.setItem(`sidebar.orgName:${userKey}`, name);
          } else {
            sessionStorage.removeItem(`sidebar.orgName:${userKey}`);
          }
        } catch {}
      } else {
        setOrgName(null);
      }
    } catch {
      setOrgName(null);
    }
  }, [userKey]);

  // Initial fetch only once
  React.useEffect(() => {
    void loadFlowsOnce();
    void loadPackagesOnce();
    void fetchOrgName();
  }, [loadFlowsOnce, loadPackagesOnce, fetchOrgName]);

  // Listen for account changes to refresh org name live
  React.useEffect(() => {
    const onChanged = () => void fetchOrgName();
    window.addEventListener("account:info-changed", onChanged);
    return () => window.removeEventListener("account:info-changed", onChanged);
  }, [fetchOrgName]);

  // Listen for explicit admin changes to refresh packages and flows (no refresh on simple navigation)
  React.useEffect(() => {
    const onChanged = () => {
      void loadPackagesOnce();
      void loadFlowsOnce();
    };
    window.addEventListener("policy-settings:changed", onChanged);
    window.addEventListener("form-options:changed", onChanged);
    return () => {
      window.removeEventListener("policy-settings:changed", onChanged);
      window.removeEventListener("form-options:changed", onChanged);
    };
  }, [loadPackagesOnce, loadFlowsOnce]);

  const { collapsed, isMobile } = useSidebar();
  const isCollapsed = collapsed && !isMobile;
  const [adminCollapsedOpen, setAdminCollapsedOpen] = React.useState(true);
  const [policyCollapsedOpen, setPolicyCollapsedOpen] = React.useState(false);
  const [pkgCollapsedOpen, setPkgCollapsedOpen] = React.useState(false);

  return (
    <Sidebar collapsible="icon" {...sidebarProps}>
      <SidebarHeader>
        <TeamSwitcher
          size="xs"
          teams={[
            {
              name: (orgName ?? (user?.name || user?.email || "Account")),
              logo: GalleryVerticalEnd,
              plan: "",
            },
          ]}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
        {canManageSettings ? (
          <SidebarGroup>
            <Separator className="my-2 dark:bg-neutral-800" />
            {isCollapsed ? (
              /* ---- Collapsed: toggleable icon groups ---- */
              <SidebarMenu>
                {/* Admin group — toggle */}
                <CollapsedGroupBadge
                  title="Admin Panel"
                  icon={Shield}
                  onToggle={() => setAdminCollapsedOpen((v) => !v)}
                />
                {adminCollapsedOpen && (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip="User Settings" asChild>
                        <Link href="/admin/users">
                          <UserCog className="h-3.5 w-3.5 shrink-0" />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip="Client Number Settings" asChild>
                        <Link href="/admin/client-settings">
                          <Hash className="h-3.5 w-3.5 shrink-0" />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                )}
                {isAdmin && (
                  <>
                    {/* Policy Settings group — toggle */}
                    <CollapsedGroupBadge
                      title="Policy Settings"
                      icon={FileText}
                      onToggle={() => setPolicyCollapsedOpen((v) => !v)}
                    />
                    {policyCollapsedOpen && (
                      <>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip="Packages" asChild>
                            <Link href="/admin/policy-settings/packages">
                              <Package className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip="Flows" asChild>
                            <Link href="/admin/policy-settings/flows">
                              <GitBranch className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </>
                    )}
                    {/* Packages group — toggle */}
                    {packages.length > 0 && (
                      <>
                        <CollapsedGroupBadge
                          title="Packages"
                          icon={Folder}
                          onToggle={() => setPkgCollapsedOpen((v) => !v)}
                        />
                        {pkgCollapsedOpen && packages.map((p) => {
                          const iconName = (p.meta as Record<string, unknown> | null)?.icon as string | undefined;
                          const PkgIcon = getIcon(iconName);
                          return (
                            <SidebarMenuItem key={p.value}>
                              <SidebarMenuButton tooltip={p.label} asChild>
                                <Link href={`/admin/policy-settings/${p.value}/fields`}>
                                  <PkgIcon className="h-3.5 w-3.5 shrink-0" />
                                </Link>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </SidebarMenu>
            ) : (
              /* ---- Expanded: full collapsible tree ---- */
              <SidebarMenu>
                <SidebarMenuItem>
                  <Collapsible asChild className="group/collapsible" open={adminOpen} onOpenChange={setAdminOpen}>
                    <div>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          tooltip="Admin Panel"
                          className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 dark:bg-yellow-400 dark:text-neutral-900 dark:hover:bg-yellow-500"
                        >
                          <Shield className="h-4 w-4 shrink-0" />
                          <span className="font-medium">Admin Panel</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="ml-4 grid gap-1 py-1">
                          <li>
                            <SidebarMenuButton tooltip="User Settings" asChild>
                              <Link href="/admin/users">
                                <UserCog className="h-4 w-4 shrink-0" />
                                <span>User Settings</span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          <li>
                            <SidebarMenuButton tooltip="Client Number Settings" asChild>
                              <Link href="/admin/client-settings">
                                <Hash className="h-4 w-4 shrink-0" />
                                <span>Client Number Settings</span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          {isAdmin && (
                            <li>
                              <Collapsible asChild className="group/collapsible" open={policyOpen} onOpenChange={setPolicyOpen}>
                                <div>
                                  <CollapsibleTrigger asChild>
                                    <SidebarMenuButton tooltip="Policy Settings">
                                      <FileText className="h-4 w-4 shrink-0" />
                                      <span>Policy Settings</span>
                                      <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                    </SidebarMenuButton>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <ul className="ml-4 grid gap-1 py-1">
                                      <li>
                                        <SidebarMenuButton tooltip="Packages" asChild>
                                          <Link href="/admin/policy-settings/packages">
                                            <Package className="h-4 w-4 shrink-0" />
                                            <span>Packages</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip="Flows" asChild>
                                          <Link href="/admin/policy-settings/flows">
                                            <GitBranch className="h-4 w-4 shrink-0" />
                                            <span>Flows</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                    </ul>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            </li>
                          )}
                        </ul>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </SidebarMenuItem>

                {isAdmin && packages.length > 0 && (
                  <>
                    <Separator className="my-2 dark:bg-neutral-800" />
                    {packages.map((p) => {
                      const iconName = (p.meta as Record<string, unknown> | null)?.icon as string | undefined;
                      const PkgIcon = getIcon(iconName);
                      return (
                        <SidebarMenuItem key={p.value}>
                          <Collapsible
                            asChild
                            className="group/collapsible"
                            open={pkgOpen[p.value] ?? false}
                            onOpenChange={(v) => {
                              setPkgOpen((s) => {
                                const next = { ...s, [p.value]: v };
                                try { sessionStorage.setItem("sidebar.pkgOpen", JSON.stringify(next)); } catch {}
                                return next;
                              });
                            }}
                          >
                            <div>
                              <CollapsibleTrigger asChild>
                                <SidebarMenuButton tooltip={p.label}>
                                  <PkgIcon className="h-4 w-4 shrink-0" />
                                  <span>{p.label}</span>
                                  <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                </SidebarMenuButton>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <ul className="ml-4 grid gap-1 py-1">
                                  <li>
                                    <SidebarMenuButton tooltip={`${p.label} — Category`} asChild>
                                      <Link href={`/admin/policy-settings/${p.value}/category`}>
                                        <Folder className="h-4 w-4 shrink-0" />
                                        <span>Category</span>
                                      </Link>
                                    </SidebarMenuButton>
                                  </li>
                                  <li>
                                    <SidebarMenuButton tooltip={`${p.label} — Fields`} asChild>
                                      <Link href={`/admin/policy-settings/${p.value}/fields`}>
                                        <FileText className="h-4 w-4 shrink-0" />
                                        <span>Fields</span>
                                      </Link>
                                    </SidebarMenuButton>
                                  </li>
                                </ul>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        </SidebarMenuItem>
                      );
                    })}
                  </>
                )}
              </SidebarMenu>
            )}
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <div className="border-t border-neutral-200 pt-2 dark:border-neutral-800">
          <NavUser user={user ?? data.user} />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

