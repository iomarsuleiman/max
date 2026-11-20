"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useUploader } from "@/lib/client/upload";
import { INSERT_FILES_EVENT, importSourceOf } from "@/lib/client/importKinds";
import { notifyError, useWorkspace } from "@/components/workspace/context";


const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
const inEditor = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".bn-editor[contenteditable='true']");
/** Notion exports and Max backups always open as their own pages, even when dropped on a page. */
const opensOnItsOwn = (file: File) => {
  const source = importSourceOf(file.name);
  return source === "notion" || source === "max";
};

/**
 * Drop files anywhere in Max. A Markdown file, web page, Notion export (.zip) or Max backup (.json)
 * opens as a page (on Templates it becomes a template). Pictures and other files dropped on a page
 * go into it; inside the text they land where you drop them.
 */
export function FileDrop() {
  const ws = useWorkspace();
  const upload = useUploader();
  const router = useRouter();
  const pathname = usePathname();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const depth = useRef(0);
  const live = useRef({ ws, upload, router, pathname });
  useEffect(() => {
    live.current = { ws, upload, router, pathname };
  });

  useEffect(() => {
    const leave = () => {
      depth.current = 0;
      setOver(false);
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(!inEditor(e.target));
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this the browser opens the file itself and Max is gone.
      e.preventDefault();
      setOver(!inEditor(e.target));
      setSidebar(!!(e.target as Element | null)?.closest?.("[data-sidebar]"));
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      leave();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const own = files.filter(opensOnItsOwn);
      // Inside the page's text the editor places everything else where it was dropped.
      if (inEditor(e.target) && !own.length) return;
      e.preventDefault();
      e.stopPropagation();
      const { pathname: path } = live.current;
      // Dropped on the sidebar, a file always opens as its own page.
      const onSidebar = !!(e.target as Element | null)?.closest?.("[data-sidebar]");
      const onPage = !onSidebar && /^\/p\//.test(path) && !!document.querySelector(".bn-editor[contenteditable='true']");
      const templates = path.startsWith("/templates");
      // On a page, Markdown, web pages and pictures go into it; elsewhere Markdown and web pages open as new pages.
      const toImport = onPage && !templates ? own : files.filter((f) => importSourceOf(f.name));
      const toPage = files.filter((f) => !toImport.includes(f));
      if (toPage.length) {
        if (onPage) window.dispatchEvent(new CustomEvent(INSERT_FILES_EVENT, { detail: { files: toPage }, cancelable: true }));
        else toast(toPage.length === 1 ? `Open a page to add “${toPage[0].name}” to it.` : "Open a page to add these files to it.");
      }
      if (toImport.length) void run(toImport, templates);
    };
    const run = async (files: File[], asTemplates: boolean) => {
      const { ws: w, upload: up, router: r } = live.current;
      setBusy(files.length === 1 ? `Opening ${files[0].name}…` : `Opening ${files.length} files…`);
      try {
        const { importFiles } = await import("@/lib/client/importFiles");
        const res = await importFiles(w.call, up, files, { asTemplates, onProgress: setBusy });
        if (asTemplates) toast.success(res.pages === 1 ? "Added to your templates" : `Added ${res.pages} templates`);
        else if (res.firstId) r.push(`/p/${res.firstId}`);
        else if (res.pages) toast.success(`Restored ${res.pages} page${res.pages === 1 ? "" : "s"}`);
      } catch (err) {
        notifyError(err, "That file couldn't be opened.");
      } finally {
        setBusy(null);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", leave);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragend", leave);
    };
  }, []);

  const onTemplates = pathname.startsWith("/templates");
  const onPage = pathname.startsWith("/p/") && !sidebar;
  if (!over && !busy) return null;
  return (
    <div className="max-filedrop" data-busy={busy ? "" : undefined} role="status" aria-live="polite">
      <div className="max-filedrop-card">
        {busy ?? (onTemplates ? "Drop to add as a template" : onPage ? "Drop to add to this page" : "Drop to open in Max")}
        {!busy && <span>{onTemplates ? "Markdown, web pages and Notion exports" : onPage ? "Pictures, files and Markdown" : "Markdown, web pages, Notion exports and Max backups"}</span>}
      </div>
    </div>
  );
}
