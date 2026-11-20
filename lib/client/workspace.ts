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

const PLACE = "max:workspace-place:";

/** Remembers where you are in the open workspace, so coming back to it returns you there. */
export function rememberPlace(path: string) {
  if (!/^\/(home|p\/|graph|templates)/.test(path)) return;
  try {
    localStorage.setItem(PLACE + (activeWorkspace() ?? "main"), path);
  } catch {
    // Without storage, switching opens Home.
  }
}

function placeIn(id: string | null): string {
  try {
    return localStorage.getItem(PLACE + (id ?? "main")) ?? "/home";
  } catch {
    return "/home";
  }
}

/**
 * Opens a workspace (null: your main one) without reloading: at `path`, or wherever you were in it
 * last time (Home the first time).
 */
export function switchWorkspace(id: string | null, path?: string) {
  path ??= placeIn(id);
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows without storage keep the choice for this tab only.
  }
  if (id === activeWorkspace()) return;
  current = id;
  // Next's router follows history.pushState, so the new workspace opens straight on Home.
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
  listeners.forEach((fn) => fn());
}
