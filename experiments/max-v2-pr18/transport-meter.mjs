/**
 * PR23 opt-in operational evidence: bounded, payload-free request counters.
 * Not a billing estimator. Network subscriptions and Convex compute are
 * intentionally NOT represented as a total cost or complete call count.
 */
export function createMeteredTransport(transport, now = () => performance.now()) {
  if (!transport || typeof transport.join !== "function" ||
      typeof transport.readUpdates !== "function" ||
      typeof transport.appendUpdate !== "function") {
    throw Error("INVALID_LAB_TRANSPORT");
  }
  const records = {
    join: { attempts: 0, failures: 0, maxElapsedMs: 0 },
    readUpdates: { attempts: 0, failures: 0, maxElapsedMs: 0 },
    appendUpdate: { attempts: 0, failures: 0, maxElapsedMs: 0 },
  };
  let updateRows = 0;
  let encodedReadBytes = 0;
  let encodedWriteBytes = 0;
  const wrap = (name, observe = () => {}) => async args => {
    const record = records[name];
    record.attempts++;
    const started = now();
    try {
      const result = await transport[name](args);
      observe(args, result);
      return result;
    } catch (e) {
      record.failures++;
      throw e;
    } finally {
      const duration = now() - started;
      if (Number.isFinite(duration) && duration >= 0) {
        record.maxElapsedMs = Math.max(record.maxElapsedMs, Math.round(duration));
      }
    }
  };
  return {
    ...transport,
    join: wrap("join"),
    readUpdates: wrap("readUpdates", (_args, result) => {
      for (const update of result.updates ?? []) {
        if (typeof update.base64 === "string") {
          encodedReadBytes += update.base64.length;
          updateRows++;
        }
      }
    }),
    appendUpdate: wrap("appendUpdate", (args) => {
      if (typeof args.base64 === "string") encodedWriteBytes += args.base64.length;
    }),
    operationEvidence: () => JSON.parse(JSON.stringify({
      kind: "synthetic-lab-application-metrics",
      counts: records,
      updateRows, encodedReadBytes, encodedWriteBytes,
      caveat: "Does not measure subscription updates, server compute, storage, real billing or cloud export/restore",
    })),
  };
}
