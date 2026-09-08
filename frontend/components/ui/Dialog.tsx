"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Surface } from "@/components/ui/Surface";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function Dialog({ open, title, children, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[color:color-mix(in_srgb,var(--color-navy)_45%,transparent)] p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Fermer"
        onClick={onClose}
      />
      <Surface
        ref={panelRef}
        elevation="raised"
        radius="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[min(36rem,88dvh)] w-full max-w-md overflow-y-auto p-5 text-content sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </Surface>
    </div>
  );
}
