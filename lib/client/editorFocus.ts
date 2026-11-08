/** Enter in a page title asks the editor for focus; if the editor isn't mounted yet, it takes it on mount. */
let pending: string | null = null;

export function requestEditorFocus(pageId: string) {
  pending = pageId;
  document.dispatchEvent(new CustomEvent("max:focus-editor", { detail: pageId }));
}

export function takeEditorFocusRequest(pageId: string): boolean {
  if (pending !== pageId) return false;
  pending = null;
  return true;
}
