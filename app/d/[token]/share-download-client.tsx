"use client";

import * as React from "react";
import { Download, FileText, Loader2, ShieldCheck } from "lucide-react";

type ShareFile = {
  idx: number;
  kind: "upload" | "pdf_template";
  label: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
};

type ShareManifest = {
  ok: true;
  label: string | null;
  policyNumber: string | null;
  expiresAt: string;
  files: ShareFile[];
  recipientName: string | null;
};

type ShareError = {
  ok?: false;
  error: string;
  status: number;
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeExpiry(expiresAt: string): string {
  const target = new Date(expiresAt).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return "expired";
  const diffH = diffMs / (60 * 60 * 1000);
  if (diffH < 1) return `expires in ${Math.max(1, Math.round(diffMs / 60000))} min`;
  if (diffH < 24) return `expires in ${Math.round(diffH)} hour${Math.round(diffH) === 1 ? "" : "s"}`;
  const diffD = Math.round(diffH / 24);
  return `expires in ${diffD} day${diffD === 1 ? "" : "s"}`;
}

export function ShareDownloadClient({ token }: { token: string }) {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; manifest: ShareManifest }
    | { kind: "error"; message: string; status: number }
  >({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ShareError;
          if (!cancelled) {
            setState({
              kind: "error",
              message: body.error || "Link is no longer available",
              status: res.status,
            });
          }
          return;
        }
        const manifest = (await res.json()) as ShareManifest;
        if (!cancelled) setState({ kind: "ready", manifest });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            message: "Could not reach the server. Please try again.",
            status: 0,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "loading") {
    return (
      <div className="flex h-72 items-center justify-center text-neutral-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading documents…</span>
      </div>
    );
  }

  if (state.kind === "error") {
    const isExpired = state.status === 410;
    const isMissing = state.status === 404;
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {isExpired ? "Link expired" : isMissing ? "Link not found" : "Something went wrong"}
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {isExpired
            ? "This download link has expired. Please ask the sender to share a fresh link."
            : isMissing
              ? "The link you opened is invalid or has been removed."
              : state.message}
        </p>
      </div>
    );
  }

  const { manifest } = state;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-xs font-medium">Secure download</span>
        </div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {manifest.label || "Documents"}
        </h1>
        {manifest.policyNumber && (
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Policy{" "}
            <span className="font-mono text-neutral-900 dark:text-neutral-100">
              {manifest.policyNumber}
            </span>
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-500">
          {manifest.files.length} file{manifest.files.length === 1 ? "" : "s"} ·{" "}
          {formatRelativeExpiry(manifest.expiresAt)}
        </p>
      </div>

      <div className="space-y-2">
        {manifest.files.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 text-center text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            No files in this share.
          </div>
        ) : (
          manifest.files.map((file) => (
            <a
              key={file.idx}
              href={`/api/share/${encodeURIComponent(token)}/file/${file.idx}?download=1`}
              className="group flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50/40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-950/20"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 group-hover:bg-emerald-100 group-hover:text-emerald-700 dark:bg-neutral-800 dark:text-neutral-400 dark:group-hover:bg-emerald-900/40 dark:group-hover:text-emerald-300">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {file.label}
                </div>
                <div className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-500">
                  {file.fileName}
                  {file.fileSize ? ` · ${formatBytes(file.fileSize)}` : ""}
                </div>
              </div>
              <Download className="h-4 w-4 shrink-0 text-neutral-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
            </a>
          ))
        )}
      </div>

      <p className="px-2 text-center text-[11px] text-neutral-400 dark:text-neutral-600">
        Sent via Insurance Platform · Do not share this link with people who
        shouldn’t access these documents.
      </p>
    </div>
  );
}
