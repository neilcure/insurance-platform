import { requireUser } from "@/lib/auth/require-user";
import EditPackageFieldClient from "@/components/admin/generic/EditPackageFieldClient";

export default async function PolicySettingsEditFieldPage(props: { params: Promise<{ pkg: string; id: string }> }) {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  const { pkg, id } = await props.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) throw new Error("Invalid id");
  return <EditPackageFieldClient pkg={pkg} id={numId} />;
}

