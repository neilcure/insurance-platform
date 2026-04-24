"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Download, Loader2, PenLine, Type as TypeIcon, MousePointerClick, AlertCircle, XCircle } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";

type State = "open" | "already_signed" | "expired" | "declined";

export function SignPageClient({
  token,
  documentLabel,
  subject,
  recipientName,
  recipientEmail,
  pdfUrl,
  signedPdfUrl,
  initialState,
  signedAt,
  declinedAt,
  declineReason,
}: {
  token: string;
  documentLabel: string;
  subject: string;
  recipientName: string | null;
  recipientEmail: string;
  pdfUrl: string;
  signedPdfUrl: string | null;
  initialState: State;
  signedAt: string | null;
  declinedAt?: string | null;
  declineReason?: string | null;
}) {
  const [state, setState] = React.useState<
    State | "submitting" | "submitted" | "declining" | "declined_just_now" | "error"
  >(initialState);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Method-specific state. We keep them all mounted (one tab visible
  // at a time) so the user can flip between methods without losing
  // their input. Only the active tab's value is submitted.
  // The "decline" tab is a separate flow (it doesn't sign — it
  // explicitly rejects the document) and lives next to the three
  // signing methods so the recipient sees both options together.
  const [tab, setTab] = React.useState<"draw" | "type" | "accept" | "decline">("draw");
  const [drawIsEmpty, setDrawIsEmpty] = React.useState(true);
  const padRef = React.useRef<SignaturePadHandle>(null);
  const [typedName, setTypedName] = React.useState(recipientName ?? "");
  const [accepted, setAccepted] = React.useState(false);
  const [declineReasonInput, setDeclineReasonInput] = React.useState("");
  const [confirmingDecline, setConfirmingDecline] = React.useState(false);

  const submitDisabled =
    (tab === "draw" && drawIsEmpty) ||
    (tab === "type" && !typedName.trim()) ||
    (tab === "accept" && !accepted);
  const declineDisabled = declineReasonInput.trim().length < 3;

  async function handleSubmit() {
    setErrorMsg(null);
    setState("submitting");
    try {
      let payload: { method: "draw" | "type" | "accept"; value: string };
      if (tab === "draw") {
        const dataUrl = padRef.current?.getDataUrl();
        if (!dataUrl) {
          throw new Error("Please draw your signature before submitting.");
        }
        payload = { method: "draw", value: dataUrl };
      } else if (tab === "type") {
        if (!typedName.trim()) throw new Error("Please type your name.");
        payload = { method: "type", value: typedName.trim() };
      } else {
        if (!accepted) throw new Error("Please tick the confirmation box.");
        payload = { method: "accept", value: "" };
      }

      const res = await fetch(`/api/sign/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      setState("submitted");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to submit signature");
      setState("error");
    }
  }

  /**
   * Submit a decline. Two-step UX: first click "Decline document"
   * shows a confirmation panel, second click actually fires. We
   * gate this way because a decline is irreversible from the
   * recipient's side (they'd have to ask the sender to send a
   * fresh link) — easy to misclick if it were one-tap.
   */
  async function handleDecline() {
    setErrorMsg(null);
    if (!confirmingDecline) {
      setConfirmingDecline(true);
      return;
    }
    if (declineReasonInput.trim().length < 3) {
      setErrorMsg("Please give a short reason so the sender can follow up.");
      return;
    }
    setState("declining");
    try {
      const res = await fetch(`/api/sign/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReasonInput.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      setState("declined_just_now");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to decline document");
      // Roll back to the open state so the recipient can fix the
      // reason or try again instead of being stuck on a dead page.
      setState("open");
    }
  }

  // -------- Already-signed / expired / declined states (terminal) -
  if (state === "already_signed") {
    return (
      <Shell title={documentLabel} subject={subject}>
        <StatusCard
          icon={<CheckCircle2 className="h-12 w-12 text-green-600" />}
          title="Document already signed"
          message={
            signedAt
              ? `This document was signed on ${formatDate(signedAt)}. You can download a copy below.`
              : "This document was signed previously. You can download a copy below."
          }
          action={
            signedPdfUrl ? (
              <Button asChild>
                <a href={signedPdfUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-1.5 h-4 w-4" />
                  Download signed PDF
                </a>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-1.5 h-4 w-4" />
                  Download original PDF
                </a>
              </Button>
            )
          }
        />
      </Shell>
    );
  }
  if (state === "expired") {
    return (
      <Shell title={documentLabel} subject={subject}>
        <StatusCard
          icon={<AlertCircle className="h-12 w-12 text-amber-600" />}
          title="This signing link has expired"
          message="Please contact the sender to request a new signing link."
        />
      </Shell>
    );
  }
  // Pre-existing decline (set on initial load via SSR).
  if (state === "declined") {
    return (
      <Shell title={documentLabel} subject={subject}>
        <StatusCard
          icon={<XCircle className="h-12 w-12 text-red-600" />}
          title="This document was declined"
          message={
            declineReason
              ? `You declined this document${declinedAt ? ` on ${formatDate(declinedAt)}` : ""}: "${declineReason}". The sender has been notified.`
              : `You declined this document${declinedAt ? ` on ${formatDate(declinedAt)}` : ""}. The sender has been notified.`
          }
        />
      </Shell>
    );
  }
  // Decline that just happened in this session — slightly warmer
  // tone than the cold SSR'd version above.
  if (state === "declined_just_now") {
    return (
      <Shell title={documentLabel} subject={subject}>
        <StatusCard
          icon={<XCircle className="h-12 w-12 text-red-600" />}
          title="Document declined"
          message="Thanks — we've recorded your reason and notified the sender. They'll follow up with you directly. You can safely close this tab."
        />
      </Shell>
    );
  }
  if (state === "submitted") {
    // The submit endpoint stores the signed PDF synchronously
    // before responding ok, so the download URL is immediately
    // valid here — no refresh required. Surfacing it directly
    // beats the "refresh to download" dance.
    const signedDownloadUrl = `/api/sign/${token}/signed.pdf`;
    return (
      <Shell title={documentLabel} subject={subject}>
        <StatusCard
          icon={<CheckCircle2 className="h-12 w-12 text-green-600" />}
          title="Thank you — your signature has been received"
          message="The sender has been notified and the signed PDF is stored in their system. You can download a copy below for your records — there's nothing else you need to do."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button asChild>
                <a href={signedDownloadUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download signed PDF
                </a>
              </Button>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                You can safely close this tab.
              </p>
            </div>
          }
        />
      </Shell>
    );
  }

  // -------- Active signing UI ------------------------------------
  return (
    <Shell title={documentLabel} subject={subject}>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left: PDF preview. Inline iframe is the most reliable
            cross-browser way to show a PDF without bundling a JS
            renderer. Disabled-toolbar params are best-effort:
            Chrome honours `#toolbar=0`, Safari ignores it. */}
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0`}
            title="Document preview"
            className="h-[600px] w-full lg:h-[800px]"
          />
        </div>

        {/* Right: signature controls. Sticky on desktop so the
            controls stay in view as the recipient scrolls the PDF. */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Sign this document
            </h3>
            <p className="mb-4 text-xs text-neutral-600 dark:text-neutral-400">
              Choose how you'd like to sign:
            </p>
            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as typeof tab);
                // Reset the two-step decline confirmation whenever
                // the recipient flips tabs, so they don't return
                // to the decline tab and accidentally submit.
                setConfirmingDecline(false);
                setErrorMsg(null);
              }}
            >
              {/* 2-row grid on phones (h-auto so the second row isn't clipped),
                  flat 4-across on sm and up. Keeps icon+label readable on
                  narrow viewports without forcing horizontal scroll. */}
              <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                <TabsTrigger value="draw" className="gap-1">
                  <PenLine className="h-3 w-3" /> Draw
                </TabsTrigger>
                <TabsTrigger value="type" className="gap-1">
                  <TypeIcon className="h-3 w-3" /> Type
                </TabsTrigger>
                <TabsTrigger value="accept" className="gap-1">
                  <MousePointerClick className="h-3 w-3" /> Accept
                </TabsTrigger>
                <TabsTrigger
                  value="decline"
                  className="gap-1 text-red-600 data-[state=active]:text-red-700 dark:text-red-400 dark:data-[state=active]:text-red-300"
                >
                  <XCircle className="h-3 w-3" /> Decline
                </TabsTrigger>
              </TabsList>

              <TabsContent value="draw" className="mt-4">
                <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700">
                  <SignaturePad ref={padRef} onChange={(empty) => setDrawIsEmpty(empty)} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Sign with your mouse or finger.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => padRef.current?.clear()}
                    disabled={drawIsEmpty}
                  >
                    Clear
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="type" className="mt-4 space-y-2">
                <Label htmlFor="typed-signature">Type your full name</Label>
                <Input
                  id="typed-signature"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Your full name"
                />
                {typedName.trim() && (
                  <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Preview</p>
                    {/* Cursive font preview — same family stack the
                        server uses when rendering the typed signature
                        SVG, so what the recipient sees here matches
                        what ends up on the PDF. */}
                    <p
                      className="text-2xl text-neutral-900 dark:text-neutral-100"
                      style={{ fontFamily: "'Brush Script MT','Lucida Handwriting',cursive" }}
                    >
                      {typedName}
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="accept" className="mt-4 space-y-3">
                <p className="text-xs text-neutral-700 dark:text-neutral-300">
                  By ticking the box below you confirm that you have read the document
                  and agree to its contents.
                </p>
                <label className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-neutral-800 dark:text-neutral-200">
                    I have reviewed the attached document and accept its contents.
                  </span>
                </label>
              </TabsContent>

              <TabsContent value="decline" className="mt-4 space-y-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                  <p className="font-medium">
                    Don&apos;t want to sign this document?
                  </p>
                  <p className="mt-1">
                    Tell the sender what to change and they&apos;ll send a corrected
                    version. This is irreversible from your side — once submitted,
                    the document is marked rejected.
                  </p>
                </div>
                <Label htmlFor="decline-reason">Reason (required)</Label>
                <textarea
                  id="decline-reason"
                  value={declineReasonInput}
                  onChange={(e) => {
                    setDeclineReasonInput(e.target.value);
                    // Re-confirm if the recipient edits the reason
                    // after pressing the first button — they may
                    // be adjusting their mind, so don't fast-track.
                    if (confirmingDecline) setConfirmingDecline(false);
                  }}
                  placeholder="e.g. The premium amount is wrong, please reduce by RM200."
                  rows={4}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </TabsContent>
            </Tabs>

            {errorMsg && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {tab === "decline" ? (
              <Button
                variant="destructive"
                className="mt-4 w-full"
                onClick={handleDecline}
                disabled={declineDisabled || state === "declining"}
              >
                {state === "declining" ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Submitting decline...
                  </>
                ) : confirmingDecline ? (
                  <>
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Confirm — Decline document
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Decline document
                  </>
                )}
              </Button>
            ) : (
              <Button
                className="mt-4 w-full"
                onClick={handleSubmit}
                disabled={submitDisabled || state === "submitting"}
              >
                {state === "submitting" ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Submit Signature
                  </>
                )}
              </Button>
            )}

            <p className="mt-3 text-[10px] text-neutral-500 dark:text-neutral-400">
              {tab === "decline" ? (
                <>
                  Declining as <strong>{recipientName || recipientEmail}</strong>.
                  The sender will see your reason in their dashboard.
                </>
              ) : (
                <>
                  Signing as <strong>{recipientName || recipientEmail}</strong>.
                  Your IP address and timestamp will be recorded for audit purposes.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  subject,
  children,
}: {
  title: string;
  subject: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">
              Document for signature
            </p>
            <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {subject}
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex justify-center">{icon}</div>
      <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        {message}
      </p>
      {action}
    </div>
  );
}

function formatDate(iso: string): string {
  // Pin the locale to "en-US" so server-side and client-side
  // rendering agree. `toLocaleString(undefined, ...)` defaults to
  // the runtime locale, which is en-US on Node but the browser's
  // chosen language on the client (zh-CN, etc.) — that mismatch
  // triggers a React hydration warning. Pinning here is fine: the
  // sign page is a transactional surface, not localised UI, and
  // recipients still get a clear "Apr 24, 2026, 08:10 AM" stamp
  // regardless of their browser language.
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
