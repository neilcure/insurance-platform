"use client";

import * as React from "react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

type AnnouncementPayload = {
  id: number;
  title: string;
  bodyHtml: string;
  linkUrl: string | null;
  mediaKind: string;
  mediaUrl: string | null;
  autoCloseSeconds: number | null;
};

export function AnnouncementHost() {
  const t = useT();
  const [queue, setQueue] = React.useState<AnnouncementPayload[]>([]);
  const current = queue[0] ?? null;

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/me/announcements", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.announcements) ? data.announcements : [];
      setQueue(list as AnnouncementPayload[]);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const dismissCurrent = React.useCallback(async (id: number) => {
    try {
      await fetch(`/api/me/announcements/${id}/dismiss`, { method: "POST" });
    } catch {
      /* still advance UI */
    }
    setQueue((q) => q.filter((x) => x.id !== id));
  }, []);

  React.useEffect(() => {
    if (!current?.autoCloseSeconds || current.autoCloseSeconds <= 0) return;
    const ms = current.autoCloseSeconds * 1000;
    const timer = window.setTimeout(() => {
      void dismissCurrent(current.id);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [current?.id, current?.autoCloseSeconds, dismissCurrent]);

  const open = Boolean(current);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && current) void dismissCurrent(current.id);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {current ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg pr-8">{current.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {current.mediaUrl && current.mediaKind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed-in blob URL from same origin
                <img
                  src={current.mediaUrl}
                  alt=""
                  className="max-h-[40vh] w-full rounded-md object-contain border border-neutral-200 dark:border-neutral-700"
                />
              ) : null}
              {current.mediaUrl && current.mediaKind === "pdf" ? (
                <iframe
                  title={current.title}
                  src={current.mediaUrl}
                  className="h-[45vh] w-full rounded-md border border-neutral-200 dark:border-neutral-700"
                />
              ) : null}
              {current.bodyHtml ? (
                <div
                  className="space-y-2 text-xs text-neutral-800 dark:text-neutral-100 sm:text-sm [&_a]:break-all [&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400"
                  dangerouslySetInnerHTML={{ __html: current.bodyHtml }}
                />
              ) : null}
              {current.linkUrl ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link href={current.linkUrl} target="_blank" rel="noopener noreferrer">
                    {t("announcementsViewer.openLink", "Open link")}
                  </Link>
                </Button>
              ) : null}
              {current.autoCloseSeconds && current.autoCloseSeconds > 0 ? (
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {t("announcementsViewer.autoCloseNotice", "This message will close automatically.")}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="default" onClick={() => void dismissCurrent(current.id)}>
                {t("common.close", "Close")}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
