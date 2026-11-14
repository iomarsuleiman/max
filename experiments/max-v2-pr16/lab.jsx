/**
 * PR16: disposable, browser-run, **actual Max maxSchema** collaboration lab.
 *
 * The pages, edits and Y.Docs are synthetic and exist only in memory.
 * Two BlockNote editor instances mount in Chromium/WebKit with an in-process
 * Yjs update relay; NO server, auth, workspace rooms, personal data, or
 * persistent provider is connected. Never promote this relay to production.
 */
import React, { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { withCollaboration } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { maxSchema } from "../../components/editor/blocks.tsx";
import "@blocknote/shadcn/style.css";
import "./lab.css";

const peers = {
  alice: { doc: new Y.Doc() },
  bob: { doc: new Y.Doc() },
};
for (const peer of Object.values(peers)) {
  peer.provider = {
    awareness: new Awareness(peer.doc),
    connect() {},
    disconnect() {},
    on() {},
    off() {},
    destroy() {},
  };
}

const editors = {};
let connected = false;
const errors = [];
window.addEventListener("error", (event) => {
  errors.push(String(event.error?.message ?? event.message));
});

peers.alice.doc.on("update", (update) => {
  if (connected) Y.applyUpdate(peers.bob.doc, update);
});
peers.bob.doc.on("update", (update) => {
  if (connected) Y.applyUpdate(peers.alice.doc, update);
});

function exchangeUpdates() {
  const first = Y.encodeStateAsUpdate(peers.alice.doc);
  const second = Y.encodeStateAsUpdate(peers.bob.doc);
  Y.applyUpdate(peers.alice.doc, second);
  Y.applyUpdate(peers.bob.doc, first);
}
function findBlock(blocks, id) {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findBlock(block.children ?? [], id);
    if (child) return child;
  }
  return null;
}
function read() {
  const alice = editors.alice?.document ?? [];
  const bob = editors.bob?.document ?? [];
  const target = "gold-callout";
  const marked = [findBlock(alice, target), findBlock(bob, target)];
  return {
    ready: Boolean(editors.alice && editors.bob),
    connected,
    alice: JSON.parse(JSON.stringify(alice)),
    bob: JSON.parse(JSON.stringify(bob)),
    marked,
    errors: [...errors],
    // This measures byte-for-byte *Yjs state replay*, not durable persistence.
    yjsRestored: Boolean(window.__maxLab?.recoveredSnapshot),
  };
}

function insert(editor, blocks) {
  const last = editor.document.at(-1);
  editor.insertBlocks(blocks, last, "after");
}
window.__maxLab = {
  ready: false,
  recoveredSnapshot: false,
  read,
  seed() {
    if (!editors.alice || !editors.bob) throw new Error("Editors not ready");
    exchangeUpdates();
    connected = true;
    insert(editors.alice, [
      {
        id: "gold-callout",
        type: "callout",
        props: { tone: "tip" },
        content: [{ type: "text", text: "مرحبا Max custom schema", styles: {} }],
      },
      { id: "gold-page-link", type: "pageLink", props: { pageId: "fixturepage001" } },
      { id: "gold-bookmark", type: "bookmark", props: { url: "https://example.com", title: "Example" } },
    ]);
    return read();
  },
  seedExpanded() {
    if (!connected) throw Error("Fixture requires the explicitly connected lab");
    insert(editors.alice, [
      { id:"parity-heading", type:"heading",props:{level:2},
        content:[{type:"text",text:"مراجعة عربية و English",styles:{}}] },
      { id:"parity-callout-ar",type:"callout",props:{tone:"warning"},
        content:[{type:"text",text:"تنبيه: preserve exact Arabic text",styles:{}}] },
      { id:"parity-equation",type:"equation",
        content:[{type:"text",text:"E = mc^2 + \\alpha",styles:{}}] },
      { id:"parity-image",type:"image",props:{
        url:"https://example.com/fixture.png",name:"synthetic.png",
        alt:"Arabic figure وصف",caption:"caption حفظ",showPreview:false,previewWidth:280,
      }},
      { id:"parity-youtube",type:"youtube",props:{
        videoId:"fixture0001",url:"https://youtube.com/watch?v=fixture0001",
        start:15,end:40,caption:"Intro اختبار",title:"synthetic media",
      }},
      { id:"parity-diagram",type:"diagram",props:{text:"flowchart LR\\n A[Start] --> B[End]"}},
      { id:"parity-bookmark",type:"bookmark",props:{
        url:"https://example.com/article?lang=ar",title:"Article مقال",
      }},
      { id:"parity-toc",type:"toc" },
      { id:"parity-embed",type:"embed",props:{url:""} },
      { id:"parity-database",type:"databaseView",props:{databaseId:"fixture-db-001"}},
      { id:"parity-inline",type:"paragraph",content:[
        {type:"text",text:"أهلا ",styles:{}},
        {type:"pageMention",props:{pageId:"fixturepage001",title:"ملاحظة"}},
        {type:"text",text:" on ",styles:{}},
        {type:"dateMention",props:{date:"2026-11-14"}},
      ] },
    ]);
    return read();
  },
  disconnect() {
    connected = false;
    return read();
  },
  divergentEdits() {
    if (connected) throw new Error("Only insert divergent edits during a partition");
    insert(editors.alice, [{
      id: "offline-alice", type: "paragraph",
      content: [{ type: "text", text: "تحرير Alice بالعربية", styles: {} }],
    }]);
    insert(editors.bob, [{
      id: "offline-bob", type: "paragraph",
      content: [{ type: "text", text: "Offline Bob English", styles: {} }],
    }]);
    return read();
  },
  reconnect() {
    exchangeUpdates();
    connected = true;
    return read();
  },
  replayOfflineSnapshot() {
    const bytes = Y.encodeStateAsUpdate(peers.alice.doc);
    const fresh = new Y.Doc();
    try {
      Y.applyUpdate(fresh, bytes);
      const original = peers.alice.doc.getXmlFragment("max-document").toJSON();
      const restored = fresh.getXmlFragment("max-document").toJSON();
      if (JSON.stringify(original) !== JSON.stringify(restored)) {
        throw new Error("Yjs snapshot failed exact XML fragment JSON parity");
      }
      window.__maxLab.recoveredSnapshot = true;
      return { bytes: bytes.length, equal: true };
    } finally {
      fresh.destroy();
    }
  },
};

function LabEditor({ name, color }) {
  const peer = peers[name];
  const options = useMemo(() => withCollaboration({
    schema: maxSchema,
    collaboration: {
      provider: peer.provider,
      fragment: peer.doc.getXmlFragment("max-document"),
      user: { name, color },
    },
  }), [peer, name, color]);
  const editor = useCreateBlockNote(options);
  useEffect(() => {
    editors[name] = editor;
    window.__maxLab.ready = Boolean(editors.alice && editors.bob);
    return () => {
      delete editors[name];
      window.__maxLab.ready = false;
    };
  }, [editor, name]);
  return React.createElement(
    "section",
    { "data-editor": name },
    React.createElement("h2", null, name),
    React.createElement(BlockNoteView, { editor }),
  );
}

function App() {
  return React.createElement(
    "main", { id: "lab" },
    React.createElement("h1", null, "Max 2.0 — Isolated collaboration lab"),
    React.createElement("p", null, "Synthetic documents only. No network, user data, or permissions."),
    React.createElement("div", { id: "editors" },
      React.createElement(LabEditor, { name: "alice", color: "#4477aa" }),
      React.createElement(LabEditor, { name: "bob", color: "#aa6644" }),
    ),
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
