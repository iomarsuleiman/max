/**
 * PR19: isolated, account+room-bound IndexedDB outbox for Yjs updates.
 * No tokens, permission decisions or real Max page data are stored here.
 * An acknowledgement deletes only the matching immutable operation after the
 * server has committed it. Storage failures are fatal to automatic sending.
 */
const DB_NAME = "max-pr19-sandbox-outbox";
const STORE = "outbox";
const VERSION = 1;
const MAX_ITEMS = 16;
const MAX_BYTES = 131_072;
const MAX_UPDATE = 16_384;
const VALID_ID = /^[a-zA-Z0-9_:-]{1,200}$/;
const VALID_OP = /^[a-zA-Z0-9_-]{8,96}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function identity({ accountId, workspaceId, pageId }) {
  if (![accountId, workspaceId, pageId].every(v => typeof v === "string" && VALID_ID.test(v))) {
    throw Error("INVALID_JOURNAL_SCOPE");
  }
  return JSON.stringify([accountId, workspaceId, pageId]);
}
function validate(entry) {
  if (!entry || !VALID_OP.test(entry.operationId) || typeof entry.base64 !== "string" ||
      !BASE64.test(entry.base64) || !Number.isSafeInteger(entry.size) ||
      entry.size < 1 || entry.size > MAX_UPDATE ||
      Math.floor(entry.base64.length * 3 / 4) -
      (entry.base64.endsWith("==") ? 2 : entry.base64.endsWith("=") ? 1 : 0) !== entry.size) {
    throw Error("CORRUPT_JOURNAL_ENTRY");
  }
}
function check(row, key) {
  if (!row) return [];
  if (row.key !== key || row.version !== VERSION || !Array.isArray(row.entries) ||
      row.entries.length > MAX_ITEMS) throw Error("CORRUPT_JOURNAL_RECORD");
  const seen = new Set();
  let total = 0;
  for (const entry of row.entries) {
    validate(entry);
    if (seen.has(entry.operationId)) throw Error("DUPLICATE_JOURNAL_OPERATION");
    seen.add(entry.operationId);
    total += entry.size;
  }
  if (total > MAX_BYTES) throw Error("CORRUPT_JOURNAL_SIZE");
  return row.entries.map(e => ({operationId: e.operationId, base64: e.base64, size: e.size}));
}
function opened(idb) {
  if (!idb?.open) throw Error("INDEXEDDB_UNAVAILABLE: export the Yjs document");
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onerror = () => reject(req.error ?? Error("JOURNAL_OPEN_FAILED"));
    req.onblocked = () => reject(Error("JOURNAL_SCHEMA_UPGRADE_BLOCKED"));
    req.onsuccess = () => resolve(req.result);
  });
}
export function createIndexedDbJournal(idb = globalThis.indexedDB) {
  // The read-modify-write stays in ONE IDB readwrite transaction to avoid
  // losing independent tab writes to the same room.
  async function transaction(scope, access, transform) {
    const key = identity(scope);
    const db = await opened(idb);
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, access);
        const store = tx.objectStore(STORE);
        const request = store.get(key);
        let output;
        request.onsuccess = () => {
          try {
            const entries = check(request.result, key);
            const result = transform(entries);
            output = result.output;
            if (access === "readwrite" && result.next !== undefined) {
              if (result.next.length === 0) store.delete(key);
              else store.put({ key, version: VERSION, entries: result.next });
            }
          } catch (e) {
            tx.abort();
            output = e;
          }
        };
        tx.oncomplete = () => resolve(output);
        tx.onabort = () => reject(output instanceof Error ? output : tx.error ?? Error("JOURNAL_TRANSACTION_ABORTED"));
        tx.onerror = () => {}; // onabort reports the actionable error
      });
    } finally { db.close(); }
  }
  return {
    load: scope => transaction(scope, "readonly", entries => ({output: entries})),
    append: (scope, entry) => {
      validate(entry);
      return transaction(scope, "readwrite", entries => {
        const found = entries.find(e => e.operationId === entry.operationId);
        if (found) {
          if (found.base64 !== entry.base64 || found.size !== entry.size) throw Error("JOURNAL_RETRY_PAYLOAD_MISMATCH");
          return {output: false};
        }
        if (entries.length >= MAX_ITEMS || entries.reduce((n, e) => n + e.size, 0) + entry.size > MAX_BYTES)
          throw Error("JOURNAL_FULL: export the Yjs snapshot");
        return {next: [...entries, {operationId: entry.operationId, base64: entry.base64, size: entry.size}], output: true};
      });
    },
    ack: (scope, operationId) => {
      if (!VALID_OP.test(operationId)) throw Error("INVALID_ACK_OPERATION");
      return transaction(scope, "readwrite", entries => ({
        next: entries.filter(e => e.operationId !== operationId),
        output: entries.some(e => e.operationId === operationId),
      }));
    },
  };
}
