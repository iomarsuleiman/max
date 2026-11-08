/** Per-device conveniences in localStorage. Every access is guarded: storage can be unavailable. */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`max:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(`max:${key}`);
    else window.localStorage.setItem(`max:${key}`, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}
