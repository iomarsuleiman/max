"use client";

import { useRouter } from "next/navigation";
import { Copy, CornerUpRight, Download, FileCode2, LayoutTemplate, Link2, Lock, MoreHorizontal, Star, StarOff, Trash2, Type, MoveHorizontal, Unlock } from "lucide-react";
import { toast } from "sonner";
import { IconButton, Menu, MenuCheckItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Switch } from "@/components/ui";
import { useRead } from "@/lib/client/data";
import { dateTime } from "@/lib/client/format";
import type { PageRow } from "@/lib/client/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PageOptions({ page, wordCount }: { page: PageRow; wordCount?: number }) {
  const ws = useWorkspace();
  const read = useRead();
  const router = useRouter();
  const update = (patch: Record<string, unknown>, msg?: string) =>
    ws
      .call("pages.update", { id: page._id, ...patch })
      .then(() => msg && toast.success(msg, { duration: 1500 }))
      .catch((e) => notifyError(e));
  const exportAs = async (format: "markdown" | "json") => {
    try {
      const res = await read<{ filename: string; content: string; mimeType: string }>("export.page", { id: page._id, format });
      download(res.filename, res.content, res.mimeType);
      toast.success(`Exported “${res.filename}”`);
    } catch (err) {
      notifyError(err, "Couldn't export the page.");
    }
  };
  const saveAsTemplate = async () => {
    try {
      const { template } = await ws.call<{ template: { _id: string } }>("templates.create", { fromPageId: page._id, databaseId: page.databaseId ?? undefined });
      toast.success(page.databaseId ? "Saved as a row template for this database" : "Saved as a template", { action: { label: "Edit template", onClick: () => router.push(`/p/${template._id}`) } });
    } catch (err) {
      notifyError(err, "Couldn't save the template.");
    }
  };
  const fav = !!page.favoriteRank;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Page options" size="md">
          <MoreHorizontal className="size-4" />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="w-64">
        <MenuLabel>Style</MenuLabel>
        <div className="flex items-center justify-between px-2 py-1 text-[13.5px]">
          <span className="inline-flex items-center gap-2"><MoveHorizontal className="size-4 text-fg-2" />Full width</span>
          <Switch checked={page.fullWidth} onCheckedChange={(v) => update({ fullWidth: v })} label="Full width" />
        </div>
        <div className="flex items-center justify-between px-2 py-1 text-[13.5px]">
          <span className="inline-flex items-center gap-2"><Type className="size-4 text-fg-2" />Small text</span>
          <Switch checked={page.smallText} onCheckedChange={(v) => update({ smallText: v })} label="Small text" />
        </div>
        <MenuCheckItem checked={page.locked} onCheckedChange={(v) => update({ locked: v }, v ? "Page locked. Unlock it here to edit." : "Page unlocked")} icon={page.locked ? <Lock /> : <Unlock />}>
          Lock page
        </MenuCheckItem>
        <MenuSeparator />
        {!page.isTemplate && (
          <MenuItem icon={fav ? <StarOff /> : <Star />} onSelect={() => ws.toggleFavorite(page._id, !fav)}>
            {fav ? "Remove from Favorites" : "Add to Favorites"}
          </MenuItem>
        )}
        <MenuItem icon={<Link2 />} onSelect={() => ws.copyLink(page._id)}>
          Copy link
        </MenuItem>
        <MenuItem icon={<Copy />} onSelect={() => ws.duplicatePage(page._id)}>
          Duplicate
        </MenuItem>
        {!page.databaseId && !page.isTemplate && (
          <MenuItem icon={<CornerUpRight />} onSelect={() => ws.setMoveTarget(page._id)}>
            Move to…
          </MenuItem>
        )}
        {!page.isTemplate && (
          <MenuItem icon={<LayoutTemplate />} onSelect={saveAsTemplate}>
            Save as template
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Download />} onSelect={() => exportAs("markdown")}>
          Export as Markdown
        </MenuItem>
        <MenuItem icon={<FileCode2 />} onSelect={() => exportAs("json")}>
          Export as JSON
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 />} danger onSelect={() => ws.archivePage(page._id)}>
          Move to trash
        </MenuItem>
        <MenuSeparator />
        <div className="grid gap-0.5 px-2 pb-1.5 pt-1 text-[11.5px] text-fg-3">
          {wordCount !== undefined && <span>{wordCount.toLocaleString("en")} words</span>}
          <span>Created {dateTime(page.createdAt)}</span>
          <span>Last edited {dateTime(page.updatedAt)}</span>
        </div>
      </MenuContent>
    </Menu>
  );
}
