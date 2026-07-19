"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline" | "subtle" | "danger";
type Size = "sm" | "md" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover font-medium shadow-card active:translate-y-px",
  ghost: "text-text-muted hover:text-text hover:bg-surface-2",
  outline:
    "border border-border-strong text-text hover:bg-surface-2 hover:border-text-faint",
  subtle: "bg-surface-2 text-text hover:bg-surface-3 border border-border",
  danger: "text-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md",
  icon: "h-9 w-9 rounded-md",
  "icon-sm": "h-7 w-7 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap outline-none transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
