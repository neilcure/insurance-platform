"use client";

import * as React from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type FlowOption = { label: string; value: string };

function normKey(k: string): string {
  return k.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
}

function humanize(k: string): string {
  return k
    .replace(/^[a-zA-Z0-9]+__?/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

type DisplayField = { label: string; value: string };

const SKIP_NORM = /^(insuredtype|category|flowkey)$/;
const INSURED_CONTACT = /phone|tel|mobile|email|address|occupation|nationality|dateofbirth|dob/;

function extractInsuredFields(snap: Record<string, unknown>): {
  type: string;
  displayName: string;
  fields: DisplayField[];
} {
  const rawType = String(snap?.insuredType ?? snap?.insured__category ?? snap?.category ?? "").trim().toLowerCase();
  const isPersonal = rawType === "personal";
  const fields: DisplayField[] = [];

  let firstName = "", lastName = "", companyName = "", fullName = "", brNumber = "", idNumber = "";
  for (const [k, v] of Object.entries(snap)) {
    const n = normKey(k), s = String(v ?? "").trim();
    if (!s || SKIP_NORM.test(n)) continue;
    if (/lastname|surname|lname/.test(n)) lastName = s;
    if (/firstname|fname/.test(n)) firstName = s;
    if (/companyname|organisationname|orgname|corporatename/.test(n)) companyName = s;
    if (/fullname|displayname/.test(n) && n !== "companyname") fullName = s;
    if (/brnumber|businessregistration|brno/.test(n)) brNumber = s;
    if (/idnumber|hkid|identitynumber|passportnumber|idno/.test(n)) idNumber = s;
  }

  const displayName = isPersonal
    ? [lastName, firstName].filter(Boolean).join(" ") || fullName || ""
    : companyName || fullName || [lastName, firstName].filter(Boolean).join(" ") || "";

  if (isPersonal) {
    if (idNumber) fields.push({ label: "ID Number", value: idNumber });
  } else {
    if (brNumber) fields.push({ label: "BR Number", value: brNumber });
  }

  for (const [k, v] of Object.entries(snap)) {
    const n = normKey(k), s = String(v ?? "").trim();
    if (!s || SKIP_NORM.test(n)) continue;
    if (INSURED_CONTACT.test(n)) {
      if (!fields.some((f) => f.value === s)) fields.push({ label: humanize(k), value: s });
    }
  }

  return { type: rawType || "unknown", displayName, fields };
}

const VEHICLE_KEYS = /platenumber|registrationno|plateno|regno|vehicleno/;
const MAKE_KEYS = /^make$|vehiclemake|carmake/;
const MODEL_KEYS = /^model$|vehiclemodel|carmodel/;
const YEAR_KEYS = /^year$|vehicleyear|caryear|yearofmanufacture|manufactureyear/;
const COVER_KEYS = /covertype|typeofcover|policytype|insurancetype|typeofinsuran/;
const POLICY_NOTABLE = /suminsured|premium|startdate|enddate|effectivedate|expirydate|periodstart|periodend|policyperiod|deductible|excess|ncb|nodiscount|noclaimbonus|noclaimdiscount/;

type AgentInfo = { id: number; userNumber?: string | null; name?: string | null; email?: string } | null;

const FIELD_INSURER = /insurancecompany|insurer|insuranceco|inscompany|inssection/;
const FIELD_COLLAB = /collaborator|collorator|collabrator/;
const FIELD_AGENT = /^agent$/;

type EntitySummary = {
  insurers: { label: string; value: string }[];
  collaborators: { label: string; value: string }[];
  agentName: string;
};

function extractEntitiesFromPackages(pkgs: Record<string, unknown>): EntitySummary {
  const insurers: { label: string; value: string }[] = [];
  const collaborators: { label: string; value: string }[] = [];
  let agentName = "";
  const seenValues = new Set<string>();

  for (const [, data] of Object.entries(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const structured = data as { values?: Record<string, unknown> };
    const vals = structured.values ?? (data as Record<string, unknown>);
    if (!vals || typeof vals !== "object") continue;

    for (const [k, v] of Object.entries(vals)) {
      const n = normKey(k), s = String(v ?? "").trim();
      if (!s || typeof v === "object") continue;
      if (seenValues.has(s)) continue;

      if (FIELD_INSURER.test(n)) {
        seenValues.add(s);
        insurers.push({ label: humanize(k), value: s });
      } else if (FIELD_COLLAB.test(n)) {
        seenValues.add(s);
        collaborators.push({ label: humanize(k), value: s });
      } else if (FIELD_AGENT.test(n) && !agentName) {
        agentName = s;
      }
    }
  }

  return { insurers, collaborators, agentName };
}

function extractPackageFields(pkgs: Record<string, unknown>): DisplayField[] {
  const fields: DisplayField[] = [];
  const seen = new Set<string>();

  const add = (label: string, value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    fields.push({ label, value });
  };

  let plate = "", make = "", model = "", year = "", coverType = "";

  for (const [, data] of Object.entries(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const structured = data as { values?: Record<string, unknown> };
    const vals = structured.values ?? (data as Record<string, unknown>);
    if (!vals || typeof vals !== "object") continue;

    for (const [k, v] of Object.entries(vals)) {
      const n = normKey(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (!plate && VEHICLE_KEYS.test(n)) plate = s;
      if (!make && MAKE_KEYS.test(n)) make = s;
      if (!model && MODEL_KEYS.test(n)) model = s;
      if (!year && YEAR_KEYS.test(n)) year = s;
      if (!coverType && COVER_KEYS.test(n)) coverType = s;
    }
  }

  if (coverType) add("Cover Type", coverType);

  const vehicleDesc = [make, model, year].filter(Boolean).join(" ");
  if (plate) add("Vehicle", vehicleDesc ? `${plate} — ${vehicleDesc}` : plate);
  else if (vehicleDesc) add("Vehicle", vehicleDesc);

  for (const [, data] of Object.entries(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const structured = data as { values?: Record<string, unknown> };
    const vals = structured.values ?? (data as Record<string, unknown>);
    if (!vals || typeof vals !== "object") continue;

    for (const [k, v] of Object.entries(vals)) {
      const n = normKey(k), s = String(v ?? "").trim();
      if (!s || typeof v === "object") continue;
      if (POLICY_NOTABLE.test(n)) add(humanize(k), s);
    }
  }

  return fields;
}

function parseJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json || "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function LinkedPolicyCard({
  policyNumber,
  insuredSnapshotJson,
  packagesSnapshotJson,
  flowKey,
  agentJson,
  title,
  onClear,
}: {
  policyId?: string;
  policyNumber: string;
  insuredSnapshotJson: string;
  packagesSnapshotJson?: string;
  flowKey?: string;
  agentJson?: string;
  title?: string;
  onClear?: () => void;
}) {
  const [flowLabel, setFlowLabel] = React.useState<string>("");

  React.useEffect(() => {
    if (!flowKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/form-options?groupKey=flows", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as FlowOption[];
        if (cancelled) return;
        const match = (Array.isArray(data) ? data : []).find((f) => f.value === flowKey);
        setFlowLabel(match?.label ?? flowKey);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [flowKey]);

  const insuredSnap = React.useMemo(() => parseJson(insuredSnapshotJson), [insuredSnapshotJson]);
  const pkgsSnap = React.useMemo(() => parseJson(packagesSnapshotJson ?? ""), [packagesSnapshotJson]);

  const { type, displayName, fields: insuredFields } = React.useMemo(() => extractInsuredFields(insuredSnap), [insuredSnap]);
  const policyFields = React.useMemo(() => extractPackageFields(pkgsSnap), [pkgsSnap]);
  const entities = React.useMemo(() => extractEntitiesFromPackages(pkgsSnap), [pkgsSnap]);


  // Agent from API (relational link via policies.agent_id)
  const apiAgent = React.useMemo<AgentInfo>(() => {
    if (!agentJson) return null;
    try {
      const parsed = JSON.parse(agentJson);
      return parsed && typeof parsed === "object" && parsed.id ? (parsed as AgentInfo) : null;
    } catch { return null; }
  }, [agentJson]);

  // Prefer API agent, fall back to snapshot agent package
  const agentDisplay = apiAgent
    ? (apiAgent.name || apiAgent.email || `#${apiAgent.id}`) + (apiAgent.userNumber ? ` (${apiAgent.userNumber})` : "")
    : entities.agentName || "";

  if (!policyNumber) return null;

  const typeBadge = type === "company" ? "Company" : type === "personal" ? "Personal" : null;
  const hasEntities = Boolean(agentDisplay) || entities.insurers.length > 0 || entities.collaborators.length > 0;

  return (
    <div className="col-span-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
            {title || "Linked Policy"}
          </span>
        </div>
        {onClear && (
          <Button
            type="button"
            size="iconCompact"
            variant="ghost"
            onClick={onClear}
            title="Unlink policy"
            className="h-5 w-5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">Policy No.</span>
        <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100">{policyNumber}</span>

        {(flowKey || flowLabel) && (
          <>
            <span className="text-neutral-500 dark:text-neutral-400">Insurance Type</span>
            <span className="text-neutral-900 dark:text-neutral-100">{flowLabel || flowKey}</span>
          </>
        )}

        {displayName && (
          <>
            <span className="text-neutral-500 dark:text-neutral-400">Insured</span>
            <span className="text-neutral-900 dark:text-neutral-100">
              {displayName}
              {typeBadge && (
                <span className="ml-1.5 inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {typeBadge}
                </span>
              )}
            </span>
          </>
        )}

        {insuredFields.map((f, i) => (
          <React.Fragment key={`ins-${i}`}>
            <span className="text-neutral-500 dark:text-neutral-400">{f.label}</span>
            <span className="text-neutral-900 dark:text-neutral-100">{f.value}</span>
          </React.Fragment>
        ))}

        {hasEntities && (
          <>
            <div className="col-span-2 mt-1 border-t border-neutral-200 pt-1 dark:border-neutral-800" />

            {agentDisplay && (
              <>
                <span className="text-neutral-500 dark:text-neutral-400">Agent</span>
                <span className="text-neutral-900 dark:text-neutral-100">{agentDisplay}</span>
              </>
            )}

            {entities.collaborators.map((c, i) => (
              <React.Fragment key={`collab-${i}`}>
                <span className="text-neutral-500 dark:text-neutral-400">{c.label}</span>
                <span className="text-neutral-900 dark:text-neutral-100">{c.value}</span>
              </React.Fragment>
            ))}

            {entities.insurers.map((ins, i) => (
              <React.Fragment key={`ins-co-${i}`}>
                <span className="text-neutral-500 dark:text-neutral-400">{ins.label}</span>
                <span className="text-neutral-900 dark:text-neutral-100">{ins.value}</span>
              </React.Fragment>
            ))}
          </>
        )}

        {policyFields.length > 0 && (
          <>
            <div className="col-span-2 mt-1 border-t border-neutral-200 pt-1 dark:border-neutral-800" />
            {policyFields.map((f, i) => (
              <React.Fragment key={`pkg-${i}`}>
                <span className="text-neutral-500 dark:text-neutral-400">{f.label}</span>
                <span className="text-neutral-900 dark:text-neutral-100">{f.value}</span>
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
