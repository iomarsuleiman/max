/** Only against the SEPARATE PR17 synthetic Convex deployment. */
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const fn = (name) => makeFunctionReference("provider:" + name);
const JOIN = fn("join"), READ = fn("readUpdates"), WRITE = fn("appendUpdate");
const STATUS = fn("sessionStatus"), REVOKE = fn("revokeMember"), DOWNGRADE = fn("downgradeMemberEdit");
const COMPACT = fn("compactLog"), CHECKPOINT = fn("checkpointStatus");
const PRESENCE_PUBLISH = fn("publishPresence"), PRESENCE_LIST = fn("listPresence"), PRESENCE_STOP = fn("stopPresence");

export function createAuthenticatedConvexTransport({ url, getToken }) {
  if (!url || !/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url))
    throw Error("Only a dedicated HTTPS Convex cloud deployment is accepted");
  if (typeof getToken !== "function") throw Error("Clerk session getToken required");
  const client = new ConvexClient(url);
  client.setAuth(async () => (await getToken()) ?? null);
  return {
    join: (scope) => client.mutation(JOIN, scope),
    readUpdates: (args) => client.query(READ, args),
    appendUpdate: (args) => client.mutation(WRITE, args),
    watch: (args, onUpdate, onError) => client.onUpdate(READ, args, onUpdate, onError),
    watchStatus: (args, onUpdate, onError) => client.onUpdate(STATUS, args, onUpdate, onError),
    revokeMember: (args) => client.mutation(REVOKE, args),
    downgradeMemberEdit: (args) => client.mutation(DOWNGRADE, args),
    compactLog: (args) => client.mutation(COMPACT, args),
    checkpointStatus: (args) => client.query(CHECKPOINT, args),
    // PR25: isolated awareness; never write the Yjs update log for presence.
    publishPresence: (args) => client.mutation(PRESENCE_PUBLISH, args),
    watchPresence: (args, onUpdate, onError) => client.onUpdate(PRESENCE_LIST, args, onUpdate, onError),
    stopPresence: (args) => client.mutation(PRESENCE_STOP, args),
    close: () => client.close(),
  };
}