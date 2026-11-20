import { importSourceOf } from "@/lib/client/importKinds";
import type { MaxEditorType } from "./blocks";

/** Markdown and web pages: dropped into a page, their content opens there as blocks. */
export const isTextFile = (file: File) => {
  const source = importSourceOf(file.name);
  return source === "markdown" || source === "html";
};

const blockTypeFor = (file: File) =>
  file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file";

/** The block under a point, and whether the drop is in its top or bottom half. */
function blockAt(editor: MaxEditorType, at: { x: number; y: number }) {
  const el = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-node-type='blockOuter'][data-id]");
  const block = el ? editor.getBlock(el.dataset.id!) : undefined;
  if (!el || !block) return null;
  const box = el.getBoundingClientRect();
  return { block, placement: (box.top + box.bottom) / 2 > at.y ? ("before" as const) : ("after" as const) };
}

/**
 * Puts dropped files into the page: Markdown and web pages as blocks, pictures, videos, audio and
 * other files as their own blocks that upload in place. At a point when dropped in the text,
 * otherwise at the end of the page.
 */
export async function insertDroppedFiles(editor: MaxEditorType, files: File[], at?: { x: number; y: number }) {
  const doc = editor.document;
  const target = at ? blockAt(editor, at) : null;
  let ref = target?.block ?? doc[doc.length - 1];
  let placement: "before" | "after" = target?.placement ?? "after";
  for (const file of files) {
    let blocks;
    if (isTextFile(file)) {
      const text = await file.text();
      blocks = importSourceOf(file.name) === "html" ? await editor.tryParseHTMLToBlocks(text.slice(0, 2_000_000)) : await editor.tryParseMarkdownToBlocks(text.slice(0, 400_000));
      if (!blocks.length) continue;
    } else {
      blocks = [{ type: blockTypeFor(file), props: { name: file.name } }];
    }
    const inserted = editor.insertBlocks(blocks as never, ref, placement);
    ref = inserted[inserted.length - 1];
    placement = "after";
    if (isTextFile(file) || !editor.uploadFile) continue;
    const id = inserted[0].id;
    // Uploads in the background; the block shows its loading state until the file is stored.
    void Promise.resolve(editor.uploadFile(file, id))
      .then((url) => {
        if (editor.getBlock(id)) editor.updateBlock(id, { props: { url: typeof url === "string" ? url : "" } } as never);
      })
      .catch(() => {
        if (editor.getBlock(id)) editor.removeBlocks([id]);
      });
  }
}
