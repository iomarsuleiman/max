/** Lets other UI (page history) ask an open editor to save pending edits before acting. */
export function requestSaveFlush(pageId: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    document.dispatchEvent(new CustomEvent("max:flush-save", { detail: { pageId, done: finish } }));
    // No editor open for this page (or it's slow): don't block forever.
    setTimeout(finish, timeoutMs);
    queueMicrotask(() => {
      if (!(window as { __maxEditors?: Set<string> }).__maxEditors?.has(pageId)) finish();
    });
  });
}

export function registerEditor(pageId: string, onFlush: () => Promise<void>) {
  const w = window as { __maxEditors?: Set<string> };
  w.__maxEditors ??= new Set();
  w.__maxEditors.add(pageId);
  const listener = (e: Event) => {
    const { pageId: id, done } = (e as CustomEvent<{ pageId: string; done: () => void }>).detail;
    if (id === pageId) void onFlush().finally(done);
  };
  document.addEventListener("max:flush-save", listener);
  return () => {
    w.__maxEditors?.delete(pageId);
    document.removeEventListener("max:flush-save", listener);
  };
}
