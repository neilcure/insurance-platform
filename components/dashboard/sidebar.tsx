import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const mainLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/policies", label: "Policies" },
  { href: "/dashboard/clients", label: "Clients" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/partners", label: "Partners" },
  { href: "/dashboard/membership", label: "Membership" },
];
const adminLinks = [
  // Admin routes (page itself enforces admin)
  { href: "/admin/users", label: "User Settings" },
];

export function Sidebar({ isAdmin }: { isAdmin?: boolean }) {
  return (
    <aside className="sticky top-0 h-screen w-64 shrink-0 border-r border-neutral-200 bg-white px-4 py-6 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-6 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Insurance Platform
      </div>
      <nav className="grid gap-1">
        {mainLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
            )}
          >
            {l.label}
          </Link>
        ))}
        {isAdmin ? (
          <>
            <Separator className="my-3 dark:bg-neutral-800" />
            <div className="px-1 py-1">
              <Badge className="w-full justify-center bg-yellow-400 text-neutral-900 dark:bg-yellow-400">
                Admin Panel
              </Badge>
            </div>
            {adminLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
                )}
              >
                {l.label}
              </Link>
            ))}
          </>
        ) : null}
      </nav>
    </aside>
  );
}




