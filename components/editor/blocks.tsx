"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Select } from "@/components/ui";
import "katex/dist/katex.min.css";
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
  imageParse,
} from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec, ResizableFileBlockWrapper, SourceBlockWithPreview, useEditorChange, useResolveUrl } from "@blocknote/react";
import { CODE_LANGUAGES } from "./codeLanguages";
import { AlertTriangle, FileText, Globe, Image as ImageIcon, Info, Lightbulb, Link2, ListTree, Octagon, PlayCircle, Sheet, Star, StickyNote, Video } from "lucide-react";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import Diagram from "./Diagram";
import { EMBED_PROVIDERS, toEmbed } from "./embeds";
import { PageIcon } from "@/components/workspace/PageIcon";
import { isolatedBlock } from "./EditorErrorBoundary";
import { formatTimestamp, normalizeLink, parseTimestamp, parseYouTube } from "./policy";

/* Blocks for the Max editor. Callout, equation, image, YouTube and diagram come from the Chaos
   editor; page links, mentions, bookmarks and the table of contents are Max's own. */

const createIsolatedBlockSpec = ((config: never, implementation: { render: React.ComponentType<never> }) =>
  createReactBlockSpec(config, { ...implementation, render: isolatedBlock(implementation.render) } as never)) as unknown as typeof createReactBlockSpec;

export interface PageRef {
  title: string;
  icon: string | null;
  kind: string;
}

/** What blocks need from the workspace around them. */
export interface EditorBridgeValue {
  pages: Map<string, PageRef>;
  navigate: (pageId: string) => void;
  editImage: (blockId: string) => void;
  renderDatabase: (databaseId: string, readOnly: boolean) => React.ReactNode;
}
export const EditorBridge = createContext<EditorBridgeValue>({ pages: new Map(), navigate: () => {}, editImage: () => {}, renderDatabase: () => null });

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/* ── Callout ─────────────────────────────────────────────────────────────── */

