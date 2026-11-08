import { MemoryDb } from "@/lib/domain/memoryDb";
import { execute } from "@/lib/domain/ops";
import type { Storage } from "@/lib/domain/db";

export function setup() {
  const db = new MemoryDb();
  const files = new Map<string, string>();
  const storage: Storage = {
    async createUploadUrl() { return "/upload"; },
    async getUrl(id) { return files.has(id) ? `/files/${id}` : null; },
    async remove(id) { files.delete(id); },
  };
  let clock = Date.UTC(2026, 10, 8, 12);
  const as = (ownerId: string, source: "ui" | "mcp" = "ui") =>
    async function call<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
      clock += 1000;
      const ctx = { db, storage, ownerId, now: clock, source };
      return db.transaction(() => execute(op, args, ctx)) as Promise<T>;
    };
  return { db, files, storage, as };
}
