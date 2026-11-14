/** Only against the SEPARATE PR17 synthetic Convex deployment. */
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const fn = (name) => makeFunctionReference("provider:" + name);
const JOIN = fn("join"), READ = fn("readUpdates"), WRITE = fn("appendUpdate");

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
    close: () => client.close(),
  };
}