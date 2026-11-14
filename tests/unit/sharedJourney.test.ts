import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";

const modules = {
  "../../convex/_generated/server.ts": async () => ({}),
  "../../convex/sharedWorkspaces.ts": () => import("@/convex/sharedWorkspaces"),
  "../../convex/sharedPages.ts": () => import("@/convex/sharedPages"),
};
const createWorkspace = makeFunctionReference<"action", { name: string }, { workspaceId: string; teamspaceId: string }>("sharedWorkspaces:create");
const invite = makeFunctionReference<"action", { workspaceId: string; email: string; role: "member" }, { token: string }>("sharedWorkspaces:invite");
const accept = makeFunctionReference<"action", { token: string }, { workspaceId: string }>("sharedWorkspaces:accept");
const revoke = makeFunctionReference<"mutation", { workspaceId: string; userId: string }, { revoked: true }>("sharedWorkspaces:revoke");
const createPage = makeFunctionReference<"mutation">("sharedPages:create");
const getPage = makeFunctionReference<"query">("sharedPages:get");
const listPages = makeFunctionReference<"query">("sharedPages:list");
const share = makeFunctionReference<"mutation">("sharedPages:setMemberGrant");
const save = makeFunctionReference<"mutation">("sharedPages:save");
const rename = makeFunctionReference<"mutation">("sharedPages:rename");
const history = makeFunctionReference<"query">("sharedPages:history");
const historicalDocument = makeFunctionReference<"query">("sharedPages:historicalDocument");
const restoreVersion = makeFunctionReference<"mutation">("sharedPages:restoreVersion");
const blocks = (text: string) => [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] }];

