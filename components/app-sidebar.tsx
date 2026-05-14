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
  Upload,
  FileDown,
  Stamp,
  ClipboardList,
  ListOrdered,
  Bug,
  Activity,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { getIcon } from "@/lib/icons";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import { tDynamic, useLocale, useT } from "@/lib/i18n";
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

/**
 * Static structure of the base dashboard items. Titles are rendered
 * via `t(titleKey, fallbackTitle)` inside the component so that the
 * language switcher can re-render without duplicating the icon/url
 * shape in two places.
 */
const BASE_DASHBOARD_ITEMS: {
  titleKey: string;
  fallbackTitle: string;
  url: string;
  icon: LucideIcon;
}[] = [
  { titleKey: "nav.agents", fallbackTitle: "Agents", url: "/dashboard/agents", icon: UserPlus },
  { titleKey: "nav.accounting", fallbackTitle: "Accounting", url: "/dashboard/accounting", icon: ClipboardList },
  { titleKey: "nav.imports", fallbackTitle: "Imports", url: "/dashboard/imports", icon: Upload },
  { titleKey: "nav.membership", fallbackTitle: "Membership", url: "/dashboard/membership", icon: IdCard },
  { titleKey: "nav.profile", fallbackTitle: "Profile", url: "/dashboard/account", icon: User },
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
    userType?: string;
    user?: { name?: string | null; email?: string | null };
    /** Client master `displayName` from the server — keeps the header from briefly showing `user.name`. */
    initialWorkspaceLabel?: string | null;
  }
) {
  const {
    isAdmin = false,
    canManageSettings = false,
    userType = "",
    user,
    initialWorkspaceLabel = null,
    ...sidebarProps
  } = props as {
    isAdmin?: boolean;
    canManageSettings?: boolean;
    userType?: string;
    user?: { name?: string | null; email?: string | null };
    initialWorkspaceLabel?: string | null;
  };
  const t = useT();
  const isClientUser = userType === "direct_client";
  const userKey = React.useMemo(() => (user?.email || user?.name || "anon") as string, [user?.email, user?.name]);
  const [flows, setFlows] = React.useState<SidebarFlow[]>(() => flowsCache ?? []);
  const [packages, setPackages] = React.useState<SidebarPackage[]>(
    () => packagesCache ?? []
  );
  // Persist collapsible open states to keep sidebar from folding on navigation
  const [adminOpen, setAdminOpen] = React.useState<boolean>(adminOpenCache ?? true);
  const [policyOpen, setPolicyOpen] = React.useState<boolean>(policyOpenCache ?? true);
  const [pkgOpen, setPkgOpen] = React.useState<Record<string, boolean>>(pkgOpenCache ?? {});
  const [orgName, setOrgName] = React.useState<string | null>(() => {
    if (!isClientUser) return null;
    const v = initialWorkspaceLabel?.trim();
    return v || null;
  });
  const [auditBadge, setAuditBadge] = React.useState(0);

  React.useEffect(() => {
    if (!isClientUser) return;
    const v = initialWorkspaceLabel?.trim();
    if (v) setOrgName(v);
  }, [isClientUser, initialWorkspaceLabel]);

  const navItems = React.useMemo(() => {
    if (isClientUser) {
      return [
        {
          title: t("nav.dashboard", "Dashboard"),
          url: "/dashboard",
          icon: LayoutDashboard,
          isActive: true,
          items: [
            { title: t("nav.myPolicies", "My Policies"), url: "/dashboard/policies", icon: FileText },
            { title: t("nav.myProfile", "My Profile"), url: "/dashboard/account", icon: User },
          ],
        },
      ];
    }
    // Flow titles are admin-configured (dynamic) and follow Pipeline B —
    // they will pick up `meta.translations` once Phase 4a wires the
    // dynamic resolver into this list. For Phase 2 we keep the raw
    // value so existing flows render unchanged.
    const dashboardFlowItems = flows
      .filter((f) => f.meta?.showInDashboard)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        title: f.meta?.dashboardLabel || f.label,
        url: `/dashboard/flows/${f.value}`,
        icon: getIcon(f.meta?.icon),
      }));
    const baseItems = BASE_DASHBOARD_ITEMS.map((item) => ({
      title: t(item.titleKey, item.fallbackTitle),
      url: item.url,
      icon: item.icon,
    }));
    return [
      {
        title: t("nav.dashboard", "Dashboard"),
        url: "/dashboard",
        icon: LayoutDashboard,
        isActive: true,
        items: [
          ...dashboardFlowItems,
          ...baseItems,
        ],
      },
      {
        title: t("nav.docs", "Docs"),
        url: "#",
        icon: BookOpen,
        items: [{ title: t("nav.guide", "Guide"), url: "#" }],
      },
    ];
  }, [flows, isClientUser, t]);

  const loadFlowsOnce = React.useCallback(async () => {
    if (isClientUser) return;
    try {
      const res = await fetch("/api/form-options?groupKey=flows", { cache: "no-store" });
      if (!res.ok) return;
      const rows = (await res.json()) as SidebarFlow[];
      const list = Array.isArray(rows) ? rows : [];
      setFlows(list);
      try { sessionStorage.setItem("sidebar.flows", JSON.stringify(list)); } catch {}
      flowsCache = list;
    } catch {}
  }, [isClientUser]);

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
    if (isClientUser) {
      // For client users, fetch their client profile name
      try {
        const cached = sessionStorage.getItem(`sidebar.clientName:${userKey}`);
        if (cached) setOrgName(cached);
      } catch {}
      try {
        const res = await fetch("/api/account/client-profile", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { client?: { displayName?: string; clientNumber?: string } | null };
          const name = data?.client?.displayName ?? "";
          setOrgName(name || null);
          try {
            if (name) sessionStorage.setItem(`sidebar.clientName:${userKey}`, name);
            else sessionStorage.removeItem(`sidebar.clientName:${userKey}`);
          } catch {}
        }
      } catch { setOrgName(null); }
      return;
    }
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
  }, [userKey, isClientUser]);

  // Fetch unread audit log count for admin users
  const fetchAuditBadge = React.useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/admin/audit-log?count=true", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAuditBadge(data?.unreadCount ?? 0);
      }
    } catch {}
  }, [isAdmin]);

  // Initial fetch only once
  React.useEffect(() => {
    void loadFlowsOnce();
    void loadPackagesOnce();
    void fetchOrgName();
    void fetchAuditBadge();
  }, [loadFlowsOnce, loadPackagesOnce, fetchOrgName, fetchAuditBadge]);

  // Refresh audit badge on events, not polling
  React.useEffect(() => {
    if (!isAdmin) return;
    const onChanged = () => void fetchAuditBadge();
    window.addEventListener("audit:changed", onChanged);
    window.addEventListener("focus", onChanged);
    return () => {
      window.removeEventListener("audit:changed", onChanged);
      window.removeEventListener("focus", onChanged);
    };
  }, [isAdmin, fetchAuditBadge]);

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
  const locale = useLocale();
  const isCollapsed = collapsed && !isMobile;
  const [adminCollapsedOpen, setAdminCollapsedOpen] = React.useState(true);
  const [policyCollapsedOpen, setPolicyCollapsedOpen] = React.useState(false);
  const [pkgCollapsedOpen, setPkgCollapsedOpen] = React.useState(false);

  const headerWorkspaceLabel = isClientUser
    ? (orgName?.trim() ||
        initialWorkspaceLabel?.trim() ||
        t("sidebar.clientAccount", "Client account"))
    : (orgName?.trim() || user?.name || user?.email || t("sidebar.account", "Account"));

  return (
    <Sidebar collapsible="icon" {...sidebarProps}>
      <SidebarHeader>
        <TeamSwitcher
          size="xs"
          teams={[
            {
              name: headerWorkspaceLabel,
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
                  title={t("sidebar.adminPanel", "Admin Panel")}
                  icon={Shield}
                  onToggle={() => setAdminCollapsedOpen((v) => !v)}
                />
                {adminCollapsedOpen && (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip={t("sidebar.userSettings", "User Settings")} asChild>
                        <Link href="/admin/users">
                          <UserCog className="h-3.5 w-3.5 shrink-0" />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip={t("sidebar.activityLog", "Activity Log")} asChild>
                        <Link href="/admin/activity-log" className="relative">
                          <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                          {auditBadge > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
                              {auditBadge > 9 ? "9+" : auditBadge}
                            </span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip={t("sidebar.clientNumberSettings", "Client Number Settings")} asChild>
                        <Link href="/admin/client-settings">
                          <Hash className="h-3.5 w-3.5 shrink-0" />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip={t("sidebar.landingPage", "Landing Page")} asChild>
                        <Link href="/admin/landing-page">
                          <Globe className="h-3.5 w-3.5 shrink-0" />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip={t("sidebar.paymentSchedules", "Payment Schedules")} asChild>
                        <Link href="/admin/payment-schedules">
                          <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {isAdmin && (
                      <SidebarMenuItem>
                        <SidebarMenuButton tooltip={t("sidebar.systemDiagnostics", "System Diagnostics")} asChild>
                          <Link href="/admin/field-resolver">
                            <Bug className="h-3.5 w-3.5 shrink-0" />
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </>
                )}
                {isAdmin && (
                  <>
                    {/* Policy Settings group — toggle */}
                    <CollapsedGroupBadge
                      title={t("sidebar.policySettings", "Policy Settings")}
                      icon={FileText}
                      onToggle={() => setPolicyCollapsedOpen((v) => !v)}
                    />
                    {policyCollapsedOpen && (
                      <>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.accountingRules", "Accounting Rules")} asChild>
                            <Link href="/admin/policy-settings/policy/category">
                              <Shield className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.packages", "Packages")} asChild>
                            <Link href="/admin/policy-settings/packages">
                              <Package className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.flows", "Flows")} asChild>
                            <Link href="/admin/policy-settings/flows">
                              <GitBranch className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.documentTemplates", "Document Templates")} asChild>
                            <Link href="/admin/policy-settings/document-templates">
                              <BookOpen className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.workflowActions", "Workflow Actions")} asChild>
                            <Link href="/admin/policy-settings/workflow-actions">
                              <Frame className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.policyStatuses", "Policy Statuses")} asChild>
                            <Link href="/admin/policy-settings/policy-statuses">
                              <ListOrdered className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.uploadDocuments", "Upload Documents")} asChild>
                            <Link href="/admin/policy-settings/upload-documents">
                              <Upload className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.backendDocuments", "Backend Documents")} asChild>
                            <Link href="/admin/policy-settings/backend-documents">
                              <FileDown className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton tooltip={t("sidebar.pdfMailMerge", "PDF Mail Merge")} asChild>
                            <Link href="/admin/policy-settings/pdf-templates">
                              <Stamp className="h-3.5 w-3.5 shrink-0" />
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </>
                    )}
                    {/* Packages group — toggle */}
                    {packages.length > 0 && (
                      <>
                        <CollapsedGroupBadge
                          title={t("sidebar.packages", "Packages")}
                          icon={Folder}
                          onToggle={() => setPkgCollapsedOpen((v) => !v)}
                        />
                        {/* Per-package tooltip uses `p.label` (admin-configured). Phase 4a will route this through `tDynamic`. */}
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
                          tooltip={t("sidebar.adminPanel", "Admin Panel")}
                          className="bg-yellow-400 text-neutral-900 hover:bg-yellow-500 dark:bg-yellow-400 dark:text-neutral-900 dark:hover:bg-yellow-500"
                        >
                          <Shield className="h-4 w-4 shrink-0" />
                          <span className="font-medium">{t("sidebar.adminPanel", "Admin Panel")}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="ml-4 grid gap-1 py-1">
                          <li>
                            <SidebarMenuButton tooltip={t("sidebar.userSettings", "User Settings")} asChild>
                              <Link href="/admin/users">
                                <UserCog className="h-4 w-4 shrink-0" />
                                <span>{t("sidebar.userSettings", "User Settings")}</span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          <li>
                            <SidebarMenuButton tooltip={t("sidebar.activityLog", "Activity Log")} asChild>
                              <Link href="/admin/activity-log" className="relative">
                                <ClipboardList className="h-4 w-4 shrink-0" />
                                <span>{t("sidebar.activityLog", "Activity Log")}</span>
                                {auditBadge > 0 && (
                                  <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                                    {auditBadge > 99 ? "99+" : auditBadge}
                                  </span>
                                )}
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          <li>
                            <SidebarMenuButton tooltip={t("sidebar.clientNumberSettings", "Client Number Settings")} asChild>
                              <Link href="/admin/client-settings">
                                <Hash className="h-4 w-4 shrink-0" />
                                <span>{t("sidebar.clientNumberSettings", "Client Number Settings")}</span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          <li>
                            <SidebarMenuButton tooltip={t("sidebar.landingPage", "Landing Page")} asChild>
                              <Link href="/admin/landing-page">
                                <Globe className="h-4 w-4 shrink-0" />
                                <span>{t("sidebar.landingPage", "Landing Page")}</span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          <li>
                            <SidebarMenuButton tooltip={t("sidebar.paymentSchedules", "Payment Schedules")} asChild>
                              <Link href="/admin/payment-schedules">
                                <ClipboardList className="h-4 w-4 shrink-0" />
                                <span>{t("sidebar.paymentSchedules", "Payment Schedules")}</span>
                              </Link>
                            </SidebarMenuButton>
                          </li>
                          {isAdmin && (
                            <li>
                              <SidebarMenuButton tooltip={t("sidebar.systemDiagnostics", "System Diagnostics")} asChild>
                                <Link href="/admin/field-resolver">
                                  <Bug className="h-4 w-4 shrink-0" />
                                  <span>{t("sidebar.systemDiagnostics", "System Diagnostics")}</span>
                                </Link>
                              </SidebarMenuButton>
                            </li>
                          )}
                          {isAdmin && (
                            <li>
                              <Collapsible asChild className="group/collapsible" open={policyOpen} onOpenChange={setPolicyOpen}>
                                <div>
                                  <CollapsibleTrigger asChild>
                                    <SidebarMenuButton tooltip={t("sidebar.policySettings", "Policy Settings")}>
                                      <FileText className="h-4 w-4 shrink-0" />
                                      <span>{t("sidebar.policySettings", "Policy Settings")}</span>
                                      <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                    </SidebarMenuButton>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <ul className="ml-4 grid gap-1 py-1">
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.accountingRules", "Accounting Rules")} asChild>
                                          <Link href="/admin/policy-settings/policy/category">
                                            <Shield className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.accountingRules", "Accounting Rules")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.packages", "Packages")} asChild>
                                          <Link href="/admin/policy-settings/packages">
                                            <Package className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.packages", "Packages")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.flows", "Flows")} asChild>
                                          <Link href="/admin/policy-settings/flows">
                                            <GitBranch className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.flows", "Flows")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.documentTemplates", "Document Templates")} asChild>
                                          <Link href="/admin/policy-settings/document-templates">
                                            <BookOpen className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.documentTemplates", "Document Templates")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.workflowActions", "Workflow Actions")} asChild>
                                          <Link href="/admin/policy-settings/workflow-actions">
                                            <Frame className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.workflowActions", "Workflow Actions")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.policyStatuses", "Policy Statuses")} asChild>
                                          <Link href="/admin/policy-settings/policy-statuses">
                                            <ListOrdered className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.policyStatuses", "Policy Statuses")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.uploadDocuments", "Upload Documents")} asChild>
                                          <Link href="/admin/policy-settings/upload-documents">
                                            <Upload className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.uploadDocuments", "Upload Documents")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.backendDocuments", "Backend Documents")} asChild>
                                          <Link href="/admin/policy-settings/backend-documents">
                                            <FileDown className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.backendDocuments", "Backend Documents")}</span>
                                          </Link>
                                        </SidebarMenuButton>
                                      </li>
                                      <li>
                                        <SidebarMenuButton tooltip={t("sidebar.pdfMailMerge", "PDF Mail Merge")} asChild>
                                          <Link href="/admin/policy-settings/pdf-templates">
                                            <Stamp className="h-4 w-4 shrink-0" />
                                            <span>{t("sidebar.pdfMailMerge", "PDF Mail Merge")}</span>
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

                {/* Per-package items: admin `label` + `meta.translations` via `tDynamic` (see i18n skill). */}
                {isAdmin && packages.length > 0 && (
                  <>
                    <Separator className="my-2 dark:bg-neutral-800" />
                    {packages.map((p) => {
                      const iconName = (p.meta as Record<string, unknown> | null)?.icon as string | undefined;
                      const PkgIcon = getIcon(iconName);
                      const pkgLabel = tDynamic(
                        { label: p.label, meta: (p.meta ?? null) as Record<string, unknown> | null },
                        locale,
                      );
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
                                <SidebarMenuButton tooltip={pkgLabel}>
                                  <PkgIcon className="h-4 w-4 shrink-0" />
                                  <span>{pkgLabel}</span>
                                  <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                </SidebarMenuButton>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <ul className="ml-4 grid gap-1 py-1">
                                  <li>
                                    <SidebarMenuButton tooltip={t("sidebar.categoryHint", "{label} — Category", { label: pkgLabel })} asChild>
                                      <Link href={`/admin/policy-settings/${p.value}/category`}>
                                        <Folder className="h-4 w-4 shrink-0" />
                                        <span>{t("sidebar.category", "Category")}</span>
                                      </Link>
                                    </SidebarMenuButton>
                                  </li>
                                  <li>
                                    <SidebarMenuButton tooltip={t("sidebar.fieldsHint", "{label} — Fields", { label: pkgLabel })} asChild>
                                      <Link href={`/admin/policy-settings/${p.value}/fields`}>
                                        <FileText className="h-4 w-4 shrink-0" />
                                        <span>{t("sidebar.fields", "Fields")}</span>
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

