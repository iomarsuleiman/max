"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeftToLine, ArrowRightToLine, ArrowUp, Copy, CornerUpRight, ExternalLink, Link2, PanelRight, PenLine, RectangleHorizontal, Star, StarOff, Trash2 } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui";
import type { PageSummary } from "@/lib/client/types";
import { useWorkspace } from "./context";

/** The actions available for a page everywhere it appears (sidebar rows, favorites, search). */
export function PageMenu({
  page,
  trigger,
  onRename,
  onMove,
  align = "start",
}: {
  page: PageSummary;
  trigger: ReactNode;
  onRename?: () => void;
  onMove?: (dir: "up" | "down" | "indent" | "outdent") => void;
  align?: "start" | "end";
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const fav = !!page.favoriteRank;
  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent align={align}>
        <MenuItem icon={fav ? <StarOff /> : <Star />} onSelect={() => ws.toggleFavorite(page._id, !fav)}>
          {fav ? "Remove from Favorites" : "Add to Favorites"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Link2 />} onSelect={() => ws.copyLink(page._id)}>
          Copy link
        </MenuItem>
        <MenuItem icon={<Copy />} onSelect={() => ws.duplicatePage(page._id)} shortcut="⌘⇧D">
          Duplicate
        </MenuItem>
        {onRename && (
          <MenuItem icon={<PenLine />} onSelect={onRename} shortcut="F2">
            Rename
          </MenuItem>
        )}
        <MenuItem icon={<CornerUpRight />} onSelect={() => ws.setMoveTarget(page._id)} shortcut="⌘⇧P">
          Move to…
        </MenuItem>
        {onMove && (
          <>
            <MenuSeparator />
            <MenuItem icon={<ArrowUp />} onSelect={() => onMove("up")} shortcut="⌥⇧↑">
              Move up
            </MenuItem>
            <MenuItem icon={<ArrowDown />} onSelect={() => onMove("down")} shortcut="⌥⇧↓">
              Move down
            </MenuItem>
            <MenuItem icon={<ArrowRightToLine className="flip-rtl" />} onSelect={() => onMove("indent")} shortcut="⌥⇧→">
              Nest under page above
            </MenuItem>
            <MenuItem icon={<ArrowLeftToLine className="flip-rtl" />} onSelect={() => onMove("outdent")} shortcut="⌥⇧←">
              Move out one level
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem icon={<PanelRight />} onSelect={() => ws.openPage(page._id, { mode: "side" })}>
          Open in side peek
        </MenuItem>
        <MenuItem icon={<RectangleHorizontal />} onSelect={() => ws.openPage(page._id, { mode: "center" })}>
          Open in center peek
        </MenuItem>
        <MenuItem icon={<ExternalLink />} onSelect={() => window.open(`/p/${page._id}`, "_blank", "noopener")}>
          Open in new tab
        </MenuItem>
        <MenuItem icon={<Trash2 />} danger onSelect={() => ws.archivePage(page._id)}>
          Move to trash
        </MenuItem>
        <p className="px-2 pb-1 pt-1.5 text-[11.5px] leading-snug text-fg-3">
          Trash keeps it until you empty the trash.
          <button type="button" className="sr-only" onClick={() => router.push("/trash")}>
            Open trash
          </button>
        </p>
      </MenuContent>
    </Menu>
  );
}
