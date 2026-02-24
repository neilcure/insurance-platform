"use client";

import * as React from "react";
// import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Shield,
  Users,
  IdCard,
  Frame,
  GalleryVerticalEnd,
  Map,
  PieChart,
  Settings2,
  SquareTerminal,
  Folder,
} from "lucide-react";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// In-memory cache to prevent sidebar package list disappearing between navigations
let packagesCache: { label: string; value: string }[] | null = null;
let adminOpenCache: boolean | null = null;
let policyOpenCache: boolean | null = null;
let pkgOpenCache: Record<string, boolean> | null = null;

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  // teams removed; we now compute from account info
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: SquareTerminal,
      isActive: true,
      items: [
        { title: "Policies", url: "/dashboard/policies", icon: FileText },
        { title: "Agents", url: "/dashboard/agents", icon: Users },
        { title: "Clients", url: "/dashboard/clients", icon: Users },
        { title: "Membership", url: "/dashboard/membership", icon: IdCard },
        { title: "Account", url: "/dashboard/account", icon: Settings2 },
      ],
    },
    {
      title: "Admin",
      url: "/admin",
      icon: Settings2,
      items: [{ title: "User Settings", url: "/admin/users" }],
    },
    {
      title: "Docs",
      url: "#",
      icon: BookOpen,
      items: [{ title: "Guide", url: "#" }],
    },
  ],
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
  // const pathname = usePathname();
  const navItems = React.useMemo(() => {
    // Always remove the legacy Admin item; we render the Admin Panel block separately
    return data.navMain.filter((i) => i.title !== "Admin");
  }, []);
  const [packages, setPackages] = React.useState<{ label: string; value: string }[]>(
    () => packagesCache ?? []
  );
  // Persist collapsible open states to keep sidebar from folding on navigation
  const [adminOpen, setAdminOpen] = React.useState<boolean>(adminOpenCache ?? true);
  const [policyOpen, setPolicyOpen] = React.useState<boolean>(policyOpenCache ?? true);
  const [pkgOpen, setPkgOpen] = React.useState<Record<string, boolean>>(pkgOpenCache ?? {});
  const [orgName, setOrgName] = React.useState<string | null>(null);

  // Fetch helper reused by effects and custom events
  const loadPackagesOnce = React.useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as { label: string; value: string }[];
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
      if (!packagesCache) {
        const cachedPackages = sessionStorage.getItem("sidebar.packages");
        if (cachedPackages) {
          const list = JSON.parse(cachedPackages) as { label: string; value: string }[];
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
    void loadPackagesOnce();
    void fetchOrgName();
  }, [loadPackagesOnce, fetchOrgName]);

  // Listen for account changes to refresh org name live
  React.useEffect(() => {
    const onChanged = () => void fetchOrgName();
    window.addEventListener("account:info-changed", onChanged);
    return () => window.removeEventListener("account:info-changed", onChanged);
  }, [fetchOrgName]);

  // Listen for explicit admin changes to refresh packages (no refresh on simple navigation)
  React.useEffect(() => {
    const onChanged = () => void loadPackagesOnce();
    window.addEventListener("policy-settings:changed", onChanged);
    window.addEventListener("form-options:changed", onChanged);
    return () => {
      window.removeEventListener("policy-settings:changed", onChanged);
      window.removeEventListener("form-options:changed", onChanged);
    };
  }, [loadPackagesOnce]);

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
          <div className="mt-4">
            <Separator className="my-3 dark:bg-neutral-800" />
            <Collapsible asChild className="group/collapsible" open={adminOpen} onOpenChange={setAdminOpen}>
              <div>
                <CollapsibleTrigger asChild>
                  <button
                    className="flex w-full items-center gap-2 rounded-md bg-yellow-400 px-2 py-2 text-left text-sm text-neutral-900 hover:bg-yellow-400 dark:bg-yellow-400 dark:text-neutral-900"
                    title="Admin Panel"
                  >
                    <Shield className="h-4 w-4 text-neutral-900" />
                    <span className="font-medium group-data-[collapsed=true]/sidebar-wrapper:hidden">
                      Admin Panel
                    </span>
                    <ChevronRight className="ml-auto h-4 w-4 text-neutral-900 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-4 grid gap-1 py-1">
                    <Link
                      href="/admin/users"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      title="User Settings"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                        User Settings
                      </span>
                    </Link>
                    <Link
                      href="/admin/client-settings"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      title="Client Number Settings"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                        Client Number Settings
                      </span>
                    </Link>
                    {isAdmin ? <div className="ml-0">
                      <Collapsible asChild className="group/collapsible" open={policyOpen} onOpenChange={setPolicyOpen}>
                        <div>
                          <CollapsibleTrigger asChild>
                            <button
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                              title="Policy Settings"
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                              <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                Policy Settings
                              </span>
                              <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="ml-4 grid gap-1 py-1">
                            <Link
                                href="/admin/policy-settings/declarations"
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                    title="Declarations"
                                  >
                                    <Settings2 className="h-3.5 w-3.5" />
                                    <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                  Declarations
                                    </span>
                                  </Link>
                                  <Link
                                href="/admin/policy-settings/packages"
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                    title="Packages"
                                  >
                                    <Settings2 className="h-3.5 w-3.5" />
                                    <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                  Packages
                                    </span>
                                  </Link>
                              <Link
                                href="/admin/policy-settings/flows"
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                title="Flows"
                              >
                                <Settings2 className="h-3.5 w-3.5" />
                                <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                  Flows
                                </span>
                              </Link>
                              {packages.length > 0 ? (
                                <>
                                  <Separator className="my-2 dark:bg-neutral-800" />
                                  {packages.map((p) => (
                                    <Collapsible
                                      key={p.value}
                                      asChild
                                      className="group/collapsible"
                                      open={pkgOpen[p.value] ?? false}
                                      onOpenChange={(v) => {
                                        setPkgOpen((s) => {
                                          const next = { ...s, [p.value]: v };
                                          try {
                                            sessionStorage.setItem("sidebar.pkgOpen", JSON.stringify(next));
                                          } catch {}
                                          return next;
                                        });
                                      }}
                                    >
                                      <div>
                                        <CollapsibleTrigger asChild>
                                          <button
                                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                            title={p.label}
                                          >
                                            <Folder className="h-3.5 w-3.5" />
                                            <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                              {p.label}
                                            </span>
                                            <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                          </button>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <div className="ml-4 grid gap-1 py-1">
                                            <Link
                                              href={`/admin/policy-settings/${p.value}/category`}
                                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                              title="Category"
                                            >
                                              <Settings2 className="h-3.5 w-3.5" />
                                              <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                                Category
                                              </span>
                                            </Link>
                                            <Link
                                              href={`/admin/policy-settings/${p.value}/fields`}
                                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                              title="Fields"
                                            >
                                              <FileText className="h-3.5 w-3.5" />
                                              <span className="group-data-[collapsed=true]/sidebar-wrapper:hidden">
                                                Fields
                                              </span>
                                            </Link>
                                          </div>
                                        </CollapsibleContent>
                                      </div>
                                    </Collapsible>
                                  ))}
                                </>
                              ) : null}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    </div> : null}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
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

