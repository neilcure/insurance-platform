import NewPackageFieldClient from "@/components/admin/generic/NewPackageFieldClient";

export default async function NewPackageFieldPage(props: { params: Promise<{ pkg: string }> }) {
  const { pkg } = await props.params;
  return <NewPackageFieldClient pkg={pkg} />;
}