export const CALLOUT_TONES = ["info", "tip", "warning", "danger", "key", "note"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
const calloutIcon: Record<CalloutTone, typeof Info> = { info: Info, tip: Lightbulb, warning: AlertTriangle, danger: Octagon, key: Star, note: StickyNote };
const toneName: Record<CalloutTone, string> = { info: "Note", tip: "Tip", warning: "Caution", danger: "Important", key: "Key point", note: "Plain" };

export const Callout = createReactBlockSpec(
  { type: "callout", propSchema: { tone: { default: "info", values: CALLOUT_TONES } }, content: "inline" },
  {
    render: function CalloutBlock({ block, editor, contentRef }) {
      const tone = block.props.tone as CalloutTone;
      const Icon = calloutIcon[tone] ?? Info;
      const next = CALLOUT_TONES[(CALLOUT_TONES.indexOf(tone) + 1) % CALLOUT_TONES.length];
      return (
        <div className="lx-callout" data-tone={tone}>
          <button
            type="button"
            contentEditable={false}
            className="lx-callout__icon"
            disabled={!editor.isEditable}
            aria-label={`Callout style: ${toneName[tone]}`}
            title={`${toneName[tone]} → ${toneName[next]}`}
            onClick={() => editor.updateBlock(block, { props: { tone: next } })}
          >
            <Icon size={18} aria-hidden />
          </button>
          <div className="lx-callout__body" ref={contentRef} />
        </div>
      );
    },
  },
);

/* ── Equation (LaTeX via KaTeX) ──────────────────────────────────────────── */

// KaTeX (~75 KB) loads the first time a page shows an equation, not with every page.
let katex: typeof import("katex").default | null = null;
let katexLoading: Promise<void> | null = null;
function loadKatex() {
  katexLoading ??= import("katex").then((m) => {
    katex = m.default;
  });
  return katexLoading;
}
function useKatex() {
  const [ready, setReady] = useState(() => katex !== null);
  useEffect(() => {
    if (!ready) void loadKatex().then(() => setReady(true));
  }, [ready]);
  return ready;
}

export function renderMath(source: string, display = true): { html: string; error?: string } {
  if (!katex) return { html: "" };
  try {
    return { html: katex.renderToString(source, { displayMode: display, throwOnError: true, output: "htmlAndMathml", strict: "ignore", trust: false }) };
  } catch (err) {
    return { html: "", error: err instanceof Error ? err.message : String(err) };
  }
}

export const Equation = createReactBlockSpec(
  { type: "equation", propSchema: {}, content: "plain" },
  {
    meta: { hasPreview: true, code: true },
    render: function EquationBlock({ block, editor, contentRef }) {
      const source = Array.isArray(block.content) ? block.content.map((c) => ("text" in c ? c.text : "")).join("") : "";
      const ready = useKatex();
      const rendered = useMemo(() => (ready && source.trim() ? renderMath(source) : { html: "" }), [source, ready]);
      const [lastGood, setLastGood] = useState(rendered.html);
      useEffect(() => {
        if (rendered.html) setLastGood(rendered.html);
      }, [rendered.html]);
      const preview = rendered.html || lastGood ? <span className="lx-math" dangerouslySetInnerHTML={{ __html: rendered.html || lastGood }} /> : undefined;
      return (
        <SourceBlockWithPreview
          block={block}
          editor={editor}
          contentRef={contentRef}
          source={source}
          preview={preview}
          error={rendered.error ? <span role="alert">This equation has an error. {rendered.error}</span> : undefined}
          emptySourcePlaceholder="Add an equation"
          sourcePlaceholder="LaTeX, e.g. \frac{a}{b}"
        />
      );
    },
  },
);

/* ── Image with alt text ─────────────────────────────────────────────────── */

const FileWrapper = ResizableFileBlockWrapper as unknown as React.FC<Record<string, unknown> & { buttonIcon: React.ReactNode; children: React.ReactNode }>;

export const MaxImage = createReactBlockSpec(
  {
    type: "image",
    content: "none",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      backgroundColor: defaultProps.backgroundColor,
      name: { default: "" },
      url: { default: "" },
      caption: { default: "" },
      showPreview: { default: true },
      previewWidth: { default: undefined, type: "number" },
      alt: { default: "" },
    },
  },
  {
    meta: { fileBlockAccept: ["image/*"] },
    parse: imageParse({}) as never,
    runsBefore: ["file"],
    render: function ImageBlock(props) {
      const bridge = useContext(EditorBridge);
      const { block } = props;
      const resolved = useResolveUrl(block.props.url);
      const editable = props.editor.isEditable;
      return (
        <FileWrapper {...(props as object)} buttonIcon={<ImageIcon size={24} />}>
          <figure className="lx-figure">
            <img
              className="bn-visual-media"
              src={resolved.loadingState === "loading" ? undefined : resolved.downloadUrl}
              alt={block.props.alt}
              width={block.props.previewWidth}
              loading="lazy"
              decoding="async"
              contentEditable={false}
              draggable={false}
            />
            {editable && (
              <button type="button" contentEditable={false} className="lx-figure__alt" data-missing={!block.props.alt || undefined} onClick={() => bridge.editImage(block.id)}>
                {block.props.alt ? `Alt: ${block.props.alt}` : "Add a description for screen readers"}
              </button>
            )}
          </figure>
        </FileWrapper>
      );
    },
  },
);

/* ── YouTube (watch range, privacy-enhanced) ─────────────────────────────── */

