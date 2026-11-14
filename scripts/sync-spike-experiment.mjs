import assert from "node:assert/strict";
import { BlockNoteEditor, docToBlocks } from "@blocknote/core";
import { _blocksToProsemirrorNode, blocksToYDoc, yDocToBlocks } from "@blocknote/core/yjs";
import { maxSchema } from "../components/editor/blocks.tsx";
import { normalizeBlocks, walk } from "../lib/domain/blocks.ts";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { collab, getVersion, receiveTransaction, sendableSteps } from "prosemirror-collab";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, undo, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror";
import * as Y from "yjs";
import { blocksToYDoc as blocksToYDocV14, yDocToBlocks as yDocToBlocksV14 } from "@blocknote/core/y";
import { blockMatchNodes } from "../node_modules/@blocknote/core/src/y/extensions/blockMatchNodes.ts";
import { configureYProsemirror, syncPlugin } from "@y/prosemirror";
import * as Y14 from "@y/y";
import { commitContentUpdate, commitStructuralChange, settleDraft } from "../lib/domain/collaboration/generations.ts";

const names = ["alice", "bob", "carol"];
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const bytes = (base64) => new Uint8Array(Buffer.from(base64, "base64"));
const serialized = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function canonicalContent(content) {
  if (!content || Array.isArray(content)) return content;
  return {
    ...content,
    rows: content.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        type: "tableCell",
        content: Array.isArray(cell) ? cell : cell.content,
        props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1, ...(Array.isArray(cell) ? {} : cell.props) },
      })),
    })),
  };
}

/** Check authored fields, not just equality between two potentially lossy encodings. */
function assertAuthoredCorpus(original, actual) {
  const byId = new Map([...walk(actual)].map(({ block }) => [block.id, block]));
  assert.equal(byId.size, [...walk(original)].length, "Every original block ID is retained exactly once");
  for (const { block } of walk(original)) {
    const converted = byId.get(block.id);
    assert.ok(converted, block.id);
    assert.equal(converted.type, block.type, block.id);
    for (const [key, value] of Object.entries(block.props)) assert.deepEqual(converted.props[key], value, `${block.id}.${key}`);
    assert.deepEqual(serialized(canonicalContent(converted.content)), serialized(canonicalContent(block.content)), `${block.id}.content`);
    assert.deepEqual(
      converted.children.map((child) => child.id),
      block.children.map((child) => child.id),
      `${block.id}.children`,
    );
  }
}

function findNode(doc, predicate) {
  let found;
  doc.descendants((node, position) => {
    if (!found && predicate(node)) found = { node, position };
  });
  assert.ok(found, "The fixture contains the target node");
  return found;
}

function concurrentEdit(state, name) {
  const transaction = state.tr.insertText(`${name} العربية `, 3);
  if (name === "bob") {
    const cellText = findNode(transaction.doc, (node) => node.isText && node.text === "Name");
    transaction.insertText("bob-table ", cellText.position);
  }
  if (name === "carol") {
    const image = findNode(transaction.doc, (node) => node.type.name === "image");
    transaction.setNodeMarkup(image.position, undefined, { ...image.node.attrs, alt: "Carol updated image alt العربية" });
  }
  return transaction;
}

function makeYClient(schema, seedUpdate, name) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seedUpdate);
  const mount = document.createElement("div");
  document.body.append(mount);
  const view = new EditorView(mount, { state: EditorState.create({ schema, plugins: [ySyncPlugin(doc.getXmlFragment("prosemirror")), yUndoPlugin()] }) });
  return {
    name,
    doc,
    view,
    destroy() {
      view.destroy();
      doc.destroy();
      mount.remove();
    },
  };
}

function assertMerged(blocks) {
  const text = JSON.stringify(blocks);
  for (const name of names) assert.ok(text.includes(`${name} العربية `), `Retains ${name}'s concurrent text`);
  assert.ok(text.includes("bob-table "), "Retains concurrent table edit");
  const image = [...walk(blocks)].find(({ block }) => block.id === "gold-image")?.block;
  assert.equal(image?.props.alt, "Carol updated image alt العربية");
}

