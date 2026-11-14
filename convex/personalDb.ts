import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { Db } from "../lib/domain/db";
import { convexCollaborationStore } from "./collaborationStore";
import { createPersonalDb } from "../lib/domain/collaboration/personalDb";

/** Resolve the legacy dispatcher's scope inside its outer native transaction. */
export async function convexPersonalDb(nativeDb: DatabaseReader | DatabaseWriter, rawDb: Db, ownerId: string) {
  const personal = await convexCollaborationStore(nativeDb).transaction((tx) => tx.getPersonalWorkspace(ownerId));
  return createPersonalDb({
    db: rawDb, ownerId,
    personalWorkspaceId: personal?.kind === "personal" && personal.ownerId === ownerId && personal.state === "active" ? personal.id : undefined,
  });
}
