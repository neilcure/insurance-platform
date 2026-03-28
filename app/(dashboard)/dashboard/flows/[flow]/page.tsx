import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PoliciesTableClient from "@/components/policies/PoliciesTableClient";
import { FlowNewButton } from "@/components/flows/FlowNewButton";
import { serverFetch } from "@/lib/auth/server-fetch";

type PolicyRowRaw = {
  policyId: number;
  policyNumber: string;
  recordId?: number;
  recordNumber?: string;
  flowKey?: string | null;
  createdAt: string;
  isActive?: boolean;
  carExtra?: Record<string, unknown> | null;
};
type PolicyRow = { policyId: number; policyNumber: string; recordId?: number; recordNumber?: string; flowKey?: string | null; createdAt: string; isActive: boolean; displayName?: string; carExtra?: Record<string, unknown> | null };

type FlowOption = {
  id: number;
  label: string;
  value: string;
  meta?: { showInDashboard?: boolean; icon?: string; dashboardLabel?: string } | null;
};

const FIRST_NAME_PATTERNS = [/^firstname$/, /firstname/];
const LAST_NAME_PATTERNS = [/^lastname$/, /^surname$/, /lastname/, /surname/];
const COMPANY_NAME_PATTERNS = [/companyname/, /coname/, /organisationname/, /orgname/];
const GENERIC_NAME_PATTERNS = [/^fullname$/, /^name$/];

function normalizeKeyForName(rawKey: string): string {
  const stripped = rawKey.replace(/^[a-zA-Z0-9]+__/, "");
  const clean = stripped.replace(/^_+/, "");
  return clean.toLowerCase().replace(/[^a-z]/g, "");
}

function findByPatterns(obj: Record<string, unknown> | undefined, patterns: RegExp[]): string {
  if (!obj) return "";
  for (const [k, v] of Object.entries(obj)) {
    const norm = normalizeKeyForName(k);
    const s = String(v ?? "").trim();
    if (s && patterns.some((p) => p.test(norm))) return s;
  }
  return "";
}

function extractDisplayName(extra: Record<string, unknown> | null | undefined): string {
  if (!extra) return "";
  const insured = extra.insuredSnapshot as Record<string, unknown> | undefined;
  const pkgs = extra.packagesSnapshot as Record<string, unknown> | undefined;

  const insuredType = String(
    insured?.insuredType ?? insured?.insured__category ?? ""
  ).trim().toLowerCase();

  // Personal: prefer lastName + firstName
  if (insuredType === "personal" && insured) {
    let first = "", last = "";
    for (const [k, v] of Object.entries(insured)) {
      const norm = normalizeKeyForName(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (!last && LAST_NAME_PATTERNS.some((p) => p.test(norm))) last = s;
      if (!first && FIRST_NAME_PATTERNS.some((p) => p.test(norm))) first = s;
    }
    const combined = [last, first].filter(Boolean).join(" ");
    if (combined) return combined;
  }

  // Search all sources: insured → package values → extra
  const allSources: Array<Record<string, unknown>> = [];
  if (insured) allSources.push(insured);
  if (pkgs) {
    for (const entry of Object.values(pkgs)) {
      if (!entry || typeof entry !== "object") continue;
      const vals = (entry as { values?: Record<string, unknown> }).values ?? (entry as Record<string, unknown>);
      allSources.push(vals as Record<string, unknown>);
    }
  }
  allSources.push(extra);

  // Pass 1: company-specific names (companyName, coName, orgName)
  for (const src of allSources) {
    const r = findByPatterns(src, COMPANY_NAME_PATTERNS);
    if (r) return r;
  }
  // Pass 2: generic names (fullName, name)
  for (const src of allSources) {
    const r = findByPatterns(src, GENERIC_NAME_PATTERNS);
    if (r) return r;
  }
  // Pass 3: personal name fallback
  for (const src of allSources) {
    let first = "", last = "";
    for (const [k, v] of Object.entries(src)) {
      const norm = normalizeKeyForName(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (!last && LAST_NAME_PATTERNS.some((p) => p.test(norm))) last = s;
      if (!first && FIRST_NAME_PATTERNS.some((p) => p.test(norm))) first = s;
    }
    const combined = [last, first].filter(Boolean).join(" ");
    if (combined) return combined;
  }
  return "";
}

async function fetchPolicies(flowKey: string): Promise<PolicyRow[]> {
  const res = await serverFetch(`/api/policies?flow=${encodeURIComponent(flowKey)}`);
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to load policies");
  }
  const raw = (await res.json()) as PolicyRowRaw[];
  return raw.map((r) => ({
    policyId: r.policyId,
    policyNumber: r.policyNumber,
    recordId: r.recordId ?? r.policyId,
    recordNumber: r.recordNumber ?? r.policyNumber,
    flowKey: r.flowKey ?? null,
    createdAt: r.createdAt,
    isActive: r.isActive !== false,
    displayName: extractDisplayName(r.carExtra),
    carExtra: r.carExtra ?? null,
  }));
}

async function fetchFlowInfo(flowKey: string): Promise<FlowOption | null> {
  const res = await serverFetch(`/api/form-options?groupKey=flows`);
  if (!res.ok) return null;
  const rows = (await res.json()) as FlowOption[];
  return rows.find((r) => r.value === flowKey) ?? null;
}

export default async function FlowDashboardPage({
  params,
}: {
  params: Promise<{ flow: string }>;
}) {
  const { flow } = await params;
  const [flowInfo, rows] = await Promise.all([fetchFlowInfo(flow), fetchPolicies(flow)]);

  const title = flowInfo?.meta?.dashboardLabel || flowInfo?.label || flow;

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <FlowNewButton flowKey={flow} defaultLabel={`New ${title}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All {title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No records found.
            </div>
          ) : (
            <PoliciesTableClient initialRows={rows} entityLabel={title} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
