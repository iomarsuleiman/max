"use client";

import type { ReactNode } from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "./cn";

export interface SelectChoice<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Plain text for type-to-find and the trigger when `label` isn't a string. */
  text?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

// Radix reserves "" for "nothing selected", so an empty option value travels as this token.
const EMPTY = "\u0000empty";
const toRadix = (v: string) => (v === "" ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? "" : v);

const triggerVariants = {
  /** Field style: settings, property editors. */
  outline: "bg-overlay shadow-[0_0_0_1px_var(--line-strong)] hover:bg-hover",
  /** Soft chip style: filter and sort rows. */
  filled: "bg-surface-2 hover:bg-hover",
  /** Text-like: toolbar actions such as "+ Add a filter". */
  ghost: "text-fg-2 hover:bg-hover hover:text-fg",
};

/**
 * The one dropdown in Max (no native <select>): a Radix listbox styled like our menus,
 * with keyboard navigation, type-to-find, and the selected item checked.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  label,
  placeholder = "Choose…",
  variant = "outline",
  size = "md",
  disabled,
  id,
  className,
  contentClassName,
  align = "start",
}: {
  value: T | "";
  onChange: (value: T) => void;
  options: SelectChoice<T>[];
  /** Accessible name (also used when the visible label is elsewhere). */
  label: string;
  placeholder?: ReactNode;
  variant?: keyof typeof triggerVariants;
  size?: "sm" | "md";
  disabled?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
}) {
  const known = options.some((o) => o.value === value);
  return (
    <S.Root value={known ? toRadix(value) : ""} onValueChange={(v) => onChange(fromRadix(v) as T)} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={label}
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-md text-start text-fg outline-none transition-colors focus-visible:shadow-[0_0_0_2px_var(--focus)] disabled:opacity-50 data-[placeholder]:text-fg-3",
          size === "sm" ? "h-7 px-2 text-[13px]" : "h-8 px-2.5 text-[13.5px]",
          triggerVariants[variant],
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-fg-3" aria-hidden />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            "z-[80] max-h-[min(60dvh,var(--radix-select-content-available-height))] min-w-[max(var(--radix-select-trigger-width),180px)] overflow-hidden rounded-lg bg-overlay text-fg shadow-pop outline-none animate-in",
            contentClassName,
          )}
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value || EMPTY}
                value={toRadix(o.value)}
                disabled={o.disabled}
                textValue={o.text ?? (typeof o.label === "string" ? o.label : undefined)}
                className="relative flex min-h-7 cursor-default select-none items-center gap-2 rounded-[5px] py-1 pe-7 ps-2 text-[13.5px] outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-hover data-[disabled]:opacity-45 max-sm:min-h-10"
              >
                {o.icon && <span className="grid size-4 shrink-0 place-items-center text-fg-2 [&>svg]:size-4">{o.icon}</span>}
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="absolute end-2 grid place-items-center">
                  <Check className="size-3.5 text-fg-2" aria-hidden />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/** A select used as an action ("+ Add a filter"): it always shows its label and runs `onPick`. */
export function ActionSelect({ label, options, onPick, size = "sm", className }: { label: string; options: SelectChoice[]; onPick: (value: string) => void; size?: "sm" | "md"; className?: string }) {
  return (
    <Select
      value=""
      onChange={(v) => v && onPick(v)}
      options={options}
      label={label}
      placeholder={
        <span className="inline-flex items-center gap-1 text-fg-2">
          <Plus className="size-3.5" aria-hidden />
          {label}
        </span>
      }
      variant="ghost"
      size={size}
      disabled={!options.length}
      className={className}
    />
  );
}
