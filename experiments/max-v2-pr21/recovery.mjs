/* Validate two independently captured, *authorized* Convex readUpdates
 * transcripts. This is an offline verifier; no cloud access is implied. */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export function verifyTranscript(s) {
  if (!s || typeof s !== "object" || !s.scope ||
      typeof s.scope.workspaceId !== "string" || !s.scope.workspaceId ||
      typeof s.scope.pageId !== "string" || !s.scope.pageId ||
      !Number.isSafeInteger(s.headSeq) || s.headSeq < 0 || s.headSeq > 256 ||
      !Array.isArray(s.pages) || s.pages.length < 1) throw Error("INVALID_MANIFEST");
  const hash=createHash("sha256"), seen=new Set();
  let seq=0;
  for(const page of s.pages) {
    if (!page || page.headSeq !== s.headSeq || !Array.isArray(page.updates) ||
        page.updates.length > 64 || typeof page.hasMore !== "boolean")
      throw Error("INVALID_PAGE");
    for(const row of page.updates) {
      if (!row || row.seq !== seq+1 || typeof row.actorId !== "string" ||
          !row.actorId || !/^[A-Za-z0-9_-]{8,96}$/.test(row.operationId) ||
          typeof row.base64 !== "string" ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.base64))
        throw Error("GAP_OR_BAD_UPDATE");
      const bytes=Buffer.from(row.base64,"base64");
      if (bytes.length < 1 || bytes.length > 16384 ||
          bytes.toString("base64") !== row.base64) throw Error("NONCANONICAL_BYTES");
      const key=row.actorId+"\0"+row.operationId;
      if(seen.has(key)) throw Error("DUPLICATE_OPERATION");
      seen.add(key);seq++;
      hash.update(String(seq)+"\0"+row.actorId+"\0"+row.operationId+"\0");
      hash.update(bytes);hash.update("\0");
    }
    if(page.hasMore !== (seq < s.headSeq)) throw Error("BAD_PAGINATION");
    if(page.hasMore && page.updates.length === 0) throw Error("EMPTY_PAGE");
  }
  if(seq !== s.headSeq) throw Error("TRUNCATED_LOG");
  return {workspaceId:s.scope.workspaceId,pageId:s.scope.pageId,
    headSeq:seq,sha256:hash.digest("hex")};
}
export function verifyRestore(before,after) {
  const a=verifyTranscript(before), b=verifyTranscript(after);
  if(JSON.stringify(a)!==JSON.stringify(b)) throw Error("RESTORE_PARITY_FAILURE");
  return a;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==4) throw Error("usage: node recovery.mjs before.json after.json");
    const before=JSON.parse(readFileSync(process.argv[2],"utf8"));
    const after=JSON.parse(readFileSync(process.argv[3],"utf8"));
    console.log(JSON.stringify(verifyRestore(before,after),null,2));
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
