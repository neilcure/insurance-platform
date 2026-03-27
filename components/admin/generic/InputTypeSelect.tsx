"use client";

import type { InputType } from "@/lib/types/form";
export type { InputType };

export const INPUT_TYPE_OPTIONS: { value: InputType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "negative_currency", label: "Negative Currency (-)" },
  { value: "percent", label: "Percent (%)" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi Select" },
  { value: "boolean", label: "Boolean (Yes/No)" },
  { value: "repeatable", label: "Repeatable (List)" },
  { value: "formula", label: "Formula" },
  { value: "list", label: "List (Add Items)" },
  { value: "agent_picker", label: "Agent Picker" },
];

export function InputTypeSelect({
  value,
  onChange,
  exclude,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  exclude?: InputType[];
  className?: string;
}) {
  const options = exclude
    ? INPUT_TYPE_OPTIONS.filter((o) => !exclude.includes(o.value))
    : INPUT_TYPE_OPTIONS;

  return (
    <select
      className={
        className ??
        "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
