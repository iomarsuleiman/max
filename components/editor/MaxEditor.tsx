"use client";

import "@blocknote/shadcn/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useUIMode,
} from "@blocknote/react";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { SyntaxHighlightingExtension } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/shadcn";
import { CalendarDays, Plus, Ellipsis, Check, Undo2, Redo2, Copy, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { PageIcon } from "@/components/workspace/PageIcon";
import { pageIdFromPath } from "@/lib/pageUrl";
import { EditorBridge, maxSchema, type EditorBridgeValue, type MaxEditorType } from "./blocks";
import { focusEditorEnd, isBlankEditorTarget } from "./focusEnd";
import { maxSlashItems, normalizeSearch, searchSlashItems } from "./slashMenu";
import { MaxSideMenuController, runBlockAction } from "./sideMenu";
import { announce } from "./announce";
import { fromEditorCodeLanguages, toEditorCodeLanguages } from "./codeLanguages";
import { blockDropTarget, handleBlockDrop } from "./dragFeedback";
import * as locales from "@blocknote/core/locales";
import { getMultiColumnSlashMenuItems, locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { formatMentionDate } from "./blocks";
import { checkFile, isBlockNoteClipboard, isLinkAllowed, normalizeEditorLinks, parseYouTube, sanitizeClipboardHtml, uploadProblemCopy } from "./policy";

export interface MaxEditorProps {
  initialContent: unknown[];
  editable: boolean;
  onChange: (blocks: unknown[]) => void;
  uploadFile: (file: File) => Promise<string>;
  resolveFileUrl: (url: string) => Promise<string>;
  onNotice: (message: string, tone?: "info" | "error") => void;
  onReady?: (editor: MaxEditorType) => void;
  onEditImage: (blockId: string, editor: MaxEditorType) => void;
  createSubpage: () => Promise<{ id: string; title: string } | null>;
  pages: EditorBridgeValue["pages"];
  navigate: (pageId: string) => void;
  /** Renders an inline database (or linked view) inside the page. */
  renderDatabase?: EditorBridgeValue["renderDatabase"];
  /** Creates a database inside this page for "/Database – inline". */
  createDatabase?: () => Promise<string | null>;
  density?: "comfortable" | "compact";
  font?: "default" | "serif" | "mono";
  smallText?: boolean;
  dir?: "auto" | "ltr" | "rtl";
  spellcheck?: boolean;
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export default function MaxEditor(props: MaxEditorProps) {
  const dark = useDarkMode();
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const [languages] = useState(() => toEditorCodeLanguages(props.initialContent));
  const lastRemovedLinks = useRef(0);

  const editor = useCreateBlockNote({
    schema: maxSchema,
    // Shiki loads the first time a code block needs coloring, not with every page.
    extensions: [SyntaxHighlightingExtension({ createHighlighter: () => import("./shiki").then((m) => m.createHighlighter()) })],
    dictionary: { ...locales.en, multi_column: multiColumnLocales.en } as never,
    domAttributes: { editor: { "aria-label": "Page content", "aria-multiline": "true" } },
    initialContent: languages.blocks.length ? (languages.blocks as never) : undefined,
    uploadFile: async (file: File) => {
      const problem = checkFile(file);
      if (problem) {
        const message = uploadProblemCopy[problem](file.name || "file");
        propsRef.current.onNotice(message, "error");
        throw new Error(message);
      }
      try {
        return await propsRef.current.uploadFile(file);
      } catch (err) {
        propsRef.current.onNotice(err instanceof Error && err.message ? err.message : "The image couldn't be uploaded. Check your connection and try again.", "error");
        throw err;
      }
    },
    resolveFileUrl: (url) => propsRef.current.resolveFileUrl(url),
    links: { isValidLink: isLinkAllowed },
    pasteHandler: ({ event, editor: target, defaultPasteHandler }) => {
      const data = event.clipboardData;
      const inCode = target.transact((tr) => !!(tr.selection.$from.parent.type.spec.code && tr.selection.$to.parent.type.spec.code));
      if (!data || inCode || isBlockNoteClipboard(data.types) || data.types.includes("vscode-editor-data") || data.types.includes("text/markdown") || !data.types.includes("text/html")) return defaultPasteHandler();
      const clean = sanitizeClipboardHtml(data.getData("text/html"));
      if (!clean.html.trim()) return defaultPasteHandler({ prioritizeMarkdownOverHTML: true });
      target.pasteHTML(clean.html);
      if (clean.removedImages || clean.removedMedia) {
        propsRef.current.onNotice(`${clean.removedImages + clean.removedMedia} pasted image or video item${clean.removedImages + clean.removedMedia === 1 ? " was" : "s were"} left out. Drag the image file in, or use /Image, so it's stored privately.`);
      }
      return true;
    },
    tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
    dropCursor: {
      width: 3,
      color: false,
      hooks: {
        computeDropPosition: ({ editor: view, event, defaultPosition }) => {
          const target = blockDropTarget(view as MaxEditorType, event.clientX, event.clientY);
          return target === undefined ? defaultPosition : target && { pos: target.pos, orientation: "block-horizontal" };
        },
      },
    },
  });

  useEffect(() => {
    props.onReady?.(editor);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const bridge = useMemo<EditorBridgeValue>(
    () => ({
      pages: props.pages,
      navigate: (id) => propsRef.current.navigate(id),
      editImage: (id) => propsRef.current.onEditImage(id, editor),
      renderDatabase: (id, readOnly) => propsRef.current.renderDatabase?.(id, readOnly) ?? null,
    }),
    [props.pages, editor],
  );

  const slashItems = () =>
    maxSlashItems(editor, getMultiColumnSlashMenuItems(editor) as never, {
      createDatabase: async () => {
        const id = await propsRef.current.createDatabase?.();
        if (id) insertOrUpdateBlockForSlashMenu(editor, { type: "databaseView", props: { databaseId: id } } as never);
      },
      linkDatabase: () => insertOrUpdateBlockForSlashMenu(editor, { type: "databaseView", props: { databaseId: "" } } as never),
      createSubpage: async () => {
        const page = await propsRef.current.createSubpage();
        if (!page) return;
        insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId: page.id } } as never);
        propsRef.current.navigate(page.id);
      },
      linkPage: () => {
        setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@"), 0);
      },
    });

  const mentionItems = (query: string) => {
    const q = normalizeSearch(query);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const dates: [string, Date][] = [["today", now], ["tomorrow", new Date(now.getTime() + 86_400_000)], ["yesterday", new Date(now.getTime() - 86_400_000)], ["next week", new Date(now.getTime() + 7 * 86_400_000)]];
    const typed = query.trim() && /\d/.test(query) ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(query.trim()) ? `${query.trim()}T00:00:00` : `${query} ${/\d{4}/.test(query) ? "" : now.getFullYear()}`) : null;
    const dateItems = [
      ...(typed && !Number.isNaN(typed.getTime()) ? [["date", typed] as [string, Date]] : []),
      ...dates.filter(([label]) => !q || label.startsWith(q)),
    ].map(([, d]) => ({
      title: formatMentionDate(iso(d)),
      subtext: d.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      icon: <CalendarDays size={16} />,
      group: "Date",
      onItemClick: () => editor.insertInlineContent([{ type: "dateMention", props: { date: iso(d) } } as never, " "]),
    }));
    const pageItems = [...propsRef.current.pages.entries()]
      .filter(([, p]) => !q || normalizeSearch(p.title || "untitled").includes(q))
      .slice(0, 12)
      .map(([id, p]) => ({
        title: p.title || "Untitled",
        icon: <PageIcon icon={p.icon} kind={p.kind} />,
        group: "Link to page",
        onItemClick: () => editor.insertInlineContent([{ type: "pageMention", props: { pageId: id, title: p.title } } as never, " "]),
      }));
    return [...pageItems, ...dateItems];
  };

  const dir = props.dir === "auto" || !props.dir ? undefined : props.dir;

  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <EditorBridge.Provider value={bridge}>
      {/* Blank-canvas clicks focus the end of the document; block shortcuts are handled here. */}
      <div
        ref={rootRef}
        className="lx-editor"
        dir={dir}
        spellCheck={props.spellcheck !== false}
        data-readonly={!props.editable || undefined}
        data-small={props.smallText || undefined}
        data-density={props.density === "compact" ? "compact" : undefined}
        data-font={props.font && props.font !== "default" ? props.font : undefined}
        onPointerDown={(event) => {
          if (!props.editable || event.button !== 0 || !isBlankEditorTarget(event.target)) return;
          event.preventDefault();
          focusEditorEnd(editor);
        }}
        onClickCapture={(event) => {
          // Internal page links open the page, like Notion (Cmd/Ctrl-click opens a new tab).
          const a = (event.target as HTMLElement).closest?.("a[href^='/p/']") as HTMLAnchorElement | null;
          if (!a || a.closest(".mx-pagelink, .mx-mention")) return;
          event.preventDefault();
          event.stopPropagation();
          const pageId = pageIdFromPath(a.getAttribute("href"));
          if (!pageId) return;
          if (event.metaKey || event.ctrlKey) window.open(`/p/${pageId}`, "_blank", "noopener");
          else propsRef.current.navigate(pageId);
        }}
        onDropCapture={(event) => {
          handleBlockDrop(editor, event);
        }}
        onKeyDownCapture={(event) => {
          if (!props.editable || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "d") return;
          if (!editor.isFocused()) return;
          event.preventDefault();
          const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
          runBlockAction(editor, "duplicate", blocks as never);
          announce("Duplicated");
        }}
      >
        <BlockNoteView
          editor={editor}
          editable={props.editable}
          theme={dark ? "dark" : "light"}
          slashMenu={false}
          formattingToolbar={false}
          sideMenu={false}
          onChange={() => {
            if (embedYouTubeVideos(editor)) return;
            const links = normalizeEditorLinks(editor.document as unknown[]);
            if (links.removed && links.removed !== lastRemovedLinks.current) {
              propsRef.current.onNotice(`${links.removed} link${links.removed === 1 ? "" : "s"} couldn't be kept (only web, email and page links are allowed). The text stays.`);
            }
            lastRemovedLinks.current = links.removed;
            propsRef.current.onChange(fromEditorCodeLanguages(links.blocks, languages.restore));
          }}
        >
          <SuggestionMenuController triggerCharacter="/" getItems={async (query) => searchSlashItems(slashItems(), query)} />
          <SuggestionMenuController triggerCharacter="@" getItems={async (query) => mentionItems(query)} />
          <FormattingToolbarController formattingToolbar={MaxFormattingToolbar} />
          <MaxSideMenuController dir={dir === "rtl" ? "rtl" : "ltr"} />
        </BlockNoteView>
      </div>
    </EditorBridge.Provider>
  );
}

