"use client";

/**
 * Which of your personal workspaces this browser has open. Every request carries it (`ws`).
 * Switching is instant: no reload. The app is remounted for the new workspace (so nothing from
 * the previous one lingers) while the connection to the server stays open.
 */
const KEY = "max:workspace";
const VALID = /^[a-z0-9]{8}$/;

function stored(): string | null {
  try {
    const id = localStorage.getItem(KEY);
    return id && VALID.test(id) ? id : null;
  } catch {
    return null;
  }
}

let current: string | null | undefined;
const listeners = new Set<() => void>();

export function activeWorkspace(): string | null {
  if (current === undefined) current = typeof window === "undefined" ? null : stored();
  return current;
}

export function wsArgs(): { ws?: string } {
  const id = activeWorkspace();
  return id ? { ws: id } : {};
}

export function onWorkspaceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Opens a workspace (null: your main one) at its home page, without reloading. */
export function switchWorkspace(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows without storage keep the choice for this tab only.
  }
  if (id === activeWorkspace()) return;
  current = id;
  // Next's router follows history.pushState, so the new workspace opens straight on Home.
  if (window.location.pathname !== "/home") window.history.pushState(null, "", "/home");
  listeners.forEach((fn) => fn());
}
