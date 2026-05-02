"use client";

import { useSyncExternalStore } from "react";
import {
  PDF_SELECTION_MARK_CHANGED_EVENT,
  PDF_SELECTION_MARK_SCALE_KEY,
  PDF_SELECTION_MARK_STORAGE_KEY,
  readPdfSelectionMarkFromStorage,
  readPdfSelectionMarkScaleFromStorage,
  type PdfSelectionMarkStyle,
} from "./form-selections-preferences";

export function subscribePdfSelectionMark(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === PDF_SELECTION_MARK_STORAGE_KEY ||
      e.key === PDF_SELECTION_MARK_SCALE_KEY ||
      e.key === null
    ) {
      onStoreChange();
    }
  };
  const onCustom = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(PDF_SELECTION_MARK_CHANGED_EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PDF_SELECTION_MARK_CHANGED_EVENT, onCustom);
  };
}

export function usePdfSelectionMarkSync(): PdfSelectionMarkStyle {
  return useSyncExternalStore(
    subscribePdfSelectionMark,
    readPdfSelectionMarkFromStorage,
    () => "check",
  );
}

export function usePdfSelectionMarkScaleSync(): number {
  return useSyncExternalStore(
    subscribePdfSelectionMark,
    readPdfSelectionMarkScaleFromStorage,
    () => 1,
  );
}

export function emitPdfSelectionMarkChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PDF_SELECTION_MARK_CHANGED_EVENT));
}
