import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { compareSnapshots, inventorySnapshot } from "../../scripts/cloud-recovery-verify.mjs";

const jsonl = (rows) => strToU8(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
const source = () => ({
  "README.md": strToU8("Convex snapshot export instructions"),
  "_tables/documents.jsonl": jsonl([
    { name: "pages", id: 10010 },
    { name: "documents", id: 10004 },
  ]),
  "pages/documents.jsonl": jsonl([
    { _id: "page1", ownerId: "one", title: "العربية", parentId: null },
    { _id: "page2", ownerId: "two", title: "Private", parentId: null },
  ]),
  "documents/documents.jsonl": jsonl([{ _id: "doc1", pageId: "page1", revision: 9, content: '[{"id":"stable-block","type":"paragraph"}]' }]),
  "assets/documents.jsonl": jsonl([{ _id: "asset1", storageId: "file1", pageId: "page1" }]),
  "_storage/documents.jsonl": jsonl([{ _id: "file1", contentType: "application/octet-stream", size: 6 }]),
  "_storage/file1": new Uint8Array([0, 255, 128, 10, 13, 42]),
  "documents/generated_schema.jsonl": jsonl([{ field: "revision", type: "number" }]),
});

test("verifies exact IDs, revisions, content and attachment bytes while ignoring row/key ordering", () => {
  const original = source();
  const restored = source();
  restored["pages/documents.jsonl"] = jsonl([
    { title: "Private", parentId: null, ownerId: "two", _id: "page2" },
    { parentId: null, title: "العربية", ownerId: "one", _id: "page1" },
  ]);
  const result = compareSnapshots(zipSync(original), zipSync(restored));
  assert.equal(result.rows, 7);
  assert.equal(result.attachments, 1);
  assert.equal(result.attachmentBytes, 6);
});

test("rejects changed revision, row ID, lost table and extra row", () => {
  for (const mutate of [
    (entries) => {
      entries["documents/documents.jsonl"] = jsonl([{ _id: "doc1", pageId: "page1", revision: 10, content: "[]" }]);
    },
    (entries) => {
      entries["assets/documents.jsonl"] = jsonl([{ _id: "changed", storageId: "file1", pageId: "page1" }]);
    },
    (entries) => {
      delete entries["assets/documents.jsonl"];
    },
    (entries) => {
      entries["comments/documents.jsonl"] = jsonl([{ _id: "leaked", text: "extra" }]);
    },
    (entries) => {
      entries["documents/generated_schema.jsonl"] = jsonl([{ field: "revision", type: "int64" }]);
    },
    (entries) => {
      entries["_tables/documents.jsonl"] = jsonl([
        { name: "pages", id: 10011 },
        { name: "documents", id: 10004 },
      ]);
    },
  ]) {
    const changed = source();
    mutate(changed);
    assert.throws(() => compareSnapshots(zipSync(source()), zipSync(changed)), /differs/);
  }
});

test("rejects corrupted or omitted file bytes and missing storage metadata", () => {
  const corrupted = source();
  corrupted["_storage/file1"][0] = 12;
  assert.throws(() => compareSnapshots(zipSync(source()), zipSync(corrupted)), /differs/);
  const missing = source();
  delete missing["_storage/file1"];
  assert.throws(() => inventorySnapshot(zipSync(missing)), /Storage bytes are missing/);
  const noMetadata = source();
  delete noMetadata["_storage/documents.jsonl"];
  assert.throws(() => inventorySnapshot(zipSync(noMetadata)), /no exported storage metadata/);
});

test("rejects duplicate row IDs, malformed JSON, unsafe paths, absent tables and unsupported archive entries", () => {
  for (const [name, bytes] of [
    ["pages/documents.jsonl", jsonl([{ _id: "same" }, { _id: "same" }])],
    ["pages/documents.jsonl", strToU8("broken")],
    ["../outside", strToU8("bad")],
    ["unknown", strToU8("bad")],
  ]) {
    assert.throws(() => inventorySnapshot(zipSync({ ...source(), [name]: bytes })));
  }
  assert.throws(() => inventorySnapshot(zipSync({})), /must include/);
  assert.throws(() => inventorySnapshot(new Uint8Array([1, 2, 3])));
});
