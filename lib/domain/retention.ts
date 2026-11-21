import type { Db, Storage } from "./db";
import { pagesDeletePermanently } from "./ops/pages";
import { logEvent } from "./organizations";

const DAY = 86_400_000;

/**
 * Applies organizations' retention policies: trashed pages past their time are deleted for good
 * (with their files), and page history older than the limit is pruned, always keeping each page's
 * latest version. Bounded per run (`budget` deletions) so one huge organization can't stall it;
 * the next run continues. Recorded in each organization's audit log.
 */
export async function applyRetention(db: Db, storage: Storage | null, now: number, only?: string, budget = 400) {
  let used = 0;
  const orgs = (await db.listAll("orgs", 5000)).filter((o) => (!only || o.ownerId === only) && (o.policies.trashRetentionDays || o.policies.versionRetentionDays));
  for (const org of orgs) {
    if (used >= budget) break;
    const ns = org.ownerId;
    const ctx = { db, storage, ownerId: ns, now, source: "ui" as const };
    let pages = 0;
    let versions = 0;
    if (org.policies.trashRetentionDays) {
      const cutoff = now - org.policies.trashRetentionDays * DAY;
      const roots = (await db.list("pages", ns)).filter((p) => p.archivedAt && p.archivedAt < cutoff && (!p.archivedRootId || p.archivedRootId === p._id));
      for (const root of roots) {
        if (used >= budget) break;
        const { deleted } = await pagesDeletePermanently.run(ctx, { id: root._id, confirm: true });
        pages += deleted;
        used += deleted;
      }
    }
    if (org.policies.versionRetentionDays && used < budget) {
      const cutoff = now - org.policies.versionRetentionDays * DAY;
      const all = await db.list("versions", ns);
      const latest = new Map<string, number>();
      for (const v of all) latest.set(v.pageId, Math.max(latest.get(v.pageId) ?? 0, v.at));
      for (const v of all) {
        if (used >= budget) break;
        if (v.at < cutoff && v.at !== latest.get(v.pageId)) {
          await db.delete("versions", v._id);
          versions++;
          used++;
        }
      }
    }
    if (pages || versions) await logEvent(db, ns, { id: "system", name: "Max" }, "retention.applied", ns, `${pages} trashed pages, ${versions} old versions removed`, now);
  }
  return { removed: used };
}
