"use client";

/**
 * Imperative document-delivery API.
 *
 * Mirror of the proven `@/components/ui/global-dialogs` pattern: the
 * `<DocumentDeliveryHost />` is mounted ONCE in `app/(dashboard)/layout.tsx`,
 * and any client component anywhere in the dashboard tree can pop the
 * Email Files or WhatsApp Files dialog with a single call:
 *
 *   import { useDeliverDocuments } from "@/lib/document-delivery";
 *
 *   const deliver = useDeliverDocuments();
 *   await deliver({
 *     channel: "whatsapp",
 *     policyId,
 *     policyNumber,
 *     groups,
 *     recipient: { phone, name },
 *   });
 *
 * Why a context vs. local state in every parent
 * --------------------------------------------
 * - The same dialogs are now reachable from many surfaces (Documents
 *   drawer, Workflow tab, the new DocumentActionBar, the per-row
 *   icons in DocumentsTab). Local state would mean each parent
 *   mounts its own copy of the dialogs — duplicated DOM, duplicated
 *   PDF-template fetches, inconsistent prefill state across surfaces.
 * - A single host means one open dialog at a time (correct UX), one
 *   network fetch for the template list (cheaper), and a single
 *   contract for "what does it mean to deliver these files".
 *
 * Why the request shape lives in `types.ts`
 * ----------------------------------------
 * Splitting the type into a server-safe file lets non-React server
 * code (e.g. future audit code) reference `DeliveryRequest` without
 * pulling React into its bundle.
 */

import * as React from "react";
import type { DeliveryRequest } from "./types";

type DeliveryContextValue = {
  request: DeliveryRequest | null;
  open: (request: DeliveryRequest) => void;
  close: () => void;
};

const DeliveryContext = React.createContext<DeliveryContextValue | null>(null);

export function DocumentDeliveryProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<DeliveryRequest | null>(null);

  const open = React.useCallback((next: DeliveryRequest) => {
    setRequest(next);
  }, []);

  const close = React.useCallback(() => {
    setRequest(null);
  }, []);

  const value = React.useMemo(
    () => ({ request, open, close }),
    [request, open, close],
  );

  return (
    <DeliveryContext.Provider value={value}>
      {children}
    </DeliveryContext.Provider>
  );
}

/** Internal — used by `<DocumentDeliveryHost />` to drive the dialogs.
 *  Hidden from `index.ts` so callers don't reach into host internals. */
export function useDocumentDeliveryState(): DeliveryContextValue {
  const ctx = React.useContext(DeliveryContext);
  if (!ctx) {
    throw new Error(
      "useDocumentDeliveryState must be used inside <DocumentDeliveryProvider />",
    );
  }
  return ctx;
}

/**
 * Public API for client components. Returns a single function that
 * pops the appropriate delivery dialog.
 *
 * Outside the provider this throws — that's intentional, so an
 * accidental call from `app/(auth)/...` (which has no provider) fails
 * fast in development instead of silently no-op'ing.
 */
export function useDeliverDocuments(): (request: DeliveryRequest) => void {
  const ctx = React.useContext(DeliveryContext);
  if (!ctx) {
    throw new Error(
      "useDeliverDocuments must be used inside <DocumentDeliveryProvider />. " +
        "The provider is mounted in app/(dashboard)/layout.tsx — make sure your " +
        "component renders within /dashboard or /admin.",
    );
  }
  return ctx.open;
}
