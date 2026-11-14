/** Navigation-only utilities. No workspace IDs, permissions or user content are persisted. */
export function nextWorkspaceFocusIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (!Number.isSafeInteger(count) || count < 1 || current < 0 || current >= count) return null;
  switch (key) {
    case "ArrowDown": return (current + 1) % count;
    case "ArrowUp": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** Touch/pen dragging a navigation list must not accidentally follow a link.
 * Keyboard activation and ordinary taps retain native anchor semantics. */
export function isAccidentalWorkspaceSwitchGesture(
  pointerType: string,
  deltaX: number,
  deltaY: number,
): boolean {
  return (pointerType === "touch" || pointerType === "pen") &&
    Number.isFinite(deltaX) && Number.isFinite(deltaY) &&
    Math.hypot(deltaX, deltaY) >= 12;
}
