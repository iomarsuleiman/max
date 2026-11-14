import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(root, "package.json"));
const { build } = createRequire(localRequire.resolve("tsx"))("esbuild");
const output = await mkdtemp(path.join(os.tmpdir(), "max-outbox-proof-"));
const bundle = path.join(output, "outbox.js");
await build({
  absWorkingDir: root,
  entryPoints: ["lib/client/collaborationOutbox.ts"],
  outfile: bundle,
  bundle: true,
  format: "iife",
  globalName: "MaxOutbox",
  platform: "browser",
  logLevel: "error",
});
const snapshot = await readFile(path.join(root, "tests/fixtures/editor-document.json"), "utf8");
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end("<!doctype html><title>Isolated recovery storage proof</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}`;
const results = [];
let context;
async function openPage(ctx) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.outbox = new window.MaxOutbox.CollaborationOutbox();
  });
  return page;
}
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const profile = path.join(output, engine);
    context = await type.launchPersistentContext(profile, { headless: true });
    let page = await openPage(context);
    const seeded = await page.evaluate(
      async ({ snapshot }) => {
        const scope = { accountId: "alice", workspaceId: "synthetic-workspace", pageId: "synthetic-page" };
        const entry = { ...scope, operationId: "first", generation: 0, baseRevision: 0, snapshot, update: new Uint8Array([0, 1, 255]) };
        const first = await window.outbox.append(entry);
        const retry = await window.outbox.append(entry);
        let rejected = false;
        try {
          await window.outbox.append({ ...entry, snapshot: "{}" });
        } catch {
          rejected = true;
        }
        return { first, retry, rejected, rows: (await window.outbox.recoverable(scope)).length };
      },
      { snapshot },
    );
    assert.deepEqual(seeded.first, seeded.retry);
    assert.equal(seeded.rejected, true);
    assert.equal(seeded.rows, 1);
    const second = await openPage(context);
    const append = (target, operationId) =>
      target.evaluate(
        async ({ snapshot, operationId }) =>
          window.outbox.append({
            accountId: "alice",
            workspaceId: "synthetic-workspace",
            pageId: "synthetic-page",
            operationId,
            generation: 0,
            baseRevision: 0,
            snapshot,
            update: new Uint8Array([2]),
          }),
        { snapshot, operationId },
      );
    const concurrent = await Promise.all([append(page, "second"), append(second, "third")]);
    assert.equal(new Set(concurrent.map((value) => value.sequence)).size, 2);
    await page.evaluate(() => window.outbox.close());
    await second.evaluate(() => window.outbox.close());
    await context.close();
    context = await type.launchPersistentContext(profile, { headless: true });
    page = await openPage(context);
    const verified = await page.evaluate(
      async ({ snapshot }) => {
        const scope = { accountId: "alice", workspaceId: "synthetic-workspace", pageId: "synthetic-page" };
        const recovered = await window.outbox.recoverable(scope);
        const exact = recovered.length === 3 && recovered.every((row) => row.snapshot === snapshot) && recovered[0].update.join(",") === "0,1,255";
        const isolation = [];
        for (const foreign of [
          { ...scope, accountId: "bob" },
          { ...scope, workspaceId: "other" },
          { ...scope, pageId: "other" },
        ])
          isolation.push((await window.outbox.headers(foreign)).length === 0);
        const receipt = {
          document: { workspaceId: scope.workspaceId, pageId: scope.pageId },
          accountId: scope.accountId,
          operationId: "first",
          generation: 0,
          revision: 1,
          outcome: "applied",
        };
        const staleAck = await window.outbox.acknowledge({ ...receipt, generation: 1 });
        const stillPresent = (await window.outbox.recoverable(scope)).some((entry) => entry.operationId === "first" && entry.state === "conflict");
        const conflictNotReplayable = !(await window.outbox.pending(scope)).some((entry) => entry.operationId === "first");
        const acknowledged = await window.outbox.acknowledge(receipt);
        await window.outbox.quarantine(scope);
        const readableAfterRevocation = (await window.outbox.recoverable(scope)).length;
        const headers = await window.outbox.headers(scope);
        const redacted = headers.length === 2 && headers.every((header) => header.state === "revoked" && !("snapshot" in header) && !("update" in header));
        const revokedAck = await window.outbox.acknowledge({ ...receipt, operationId: "second" });
        let revokedAppendRejected = false;
        try {
          await window.outbox.append({ ...scope, operationId: "after-revocation", generation: 1, baseRevision: 1, snapshot, update: new Uint8Array([3]) });
        } catch {
          revokedAppendRejected = true;
        }
        for (const header of headers) await window.outbox.discard(scope, header.operationId);
        let oversizedRejected = false;
        try {
          await window.outbox.append({ ...scope, operationId: "oversized", generation: 1, baseRevision: 1, snapshot, update: new Uint8Array(900_001) });
        } catch {
          oversizedRejected = true;
        }
        const emptyAfterDiscard = (await window.outbox.headers(scope)).length === 0;
        const failureScope = { ...scope, pageId: "write-failure" };
        const failureEntry = { ...failureScope, operationId: "retained", generation: 0, baseRevision: 0, snapshot: "{}", update: new Uint8Array([4]) };
        await window.outbox.append(failureEntry);
        const originalAdd = IDBObjectStore.prototype.add;
        let writeFailureRejected = false;
        try {
          IDBObjectStore.prototype.add = function () {
            throw new DOMException("Synthetic quota fault", "QuotaExceededError");
          };
          await window.outbox.append({ ...failureEntry, operationId: "failed" });
        } catch {
          writeFailureRejected = true;
        } finally {
          IDBObjectStore.prototype.add = originalAdd;
        }
        const failedWriteRetainsPriorCommit =
          writeFailureRejected && (await window.outbox.headers(failureScope)).map((entry) => entry.operationId).join(",") === "retained";
        const bounded = { ...failureEntry, pageId: "entry-limit" };
        for (let index = 0; index < window.MaxOutbox.OUTBOX_LIMITS.entries; index++)
          await window.outbox.append({ ...bounded, operationId: `operation-${index}` });
        let entryLimitRejected = false;
        try {
          await window.outbox.append({ ...bounded, operationId: "overflow" });
        } catch {
          entryLimitRejected = true;
        }
        const entryLimitRetainsAllCommitted =
          entryLimitRejected && (await window.outbox.headers({ ...scope, pageId: "entry-limit" })).length === window.MaxOutbox.OUTBOX_LIMITS.entries;
        await window.outbox.close();
        return {
          exact,
          isolation,
          staleAck,
          stillPresent,
          conflictNotReplayable,
          acknowledged,
          readableAfterRevocation,
          redacted,
          revokedAck,
          oversizedRejected,
          emptyAfterDiscard,
          revokedAppendRejected,
          failedWriteRetainsPriorCommit,
          entryLimitRetainsAllCommitted,
        };
      },
      { snapshot },
    );
    assert.equal(verified.exact, true);
    assert(verified.isolation.every(Boolean));
    assert.equal(verified.staleAck, false);
    assert.equal(verified.stillPresent, true);
    assert.equal(verified.conflictNotReplayable, true);
    assert.equal(verified.acknowledged, true);
    assert.equal(verified.readableAfterRevocation, 0);
    assert.equal(verified.redacted, true);
    assert.equal(verified.revokedAck, false);
    assert.equal(verified.oversizedRejected, true);
    assert.equal(verified.emptyAfterDiscard, true);
    assert.equal(verified.revokedAppendRejected, true);
    assert.equal(verified.failedWriteRetainsPriorCommit, true);
    assert.equal(verified.entryLimitRetainsAllCommitted, true);
    results.push({
      engine,
      browser: context.browser()?.version(),
      committedCorpusAndBinarySurviveBrowserRestart: true,
      multiTabTransactions: true,
      actorWorkspacePageIsolation: true,
      mismatchedAckRetainsDraft: true,
      revokedDraftQuarantine: true,
      boundedWriteRefusal: true,
      injectedQuotaFaultPreservesPriorCommit: true,
      abruptProcessCrashTested: false,
    });
    await context.close();
    context = null;
  }
  const report = { results, liveProviderIntegrated: false, powerLossDurabilityTested: false };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath: path.join(output, "report.json") }, null, 2));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
}
