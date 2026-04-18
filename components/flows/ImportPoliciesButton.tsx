"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { ImportPoliciesDialog } from "@/components/policies/ImportPoliciesDialog";

interface Props {
  flowKey: string;
  flowLabel: string;
}

/**
 * Client-side trigger for the bulk Excel import dialog.
 * Rendered conditionally by the server page (admin / internal_staff only).
 */
export function ImportPoliciesButton({ flowKey, flowLabel }: Props) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="h-4 w-4 sm:hidden lg:inline" />
        <span className="hidden sm:inline">Import Excel</span>
      </Button>
      <ImportPoliciesDialog
        open={open}
        onOpenChange={setOpen}
        flowKey={flowKey}
        flowLabel={flowLabel}
        onImportComplete={() => router.refresh()}
      />
    </>
  );
}
