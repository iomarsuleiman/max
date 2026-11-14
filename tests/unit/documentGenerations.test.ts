import { describe, expect, it } from "vitest";
import {
  commitContentUpdate,
  commitStructuralChange,
  settleDraft,
  type AppliedReceipt,
  type DocumentHead,
  type PendingDraft,
} from "@/lib/domain/collaboration/generations";

interface Snapshot {
  order: string[];
  quote: string;
}
const initial = (): DocumentHead<Snapshot> => ({
  document: { workspaceId: "workspace-a", pageId: "page-a" },
  generation: 0,
  revision: 0,
  snapshot: { order: ["quote", "paragraph"], quote: "A quote" },
});
const pending = (head: DocumentHead<Snapshot>, accountId: string, operationId: string): PendingDraft<Snapshot> => ({
  document: { ...head.document },
  accountId,
  operationId,
  generation: head.generation,
  baseRevision: head.revision,
  snapshot: structuredClone(head.snapshot),
});
const move = (snapshot: Snapshot): Snapshot => ({ ...snapshot, order: ["paragraph", "quote"] });

describe("document generation reference protocol", () => {
  it("rejects a stale move after a text commit, then moves fresh content without erasing the writer", () => {
    const head = initial();
    const mover = pending(head, "alice", "move-1");
    const writer = pending(head, "bob", "edit-1");
    const edited = commitContentUpdate(head, writer, (latest) => ({ ...latest, quote: `concurrent text ${latest.quote}` }));
    expect(() => commitStructuralChange(edited.head, mover, move)).toThrow("Another edit arrived");
    expect(settleDraft(mover, { outcome: "conflict", reason: "revision" })).toEqual({ state: "conflict", reason: "revision", draft: mover });
    const refreshedMove = pending(edited.head, "alice", "move-2");
    const moved = commitStructuralChange(edited.head, refreshedMove, move);
    expect(moved.head.snapshot).toEqual({ order: ["paragraph", "quote"], quote: "concurrent text A quote" });
    expect(moved.head.generation).toBe(1);
    expect(moved.head.revision).toBe(2);
    expect(moved.receipt.generation).toBe(refreshedMove.generation);
    expect(settleDraft(refreshedMove, moved.receipt).state).toBe("acknowledged");
    expect(head).toEqual(initial());
  });

  it("rejects an offline old-generation writer after a move and retains its authored branch", () => {
    const head = initial();
    const writer = pending(head, "bob", "offline-edit");
    writer.snapshot.quote = "Unsent authored text A quote";
    const moved = commitStructuralChange(head, pending(head, "alice", "move"), move);
    let invoked = false;
    expect(() =>
      commitContentUpdate(moved.head, writer, () => {
        invoked = true;
        return writer.snapshot;
      }),
    ).toThrow("structure changed");
    expect(invoked).toBe(false);
    const recovered = settleDraft(writer, { outcome: "conflict", reason: "generation" });
    expect(recovered).toEqual({ state: "conflict", reason: "generation", draft: writer });
    writer.snapshot.quote = "changed caller object";
    if (recovered.state !== "conflict") throw new Error("Expected a retained recovery branch.");
    expect(recovered.draft.snapshot.quote).toBe("Unsent authored text A quote");
  });

  it("allows merged content updates within a generation but rejects the same structural mutation twice", () => {
    const head = initial();
    const a = pending(head, "alice", "a");
    const b = pending(head, "bob", "b");
    const first = commitContentUpdate(head, a, (snapshot) => ({ ...snapshot, quote: `${snapshot.quote} Alice` }));
    const second = commitContentUpdate(first.head, b, (snapshot) => ({ ...snapshot, quote: `${snapshot.quote} Bob` }));
    expect(second.head.snapshot.quote).toBe("A quote Alice Bob");
    expect(settleDraft(a, first.receipt).state).toBe("acknowledged");
    expect(settleDraft(b, second.receipt).state).toBe("acknowledged");
    const intent = pending(second.head, "alice", "structural");
    const moved = commitStructuralChange(second.head, intent, move);
    expect(() => commitStructuralChange(moved.head, intent, move)).toThrow("structure changed");
  });

  it("makes restore advance the generation so pre-restore updates cannot overwrite restored content", () => {
    const head = initial();
    const edited = commitContentUpdate(head, pending(head, "alice", "edit"), (snapshot) => ({ ...snapshot, quote: "Changed" }));
    const oldWriter = pending(edited.head, "bob", "old-writer");
    const restored = commitStructuralChange(edited.head, pending(edited.head, "alice", "restore"), () => initial().snapshot);
    expect(restored.head.snapshot).toEqual(head.snapshot);
    expect(restored.head.revision).toBe(2);
    expect(restored.head.generation).toBe(1);
    expect(() => commitContentUpdate(restored.head, oldWriter, () => ({ order: [], quote: "stale" }))).toThrow("structure changed");
  });

  it("does not call merge code for foreign page/workspace references", () => {
    const head = initial();
    for (const document of [
      { ...head.document, workspaceId: "other" },
      { ...head.document, pageId: "other" },
    ]) {
      let called = false;
      const update = { ...pending(head, "alice", "foreign"), document };
      expect(() =>
        commitContentUpdate(head, update, () => {
          called = true;
          return head.snapshot;
        }),
      ).toThrow("doesn't exist");
      expect(called).toBe(false);
    }
  });

  it("never accepts an acknowledgement from another actor, document, operation or generation", () => {
    const head = initial();
    const draft = pending(head, "alice", "pending");
    const receipt: AppliedReceipt = { ...draft, outcome: "applied", revision: 1 };
    for (const foreign of [
      { ...receipt, accountId: "bob" },
      { ...receipt, operationId: "another" },
      { ...receipt, document: { ...receipt.document, workspaceId: "other" } },
      { ...receipt, document: { ...receipt.document, pageId: "other" } },
    ])
      expect(() => settleDraft(draft, foreign)).toThrow("different update");
    expect(settleDraft(draft, { ...receipt, generation: 1 }).state).toBe("conflict");
    for (const revision of [-1, 0, NaN, Infinity, 1.5]) expect(settleDraft(draft, { ...receipt, revision }).state).toBe("conflict");
    expect(settleDraft(draft, receipt).state).toBe("acknowledged");
  });

  it("quarantines revoked drafts without reporting them as acknowledged or mutating the branch", () => {
    const draft = pending(initial(), "alice", "revoked");
    expect(settleDraft(draft, { outcome: "revoked" })).toEqual({ state: "revoked", draft });
    expect(draft.snapshot.quote).toBe("A quote");
  });

  it("isolates failed validation and refuses exhausted counters before applying a mutation", () => {
    const head = initial();
    const draft = pending(head, "alice", "invalid");
    expect(() =>
      commitContentUpdate(head, draft, (latest) => {
        latest.quote = "partial mutation";
        throw new Error("Invalid schema");
      }),
    ).toThrow("Invalid schema");
    expect(head).toEqual(initial());
    for (const exhausted of [
      { ...head, revision: Number.MAX_SAFE_INTEGER },
      { ...head, generation: Number.MAX_SAFE_INTEGER },
    ]) {
      let called = false;
      expect(() =>
        commitStructuralChange(exhausted, pending(exhausted, "alice", "exhausted"), () => {
          called = true;
          return head.snapshot;
        }),
      ).toThrow("maintenance");
      expect(called).toBe(false);
    }
  });
});
