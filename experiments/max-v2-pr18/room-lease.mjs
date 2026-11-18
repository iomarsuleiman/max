/**
 * PR23 isolated browser lab: same-origin, same-account + same-room single-writer gate.
 * Web Locks is the browser's cross-tab arbiter. Never fake success with localStorage,
 * BroadcastChannel heartbeats or an unverified timeout if Web Locks is unavailable.
 * This is NOT a server authorization or cross-device lock.
 */
const ID = /^[A-Za-z0-9_:-]{1,200}$/;

export function labRoomLockName({ accountId, workspaceId, pageId } = {}) {
  if (![accountId, workspaceId, pageId].every(value =>
    typeof value === "string" && ID.test(value))) {
    throw Error("INVALID_LAB_ROOM_LOCK_SCOPE");
  }
  return "max-pr23-room:" + JSON.stringify([accountId, workspaceId, pageId]);
}

export async function acquireBrowserRoomLease(scope, locks = globalThis.navigator?.locks) {
  const name = labRoomLockName(scope);
  if (!locks || typeof locks.request !== "function") {
    throw Error("WEB_LOCKS_UNAVAILABLE: lab editing disabled; export local data");
  }
  let resolveGrant, rejectGrant, resolveHold;
  const grant = new Promise((resolve, reject) => {
    resolveGrant = resolve;
    rejectGrant = reject;
  });
  const hold = new Promise(resolve => { resolveHold = resolve; });
  let released = false;
  // Do not await the request itself: the callback intentionally holds the lock
  // until the editor has stopped and its IndexedDB persistence has settled.
  const request = Promise.resolve().then(() =>
    locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) {
        rejectGrant(Error("ROOM_ALREADY_OPEN_IN_ANOTHER_TAB"));
        return;
      }
      resolveGrant({
        release() {
          if (released) return;
          released = true;
          resolveHold();
        },
      });
      await hold;
    }),
  );
  void request.catch(error => rejectGrant(error));
  return grant;
}
