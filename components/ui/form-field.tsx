import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function Field({
  label,
  required,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
      </Label>
      <Input {...props} />
    </div>
  );
}
