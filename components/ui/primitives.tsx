"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Tooltip as T } from "radix-ui";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "xs" | "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover active:brightness-95 shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]",
  secondary: "bg-overlay text-fg shadow-[0_0_0_1px_var(--line-strong)] hover:bg-surface-2 active:bg-pressed",
  ghost: "text-fg-2 hover:bg-hover hover:text-fg active:bg-pressed",
  quiet: "text-fg hover:bg-hover active:bg-pressed",
  danger: "bg-danger text-white hover:bg-danger-hover",
};
const sizes: Record<Size, string> = {
  xs: "h-6 px-2 text-[12.5px] gap-1 rounded-[5px]",
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-sm gap-2 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", pending, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,box-shadow] duration-100 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "xs" | "sm" | "md"; tooltip?: boolean; shortcut?: string }>(
  function IconButton({ label, size = "sm", tooltip = true, shortcut, className, children, ...rest }, ref) {
    const btn = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-[5px] text-fg-3 transition-colors duration-100 hover:bg-hover hover:text-fg-2 active:bg-pressed disabled:opacity-40 data-[state=open]:bg-hover data-[state=open]:text-fg-2",
          size === "xs" ? "size-5" : size === "sm" ? "size-6" : "size-7",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
    return tooltip ? <Tooltip label={label} shortcut={shortcut}>{btn}</Tooltip> : btn;
  },
);

export function Tooltip({ label, shortcut, children, side = "bottom" }: { label: ReactNode; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[80] flex max-w-64 items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-canvas shadow-pop animate-in">
          {label}
          {shortcut && <span className="opacity-60">{shortcut}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-8 w-full min-w-0 rounded-md bg-overlay px-2.5 text-sm text-fg shadow-[0_0_0_1px_var(--line-strong)] outline-none transition-shadow placeholder:text-fg-3 focus:shadow-[0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)] disabled:opacity-60 aria-[invalid]:shadow-[0_0_0_1px_var(--danger)]",
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full min-w-0 rounded-md bg-overlay px-2.5 py-2 text-sm text-fg shadow-[0_0_0_1px_var(--line-strong)] outline-none placeholder:text-fg-3 focus:shadow-[0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, help, error, children, htmlFor }: { label: string; help?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : help ? (
        <p className="text-xs text-fg-3">{help}</p>
      ) : null}
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-[11px] text-fg-3", className)}>{children}</kbd>;
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-fg-3", className)} aria-label={label} role="status" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function EmptyState({ icon, title, body, children, className }: { icon?: ReactNode; title: string; body?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex max-w-sm flex-col items-center px-4 py-10 text-center", className)}>
      {icon && <div className="mb-3 grid size-10 place-items-center rounded-lg bg-surface-2 text-fg-2">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {body && <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{body}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const tones = {
    info: "bg-accent-soft text-fg",
    warning: "bg-warning-soft text-fg",
    danger: "bg-danger-soft text-fg",
    success: "bg-success-soft text-fg",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-[13px]", tones[tone], className)}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-fg-2">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 gap-2">{action}</div>}
    </div>
  );
}
