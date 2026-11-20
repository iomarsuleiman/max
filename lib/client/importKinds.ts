export type ImportSource = "notion" | "markdown" | "html" | "max";

/** What a dropped or chosen file is, from its name: a Notion export, Markdown, a web page or a Max backup. */
export function importSourceOf(name: string): ImportSource | null {
  if (/\.zip$/i.test(name)) return "notion";
  if (/\.(md|markdown|txt)$/i.test(name)) return "markdown";
  if (/\.html?$/i.test(name)) return "html";
  if (/\.json$/i.test(name)) return "max";
  return null;
}

/** True for the files Max can open as pages (everything else dropped on a page is attached instead). */
export const isImportable = (file: { name: string }) => importSourceOf(file.name) !== null;

/** Sent to the open page's editor: put these files at the end of the page (pictures, attachments, Markdown). */
export const INSERT_FILES_EVENT = "max:insert-files";
