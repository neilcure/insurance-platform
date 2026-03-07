import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { serverFetch } from "@/lib/auth/server-fetch";

type FlowButtonConfig = { label: string; flow: string };

async function fetchFlowButtonConfig(flowKey: string): Promise<FlowButtonConfig | null> {
  try {
    const res = await serverFetch("/api/admin/client-settings");
    if (!res.ok) return null;
    const data = (await res.json()) as { flowButtons?: Record<string, FlowButtonConfig> };
    return data.flowButtons?.[flowKey] ?? null;
  } catch {
    return null;
  }
}

interface FlowNewButtonProps {
  flowKey: string;
  defaultLabel: string;
}

export async function FlowNewButton({ flowKey, defaultLabel }: FlowNewButtonProps) {
  const cfg = await fetchFlowButtonConfig(flowKey);
  const label = cfg?.label || defaultLabel;
  const targetFlow = cfg?.flow || flowKey;

  return (
    <Button asChild>
      <Link href={`/dashboard/flows/${encodeURIComponent(targetFlow)}/new`}>
        <Plus className="h-4 w-4 sm:hidden lg:inline" />
        <span className="hidden sm:inline">{label}</span>
      </Link>
    </Button>
  );
}
