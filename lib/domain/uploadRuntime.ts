import type { UploadRuntime } from "./uploads";

function randomHex() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashUploadCapability(capability: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Actions and Node only. Native mutations receive action-generated IDs instead. */
export function createUploadRuntime(): UploadRuntime {
  return {
    now: () => Date.now(),
    newId: () => `upload-${randomHex()}`,
    createCapability: () => `max-upload-v1.${randomHex()}`,
    hashCapability: hashUploadCapability,
  };
}
