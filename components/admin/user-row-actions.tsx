"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ReissueInviteButton from "@/components/admin/reissue-invite-button";
import { useRouter } from "next/navigation";
import { Power, Trash2 } from "lucide-react";

type UserType = "admin" | "agent" | "direct_client" | "service_provider" | "internal_staff" | "accounting";

export function UserRowActions({
  userId,
  userType,
  isActive,
  canAssignAdmin = true,
}: {
  userId: number;
  userType: UserType;
  isActive: boolean;
  canAssignAdmin?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = React.useState<UserType>(userType);
  const [active, setActive] = React.useState<boolean>(isActive);
  const [loading, setLoading] = React.useState<boolean>(false);

  async function update(values: Partial<{ userType: UserType; isActive: boolean }>) {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Update failed");
      if (typeof data.userType === "string") setType(data.userType);
      if (typeof data.isActive === "boolean") setActive(data.isActive);
      toast.success("Updated");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function del() {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toast.success("User deleted");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-start gap-2 flex-wrap sm:flex-nowrap">
      <select
        className="min-w-[140px] rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        value={type}
        onChange={(e) => update({ userType: e.target.value as UserType })}
        disabled={loading}
      >
        {/* Allowed types (Direct Client & Service Provider deprecated) */}
        {(canAssignAdmin ? ["admin", "agent", "accounting", "internal_staff"] : ["accounting", "internal_staff"]).map((t) => (
          <option key={t} value={t}>
            {t === "internal_staff" ? "internal_staff" : t}
          </option>
        ))}
        {/* If existing user is deprecated type, show as disabled so current value renders */}
        {type === "direct_client" ? (
          <option value="direct_client" disabled>
            direct_client (deprecated)
          </option>
        ) : null}
        {type === "service_provider" ? (
          <option value="service_provider" disabled>
            service_provider (deprecated)
          </option>
        ) : null}
        {(type as any) === "insurer_staff" ? (
          <option value="insurer_staff" disabled>
            insurer_staff (renamed to internal_staff)
          </option>
        ) : null}
        {!canAssignAdmin && (type === "admin" || type === "agent") ? (
          <option value="admin" disabled>
            {type} (restricted)
          </option>
        ) : null}
      </select>
      <Button
        size="sm"
        variant={active ? "secondary" : "default"}
        onClick={() => update({ isActive: !active })}
        disabled={loading}
        className="inline-flex items-center gap-2 whitespace-nowrap"
      >
        <Power className="h-4 w-4 sm:hidden lg:inline" />
        <span className="hidden sm:inline">{active ? "Deactivate" : "Activate"}</span>
      </Button>
      {!active ? <ReissueInviteButton userId={userId} /> : null}
      <Button
        size="sm"
        variant="outline"
        className="inline-flex items-center gap-2 border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 whitespace-nowrap"
        onClick={del}
        disabled={loading}
      >
        <Trash2 className="h-4 w-4 sm:hidden lg:inline" />
        <span className="hidden sm:inline">Delete</span>
      </Button>
    </div>
  );
}


