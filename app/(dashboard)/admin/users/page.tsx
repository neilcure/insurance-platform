import { db } from "@/db/client";
import { users, clients } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import InviteForm from "@/components/admin/invite-form";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { SettingsBlock } from "@/components/ui/settings-block";
import { Separator } from "@/components/ui/separator";
import { ServerErrorToast } from "@/components/ui/ServerErrorToast";
import BackfillUserNumbersButton from "@/components/admin/backfill-user-numbers-button";

// Align with current allowed/legacy user types in UI components
type UserType = "admin" | "agent" | "accounting" | "internal_staff" | "direct_client" | "service_provider";

type UserRow = {
  id: number;
  email: string;
  name: string | null;
  userType: UserType;
  isActive: boolean;
  createdAt: string;
  userNumber: string | null;
};

export default async function AdminUsersPage() {
  const me = await requireUser();
  if (!(me.userType === "admin" || me.userType === "agent" || me.userType === "internal_staff")) {
    throw new Error("Forbidden");
  }

  let rows: UserRow[] = [];
  let loadError: string | undefined;
  try {
    const raw =
      ((await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          userType: users.userType,
          isActive: users.isActive,
          createdAt: users.createdAt,
          userNumber: users.userNumber,
        })
        .from(users)) as unknown as Array<Omit<UserRow, "userType"> & { userType: string }>) ?? [];
    // Normalize legacy values (e.g., insurer_staff -> internal_staff)
    rows = raw.map(
      (r): UserRow => ({
        ...r,
        userType: r.userType === "insurer_staff" ? ("internal_staff" as UserType) : (r.userType as UserType),
      })
    );
    if (!(me.userType === "admin" || me.userType === "internal_staff")) {
      rows = rows.filter((r) => Number(r.id) === Number(me.id));
    }
  } catch (err: any) {
    // Fallback for environments where migration hasn't run yet (no user_number column)
    try {
      const fallback =
        ((await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            userType: users.userType,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)) as unknown as Omit<UserRow, "userNumber">[]) ?? [];
      const mapped = fallback.map((r) => ({
        ...r,
        userNumber: null,
        userType: (r.userType as any) === "insurer_staff" ? ("internal_staff" as UserType) : (r.userType as UserType),
      }));
      rows =
        me.userType === "admin" || me.userType === "internal_staff"
          ? mapped
          : mapped.filter((r) => Number(r.id) === Number(me.id));
    } catch (err2: any) {
      loadError = err2?.message ?? err?.message ?? "Failed to load users";
    }
  }

  // Load linked client names for direct_client users
  let clientLinks: Record<number, string> = {};
  try {
    const clientUserIds = rows.filter((r) => r.userType === "direct_client").map((r) => r.id);
    if (clientUserIds.length > 0) {
      const linkRows = await db
        .select({ userId: clients.userId, displayName: clients.displayName })
        .from(clients);
      for (const lr of linkRows) {
        if (lr.userId && clientUserIds.includes(lr.userId)) {
          clientLinks[lr.userId] = lr.displayName;
        }
      }
    }
  } catch {}

  // Ensure stable ordering regardless of active status or refreshes
  const makeSortKey = (r: UserRow) =>
    `${(r.userNumber ?? "").toString()}|${(r.email || "").toLowerCase()}|${String(r.id).padStart(10, "0")}`;
  rows = rows.slice().sort((a, b) => makeSortKey(a).localeCompare(makeSortKey(b)));

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      {loadError ? <ServerErrorToast message={loadError} /> : null}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Admin Panel</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Manage users and permissions.</p>
      </div>
      <Separator />
      <SettingsBlock title="User Settings" description="Invite users, change roles, activate/deactivate or delete accounts.">
        <div className="space-y-4">
          <InviteForm allowedTypes={me.userType === "admin" ? ["admin","agent","accounting","internal_staff","direct_client"] : ["accounting","internal_staff"]} />
          <Separator />
          <div className="flex justify-end">
            <BackfillUserNumbersButton />
          </div>
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[480px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden md:table-cell">User #</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-left">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell
                      title={u.userNumber ?? ""}
                      className={`hidden md:table-cell font-mono text-xs ${
                        u.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-600 dark:text-neutral-400"
                      }`}
                    >
                      {u.userNumber ?? "—"}
                    </TableCell>
                    <TableCell className="block w-full md:table-cell">
                      <div className="flex items-center gap-2 md:block">
                        <span
                          title={u.userNumber ?? ""}
                          className={`md:hidden font-mono text-xs ${
                            u.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-600 dark:text-neutral-400"
                          }`}
                        >
                          {u.userNumber ?? "—"}
                        </span>
                        <span className="font-mono text-sm">{u.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="block w-full md:table-cell md:text-left">
                      <UserRowActions userId={u.id} userType={u.userType} isActive={u.isActive} canAssignAdmin={me.userType === "admin"} linkedClientName={clientLinks[u.id] ?? null} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </SettingsBlock>

    </main>
  );
}


