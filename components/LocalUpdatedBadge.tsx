"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";

export function LocalUpdatedBadge({ ts, timeZone }: { ts?: string | Date | null; timeZone?: string | null }) {
  if (!ts) return null;
  let date: Date;
  if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === "string") {
    // If the DB value is a naive timestamp (no timezone), interpret as UTC to avoid local-offset drift
    const hasTz = /[zZ]|[+\-]\d{2}:?\d{2}$/.test(ts);
    const normalized = hasTz ? ts : `${ts}Z`;
    date = new Date(normalized);
  } else {
    date = new Date(ts as any);
  }
  if (Number.isNaN(date.getTime())) return null;
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timeZone || "Asia/Hong_Kong",
  }).format(date);
  const text = `Updated ${label}`;
  return (
    <Badge variant="secondary" className="max-w-full truncate" title={text}>
      {text}
    </Badge>
  );
}

