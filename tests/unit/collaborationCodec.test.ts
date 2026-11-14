import { describe, expect, it } from "vitest";
import fixture from "../fixtures/editor-document.json";
import { DOCUMENT_SCHEMA_VERSION, MAX_CONTENT_BYTES, normalizeBlocks } from "@/lib/domain/blocks";
import {
  COLLABORATIVE_EDITING_ENABLED, inspectLegacyContent, probeCollaborationCodec,
  UnsafeCollaborationDocument, type CollaborationCodec,
} from "@/lib/domain/collaborationCodec";

const raw = JSON.stringify(normalizeBlocks(fixture));
const codec: CollaborationCodec<string> = {
  candidate: "blocknote-yjs",
  encode: (blocks) => JSON.stringify(blocks),
  decode: (wire) => JSON.parse(wire) as unknown,
};

describe("Max 2.0 collaboration compatibility contract (read-only)", () => {
  it("retains the original bytes and the complete custom BlockNote fixture", () => {
    const verified = inspectLegacyContent(raw, DOCUMENT_SCHEMA_VERSION);
    expect(verified.raw).toBe(raw);
    expect(verified.blockTypes).toEqual(expect.arrayContaining(["table", "diagram", "databaseView", "columnList", "column", "equation", "pageLink"]));
    expect(verified.canonical).toBe(raw);
    expect(verified.blockIds).toContain("gold-left-text");
    expect(verified.blockIds).toContain("gold-table");
    expect(verified.blocks[0].content).toEqual(normalizeBlocks(fixture)[0].content);
  });
  it("accepts a fully lossless provider-neutral encode/decode probe", () => {
    const source = inspectLegacyContent(raw, DOCUMENT_SCHEMA_VERSION);
    expect(probeCollaborationCodec(source, codec)).toEqual({
      candidate: "blocknote-yjs", compatible: true, blockCount: source.blockIds.length, reason: null,
    });
  });
  it("rejects candidate conversions that erase custom data", () => {
    const source = inspectLegacyContent(raw, DOCUMENT_SCHEMA_VERSION);
    const result = probeCollaborationCodec(source, {
      candidate: "convex-prosemirror-sync" as const,
      encode: (blocks: readonly unknown[]) => blocks,
      decode: (blocks: readonly unknown[]) => blocks.filter((block) => (block as { type: string }).type !== "columnList"),
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/changed/i);
  });
  it("isolates a codec that mutates its input", () => {
    const source = inspectLegacyContent(raw, DOCUMENT_SCHEMA_VERSION);
    const before = source.raw;
    const result = probeCollaborationCodec(source, {
      candidate: "blocknote-yjs" as const,
      encode: (blocks: readonly { id: string }[]) => { blocks[0].id = "tampered"; return blocks; },
      decode: (blocks: readonly { id: string }[]) => blocks,
    });
    expect(result.compatible).toBe(false);
    expect(source.raw).toBe(before);
    expect(source.blockIds).toContain("gold-paragraph");
  });
  it.each(["{truncated", "null", "{}", "false"])("rejects broken or non-array JSON: %s", (value) => {
    expect(() => inspectLegacyContent(value, 1)).toThrow(UnsafeCollaborationDocument);
  });
  it("rejects a future schema version rather than silently reinterpreting it", () => {
    expect(() => inspectLegacyContent(raw, 2)).toThrow(/schema/i);
  });
  it("rejects duplicated and missing block identifiers without generating replacements", () => {
    const blocks = JSON.parse(raw) as { id: string; props: object; children: unknown[] }[];
    blocks[1].id = blocks[0].id;
    expect(() => inspectLegacyContent(JSON.stringify(blocks), 1)).toThrow(/Duplicate/i);
    delete (blocks[1] as { id?: string }).id;
    expect(() => inspectLegacyContent(JSON.stringify(blocks), 1)).toThrow(/Malformed/i);
  });
  it("preserves unknown custom block types and properties rather than stripping them", () => {
    const custom = [{ id: "unknown", type: "customFutureBlock", props: { direction: "rtl", extension: { k: [1, 2] } }, content: [], children: [] }];
    const document = JSON.stringify(custom);
    const source = inspectLegacyContent(document, 1);
    expect(source.canonical).toBe(document);
    expect(probeCollaborationCodec(source, codec).compatible).toBe(true);
  });
  it("rejects malformed table content and excessive nesting", () => {
    const table = [{ id: "t", type: "table", props: {}, content: { type: "tableContent", rows: [{ cells: [false] }] }, children: [] }];
    expect(() => inspectLegacyContent(JSON.stringify(table), 1)).toThrow(/Malformed/i);
    const root = { id: "depth-0", type: "paragraph", props: {}, children: [] as unknown[] };
    let current = root;
    for (let i = 1; i < 70; i++) {
      const child = { id: "depth-" + i, type: "paragraph", props: {}, children: [] as unknown[] };
      current.children.push(child);
      current = child;
    }
    expect(() => inspectLegacyContent(JSON.stringify([root]), 1)).toThrow(/depth/i);
  });
  it("rejects oversized UTF-8 documents, not only long ASCII strings", () => {
    const content = JSON.stringify([{ id: "long", type: "paragraph", props: {}, content: [{ type: "text", text: "ع".repeat(MAX_CONTENT_BYTES), styles: {} }], children: [] }]);
    expect(() => inspectLegacyContent(content, 1)).toThrow(/size/i);
  });
  it("keeps collaboration disabled even when a codec passes", () => {
    expect(COLLABORATIVE_EDITING_ENABLED).toBe(false);
  });
});
