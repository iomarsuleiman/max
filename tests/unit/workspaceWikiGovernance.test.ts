import { describe, expect, it } from "vitest";
import {
  readAuthorizedWikiGovernance, validWikiExpiry, validWikiGovernanceRow,
  type WikiGovernanceRow, type WikiGovernanceStore,
} from "@/lib/domain/workspaceWikiGovernance";
import type { GrantRow, MembershipRow, ScopeRow } from "@/lib/domain/workspaceAccessGateway";
import type { RegisteredRecord, SemanticRow } from "@/lib/domain/workspaceRecordSemantics";

const workspaceId = "tenant01", databaseId = "db1", recordId = "wiki1";
const owner = "clerk_owner", author = "clerk_author", reviewer = "clerk_reviewer";
const viewer = "clerk_viewer", now = 2000000000000;
function fixture() {
  const scopes: ScopeRow[] = [
    { workspaceId, pageId: databaseId, parentId: null, teamspaceId: null },
    { workspaceId, pageId: recordId, parentId: databaseId, teamspaceId: null },
  ];
  const members: MembershipRow[] = [owner, author, reviewer, viewer].map((accountId) => ({
    workspaceId, accountId, role: accountId === owner ? "owner" : "member", status: "active",
  }));
  const grants: GrantRow[] = [
    ...[author, reviewer, viewer].map((subjectId) => ({
      workspaceId, pageId: databaseId, subjectType: "account" as const,
      subjectId, effect: "allow" as const, level: "view" as const,
    })),
    ...[reviewer].map((subjectId) => ({
      workspaceId, pageId: recordId, subjectType: "account" as const,
      subjectId, effect: "allow" as const, level: "full_access" as const,
    })),
    { workspaceId, pageId: databaseId, subjectType: "account", subjectId: reviewer,
      effect: "allow", level: "full_access" },
  ];
  const metadata: RegisteredRecord[] = [{
    workspaceId, databaseId, pageId: recordId, kind: "record", archivedAt: null,
    title: "Team wiki", updatedAt: 12,
  }];
  const semantics: SemanticRow[] = [{
    workspaceId, databaseId, recordId, kind: "wiki", state: "approved",
    assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 13,
  }];
  const rows: WikiGovernanceRow[] = [{
    workspaceId, databaseId, recordId, ownerId: author, reviewerId: reviewer,
    verifiedAt: now - 100, verifiedSemanticUpdatedAt: 13, verifiedMetadataUpdatedAt: 12,
    expiresAt: now + 10000, archivedAt: null, updatedAt: now - 90,
  }];
  let offline = false;
  const store: WikiGovernanceStore = {
    workspaces: async () => [{ workspaceId, ownerId: owner, status: "active" }],
    memberships: async (_ws, account) => members.filter((m) => m.accountId === account),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (_ws, id) => scopes.filter((s) => s.pageId === id),
    grants: async (_ws, id) => grants.filter((g) => g.pageId === id),
    databaseBindings: async () => [{ workspaceId, pageId: databaseId,
      kind: "database", archivedAt: null }],
    recordCandidates: async () => [],
    recordMetadata: async (id) => metadata.filter((m) => m.pageId === id),
    semanticRows: async (id) => semantics.filter((s) => s.recordId === id),
    wikiGovernance: async (id) => {
      if (offline) throw new Error("backend unavailable");
      return rows.filter((r) => r.recordId === id);
    },
  };
  const read = (actor: string | null = viewer, at = now) =>
    readAuthorizedWikiGovernance(store, actor, workspaceId, databaseId, recordId, at);
  return { rows, members, grants, scopes, metadata, semantics, read,
    offline: () => { offline = true; } };
}

