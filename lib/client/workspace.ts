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

let pending: string | null = null;
let navigate: ((path: string) => void) | null = null;

/** The app's router, so switching can load the new workspace's page (history alone doesn't). */
export function setWorkspaceNavigator(fn: ((path: string) => void) | null) {
  navigate = fn;
}

/** While switching: the path being opened (null once it's on screen). */
export const pendingPlace = () => pending;

export function arrived(path: string) {
  if (pending && pending === path) {
    pending = null;
    listeners.forEach((fn) => fn());
  }
}

export function onWorkspaceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const PLACE = "max:workspace-place:";

/** Remembers where you are in the open workspace, so coming back to it returns you there. */
export function rememberPlace(path: string) {
  // Mid-switch the address is still the old workspace's: don't file it under the new one.
  if (pending || !/^\/(p\/|graph|templates)/.test(path)) return;
  try {
    localStorage.setItem(PLACE + (activeWorkspace() ?? "main"), path);
  } catch {
    // Without storage, switching opens the workspace's last or first page.
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
 * last time (its first page the first time).
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
  // Load the new workspace's page through the router; until it arrives, the old workspace's page
  // (which doesn't exist here) isn't shown.
  if (window.location.pathname !== path.split("?")[0]) {
    pending = path.split("?")[0];
    if (navigate) navigate(path);
    else window.location.assign(path);
  }
  listeners.forEach((fn) => fn());
}