export const YouTube = createIsolatedBlockSpec(
  { type: "youtube", content: "none", propSchema: { videoId: { default: "" }, url: { default: "" }, start: { default: 0 }, end: { default: 0 }, caption: { default: "" }, title: { default: "" } } },
  {
    render: function YouTubeBlock({ block, editor }) {
      const [link, setLink] = useState("");
      const [error, setError] = useState("");
      const [from, setFrom] = useState(block.props.start ? formatTimestamp(block.props.start) : "");
      const [to, setTo] = useState(block.props.end ? formatTimestamp(block.props.end) : "");
      const editable = editor.isEditable;
      if (!block.props.videoId) {
        if (!editable) return <div className="lx-embed-empty" contentEditable={false}><Video size={18} aria-hidden /> YouTube</div>;
        return (
          <form
            className="lx-embed-input"
            contentEditable={false}
            onKeyDown={stop}
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseYouTube(link);
              if (!parsed) return setError("That isn't a YouTube link. Copy it from the Share button on YouTube.");
              editor.updateBlock(block, { props: { videoId: parsed.id, url: link.trim(), start: parsed.start ?? 0 } });
            }}
          >
            <PlayCircle size={18} aria-hidden />
            <input
              type="url"
              inputMode="url"
              placeholder="Paste a YouTube link and press Enter"
              aria-label="YouTube link"
              value={link}
              onChange={(e) => (setLink(e.target.value), setError(""))}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                const parsed = parseYouTube(text);
                if (parsed) {
                  e.preventDefault();
                  editor.updateBlock(block, { props: { videoId: parsed.id, url: text.trim(), start: parsed.start ?? 0 } });
                }
              }}
            />
            {error && <span role="alert" className="lx-embed-input__error">{error}</span>}
          </form>
        );
      }
      const commit = () => {
        const start = from.trim() ? parseTimestamp(from) : 0;
        const end = to.trim() ? parseTimestamp(to) : 0;
        if (start === null || end === null) return setError("Use minutes:seconds, like 1:30.");
        if (end && end <= start) return setError("The end must be after the start.");
        setError("");
        editor.updateBlock(block, { props: { start, end } });
      };
      const range = block.props.start || block.props.end ? `${formatTimestamp(block.props.start)}–${block.props.end ? formatTimestamp(block.props.end) : "…"}` : "";
      const href = `https://www.youtube.com/watch?v=${block.props.videoId}${block.props.start ? `&t=${block.props.start}` : ""}`;
      return (
        <div className="lx-youtube" contentEditable={false}>
          <div className="lx-youtube__frame">
            <img src={`https://i.ytimg.com/vi/${block.props.videoId}/hqdefault.jpg`} alt="" loading="lazy" />
            <a className="lx-youtube__launch" href={href} target="_blank" rel="noreferrer noopener" aria-label="Watch on YouTube">
              <PlayCircle size={42} aria-hidden />
            </a>
            {range && <span className="lx-youtube__range">Watch {range}</span>}
          </div>
          {editable ? (
            <div className="lx-youtube__fields" onKeyDown={stop}>
              <label><span>From</span><input value={from} placeholder="0:00" onChange={(e) => setFrom(e.target.value)} onBlur={commit} inputMode="numeric" /></label>
              <label><span>To</span><input value={to} placeholder="—" onChange={(e) => setTo(e.target.value)} onBlur={commit} inputMode="numeric" /></label>
              <input className="lx-youtube__caption" defaultValue={block.props.caption} placeholder="Caption (optional)" aria-label="Caption" onBlur={(e) => e.target.value !== block.props.caption && editor.updateBlock(block, { props: { caption: e.target.value.slice(0, 300) } })} />
              {error && <span role="alert" className="lx-embed-input__error">{error}</span>}
            </div>
          ) : (
            block.props.caption && <p className="lx-caption">{block.props.caption}</p>
          )}
        </div>
      );
    },
  },
);

/* ── Diagram (Mermaid) ───────────────────────────────────────────────────── */

export const DiagramBlock = createIsolatedBlockSpec(
  { type: "diagram", content: "none", propSchema: { text: { default: "flowchart LR\n  A[Idea] --> B[Draft] --> C[Done]" } } },
  {
    render: function DiagramRender({ block, editor }) {
      if (!editor.isEditable) return <div contentEditable={false} className="w-full"><Diagram text={block.props.text} /></div>;
      return (
        <div className="mx-diagram-edit" contentEditable={false} onKeyDown={stop}>
          <Diagram text={block.props.text} />
          <label className="grid gap-1 text-xs text-fg-3">
            Mermaid source
            <textarea dir="ltr" rows={Math.min(10, Math.max(3, block.props.text.split("\n").length))} maxLength={20000} spellCheck={false} value={block.props.text} onChange={(e) => editor.updateBlock(block, { props: { text: e.target.value } })} />
          </label>
        </div>
      );
    },
  },
);

/* ── Page link block (subpages) ──────────────────────────────────────────── */

export const PageLinkBlock = createIsolatedBlockSpec(
  { type: "pageLink", content: "none", propSchema: { pageId: { default: "" } } },
  {
    render: function PageLinkRender({ block }) {
      const bridge = useContext(EditorBridge);
      const page = bridge.pages.get(block.props.pageId);
      const Icon = page?.kind === "database" ? Sheet : FileText;
      return (
        <a
          href={`/p/${block.props.pageId}`}
          contentEditable={false}
          className="mx-pagelink"
          data-missing={!page || undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            bridge.navigate(block.props.pageId);
          }}
        >
          <span className="mx-pagelink__icon">{page?.icon ? <PageIcon icon={page.icon} size={18} /> : <Icon size={18} strokeWidth={1.75} aria-hidden />}</span>
          <span className="mx-pagelink__title">{page ? page.title || "Untitled" : "Page in trash or deleted"}</span>
        </a>
      );
    },
  },
);

