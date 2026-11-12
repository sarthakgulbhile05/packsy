"use client";

import { useEffect } from "react";

/** Closes an open popover on Escape (returning focus to its button), an outside click, or focus leaving it. */
export function useDismiss(
  open: boolean,
  close: () => void,
  wrapper: React.RefObject<HTMLElement | null>,
  button: React.RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    const outside = (e: Event) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, close, wrapper, button]);
}
