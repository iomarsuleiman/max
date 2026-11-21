import type { Db, Storage } from "./db";
import { execute } from "./ops";
import type { OrgActor } from "./organizations";

/** A new organization starts with one open teamspace, General, so there's somewhere to begin. */
export async function seedOrganization(db: Db, storage: Storage | null, ns: string, actor: OrgActor, now: number) {
  const ctx = { db, storage, ownerId: ns, now, source: "ui" as const, org: { role: "owner" as const }, actor: { id: actor.id, name: actor.name, image: actor.image } };
  const { page } = (await execute("pages.create", { title: "General", icon: "🏡", teamspace: true }, ctx, "mutation")) as { page: { _id: string } };
  return { generalId: page._id };
}
