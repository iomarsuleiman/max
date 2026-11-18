/** Only against the SEPARATE PR17 synthetic Convex deployment. */
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const fn = (name) => makeFunctionReference("provider:" + name);
const JOIN = fn("join"), READ = fn("readUpdates"), WRITE = fn("appendUpdate");
const STATUS = fn("sessionStatus"), REVOKE = fn("revokeMember"), DOWNGRADE = fn("downgradeMemberEdit");
const COMPACT = fn("compactLog"), CHECKPOINT = fn("checkpointStatus");
const COMMENT_ACCESS = fn("commentAccess"), COMMENT_THREADS = fn("listCommentThreads");
const COMMENT_ITEMS = fn("listThreadComments"), COMMENT_CREATE = fn("createCommentThread");
const COMMENT_REPLY = fn("replyToCommentThread"), COMMENT_RESOLVE = fn("resolveCommentThread");
const SUGGEST_ACCESS = fn("suggestionAccess"), SUGGEST_LIST = fn("listSuggestions");
const SUGGEST_CREATE = fn("createSuggestion"), SUGGEST_REVIEW = fn("reviewSuggestion");
const INBOX_LIST = fn("listInbox"), INBOX_READ = fn("markInboxRead");
const ACTIVITY_LIST = fn("listRoomActivity");
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
    // PR26: authenticated, sandbox-only block anchors + threaded discussion.
    watchCommentAccess: (args, update, error) => client.onUpdate(COMMENT_ACCESS, args, update, error),
    watchCommentThreads: (args, update, error) => client.onUpdate(COMMENT_THREADS, args, update, error),
    watchThreadComments: (args, update, error) => client.onUpdate(COMMENT_ITEMS, args, update, error),
    createCommentThread: (args) => client.mutation(COMMENT_CREATE, args),
    replyToCommentThread: (args) => client.mutation(COMMENT_REPLY, args),
    resolveCommentThread: (args) => client.mutation(COMMENT_RESOLVE, args),
    // PR27: separate, opt-in suggestion review; no CRDT apply endpoint.
    watchSuggestionAccess: (args,update,error) => client.onUpdate(SUGGEST_ACCESS,args,update,error),
    watchSuggestions: (args,update,error) => client.onUpdate(SUGGEST_LIST,args,update,error),
    createSuggestion: args => client.mutation(SUGGEST_CREATE,args),
    reviewSuggestion: args => client.mutation(SUGGEST_REVIEW,args),
    // PR28: private sandbox notifications, never platform push delivery.
    watchInbox: (args, update, error) => client.onUpdate(INBOX_LIST, args, update, error),
    markInboxRead: args => client.mutation(INBOX_READ, args),
    // PR29: metadata-only, read-only room history. Permission checked per emission.
    watchRoomActivity: (args, update, error) => client.onUpdate(ACTIVITY_LIST, args, update, error),
    close: () => client.close(),
  };
}