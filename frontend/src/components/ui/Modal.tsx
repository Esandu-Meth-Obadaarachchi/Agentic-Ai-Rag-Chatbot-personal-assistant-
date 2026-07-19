"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-start justify-center overflow-y-auto p-4 pt-[12vh]">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn("card relative z-10 animate-scale-in p-5 shadow-pop lit")}
        style={{ width, maxWidth: "calc(100vw - 2rem)" }}
        role="dialog"
        aria-modal
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-faint outline-none transition-colors focus:border-accent/60";
