"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, AlertTriangle, CheckCircle2, FlaskConical, Zap } from "lucide-react";

type FieldResult = {
  source: string;
  fieldKey: string;
  packageName: string | null;
  rawValue: unknown;
  formattedCurrency: string | null;
  formattedDate: string | null;
};

type PackageSummary = { name: string; fieldCount: number; sampleKeys: string[] };

type ConvenienceResult = Record<string, string>;

type FullResponse = {
  mode: "full";
  policyNumber: string;
  policyId: number;
  rawSnapshot: {
    insuredSnapshot: Record<string, unknown> | null;
    insuredKeyCount: number;
  };
  packageSummary: PackageSummary[];
  convenienceHelpers: ConvenienceResult;
  fieldResults: FieldResult[];
};

type CustomResponse = {
  mode: "custom";
  policyNumber: string;
  source: string;
  fieldKey: string;
  packageName: string | null;
  rawValue: unknown;
  formatted: string | null;
  formatUsed: string | null;
};

const SOURCES = [
  "policy", "insured", "contactinfo", "package", "agent",
  "client", "organisation", "accounting", "invoice", "statement", "static",
];

const FORMATS = ["", "currency", "negative_currency", "date", "boolean", "number"];

const SOURCE_COLORS: Record<string, string> = {
  policy: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  insured: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  contactinfo: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  package: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  agent: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  client: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  accounting: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  invoice: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  statement: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  organisation: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  static: "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
};

function RenderValue({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "") {
    return <span className="text-neutral-400 italic">empty</span>;
  }
  if (typeof v === "object") return <span className="break-all">{JSON.stringify(v)}</span>;
  return <span className="break-all">{String(v)}</span>;
}

