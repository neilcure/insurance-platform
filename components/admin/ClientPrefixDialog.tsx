"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const triggerClass =
  "flex h-10 w-full items-center justify-center rounded-md border border-neutral-200 bg-white px-1 text-[11px] font-medium uppercase tracking-tight transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export function ClientPrefixDialog({
  companyPrefix: initialCompany,
  personalPrefix: initialPersonal,
}: {
  companyPrefix: string;
  personalPrefix: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [company, setCompany] = React.useState(initialCompany);
  const [personal, setPersonal] = React.useState(initialPersonal);
  const [editCompany, setEditCompany] = React.useState(initialCompany);
  const [editPersonal, setEditPersonal] = React.useState(initialPersonal);

  const handleOpen = () => {
    setEditCompany(company);
    setEditPersonal(personal);
    setOpen(true);
  };

  const handleApply = () => {
    setCompany(editCompany);
    setPersonal(editPersonal);
    setOpen(false);
  };

  return (
    <>
      <input type="hidden" name="companyPrefix" value={company} />
      <input type="hidden" name="personalPrefix" value={personal} />
      <button type="button" onClick={handleOpen} className={triggerClass} title="Click to set Company / Personal prefix">
        <span className="text-green-600 dark:text-green-400">{company}</span>
        <span className="mx-0.5 text-neutral-400">/</span>
        <span className="text-blue-600 dark:text-blue-400">{personal}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Client Record Prefixes</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Set the number prefix for client records based on insured type.
          </p>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label className="text-sm">
                Company Prefix
                <span className="ml-1 text-[10px] text-neutral-400">(Insured Type: Company)</span>
              </Label>
              <Input
                value={editCompany}
                onChange={(e) => setEditCompany(e.target.value.toUpperCase())}
                placeholder="e.g. HIDIC"
                className="uppercase"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-sm">
                Personal Prefix
                <span className="ml-1 text-[10px] text-neutral-400">(Insured Type: Personal)</span>
              </Label>
              <Input
                value={editPersonal}
                onChange={(e) => setEditPersonal(e.target.value.toUpperCase())}
                placeholder="e.g. HIDIP"
                className="uppercase"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FlowPrefixDialog({
  flowKey,
  flowLabel,
  defaultPrefix,
}: {
  flowKey: string;
  flowLabel: string;
  defaultPrefix: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [prefix, setPrefix] = React.useState(defaultPrefix);
  const [editPrefix, setEditPrefix] = React.useState(defaultPrefix);

  const handleOpen = () => {
    setEditPrefix(prefix);
    setOpen(true);
  };

  const handleApply = () => {
    setPrefix(editPrefix);
    setOpen(false);
  };

  return (
    <>
      <input type="hidden" name={`fp_${flowKey}`} value={prefix} />
      <button
        type="button"
        onClick={handleOpen}
        className={triggerClass}
        title={`Click to set prefix for ${flowLabel}`}
      >
        {prefix || <span className="text-neutral-400">—</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{flowLabel} Prefix</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Set the record number prefix for <strong>{flowLabel}</strong>.
          </p>
          <div className="grid gap-1.5 py-2">
            <Label className="text-sm">Prefix</Label>
            <Input
              value={editPrefix}
              onChange={(e) => setEditPrefix(e.target.value.toUpperCase())}
              placeholder="e.g. POL"
              className="uppercase"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
