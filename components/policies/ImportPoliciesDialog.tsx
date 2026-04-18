"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Upload, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";

type PreviewRow = {
  excelRow: number;
  valid: boolean;
  errors: { column: string | null; message: string }[];
  values: Record<string, unknown>;
};

type PreviewResponse = {
  flow: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  unknownColumns: string[];
  missingColumns: string[];
  rows: PreviewRow[];
  columnOrder: { id: string; label: string }[];
};

type CommitRowResult = {
  excelRow: number;
  ok: boolean;
  policyId?: number;
  policyNumber?: string;
  clientNumber?: string;
  clientCreated?: boolean;
  error?: string;
};

type CommitResponse = {
  flow: string;
  total: number;
  succeeded: number;
  failed: number;
  results: CommitRowResult[];
};

type Step = "upload" | "preview" | "result";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowKey: string;
  flowLabel: string;
  /** Called after a successful commit so the parent can refresh its list. */
  onImportComplete?: () => void;
}

export function ImportPoliciesDialog({
  open,
  onOpenChange,
  flowKey,
  flowLabel,
  onImportComplete,
}: Props) {
  const [step, setStep] = React.useState<Step>("upload");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null);
  const [commit, setCommit] = React.useState<CommitResponse | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      // Reset state when the dialog closes
      setStep("upload");
      setFile(null);
      setPreview(null);
      setCommit(null);
      setBusy(false);
    }
  }, [open]);

  async function downloadTemplate() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/flows/${encodeURIComponent(flowKey)}/import/template`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${flowKey}-import-template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Template downloaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!file) {
      toast.error("Please choose a file first");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/flows/${encodeURIComponent(flowKey)}/import/preview`,
        { method: "POST", body: fd },
      );
      const body = (await res.json().catch(() => ({}))) as
        | PreviewResponse
        | { error?: string };
      if (!res.ok) {
        throw new Error(("error" in body && body.error) || `Preview failed (HTTP ${res.status})`);
      }
      setPreview(body as PreviewResponse);
      setStep("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/flows/${encodeURIComponent(flowKey)}/import/commit`,
        { method: "POST", body: fd },
      );
      const body = (await res.json().catch(() => ({}))) as
        | CommitResponse
        | { error?: string };
      if (!res.ok) {
        throw new Error(("error" in body && body.error) || `Import failed (HTTP ${res.status})`);
      }
      const result = body as CommitResponse;
      setCommit(result);
      setStep("result");
      if (result.succeeded > 0) {
        toast.success(`${result.succeeded} of ${result.total} policies imported`);
        onImportComplete?.();
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} row(s) failed — see report`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function downloadFailureReport() {
    if (!commit) return;
    const failed = commit.results.filter((r) => !r.ok);
    if (failed.length === 0) return;
    const lines = [
      "excelRow,error",
      ...failed.map((r) => {
        const safe = (r.error ?? "").replace(/"/g, '""');
        return `${r.excelRow},"${safe}"`;
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${flowKey}-import-errors.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Import {flowLabel} from Excel
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {step === "upload" && (
            <UploadStep
              file={file}
              setFile={setFile}
              fileInputRef={fileInputRef}
              busy={busy}
              onDownloadTemplate={downloadTemplate}
            />
          )}

          {step === "preview" && preview && (
            <PreviewStep preview={preview} />
          )}

          {step === "result" && commit && (
            <ResultStep commit={commit} onDownloadErrors={downloadFailureReport} />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {step === "result" ? "Close" : "Cancel"}
          </Button>

          {step === "upload" && (
            <Button onClick={runPreview} disabled={!file || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Validate
            </Button>
          )}

          {step === "preview" && preview && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")} disabled={busy}>
                Back
              </Button>
              <Button
                onClick={runCommit}
                disabled={busy || preview.validRows === 0}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import {preview.validRows} valid row{preview.validRows === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadStep({
  file,
  setFile,
  fileInputRef,
  busy,
  onDownloadTemplate,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onDownloadTemplate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
        <p className="mb-2 font-medium">How it works</p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Download the template (always matches the current field setup).</li>
          <li>Fill one row per policy. Leave the Client Number column blank to auto-create a new client.</li>
          <li>Upload, preview validation, then commit.</li>
        </ol>
      </div>

      <div>
        <Button
          variant="outline"
          onClick={onDownloadTemplate}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download Template
        </Button>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Excel file</label>
        {/*
          Native <input type="file"> renders its button text in the browser's
          locale ("Choose File" in EN, "选择文件" in zh-CN, etc.). We hide it
          visually and trigger it from our own button, so the UI stays in
          English regardless of the browser language.
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          className="sr-only"
          aria-label="Excel file"
        />
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="h-4 w-4" />
            Choose file…
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-300">
            {file ? file.name : <span className="text-neutral-400">No file selected</span>}
          </span>
          {file && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={busy}
            >
              Clear
            </Button>
          )}
        </div>
        {file && (
          <p className="mt-1 text-xs text-neutral-500">{(file.size / 1024).toFixed(1)} KB</p>
        )}
      </div>
    </div>
  );
}

function PreviewStep({ preview }: { preview: PreviewResponse }) {
  const labelById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of preview.columnOrder) m.set(c.id, c.label);
    return m;
  }, [preview.columnOrder]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Total rows" value={preview.totalRows} />
        <Stat label="Valid" value={preview.validRows} tone="ok" />
        <Stat label="Errors" value={preview.errorRows} tone={preview.errorRows > 0 ? "err" : undefined} />
      </div>

      {preview.missingColumns.length > 0 && (
        <Banner tone="err">
          <strong>Missing required columns:</strong> {preview.missingColumns.join(", ")}
        </Banner>
      )}
      {preview.unknownColumns.length > 0 && (
        <Banner tone="warn">
          <strong>Ignored unknown columns:</strong> {preview.unknownColumns.join(", ")}
        </Banner>
      )}

      <div className="max-h-[50vh] overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left">
              <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Row</th>
              <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Status</th>
              <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Errors / Preview</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={r.excelRow} className={r.valid ? "" : "bg-red-50/50 dark:bg-red-900/10"}>
                <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800">{r.excelRow}</td>
                <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800">
                  {r.valid ? (
                    <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" /> {r.errors.length} error{r.errors.length === 1 ? "" : "s"}
                    </span>
                  )}
                </td>
                <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800">
                  {r.valid ? (
                    <RowSummary values={r.values} labelById={labelById} />
                  ) : (
                    <ul className="list-disc pl-4 text-xs text-red-700 dark:text-red-300">
                      {r.errors.map((e, i) => (
                        <li key={i}>
                          {e.column ? (
                            <>
                              <span className="font-medium">{labelById.get(e.column) ?? e.column}</span>: {e.message}
                            </>
                          ) : (
                            e.message
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
            {preview.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-6 text-center text-sm text-neutral-500">
                  No data rows detected
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowSummary({
  values,
  labelById,
}: {
  values: Record<string, unknown>;
  labelById: Map<string, string>;
}) {
  const parts: string[] = [];
  let count = 0;
  for (const [k, v] of Object.entries(values)) {
    if (count >= 4) break;
    if (v === undefined || v === null || v === "") continue;
    const label = labelById.get(k) ?? k;
    parts.push(`${label}: ${String(v)}`);
    count++;
  }
  return <span className="text-xs text-neutral-600 dark:text-neutral-400">{parts.join(" • ") || "(empty)"}</span>;
}

function ResultStep({
  commit,
  onDownloadErrors,
}: {
  commit: CommitResponse;
  onDownloadErrors: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Total" value={commit.total} />
        <Stat label="Succeeded" value={commit.succeeded} tone="ok" />
        <Stat label="Failed" value={commit.failed} tone={commit.failed > 0 ? "err" : undefined} />
      </div>

      {commit.failed > 0 && (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          <span>Some rows failed to import.</span>
          <Button size="sm" variant="outline" onClick={onDownloadErrors}>
            <Download className="h-4 w-4" /> Download error report
          </Button>
        </div>
      )}

      <div className="max-h-[50vh] overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left">
              <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Row</th>
              <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Status</th>
              <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Result</th>
            </tr>
          </thead>
          <tbody>
            {commit.results.map((r) => (
              <tr key={r.excelRow} className={r.ok ? "" : "bg-red-50/50 dark:bg-red-900/10"}>
                <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800">{r.excelRow}</td>
                <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800">
                  {r.ok ? (
                    <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Created
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" /> Failed
                    </span>
                  )}
                </td>
                <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800 text-xs">
                  {r.ok ? (
                    <span>
                      {r.policyNumber ?? `#${r.policyId}`}
                      {r.clientCreated && r.clientNumber && (
                        <span className="ml-2 text-neutral-500">
                          (new client {r.clientNumber})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-red-700 dark:text-red-300">{r.error}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "err";
}) {
  const toneCls =
    tone === "ok"
      ? "text-green-700 dark:text-green-400"
      : tone === "err"
        ? "text-red-700 dark:text-red-400"
        : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warn" | "err";
  children: React.ReactNode;
}) {
  const cls =
    tone === "err"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200";
  return (
    <div className={`rounded-md border p-2 text-xs ${cls}`}>{children}</div>
  );
}
