"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A value people need to paste somewhere else (like the MCP server address), with a Copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-surface-2 mt-3 flex items-center gap-2 rounded-xl py-1.5 ps-4 pe-1.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <code className="min-w-0 flex-1 truncate font-mono text-[13.5px]" dir="ltr">{value}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => void navigator.clipboard.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="joy-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-overlay px-3 text-[13px] font-medium shadow-[0_0_0_1px_var(--line)] hover:bg-hover"
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
