"use client";

import type { ReactNode } from "react";
import { Switch as S } from "radix-ui";
import { cn } from "./cn";

export function Switch({ checked, onCheckedChange, label, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <S.Thumb className="block size-[14px] translate-x-[2px] rounded-full bg-white shadow transition-transform duration-150 data-[state=checked]:translate-x-[14px] rtl:-translate-x-[2px] rtl:data-[state=checked]:-translate-x-[14px]" />
    </S.Root>
  );
}

/** Segmented control for 2–4 exclusive options (radio semantics). */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value);
            if (e.key === "ArrowRight" || e.key === "ArrowDown") onChange(options[(i + 1) % options.length].value);
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") onChange(options[(i - 1 + options.length) % options.length].value);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[5px] font-medium text-fg-2 transition-colors hover:text-fg aria-checked:bg-overlay aria-checked:text-fg aria-checked:shadow-[0_0_0_1px_var(--line),0_1px_2px_oklch(0_0_0/0.06)]",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingRow({ title, description, children, htmlFor }: { title: string; description?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <label htmlFor={htmlFor} className="block text-sm text-fg">
          {title}
        </label>
        {description && <p className="mt-0.5 text-[12.5px] leading-snug text-fg-3">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