describe("Max 2.0 PR36 team wiki governance", () => {
  it("shows only owner-self status, not reviewer or other owner's identity", async () => {
    const f = fixture(), result = await f.read();
    expect(result).toEqual({ recordId, ownedByMe: false,
      verification: "verified", expiresAt: now + 10000, updatedAt: now - 90 });
    expect(JSON.stringify(result)).not.toContain(author);
    expect(JSON.stringify(result)).not.toContain(reviewer);
    expect((await f.read(author))?.ownedByMe).toBe(true);
  });
  it("automatically expires without a scheduled job", async () => {
    const f = fixture();
    expect((await f.read(viewer, now + 10000))?.verification).toBe("expired");
  });
  it("invalidates verification when metadata or semantic revisions change", async () => {
    const f = fixture();
    f.metadata[0].updatedAt++;
    expect((await f.read())?.verification).toBe("stale");
    f.metadata[0].updatedAt--;
    f.semantics[0].updatedAt++;
    expect((await f.read())?.verification).toBe("stale");
    f.semantics[0].updatedAt--;
    f.semantics[0].state = "draft";
    expect((await f.read())?.verification).toBe("stale");
  });
  it("invalidates on owner or reviewer revocation without leaking identities", async () => {
    const f = fixture();
    f.members.find((r) => r.accountId === author)!.status = "revoked";
    expect((await f.read())?.verification).toBe("stale");
    f.members.find((r) => r.accountId === author)!.status = "active";
    f.members.find((r) => r.accountId === reviewer)!.status = "revoked";
    expect((await f.read())?.verification).toBe("stale");
  });
  it("invalidates when reviewer manage access is revoked", async () => {
    const f = fixture();
    f.grants.push({ workspaceId, pageId: recordId, subjectType: "account",
      subjectId: reviewer, effect: "deny", level: "full_access" });
    expect((await f.read())?.verification).toBe("stale");
  });
  it("does not allow a viewer to read after permission loss", async () => {
    const f = fixture();
    f.grants.push({ workspaceId, pageId: recordId, subjectType: "account",
      subjectId: viewer, effect: "deny", level: "view" });
    expect(await f.read()).toBeNull();
  });
  it("rejects duplicate or cross-tenant metadata", async () => {
    const f = fixture();
    f.rows.push({ ...f.rows[0] });
    expect(await f.read()).toBeNull();
    f.rows.pop();
    f.rows[0].workspaceId = "otherTenant";
    expect(await f.read()).toBeNull();
  });
  it("rejects wrong record parent, archived metadata or wrong semantic type", async () => {
    const f = fixture();
    f.scopes[1].parentId = "wrongDb";
    expect(await f.read()).toBeNull();
    f.scopes[1].parentId = databaseId;
    f.metadata[0].archivedAt = 1;
    expect(await f.read()).toBeNull();
    f.metadata[0].archivedAt = null;
    f.semantics[0].kind = "task";
    expect(await f.read()).toBeNull();
  });
  it("supports an unverified assignment without exposing a reviewer ID", async () => {
    const f = fixture();
    Object.assign(f.rows[0], {
      reviewerId: null, verifiedAt: null,
      verifiedSemanticUpdatedAt: null, verifiedMetadataUpdatedAt: null,
    });
    expect((await f.read())?.verification).toBe("unverified");
  });
  it("rejects incomplete proof, self-review, malformed or unbounded time", () => {
    const f = fixture(), row = f.rows[0];
    expect(validWikiGovernanceRow(row, workspaceId, databaseId, recordId)).toBe(true);
    expect(validWikiGovernanceRow({ ...row, reviewerId: null },
      workspaceId, databaseId, recordId)).toBe(false);
    expect(validWikiGovernanceRow({ ...row, reviewerId: author },
      workspaceId, databaseId, recordId)).toBe(false);
    expect(validWikiExpiry(now + 1, now)).toBe(true);
    expect(validWikiExpiry(now, now)).toBe(false);
    expect(validWikiExpiry(now + 367 * 86400000, now)).toBe(false);
    expect(validWikiExpiry(Infinity, now)).toBe(false);
  });
  it("fails closed for missing identities and storage failures", async () => {
    const f = fixture();
    expect(await f.read(null)).toBeNull();
    expect(await f.read("clerk_stranger")).toBeNull();
    f.offline();
    expect(await f.read()).toBeNull();
  });
});
