import { test } from "node:test";
import assert from "node:assert/strict";
import { createMeteredTransport } from "./transport-meter.mjs";

test("metrics report aggregate application calls without persisting payloads or tokens", async () => {
  let tick = 0;
  const transport = createMeteredTransport({
    async join() { return { sessionId: "PRIVATE", accountId: "PRIVATE" }; },
    async readUpdates() { return { updates: [{ base64: "QUJD" }], headSeq: 1 }; },
    async appendUpdate() { return { seq: 1 }; },
    watch: () => () => {},
  }, () => { tick += 7; return tick; });
  await transport.join({ token: "SECRET" });
  await transport.readUpdates({ sessionId: "SECRET" });
  await transport.appendUpdate({ base64: "QUJD", operationId: "SECRET" });
  const evidence = transport.operationEvidence();
  assert.deepEqual([evidence.counts.join.attempts,
    evidence.counts.readUpdates.attempts, evidence.counts.appendUpdate.attempts], [1, 1, 1]);
  assert.equal(evidence.encodedReadBytes, 4);
  assert.equal(evidence.encodedWriteBytes, 4);
  assert.equal(evidence.updateRows, 1);
  assert.equal(evidence.counts.join.maxElapsedMs, 7);
  assert.doesNotMatch(JSON.stringify(evidence), /SECRET|PRIVATE|QUJD/);
  assert.equal(typeof transport.watch, "function");
});

test("failed requests count failures and never print raw credential arguments", async () => {
  const transport = createMeteredTransport({
    async join() { throw Error("expired token: TOP_SECRET"); },
    async readUpdates() { return { updates: [] }; },
    async appendUpdate() { return { seq: 0 }; },
  }, () => 0);
  await assert.rejects(() => transport.join({ token: "TOP_SECRET" }), /TOP_SECRET/);
  const evidence = transport.operationEvidence();
  assert.equal(evidence.counts.join.failures, 1);
  assert.equal(evidence.counts.join.attempts, 1);
  assert.doesNotMatch(JSON.stringify(evidence), /TOP_SECRET/);
});

test("evidence is immutable and transport shape validation fails closed", async () => {
  assert.throws(() => createMeteredTransport({}), /INVALID_LAB_TRANSPORT/);
  const transport = createMeteredTransport({
    async join() {}, async readUpdates() { return { updates: [] }; }, async appendUpdate() {},
  }, () => 0);
  const prior = transport.operationEvidence();
  prior.counts.join.attempts = 900;
  await transport.join({});
  assert.equal(transport.operationEvidence().counts.join.attempts, 1);
});
