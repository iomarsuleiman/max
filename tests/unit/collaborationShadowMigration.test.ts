import { describe, expect, it } from "vitest";
import fixture from "../fixtures/editor-document.json";
import { DOCUMENT_SCHEMA_VERSION, normalizeBlocks } from "@/lib/domain/blocks";
import { UnsafeCollaborationDocument } from "@/lib/domain/collaborationCodec";
import {
  MAX_SHADOW_BATCH_SIZE, compareShadowBatch, compareShadowDocument,
  rehearseShadowDocumentMigration,
} from "@/lib/domain/collaborationShadowMigration";
import type { DocumentRow, PageRow } from "@/lib/domain/types";
import { setup } from "./harness";

const makeDoc = (pageId: string, ownerId = "alice", revision = 17): DocumentRow => ({
  _id: "doc-" + pageId, ownerId, pageId,
  content: JSON.stringify(normalizeBlocks(fixture)),
  text: "مرحبا World", revision, schemaVersion: DOCUMENT_SCHEMA_VERSION, wordCount: 2, updatedAt: 2,
});

describe("Max 2.0 dry-run shadow document migration", () => {
  it("builds a deterministic, non-writing, reversible snapshot with exact source bytes", () => {
    const docs = [makeDoc("z"), makeDoc("a")];
    const before = JSON.stringify(docs);
    const first = rehearseShadowDocumentMigration(docs, "alice", "ws-a");
    const second = rehearseShadowDocumentMigration(docs, "alice", "ws-a");
    expect(first).toEqual(second);
    expect(first.dryRun).toBe(true);
    expect(first.candidates.map((item) => item.pageId)).toEqual(["a", "z"]);
    expect(first.candidates[0].originalContent).toBe(docs[1].content);
    expect(first.candidates[0].sourceRevision).toBe(17);
    expect(first.candidates[0].blockCount).toBeGreaterThan(20);
    expect(JSON.stringify(docs)).toBe(before);
    expect(compareShadowBatch(docs, first.candidates, "alice", "ws-a")).toBe(true);
    expect(compareShadowDocument(docs[0], first.candidates[1], "alice", "ws-a").canCutOver).toBe(false);
  });
  it("treats shadow candidate parity as NOT authorization to cut over", () => {
    const doc = makeDoc("p");
    const [candidate] = rehearseShadowDocumentMigration([doc], "alice", "workspace").candidates;
    expect(compareShadowDocument(doc, candidate, "alice", "workspace")).toEqual({
      equal: true, reason: null, sourceRevision: 17, canCutOver: false,
    });
  });
  it("rejects a stale source revision without replacing newer content", () => {
    const doc = makeDoc("p");
    const [candidate] = rehearseShadowDocumentMigration([doc], "alice", "ws").candidates;
    const updated = { ...doc, revision: 18 };
    expect(compareShadowDocument(updated, candidate, "alice", "ws")).toMatchObject({
      equal: false, reason: "Source revision or schema changed",
    });
  });
  it("rejects cross-owner and cross-workspace attempts", () => {
    const doc = makeDoc("p");
    expect(() => rehearseShadowDocumentMigration([doc], "bob", "ws")).toThrow(UnsafeCollaborationDocument);
    const [candidate] = rehearseShadowDocumentMigration([doc], "alice", "ws-a").candidates;
    expect(compareShadowDocument(doc, candidate, "bob", "ws-a").equal).toBe(false);
    expect(compareShadowDocument(doc, candidate, "alice", "ws-b").equal).toBe(false);
  });
  it("rejects source or shadow tampering, including custom block data", () => {
    const doc = makeDoc("p");
    const [candidate] = rehearseShadowDocumentMigration([doc], "alice", "ws").candidates;
    const changed = { ...candidate, shadowContent: candidate.shadowContent.replace("gold-paragraph", "mutated-paragraph") };
    expect(compareShadowDocument(doc, changed, "alice", "ws").equal).toBe(false);
    expect(compareShadowDocument(doc, { ...candidate, originalContent: "[]" }, "alice", "ws").equal).toBe(false);
    expect(compareShadowDocument(doc, { ...candidate, blockCount: 1 }, "alice", "ws").equal).toBe(false);
  });
  it("rejects duplicate source pages or document IDs atomically", () => {
    const a = makeDoc("p");
    expect(() => rehearseShadowDocumentMigration([a, { ...a, _id: "other" }], "alice", "ws")).toThrow(/Duplicated/i);
    expect(() => rehearseShadowDocumentMigration([a, a], "alice", "ws")).toThrow(/Duplicated/i);
  });
  it("rejects missing, extra or repeated candidates in a batch", () => {
    const docs = [makeDoc("a"), makeDoc("b")];
    const plan = rehearseShadowDocumentMigration(docs, "alice", "ws");
    expect(compareShadowBatch(docs, plan.candidates.slice(0, 1), "alice", "ws")).toBe(false);
    expect(compareShadowBatch(docs, [plan.candidates[0], plan.candidates[0]], "alice", "ws")).toBe(false);
    expect(compareShadowBatch(docs, [...plan.candidates, plan.candidates[0]], "alice", "ws")).toBe(false);
    expect(compareShadowBatch(docs, plan.candidates, "alice", "elsewhere")).toBe(false);
  });
  it("refuses unsupported schema, corrupt content and invalid identities", () => {
    const doc = makeDoc("p");
    expect(() => rehearseShadowDocumentMigration([{ ...doc, schemaVersion: 99 }], "alice", "ws")).toThrow(/schema/i);
    expect(() => rehearseShadowDocumentMigration([{ ...doc, content: "bad json" }], "alice", "ws")).toThrow(/JSON/i);
    expect(() => rehearseShadowDocumentMigration([doc], "", "ws")).toThrow(/identity/i);
  });
  it("enforces a bounded preflight batch before processing its documents", () => {
    const docs = Array.from({ length: MAX_SHADOW_BATCH_SIZE + 1 }, (_, i) => makeDoc("p" + i));
    expect(() => rehearseShadowDocumentMigration(docs, "alice", "ws")).toThrow(/batch/i);
  });
  it("reads real existing owner-only save rows and does not mutate their database", async () => {
    const { as, db } = setup();
    const user = as("alice");
    const { page } = await user<{ page: PageRow }>("pages.create", { title: "Owner-only editor" });
    await user("documents.save", { pageId: page._id, blocks: fixture, baseRevision: 1 });
    const [saved] = await db.list("documents", "alice", { field: "pageId", value: page._id });
    const before = db.snapshot();
    const plan = rehearseShadowDocumentMigration([saved], "alice", "future-workspace");
    expect(compareShadowDocument(saved, plan.candidates[0], "alice", "future-workspace").equal).toBe(true);
    expect(db.snapshot()).toBe(before);
  });
});