function mergeOt(schema, initialNode, edits) {
  const clients = edits.map(({ name, edit }) => {
    const initial = EditorState.create({ schema, doc: initialNode, plugins: [collab({ version: 0, clientID: name })] });
    return { name, state: initial.apply(edit(initial)) };
  });
  let server = initialNode;
  let acceptedSteps = 0;
  let discardedClientEdits = 0;
  for (const source of clients) {
    const pending = sendableSteps(source.state);
    if (!pending) {
      discardedClientEdits++;
      continue;
    }
    assert.equal(pending.version, acceptedSteps);
    for (const step of pending.steps) {
      const applied = step.apply(server);
      assert.equal(applied.failed, null);
      server = applied.doc;
    }
    acceptedSteps += pending.steps.length;
    for (const target of clients) {
      target.state = target.state.apply(
        receiveTransaction(
          target.state,
          pending.steps,
          pending.steps.map(() => pending.clientID),
        ),
      );
    }
  }
  for (const client of clients) {
    assert.equal(getVersion(client.state), acceptedSteps);
    assert.equal(sendableSteps(client.state), null);
    assert.deepEqual(client.state.doc.toJSON(), server.toJSON());
  }
  return { server, clients, acceptedSteps, discardedClientEdits };
}

function moveQuote(state) {
  const { node, position } = findNode(state.doc, (node) => node.attrs.id === "gold-quote");
  const tr = state.tr.delete(position, position + node.nodeSize);
  return tr.insert(tr.doc.content.size - 1, node);
}

function generationBarrierProof(schema, initialNode) {
  const initial = {
    document: { workspaceId: "synthetic-workspace", pageId: "synthetic-page" },
    generation: 0,
    revision: 0,
    snapshot: serialized(initialNode.toJSON()),
  };
  const writer = { document: initial.document, accountId: "writer", operationId: "edit-quote", generation: 0, baseRevision: 0 };
  const mover = { document: initial.document, accountId: "mover", operationId: "move-quote", generation: 0, baseRevision: 0 };
  const apply = (json, edit) => {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
    const next = state.apply(edit(state)).doc;
    next.check();
    return serialized(next.toJSON());
  };
  const writerDraft = { ...writer, snapshot: apply(initial.snapshot, editQuote) };
  const moverDraft = { ...mover, snapshot: apply(initial.snapshot, moveQuote) };

  // Writer arrives first. A stale structural intent cannot install its old
  // copy; an explicit retry moves the latest server content by stable block ID.
  const edited = commitContentUpdate(initial, writer, (latest) => apply(latest, editQuote));
  assert.throws(() => commitStructuralChange(edited.head, mover, (latest) => apply(latest, moveQuote)), /Another edit arrived/);
  const moveConflict = settleDraft(moverDraft, { outcome: "conflict", reason: "revision" });
  assert.equal(moveConflict.state, "conflict");
  assert.deepEqual(moveConflict.draft.snapshot, moverDraft.snapshot);
  const retried = commitStructuralChange(edited.head, { ...mover, operationId: "reviewed-move", baseRevision: edited.head.revision }, (latest) =>
    apply(latest, moveQuote),
  );
  assert.ok(schema.nodeFromJSON(retried.head.snapshot).textContent.includes("concurrent-quote-edit "));

  // Move arrives first. The disconnected writer retains its complete authored
  // branch; its older-generation update is rejected before touching the engine.
  const moved = commitStructuralChange(initial, mover, (latest) => apply(latest, moveQuote));
  let invoked = false;
  assert.throws(
    () =>
      commitContentUpdate(moved.head, writer, () => {
        invoked = true;
        return writerDraft.snapshot;
      }),
    /structure changed/,
  );
  assert.equal(invoked, false);
  const editConflict = settleDraft(writerDraft, { outcome: "conflict", reason: "generation" });
  assert.equal(editConflict.state, "conflict");
  assert.ok(schema.nodeFromJSON(editConflict.draft.snapshot).textContent.includes("concurrent-quote-edit "));
  assert.deepEqual(initial.snapshot, serialized(initialNode.toJSON()));
  return {
    exactSchema: true,
    writerFirstRetriedMovePreservesText: true,
    moveFirstStaleWriterRejectedBeforeMerge: true,
    bothConflictBranchesRetained: true,
    liveProviderEnforcementTested: false,
  };
}

function editQuote(state) {
  const quote = findNode(state.doc, (node) => node.isText && node.text === "A quote");
  return state.tr.insertText("concurrent-quote-edit ", quote.position);
}

function moveDiagnostics(schema, initialNode, seedUpdate) {
  const clients = [makeYClient(schema, seedUpdate, "mover"), makeYClient(schema, seedUpdate, "writer")];
  try {
    clients[0].view.dispatch(moveQuote(clients[0].view.state));
    clients[1].view.dispatch(editQuote(clients[1].view.state));
    const updates = clients.map((client) => Y.encodeStateAsUpdate(client.doc));
    clients.forEach((client) => updates.forEach((update) => Y.applyUpdate(client.doc, update)));
    assert.deepEqual(clients[0].view.state.doc.toJSON(), clients[1].view.state.doc.toJSON());
    const ot = mergeOt(schema, initialNode, [
      { name: "mover", edit: moveQuote },
      { name: "writer", edit: editQuote },
    ]);
    return {
      operation: "ProseMirror delete+insert block move concurrent with text edit inside that block",
      yjsConverged: true,
      yjsPreservedConcurrentEdit: clients[0].view.state.doc.textContent.includes("concurrent-quote-edit "),
      otConverged: true,
      otPreservedConcurrentEdit: ot.server.textContent.includes("concurrent-quote-edit "),
      otDiscardedClientEdits: ot.discardedClientEdits,
    };
  } finally {
    clients.forEach((client) => client.destroy());
  }
}