/** Keep the touch row small; secondary formatting stays available without sideways hunting. */
function MaxFormattingToolbar() {
  const mode = useUIMode();
  const editor = useBlockNoteEditor(maxSchema);
  const Components = useComponentsContext()!;
  const [narrow, setNarrow] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const items = getFormattingToolbarItems();
  if (mode !== "mobile" && !narrow) return <FormattingToolbar>{items}</FormattingToolbar>;
  const primary = new Set(["blockTypeSelect", "boldStyleButton", "italicStyleButton"]);
  return (
    <div className="max-touch-formatting" data-expanded={more || undefined}>
      {more && <div className="max-touch-secondary" role="group" aria-label="More formatting">
        {items.filter((item) => !primary.has(String(item.key)))}
        <Components.FormattingToolbar.Button className="bn-button" label="Undo" mainTooltip="Undo" icon={<Undo2 size={18} />} onClick={() => editor.undo()} />
        <Components.FormattingToolbar.Button className="bn-button" label="Redo" mainTooltip="Redo" icon={<Redo2 size={18} />} onClick={() => editor.redo()} />
        {([
          { action: "duplicate", label: "Duplicate block", icon: <Copy size={18} /> },
          { action: "up", label: "Move block up", icon: <ArrowUp size={18} /> },
          { action: "down", label: "Move block down", icon: <ArrowDown size={18} /> },
          { action: "delete", label: "Delete block", icon: <Trash2 size={18} /> },
        ] as const).map(({ action, label, icon }) => <Components.FormattingToolbar.Button key={action} className="bn-button" label={label} mainTooltip={label} icon={icon} onClick={() => {
          const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
          runBlockAction(editor, action, blocks as never);
          announce(action === "delete" ? "Block deleted. Undo is available in More formatting." : label);
        }} />)}
      </div>}
      <FormattingToolbar>
        <MobileInsertButton />
        {items.filter((item) => primary.has(String(item.key)))}
        <Components.FormattingToolbar.Button className="bn-button" label="More formatting" mainTooltip="More formatting" icon={<Ellipsis size={20} />} isSelected={more} onClick={() => setMore(!more)} />
        <Components.FormattingToolbar.Button className="bn-button" label="Done editing" mainTooltip="Done editing" icon={<Check size={20} />} onClick={() => { setMore(false); editor.blur(); }} />
      </FormattingToolbar>
    </div>
  );
}