describe("shared workspace and page journey", () => {
  it("invites a member, shares and edits a private page, and immediately revokes access", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", name: "Alice", email: "alice@example.com", emailVerified: true });
    const bob = t.withIdentity({ subject: "bob", name: "Bob", email: "bob@example.com", emailVerified: true });
    const workspace = await alice.action(createWorkspace, { name: "Team" });
    const other = await alice.action(createWorkspace, { name: "Other" });
    const invitation = await alice.action(invite, { workspaceId: workspace.workspaceId, email: "bob@example.com", role: "member" });
    await expect(t.withIdentity({ subject: "bob", email: "bob@example.com", emailVerified: false }).action(accept, { token: invitation.token })).rejects.toThrow();
    await expect(bob.action(accept, { token: invitation.token })).resolves.toEqual({ workspaceId: workspace.workspaceId });

    await expect(bob.action(accept, { token: invitation.token })).rejects.toThrow();

    const { pageId } = await alice.mutation(createPage, { ...workspace, title: "Private" });
    const pageArgs = { workspaceId: workspace.workspaceId, pageId };
    await expect(bob.query(getPage, pageArgs)).rejects.toThrow();
    expect((await bob.query(listPages, { workspaceId: workspace.workspaceId })).pages).toEqual([]);
    await expect(alice.query(getPage, { workspaceId: other.workspaceId, pageId })).rejects.toThrow();
    await expect(alice.mutation(share, { workspaceId: other.workspaceId, pageId, userId: "bob", grant: "edit", baseRevision: 1 })).rejects.toThrow();

    expect(await alice.mutation(share, { ...pageArgs, userId: "bob", grant: "view", baseRevision: 1 })).toEqual({ aclRevision: 2 });
    expect((await bob.query(getPage, pageArgs)).canEdit).toBe(false);
    await expect(bob.mutation(save, { ...pageArgs, blocks: blocks("read only"), baseRevision: 1 })).rejects.toThrow();

    expect(await alice.mutation(share, { ...pageArgs, userId: "bob", grant: "edit_content", baseRevision: 2 })).toEqual({ aclRevision: 3 });
    expect(await bob.query(getPage, pageArgs)).toMatchObject({ canEdit: true, canRename: false });
    await expect(bob.mutation(rename, { ...pageArgs, title: "Denied" })).rejects.toThrow();

    expect(await alice.mutation(share, { ...pageArgs, userId: "bob", grant: "edit", baseRevision: 3 })).toEqual({ aclRevision: 4 });
    expect(await bob.query(getPage, pageArgs)).toMatchObject({ canEdit: true, canRename: true });
    await expect(bob.mutation(rename, { ...pageArgs, title: "Renamed" })).resolves.toBeNull();
    expect((await alice.query(getPage, pageArgs)).page.title).toBe("Renamed");

    expect((await bob.mutation(save, { ...pageArgs, blocks: blocks("Bob's edit"), baseRevision: 1 })).revision).toBe(2);
    expect((await alice.mutation(save, { ...pageArgs, blocks: blocks("Alice's edit"), baseRevision: 2 })).revision).toBe(3);
    await expect(bob.mutation(save, { ...pageArgs, blocks: blocks("stale edit"), baseRevision: 2 })).rejects.toThrow();
    const latest = await bob.query(getPage, pageArgs);
    expect(latest.document.revision).toBe(3);
    expect(latest.document.content).toContain("Alice's edit");

    const versions = await bob.query(history, pageArgs);
    expect(versions.canRestore).toBe(true);
    const previous = versions.versions.find((v: { revision: number }) => v.revision === 2);
    expect(previous).toBeDefined();
    const previewArgs = { ...pageArgs, versionId: previous.id };
    const restoreArgs = { ...previewArgs, baseRevision: 3 };
    expect((await bob.query(historicalDocument, previewArgs)).content).toContain("Bob's edit");
    await expect(alice.query(historicalDocument, { ...previewArgs, workspaceId: other.workspaceId })).rejects.toThrow();
    const unrelated = await alice.mutation(createPage, { ...workspace, title: "Unrelated" });
    await expect(alice.mutation(restoreVersion, { ...restoreArgs, pageId: unrelated.pageId })).rejects.toThrow();
    await expect(bob.mutation(restoreVersion, { ...restoreArgs, baseRevision: 2 })).rejects.toThrow();
    await alice.mutation(share, { ...pageArgs, userId: "bob", grant: "edit_content", baseRevision: 4 });
    expect((await bob.query(history, pageArgs)).canRestore).toBe(false);
    await expect(bob.mutation(restoreVersion, restoreArgs)).rejects.toThrow();
    expect((await alice.mutation(restoreVersion, restoreArgs)).revision).toBe(4);
    expect((await alice.query(getPage, pageArgs)).document.content).toContain("Bob's edit");
    const undo = (await alice.query(history, pageArgs)).versions.find((v: { revision: number }) => v.revision === 3);
    expect(undo.reason).toBe("before-restore");
    expect((await alice.mutation(restoreVersion, { ...pageArgs, versionId: undo.id, baseRevision: 4 })).revision).toBe(5);
    expect((await alice.query(getPage, pageArgs)).page.title).toBe("Renamed");

    await t.run(ctx => ctx.db.patch(pageId, { locked: true }));
    await expect(alice.mutation(restoreVersion, { ...restoreArgs, baseRevision: 5 })).rejects.toThrow();
    expect((await alice.query(history, pageArgs)).canRestore).toBe(false);
    await t.run(ctx => ctx.db.patch(pageId, { locked: false }));

    await expect(alice.mutation(revoke, { workspaceId: workspace.workspaceId, userId: "bob" })).resolves.toEqual({ revoked: true });
    await expect(bob.query(getPage, pageArgs)).rejects.toThrow();
    await expect(bob.query(history, pageArgs)).rejects.toThrow();
    await expect(bob.query(historicalDocument, previewArgs)).rejects.toThrow();
    await expect(bob.mutation(restoreVersion, { ...restoreArgs, baseRevision: 5 })).rejects.toThrow();
    await expect(bob.mutation(save, { ...pageArgs, blocks: blocks("after revoke"), baseRevision: 3 })).rejects.toThrow();
    expect((await alice.query(getPage, pageArgs)).document.content).toContain("Alice's edit");
  });
});