function localUndoCheck(clients) {
  clients[0].view.dispatch(clients[0].view.state.tr.insertText("undo-alice ", 3));
  clients[1].view.dispatch(clients[1].view.state.tr.insertText("keep-bob ", 3));
  const updates = clients.map((client) => Y.encodeStateAsUpdate(client.doc));
  clients.forEach((client) => updates.forEach((update) => Y.applyUpdate(client.doc, update)));
  assert.ok(undo(clients[0].view.state), "Alice has a local undo action");
  const undone = Y.encodeStateAsUpdate(clients[0].doc);
  clients.forEach((client) => Y.applyUpdate(client.doc, undone));
  for (const client of clients) {
    assert.ok(!client.view.state.doc.textContent.includes("undo-alice "), "Local undo removes Alice's action");
    assert.ok(client.view.state.doc.textContent.includes("keep-bob "), "Local undo preserves Bob's action");
    assertMerged(docToBlocks(client.view.state.doc));
  }
}

function v14Experiment(editor, canonical) {
  const seed = blocksToYDocV14(editor, canonical);
  const clients = [];
  const makeClient = (name) => {
    const doc = new Y14.Doc();
    Y14.applyUpdate(doc, Y14.encodeStateAsUpdate(seed));
    const mount = document.createElement("div");
    document.body.append(mount);
    const view = new EditorView(mount, { state: EditorState.create({ schema: editor.pmSchema, plugins: [syncPlugin({ customCompare: blockMatchNodes })] }) });
    configureYProsemirror({ ytype: doc.get("prosemirror") })(view.state, view.dispatch);
    const client = {
      name,
      doc,
      view,
      destroy() {
        view.destroy();
        doc.destroy();
        mount.remove();
      },
    };
    clients.push(client);
    return client;
  };
  try {
    assert.deepEqual(yDocToBlocksV14(editor, seed), canonical);
    const concurrent = names.map(makeClient);
    concurrent.forEach((client) => {
      assert.deepEqual(docToBlocks(client.view.state.doc), canonical);
      client.view.dispatch(concurrentEdit(client.view.state, client.name));
    });
    const updates = concurrent.map((client) => Y14.encodeStateAsUpdate(client.doc));
    concurrent.forEach((client) => [...updates].reverse().forEach((update) => Y14.applyUpdate(client.doc, update)));
    concurrent.forEach((client) => {
      assert.deepEqual(client.view.state.doc.toJSON(), concurrent[0].view.state.doc.toJSON());
      assertMerged(docToBlocks(client.view.state.doc));
    });
    const mover = makeClient("mover");
    const writer = makeClient("writer");
    mover.view.dispatch(moveQuote(mover.view.state));
    writer.view.dispatch(editQuote(writer.view.state));
    const moveUpdates = [Y14.encodeStateAsUpdate(mover.doc), Y14.encodeStateAsUpdate(writer.doc)];
    for (const client of [mover, writer]) for (const update of moveUpdates) Y14.applyUpdate(client.doc, update);
    assert.deepEqual(mover.view.state.doc.toJSON(), writer.view.state.doc.toJSON());
    return {
      prerelease: true,
      customSchemaRoundtrip: true,
      concurrentClients: concurrent.length,
      samePositionBilingualTextAndCustomEdits: true,
      usesInstalledBlockMatchNodes: true,
      moveConverged: true,
      movePreservedConcurrentEdit: mover.view.state.doc.textContent.includes("concurrent-quote-edit "),
    };
  } finally {
    clients.forEach((client) => client.destroy());
    seed.destroy();
  }
}