/* ── Bookmark (web link card) ────────────────────────────────────────────── */

export const BookmarkBlock = createIsolatedBlockSpec(
  { type: "bookmark", content: "none", propSchema: { url: { default: "" }, title: { default: "" } } },
  {
    render: function BookmarkRender({ block, editor }) {
      const [value, setValue] = useState("");
      const [error, setError] = useState("");
      if (!block.props.url) {
        if (!editor.isEditable) return <div className="lx-embed-empty" contentEditable={false}><Globe size={18} aria-hidden /> Bookmark</div>;
        return (
          <form
            className="lx-embed-input"
            contentEditable={false}
            onKeyDown={stop}
            onSubmit={(e) => {
              e.preventDefault();
              const href = normalizeLink(value);
              if (!href || !/^https?:/.test(href)) return setError("Enter a web address, like example.com/article.");
              let title = "";
              try {
                title = new URL(href).hostname.replace(/^www\./, "");
              } catch {}
              editor.updateBlock(block, { props: { url: href, title } });
            }}
          >
            <Link2 size={18} aria-hidden />
            <input type="url" inputMode="url" placeholder="Paste a link and press Enter" aria-label="Bookmark link" value={value} onChange={(e) => (setValue(e.target.value), setError(""))} />
            {error && <span role="alert" className="lx-embed-input__error">{error}</span>}
          </form>
        );
      }
      let host = block.props.url;
      try {
        host = new URL(block.props.url).hostname.replace(/^www\./, "");
      } catch {}
      return (
        <a className="mx-bookmark" href={block.props.url} target="_blank" rel="noreferrer noopener" contentEditable={false}>
          <span className="mx-bookmark__body">
            {editor.isEditable ? (
              <input
                className="w-full bg-transparent text-[14px] font-medium outline-none"
                defaultValue={block.props.title || host}
                aria-label="Bookmark title"
                onClick={(e) => e.preventDefault()}
                onKeyDown={stop}
                onBlur={(e) => e.target.value !== block.props.title && editor.updateBlock(block, { props: { title: e.target.value.slice(0, 300) } })}
              />
            ) : (
              <span className="text-[14px] font-medium">{block.props.title || host}</span>
            )}
            <span className="mx-bookmark__url">
              <Globe size={12} className="me-1 inline" aria-hidden />
              {block.props.url}
            </span>
          </span>
        </a>
      );
    },
  },
);

/* ── Table of contents ───────────────────────────────────────────────────── */

