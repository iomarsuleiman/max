import { FileText, Sheet } from "lucide-react";
import { cn } from "@/components/ui";

/** A page's emoji, or a quiet document/database glyph. */
export function PageIcon({ icon, kind, className, size = 16 }: { icon: string | null | undefined; kind?: string; className?: string; size?: number }) {
  if (icon) {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center leading-none", className)} style={{ width: size + 2, height: size + 2, fontSize: size * 0.95 }} aria-hidden>
        {icon}
      </span>
    );
  }
  const Glyph = kind === "database" ? Sheet : FileText;
  return <Glyph className={cn("shrink-0 text-fg-3", className)} style={{ width: size, height: size }} strokeWidth={1.75} aria-hidden />;
}