export async function runExperiment(corpus, journalStore) {
  const editor = BlockNoteEditor.create({
    schema: maxSchema,
    initialContent: corpus,
    tables: { splitCells: true, headers: true, cellBackgroundColor: true, cellTextColor: true },
  });
  const original = normalizeBlocks(corpus);
  const node = _blocksToProsemirrorNode(editor, corpus);
  const canonical = docToBlocks(node);
  assertAuthoredCorpus(original, canonical);
  const seed = blocksToYDoc(editor, canonical);
  const clone = new Y.Doc();
  let clients = [];
  try {
    assert.deepEqual(yDocToBlocks(editor, seed), canonical);
    const seedUpdate = Y.encodeStateAsUpdate(seed);
    Y.applyUpdate(clone, seedUpdate);
    assert.deepEqual(yDocToBlocks(editor, clone), canonical);
    clients = names.map((name) => makeYClient(editor.pmSchema, seedUpdate, name));
    const binding = ySyncPluginKey.getState(clients[0].view.state).binding;
    const anchor = absolutePositionToRelativePosition(3, clients[0].doc.getXmlFragment("prosemirror"), binding.mapping);
    const journal = { seed: b64(seedUpdate), anchor: b64(Y.encodeRelativePosition(anchor)), clients: [] };
    for (const client of clients) {
      assert.deepEqual(docToBlocks(client.view.state.doc), canonical);
      const updates = [];
      client.doc.on("update", (update) => updates.push(b64(update)));
      client.view.dispatch(concurrentEdit(client.view.state, client.name));
      journal.clients.push({ name: client.name, updates });
    }
    await journalStore.write(journal);
    const localStates = clients.map((client) => docToBlocks(client.view.state.doc));
    clients.forEach((client) => client.destroy());
    clients = [];
    const recovered = await journalStore.read();
    // No original client Y.Doc survives. Reconstruct only from bytes read back from disk.
    clients = recovered.clients.map((saved) => {
      const client = makeYClient(editor.pmSchema, bytes(recovered.seed), saved.name);
      saved.updates.forEach((update) => Y.applyUpdate(client.doc, bytes(update)));
      return client;
    });
    clients.forEach((client, index) => assert.deepEqual(docToBlocks(client.view.state.doc), localStates[index]));
    // Exchange each independently produced delta, twice and in reverse order.
    const updates = recovered.clients.flatMap((client) => client.updates).reverse();
    for (const target of clients) for (const update of [...updates, ...updates]) Y.applyUpdate(target.doc, bytes(update));
    const merged = docToBlocks(clients[0].view.state.doc);
    for (const client of clients) assert.deepEqual(docToBlocks(client.view.state.doc), merged);
    for (const client of clients) {
      const mapping = ySyncPluginKey.getState(client.view.state).binding.mapping;
      const position = relativePositionToAbsolutePosition(
        client.doc,
        client.doc.getXmlFragment("prosemirror"),
        Y.decodeRelativePosition(bytes(recovered.anchor)),
        mapping,
      );
      assert.notEqual(position, null, "The persisted relative anchor resolves");
      assert.equal(
        client.view.state.doc.textBetween(position, position + 7),
        "English",
        "The anchor still points to the original text after concurrent insertion",
      );
    }
    assertMerged(merged);
    // Unedited authored fields survive the merge, including IDs, nested layout and attachment references.
    const expected = structuredClone(canonical);
    expected[0].content = merged[0].content;
    expected.find((block) => block.id === "gold-table").content = merged.find((block) => block.id === "gold-table").content;
    expected.find((block) => block.id === "gold-image").props.alt = "Carol updated image alt العربية";
    assert.deepEqual(merged, expected);
    localUndoCheck(clients);
    assert.deepEqual(docToBlocks(editor.pmSchema.nodeFromJSON(node.toJSON())), canonical);
    const ot = mergeOt(
      editor.pmSchema,
      node,
      names.map((name) => ({ name, edit: (state) => concurrentEdit(state, name) })),
    );
    assert.equal(ot.discardedClientEdits, 0);
    assertMerged(docToBlocks(ot.server));
    return {
      schema: "production maxSchema imported from components/editor/blocks.tsx",
      topLevelBlocks: canonical.length,
      totalBlocks: [...walk(canonical)].length,
      customSchemaRoundtrip: true,
      authoredFieldChecks: true,
      yjs: {
        clients: clients.length,
        samePositionBilingualText: true,
        tableAndCustomAttributeEdits: true,
        durableJournalReplay: true,
        disposedDocumentRecovery: true,
        duplicateReversedDelivery: true,
        relativeAnchorRecovery: true,
        localUndoPreservesRemoteEdits: true,
      },
      ot: {
        engine: "prosemirror-collab 1.3.1, the component's OT dependency",
        clients: ot.clients.length,
        acceptedSteps: ot.acceptedSteps,
        converged: true,
        componentBackendTested: false,
      },
      moveDiagnostics: moveDiagnostics(editor.pmSchema, node, seedUpdate),
      yjsV14: v14Experiment(editor, canonical),
      generationBarrierProof: generationBarrierProof(editor.pmSchema, node),
      gate: { transportSelected: false, productionReady: false, browserImeAndOfflineLifecycleTested: false, authenticatedProviderTested: false },
    };
  } finally {
    clients.forEach((client) => client.destroy());
    seed.destroy();
    clone.destroy();
    editor._tiptapEditor.destroy();
  }
}