export const TocBlock = createIsolatedBlockSpec(
  { type: "toc", content: "none", propSchema: {} },
  {
    render: function TocRender({ editor }) {
      const read = () =>
        (editor.document as { id: string; type: string; props: { level?: number }; content?: unknown }[])
          .filter((b) => b.type === "heading")
          .map((b) => ({ id: b.id, level: Number(b.props.level ?? 1), text: Array.isArray(b.content) ? (b.content as { text?: string }[]).map((c) => c.text ?? "").join("") : "" }));
      const [headings, setHeadings] = useState(read);
      useEditorChange(() => setHeadings(read()), editor);
      return (
        <nav className="mx-toc" contentEditable={false} aria-label="Table of contents">
          {headings.length ? (
            headings.map((h) => (
              <a
                key={h.id}
                data-level={h.level}
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.querySelector(`[data-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {h.text || "Untitled heading"}
              </a>
            ))
          ) : (
            <span className="mx-toc__empty">
              <ListTree size={14} className="me-1 inline" aria-hidden />
              Add headings to build a table of contents.
            </span>
          )}
        </nav>
      );
    },
  },
);

/* ── Inline page mention (@) ─────────────────────────────────────────────── */

export const PageMention = createReactInlineContentSpec(
  { type: "pageMention", propSchema: { pageId: { default: "" }, title: { default: "" } }, content: "none" },
  {
    render: function MentionChip({ inlineContent }) {
      const bridge = useContext(EditorBridge);
      const page = bridge.pages.get(inlineContent.props.pageId);
      return (
        <a
          href={`/p/${inlineContent.props.pageId}`}
          className="mx-mention"
          contentEditable={false}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            bridge.navigate(inlineContent.props.pageId);
          }}
        >
          {page?.icon ? <PageIcon icon={page.icon} size={14} className="self-center" /> : <FileText size={14} className="self-center" aria-hidden />}
          {page ? page.title || "Untitled" : inlineContent.props.title || "Deleted page"}
        </a>
      );
    },
  },
);

/* ── Embed (allow-listed services) ────────────────────────────────────────── */

export const EmbedBlock = createIsolatedBlockSpec(
  { type: "embed", content: "none", propSchema: { url: { default: "" } } },
  {
    render: function EmbedRender({ block, editor }) {
      const [value, setValue] = useState("");
      const [error, setError] = useState("");
      const embed = block.props.url ? toEmbed(block.props.url) : null;
      if (!embed) {
        if (!editor.isEditable) return <div className="lx-embed-empty" contentEditable={false}><Globe size={18} aria-hidden /> Embed</div>;
        return (
          <form
            className="lx-embed-input"
            contentEditable={false}
            onKeyDown={stop}
            onSubmit={(e) => {
              e.preventDefault();
              if (!toEmbed(value)) return setError(`Paste a link from ${EMBED_PROVIDERS}. For other sites, use a web bookmark.`);
              editor.updateBlock(block, { props: { url: value.trim() } });
            }}
          >
            <Globe size={18} aria-hidden />
            <input type="url" inputMode="url" placeholder="Paste a link to embed and press Enter" aria-label="Link to embed" value={value} onChange={(e) => (setValue(e.target.value), setError(""))} />
            {error && <span role="alert" className="lx-embed-input__error">{error}</span>}
          </form>
        );
      }
      return (
        <figure className="mx-embed" contentEditable={false} style={{ ["--aspect" as string]: String(embed.aspect) }}>
          <iframe
            src={embed.src}
            title={`${embed.provider} embed`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
          <figcaption>
            <a href={block.props.url} target="_blank" rel="noreferrer noopener">{embed.provider}</a>
          </figcaption>
        </figure>
      );
    },
  },
);

/* ── Inline database (or a linked view of one) ───────────────────────────── */

export const DatabaseBlock = createIsolatedBlockSpec(
  { type: "databaseView", content: "none", propSchema: { databaseId: { default: "" } } },
  {
    render: function DatabaseBlockRender({ block, editor }) {
      const bridge = useContext(EditorBridge);
      if (!block.props.databaseId) {
        return (
          <div className="lx-embed-input" contentEditable={false} onKeyDown={stop}>
            <Sheet size={18} aria-hidden />
            <span className="text-[13px]">Choose a database to show here:</span>
            <Select
              label="Database"
              size="sm"
              variant="filled"
              value=""
              placeholder="Select…"
              disabled={!editor.isEditable}
              onChange={(id) => id && editor.updateBlock(block, { props: { databaseId: id } })}
              options={[...bridge.pages.entries()].filter(([, p]) => p.kind === "database").map(([id, p]) => ({ value: id, label: p.title || "Untitled", icon: <PageIcon icon={p.icon} kind="database" size={15} /> }))}
            />
          </div>
        );
      }
      return (
        <div className="mx-inline-db" contentEditable={false} onKeyDown={stop} onPaste={(e) => e.stopPropagation()} onCopy={(e) => e.stopPropagation()}>
          {bridge.renderDatabase(block.props.databaseId, !editor.isEditable)}
        </div>
      );
    },
  },
);

/* ── Date mention (@today) ───────────────────────────────────────────────── */

export function formatMentionDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en", { month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export const DateMention = createReactInlineContentSpec(
  { type: "dateMention", propSchema: { date: { default: "" } }, content: "none" },
  {
    render: function DateChip({ inlineContent }) {
      return (
        <time className="mx-date" dateTime={inlineContent.props.date} title={inlineContent.props.date}>
          @{formatMentionDate(inlineContent.props.date)}
        </time>
      );
    },
  },
);

/* ── Schema ──────────────────────────────────────────────────────────────── */

export const maxSchema = withMultiColumn(BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: true }),
    codeBlock: createCodeBlockSpec({ defaultLanguage: "javascript", supportedLanguages: CODE_LANGUAGES }),
    image: MaxImage(),
    callout: Callout(),
    equation: Equation(),
    youtube: YouTube(),
    diagram: DiagramBlock(),
    pageLink: PageLinkBlock(),
    bookmark: BookmarkBlock(),
    toc: TocBlock(),
    embed: EmbedBlock(),
    databaseView: DatabaseBlock(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageMention: PageMention, dateMention: DateMention },
}));

export type MaxSchema = typeof maxSchema;
export type MaxEditorType = typeof maxSchema.BlockNoteEditor;
