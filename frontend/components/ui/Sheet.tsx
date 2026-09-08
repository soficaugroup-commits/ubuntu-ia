"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Surface } from "@/components/ui/Surface";

type Side = "left" | "right" | "bottom";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  side?: Side;
  labelledBy?: string;
};

const panelBySide: Record<Side, string> = {
  left: "my-3 ml-3 h-[calc(100%-1.5rem)] w-[min(22rem,calc(100vw-1.5rem))]",
  right: "my-3 mr-3 ml-auto h-[calc(100%-1.5rem)] w-[min(22rem,calc(100vw-1.5rem))]",
  bottom: "mx-3 mb-3 mt-auto w-[min(32rem,calc(100%-1.5rem))] max-h-[min(32rem,88dvh)]",
};

const wrapBySide: Record<Side, string> = {
  left: "items-stretch justify-start",
  right: "items-stretch justify-end",
  bottom: "items-end justify-center",
};

export function Sheet({
  open,
  title,
  children,
  onClose,
  side = "left",
  labelledBy,
}: Props) {
  const titleId = useId();
  const labelId = labelledBy ?? titleId;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    document.addEventListener("keydown", onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex ${wrapBySide[side]}`}>
      <button
        type="button"
        className="absolute inset-0 bg-[color:color-mix(in_srgb,var(--color-navy)_45%,transparent)]"
        aria-label="Fermer"
        onClick={onClose}
      />
      <Surface
        ref={panelRef}
        elevation="raised"
        radius="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={`relative flex flex-col overflow-hidden text-content ${panelBySide[side]}`}
      >
        <h2 id={titleId} className={labelledBy ? "sr-only" : "px-5 pt-5 text-lg font-semibold"}>
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </Surface>
    </div>
  );
}
