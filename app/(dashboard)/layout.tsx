import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema/core";
import { authOptions } from "@/lib/auth/options";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { PresenceProvider } from "@/lib/presence/presence-context";
import { OnlineUsersWidget } from "@/components/presence/online-users-widget";
import { DocumentDeliveryProvider } from "@/lib/document-delivery";
import { DocumentDeliveryHost } from "@/components/document-delivery/DocumentDeliveryHost";
import { IdleTimeoutHost } from "@/components/idle-timeout/IdleTimeoutHost";
import { AnnouncementHost } from "@/components/announcements/AnnouncementHost";
import { Suspense } from "react";
import { tStatic } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  // Server-side locale read so the breadcrumb (rendered by THIS server
  // component) follows the same language as the client-rendered chrome.
  // The cookie / x-locale header / DB chain runs once per request.
  const locale = await getLocale();

  /** Sidebar header for direct clients — must match DB, not session user.name, to avoid flashing the login name. */
  let initialWorkspaceLabel: string | null = null;
  const userType = ((session.user as any)?.userType ?? "") as string;
  const sessionUserId = Number((session.user as any)?.id);
  if (userType === "direct_client" && Number.isFinite(sessionUserId) && sessionUserId > 0) {
    const [clientRow] = await db
      .select({ displayName: clients.displayName })
      .from(clients)
      .where(eq(clients.userId, sessionUserId))
      .limit(1);
    const dn = clientRow?.displayName?.trim();
    initialWorkspaceLabel = dn || null;
  }

  return (
    <SidebarProvider>
      <AppSidebar
        isAdmin={(((session.user as any)?.userType) ?? "") === "admin"}
        canManageSettings={["admin", "agent", "internal_staff"].includes((((session.user as any)?.userType) ?? ""))}
        userType={((session.user as any)?.userType ?? "") as string}
        user={{ name: (session.user as any)?.name ?? null, email: (session.user as any)?.email ?? null }}
        initialWorkspaceLabel={initialWorkspaceLabel}
      />
      <SidebarInset>
        {/*
          PresenceProvider must wrap BOTH the header (where the
          OnlineUsersWidget reads from context) AND the page body
          (where pages call useSetPresenceResource to push their
          current resource into context). That way the per-page
          resourceKey is visible to every consumer in the layout.
        */}
        <PresenceProvider>
          {/*
            DocumentDeliveryProvider mounts a single Email Files +
            WhatsApp Files dialog host that any descendant can pop
            via `useDeliverDocuments()`. See
            `.cursor/rules/document-delivery.mdc` for the contract.
          */}
          <DocumentDeliveryProvider>
            <header className="flex h-12 shrink-0 items-center gap-2 px-3 sm:h-16 sm:px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-2 h-4" />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="/dashboard">{tStatic("nav.dashboard", locale, "Dashboard")}</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{tStatic("nav.overview", locale, "Overview")}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <OnlineUsersWidget />
                <LocaleSwitcher />
                <ModeToggle />
              </div>
            </header>
            <div className="flex-1 p-3 pt-0 sm:p-6 sm:pt-0">
              <Suspense fallback={
                <div className="space-y-4 animate-pulse">
                  <div className="h-8 w-48 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-40 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
                  <div className="h-64 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
                </div>
              }>{children}</Suspense>
            </div>
            <DocumentDeliveryHost />
            {/*
              Idle-timeout host: shows a "Are you still there?"
              lightbox after the user has been inactive for the
              configured period and signs them out automatically
              when the warning countdown reaches zero. Thresholds
              are stored in `app_settings.idle_timeout_policy` and
              are configurable per user_type via Admin → User
              Settings (see lib/idle-timeout/policy.ts).
            */}
            <IdleTimeoutHost />
            <AnnouncementHost />
          </DocumentDeliveryProvider>
        </PresenceProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}







