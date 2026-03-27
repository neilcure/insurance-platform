import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { Suspense } from "react";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <AppSidebar
        isAdmin={(((session.user as any)?.userType) ?? "") === "admin"}
        canManageSettings={["admin", "agent", "internal_staff"].includes((((session.user as any)?.userType) ?? ""))}
        userType={((session.user as any)?.userType ?? "") as string}
        user={{ name: (session.user as any)?.name ?? null, email: (session.user as any)?.email ?? null }}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 sm:h-16 sm:px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Overview</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto flex items-center gap-2">
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
      </SidebarInset>
    </SidebarProvider>
  );
}







