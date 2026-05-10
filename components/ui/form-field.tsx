import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function Field({
  label,
  required,
  labelExtra,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
  labelExtra?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
        {labelExtra}
      </Label>
      <Input {...props} />
    </div>
  );
}