export function FieldResolverDiagPanel() {
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<FullResponse | null>(null);
  const [sourceFilter, setSourceFilter] = React.useState<string>("all");
  const [searchFilter, setSearchFilter] = React.useState("");

  // Custom test state
  const [customSource, setCustomSource] = React.useState("insured");
  const [customFieldKey, setCustomFieldKey] = React.useState("");
  const [customPackageName, setCustomPackageName] = React.useState("");
  const [customFormat, setCustomFormat] = React.useState("");
  const [customCurrency, setCustomCurrency] = React.useState("");
  const [customLoading, setCustomLoading] = React.useState(false);
  const [customResult, setCustomResult] = React.useState<CustomResponse | null>(null);
  const [customError, setCustomError] = React.useState<string | null>(null);

  const runFullTest = async () => {
    const trimmed = policyNumber.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/admin/field-resolver-test?policyNumber=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runCustomTest = async () => {
    const trimmed = policyNumber.trim();
    if (!trimmed || !customFieldKey.trim()) return;
    setCustomLoading(true);
    setCustomError(null);
    setCustomResult(null);
    try {
      const params = new URLSearchParams({
        policyNumber: trimmed,
        source: customSource,
        fieldKey: customFieldKey.trim(),
      });
      if (customPackageName.trim()) params.set("packageName", customPackageName.trim());
      if (customFormat) params.set("format", customFormat);
      if (customCurrency.trim()) params.set("currencyCode", customCurrency.trim());

      const res = await fetch(`/api/admin/field-resolver-test?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCustomError(body.error || `HTTP ${res.status}`);
        return;
      }
      setCustomResult(await res.json());
    } catch (err) {
      setCustomError((err as Error).message);
    } finally {
      setCustomLoading(false);
    }
  };

  const filteredResults = React.useMemo(() => {
    if (!data) return [];
    let results = data.fieldResults;
    if (sourceFilter !== "all") {
      results = results.filter((r) => r.source === sourceFilter);
    }
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      results = results.filter(
        (r) =>
          r.fieldKey.toLowerCase().includes(q) ||
          (r.packageName ?? "").toLowerCase().includes(q) ||
          String(r.rawValue ?? "").toLowerCase().includes(q),
      );
    }
    return results;
  }, [data, sourceFilter, searchFilter]);

  const sourceCounts = React.useMemo(() => {
    if (!data) return {};
    const counts: Record<string, number> = {};
    for (const r of data.fieldResults) {
      counts[r.source] = (counts[r.source] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Policy number input */}
      <div className="flex gap-2">
        <Input
          placeholder="Enter policy number (e.g. P000123)"
          value={policyNumber}
          onChange={(e) => setPolicyNumber(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runFullTest()}
          className="max-w-sm"
        />
        <Button onClick={runFullTest} disabled={loading || !policyNumber.trim()}>
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
          Scan All Fields
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Custom field tester */}
      {policyNumber.trim() && (
        <div className="rounded-md border p-4 dark:border-neutral-700">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="h-4 w-4" /> Custom Field Test
          </h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label className="text-xs">Source</Label>
              <select
                value={customSource}
                onChange={(e) => setCustomSource(e.target.value)}
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Field Key</Label>
              <Input
                value={customFieldKey}
                onChange={(e) => setCustomFieldKey(e.target.value)}
                placeholder="e.g. displayName, grossPremium"
                className="mt-1"
              />
            </div>
            {customSource === "package" && (
              <div>
                <Label className="text-xs">Package Name</Label>
                <Input
                  value={customPackageName}
                  onChange={(e) => setCustomPackageName(e.target.value)}
                  placeholder="e.g. premiumRecord"
                  className="mt-1"
                />
              </div>
            )}
            <div>
              <Label className="text-xs">Format</Label>
              <select
                value={customFormat}
                onChange={(e) => setCustomFormat(e.target.value)}
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>{f || "(none — raw)"}</option>
                ))}
              </select>
            </div>
            {(customFormat === "currency" || customFormat === "negative_currency") && (
              <div>
                <Label className="text-xs">Currency Code</Label>
                <Input
                  value={customCurrency}
                  onChange={(e) => setCustomCurrency(e.target.value)}
                  placeholder="HKD"
                  className="mt-1"
                />
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={runCustomTest} disabled={customLoading || !customFieldKey.trim()}>
              {customLoading ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Zap className="mr-1.5 h-3 w-3" />}
              Test Field
            </Button>
            {customError && (
              <span className="text-sm text-red-600 dark:text-red-400">{customError}</span>
            )}
          </div>
          {customResult && (
            <div className="mt-3 rounded-md border bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="grid gap-1 text-sm">
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Source:</span>
                  <Badge variant="outline" className={`text-[10px] ${SOURCE_COLORS[customResult.source] ?? ""}`}>
                    {customResult.source}
                  </Badge>
                  {customResult.packageName && <span className="text-neutral-500">({customResult.packageName})</span>}
                </div>
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Field Key:</span>
                  <code className="text-xs">{customResult.fieldKey}</code>
                </div>
                <div className="flex gap-2">
                  <span className="font-medium w-24 shrink-0">Raw Value:</span>
                  <span className="text-xs"><RenderValue v={customResult.rawValue} /></span>
                </div>
                {customResult.formatted !== null && (
                  <div className="flex gap-2">
                    <span className="font-medium w-24 shrink-0">Formatted:</span>
                    <span className="text-xs font-semibold"><RenderValue v={customResult.formatted} /></span>
                    <span className="text-xs text-neutral-500">({customResult.formatUsed})</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full scan results */}
      {data && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
            <span>
              Policy <strong>{data.policyNumber}</strong> (ID: {data.policyId})
              — {data.fieldResults.length} fields resolved
            </span>
          </div>

          {/* Package summary */}
          {data.packageSummary.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Packages Found ({data.packageSummary.length})</h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.packageSummary.map((pkg) => (
                  <div key={pkg.name} className="rounded-md border p-3 dark:border-neutral-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm font-medium">{pkg.name}</span>
                      <Badge variant="outline" className="text-[10px]">{pkg.fieldCount} fields</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {pkg.sampleKeys.map((k) => (
                        <span key={k} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono dark:bg-blue-950 dark:text-blue-200">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Convenience helpers */}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Convenience Helpers</h4>
            <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Function</th>
                    <th className="px-3 py-2 text-left font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-neutral-700">
                  {Object.entries(data.convenienceHelpers).map(([fn, val]) => (
                    <tr key={fn}>
                      <td className="px-3 py-2 font-mono text-xs">{fn}()</td>
                      <td className="px-3 py-2"><RenderValue v={val} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Filters */}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Field Resolution Results</h4>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSourceFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  sourceFilter === "all"
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                }`}
              >
                All ({data.fieldResults.length})
              </button>
              {Object.entries(sourceCounts).map(([src, count]) => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(sourceFilter === src ? "all" : src)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    sourceFilter === src
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : SOURCE_COLORS[src] ?? "bg-neutral-100 dark:bg-neutral-800"
                  }`}
                >
                  {src} ({count})
                </button>
              ))}
              <Input
                placeholder="Search fields..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="ml-auto h-8 w-48 text-xs"
              />
            </div>

            <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Field Key</th>
                    <th className="px-3 py-2 text-left font-medium">Raw Value</th>
                    <th className="px-3 py-2 text-left font-medium">Formatted</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-neutral-700">
                  {filteredResults.map((r, i) => (
                    <tr key={i} className={!r.rawValue && r.rawValue !== 0 ? "opacity-40" : ""}>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${SOURCE_COLORS[r.source] ?? ""}`}>
                          {r.source}
                        </Badge>
                        {r.packageName && (
                          <span className="ml-1 text-[10px] text-neutral-500">({r.packageName})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.fieldKey}</td>
                      <td className="px-3 py-2 text-xs max-w-[250px] truncate"><RenderValue v={r.rawValue} /></td>
                      <td className="px-3 py-2 text-xs text-neutral-500">
                        {r.formattedCurrency && <span className="mr-2">{r.formattedCurrency}</span>}
                        {r.formattedDate && <span>{r.formattedDate}</span>}
                        {!r.formattedCurrency && !r.formattedDate && <span className="italic">—</span>}
                      </td>
                    </tr>
                  ))}
                  {filteredResults.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-neutral-400 italic">
                        No fields match the current filter
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Raw insured snapshot */}
          {data.rawSnapshot.insuredSnapshot && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">
                Raw Insured Snapshot ({data.rawSnapshot.insuredKeyCount} keys)
              </h4>
              <div className="max-h-60 overflow-auto rounded-md border p-3 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900">
                {Object.entries(data.rawSnapshot.insuredSnapshot).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-blue-600 dark:text-blue-400 shrink-0">{k}:</span>
                    <span className="text-neutral-600 dark:text-neutral-300 truncate">{JSON.stringify(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
