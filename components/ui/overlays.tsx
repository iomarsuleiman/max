"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog as D, DropdownMenu as M, Popover as P } from "radix-ui";
import { Check, ChevronRight, X } from "lucide-react";
import { cn } from "./cn";
import { Button, IconButton } from "./primitives";

/* ── Dialog ──────────────────────────────────────────────────────────────── */

export function Dialog({ open, onOpenChange, title, description, children, footer, className, size = "md", hideTitle }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  hideTitle?: boolean;
}) {
  const widths = { sm: "max-w-[400px]", md: "max-w-[520px]", lg: "max-w-[720px]", xl: "max-w-[1000px]" };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-[var(--scrim)] [animation:max-fade_150ms_ease]" />
        <D.Content
          className={cn(
            "fixed z-[61] flex max-h-[min(88dvh,860px)] w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl bg-overlay text-fg shadow-dialog outline-none",
            "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 [animation:max-in_160ms_var(--ease)]",
            "max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)] max-sm:[animation:max-sheet_220ms_var(--ease)]",
            widths[size],
            className,
          )}
        >
          <div className={cn("flex items-start gap-3 px-5 pt-4", hideTitle && "sr-only")}>
            <div className="min-w-0 flex-1">
              <D.Title className="text-[15px] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-[13px] text-fg-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <IconButton label="Close" size="md" tooltip={false}>
                <X className="size-4" />
              </IconButton>
            </D.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ── Promise-based confirmation ──────────────────────────────────────────── */

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "default";
  /** Typed confirmation for the most destructive actions. */
  typeToConfirm?: string;
}
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { ...opts, resolve };
    emit();
  });
}

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending,
    () => null,
  );
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [current]);
  const close = (ok: boolean) => {
    current?.resolve(ok);
    pending = null;
    emit();
  };
  if (!current) return null;
  const blocked = !!current.typeToConfirm && typed.trim() !== current.typeToConfirm;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close(false)}
      title={current.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={current.tone === "danger" ? "danger" : "primary"} disabled={blocked} onClick={() => close(true)} autoFocus={!current.typeToConfirm}>
            {current.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-[13px] leading-relaxed text-fg-2">
        {current.body}
        {current.typeToConfirm && (
          <label className="grid gap-1.5">
            <span>
              Type <strong className="text-fg">{current.typeToConfirm}</strong> to confirm.
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-8 rounded-md bg-overlay px-2.5 text-sm text-fg shadow-[0_0_0_1px_var(--line-strong)] outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
            />
          </label>
        )}
      </div>
    </Dialog>
  );
}

/* ── Menus ───────────────────────────────────────────────────────────────── */

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuSub = M.Sub;
export const MenuGroup = M.Group;

const menuSurface = "z-[70] min-w-[220px] overflow-hidden rounded-lg bg-overlay p-1 text-fg shadow-pop outline-none animate-in";

export function MenuContent({ children, className, align = "start", side, sideOffset = 4 }: { children: ReactNode; className?: string; align?: "start" | "end" | "center"; side?: "top" | "bottom" | "left" | "right"; sideOffset?: number }) {
  return (
    <M.Portal>
      <M.Content align={align} side={side} sideOffset={sideOffset} collisionPadding={8} className={cn(menuSurface, "max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto", className)}>
        {children}
      </M.Content>
    </M.Portal>
  );
}

const itemClass =
  "relative flex min-h-7 cursor-default select-none items-center gap-2 rounded-[5px] px-2 py-1 text-[13.5px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-hover max-sm:min-h-10";

export function MenuItem({ icon, children, shortcut, danger, onSelect, disabled, hint }: { icon?: ReactNode; children: ReactNode; shortcut?: string; danger?: boolean; onSelect?: (e: Event) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <M.Item className={cn(itemClass, danger && "data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger")} onSelect={onSelect} disabled={disabled}>
      {icon && <span className={cn("grid size-4 place-items-center text-fg-2 [&>svg]:size-4", danger && "group-data-[highlighted]:text-danger")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
      {shortcut && <span className="ms-4 text-xs text-fg-3">{shortcut}</span>}
    </M.Item>
  );
}

export function MenuCheckItem({ checked, onCheckedChange, children, icon }: { checked: boolean; onCheckedChange: (v: boolean) => void; children: ReactNode; icon?: ReactNode }) {
  return (
    <M.CheckboxItem className={itemClass} checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()}>
      {icon && <span className="grid size-4 place-items-center text-fg-2 [&>svg]:size-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      <M.ItemIndicator>
        <Check className="size-4 text-accent-text" />
      </M.ItemIndicator>
    </M.CheckboxItem>
  );
}

export function MenuSubTrigger({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <M.SubTrigger className={cn(itemClass, "data-[state=open]:bg-hover")}>
      {icon && <span className="grid size-4 place-items-center text-fg-2 [&>svg]:size-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      <ChevronRight className="size-3.5 text-fg-3 flip-rtl" />
    </M.SubTrigger>
  );
}

export function MenuSubContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <M.Portal>
      <M.SubContent sideOffset={4} collisionPadding={8} className={cn(menuSurface, className)}>
        {children}
      </M.SubContent>
    </M.Portal>
  );
}

export function MenuSeparator() {
  return <M.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-fg-3">{children}</M.Label>;
}

/* ── Popover ─────────────────────────────────────────────────────────────── */

export function Popover({ trigger, children, open, onOpenChange, align = "start", side, className, modal }: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  modal?: boolean;
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} side={side} sideOffset={4} collisionPadding={8} className={cn("z-[70] rounded-lg bg-overlay text-fg shadow-pop outline-none animate-in", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
export const PopoverClose = P.Close;
export const PopoverAnchor = P.Anchor;
