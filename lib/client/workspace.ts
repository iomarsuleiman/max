"use client";

/**
 * Which of your personal workspaces this browser has open. Every request carries it (`ws`), and
 * switching reloads the app so nothing from the previous workspace lingers on screen.
 */
const KEY = "max:workspace";
const VALID = /^[a-z0-9]{8}$/;

export function activeWorkspace(): string | null {
  try {
    const id = localStorage.getItem(KEY);
    return id && VALID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function wsArgs(): { ws?: string } {
  const id = activeWorkspace();
  return id ? { ws: id } : {};
}

/** Opens a workspace (null: your main one) at its home page. */
export function switchWorkspace(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows without storage stay in the main workspace.
  }
  window.location.assign("/home");
}
