/* eslint-disable @typescript-eslint/no-misused-promises */
"use client";

import * as React from "react";

type Row = {
  label: string;
  value: string;
  meta?: Record<string, unknown>;
};

function hasWord(s: string, w: string): boolean {
  return new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`).test(s);
}

function detectBranch(row: Row | null): "existing" | "create" | "unknown" {
  if (!row) return "unknown";
  const selectedLabel = String(row?.label ?? "").toLowerCase();
  const selectedValue = String(row?.value ?? "").toLowerCase();
  const meta = (row?.meta ?? {}) as Record<string, unknown>;
  const metaHintRaw = String(meta["branch"] ?? meta["branchType"] ?? meta["mode"] ?? "").toLowerCase();
  const metaExisting = ["existing", "existing_client", "existingclient"].includes(metaHintRaw);
  const metaCreate = ["new", "create", "new_client", "create_client"].includes(metaHintRaw);
  const labelExisting = hasWord(selectedLabel, "existing");
  const labelCreate = hasWord(selectedLabel, "create") || hasWord(selectedLabel, "new");
  const valueExisting = hasWord(selectedValue, "existing");
  const valueCreate = hasWord(selectedValue, "create") || hasWord(selectedValue, "new");

  if (metaExisting || metaCreate) return metaExisting && !metaCreate ? "existing" : metaCreate ? "create" : "unknown";
  if (labelExisting || labelCreate) return labelExisting && !labelCreate ? "existing" : labelCreate ? "create" : "unknown";
  if (valueExisting || valueCreate) return valueExisting && !valueCreate ? "existing" : valueCreate ? "create" : "unknown";
  return "unknown";
}

export default function BranchDetectionTestPage() {
  const [rows] = React.useState<Row[]>([
    { label: "Choosing a Existing Client", value: "existing_client" },
    // value intentionally contains both 'new' and 'existing' to reproduce the bug
    { label: "Create a New Client", value: "new_or_existing_client" },
  ]);
  const [selected, setSelected] = React.useState<string | undefined>(undefined);
  const [step, setStep] = React.useState(1);
  const [highestCompletedStep, setHighest] = React.useState(0);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState<number | undefined>(undefined);
  const [messages, setMessages] = React.useState<string[]>([]);

  const append = React.useCallback((m: string) => setMessages((s) => [...s, `${new Date().toLocaleTimeString()}: ${m}`]), []);

  const requiresSelection = rows.length > 1;

  const continueFlow = React.useCallback(() => {
    const row = rows.length === 1 ? rows[0] : rows.find((r) => r.value === selected) ?? null;
    if (requiresSelection && !row) {
      append("Please choose an option to continue.");
      return;
    }
    const branch = detectBranch(row);
    append(`Detected branch: ${branch} (label="${row?.label}", value="${row?.value}")`);

    if (branch === "existing") {
      if (typeof clientId !== "number") {
        setPickerOpen(true);
        append("Opening existing client picker…");
        return;
      }
      setStep((s) => s + 1);
      setHighest((h) => Math.max(h, step));
      append(`Client selected (#${clientId}). Proceeding to step ${step + 1}.`);
      return;
    }

    if (step === 1) {
      setStep((s) => s + 1);
      setHighest((h) => Math.max(h, step));
      append(`Create-new path on step 1. Proceeding to step ${step + 1}.`);
      return;
    }

    // Default advance for other steps
    setStep((s) => s + 1);
    setHighest((h) => Math.max(h, step));
    append(`Default advance to step ${step + 1}.`);
  }, [append, clientId, requiresSelection, rows, selected, step]);

  return (
    <div className="p-3 space-y-6 sm:p-6">
      <h1 className="text-xl font-semibold">Branch Detection Test</h1>
      <div className="flex items-center gap-3">
        <span className="text-sm px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-800">Step {step}</span>
        <span className="text-sm text-neutral-500">Highest completed: {highestCompletedStep}</span>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Choose:</div>
        <div className="flex flex-wrap gap-6">
          {rows.map((r) => (
            <label key={r.value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                value={r.value}
                checked={selected === r.value}
                onChange={(e) => setSelected(e.target.value)}
              />
              {r.label} <span className="text-xs text-neutral-500">({r.value})</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="h-9 rounded px-3 text-sm bg-neutral-900 text-white dark:bg-white dark:text-black"
          onClick={continueFlow}
        >
          Continue
        </button>
        <button
          className="h-9 rounded px-3 text-sm bg-neutral-200 dark:bg-neutral-800"
          onClick={() => {
            setStep(1);
            setHighest(0);
            setSelected(undefined);
            setPickerOpen(false);
            setClientId(undefined);
            setMessages([]);
          }}
        >
          Reset
        </button>
      </div>

      {pickerOpen ? (
        <div className="rounded border p-4 space-y-3">
          <div className="font-medium">Select Existing Client (Test)</div>
          <div className="flex items-center gap-2">
            <button
              className="h-8 rounded px-2 text-sm bg-neutral-900 text-white dark:bg-white dark:text-black"
              onClick={() => {
                setClientId(101);
                setPickerOpen(false);
                append("Picked client #101.");
              }}
            >
              Use #101
            </button>
            <button
              className="h-8 rounded px-2 text-sm bg-neutral-200 dark:bg-neutral-800"
              onClick={() => {
                setPickerOpen(false);
                append("Closed picker without selection.");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="font-medium">Log</div>
        <div className="rounded border p-3 text-sm max-h-64 overflow-auto">
          {messages.length === 0 ? <div className="text-neutral-500">No events yet.</div> : null}
          <ul className="space-y-1">
            {messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