/** On phones the formatting toolbar sits above the keyboard; it starts with "+" to open the block menu. */
function MobileInsertButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor(maxSchema);
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Insert block"
      mainTooltip="Insert block"
      icon={<Plus size={18} />}
      onClick={() => {
        const block = editor.getTextCursorPosition().block;
        const empty = block.type === "paragraph" && Array.isArray(block.content) && block.content.length === 0;
        if (!empty) editor.setTextCursorPosition(editor.insertBlocks([{ type: "paragraph" }], block, "after")[0], "end");
        editor.getExtension(SuggestionMenu)?.openSuggestionMenu("/");
      }}
    />
  );
}

/** A YouTube link dropped into the generic video block becomes a YouTube block. */
function embedYouTubeVideos(editor: MaxEditorType): boolean {
  const found: { id: string; videoId: string; start?: number; caption: string }[] = [];
  const walk = (blocks: { id: string; type: string; props: Record<string, unknown>; children?: unknown[] }[]) => {
    for (const b of blocks) {
      const yt = b.type === "video" ? parseYouTube(String(b.props.url ?? "")) : null;
      if (yt) found.push({ id: b.id, videoId: yt.id, start: yt.start, caption: String(b.props.caption ?? "") });
      if (b.children?.length) walk(b.children as typeof blocks);
    }
  };
  walk(editor.document as never);
  if (!found.length) return false;
  queueMicrotask(() => {
    for (const v of found) if (editor.getBlock(v.id)) editor.replaceBlocks([v.id], [{ type: "youtube", props: { videoId: v.videoId, start: v.start ?? 0, caption: v.caption } } as never]);
  });
  return true;
}
