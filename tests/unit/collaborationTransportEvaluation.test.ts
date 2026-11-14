import { describe, expect, it } from "vitest";
import fixture from "../fixtures/editor-document.json";
import { DOCUMENT_SCHEMA_VERSION, normalizeBlocks } from "@/lib/domain/blocks";
import {
  inspectLegacyContent, type CollaborationCodec,
} from "@/lib/domain/collaborationCodec";
import {
  REQUIRED_PROVIDER_SCENARIOS, compareTransportCandidates,
  evaluateTransportCandidate, type ProviderSpikeEvidence,
} from "@/lib/domain/collaborationTransportEvaluation";

const source = inspectLegacyContent(
  JSON.stringify(normalizeBlocks(fixture)), DOCUMENT_SCHEMA_VERSION,
);
const codec: CollaborationCodec<string> = {
  candidate: "blocknote-yjs",
  encode: (blocks) => JSON.stringify(blocks),
  decode: (wire) => JSON.parse(wire) as unknown,
};
const perfect = (): ProviderSpikeEvidence => ({
  candidate: "blocknote-yjs", integration: "real-provider", packageName: "yjs",
  scenarios: REQUIRED_PROVIDER_SCENARIOS.map((scenario) => ({
    scenario, status: "pass" as const, durationMs: 20,
  })),
});

describe("PR14 transport evidence assessment (not an actual provider test)", () => {
  it("lists the required editor, concurrency, recovery, security and performance checks", () => {
    expect(REQUIRED_PROVIDER_SCENARIOS.length).toBe(12);
    expect(REQUIRED_PROVIDER_SCENARIOS).toContain("revocation-mid-session");
    expect(REQUIRED_PROVIDER_SCENARIOS).toContain("rtl-ime-and-selection");
  });
  it("can designate a complete self-reported case set for independent review, never rollout", () => {
    const report = evaluateTransportCandidate(source, codec, perfect());
    expect(report).toMatchObject({
      codecCompatible: true, completed: 12, total: 12,
      eligibleForIndependentReview: true, canEnableCollaboration: false,
    });
    expect(report.blockers).toEqual([]);
  });
  it("rejects fixture-only evidence and missing provider details", () => {
    const result = evaluateTransportCandidate(source, codec, {
      ...perfect(), integration: "fixture-harness", packageName: null,
    });
    expect(result.eligibleForIndependentReview).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/Real provider/);
  });
  it("fails closed on missing, duplicate, invalid and failed test scenarios", () => {
    const partial = evaluateTransportCandidate(source, codec, {
      ...perfect(), scenarios: [
        { scenario: "real-blocknote-mount", status: "fail" },
        { scenario: "real-blocknote-mount", status: "pass" },
      ],
    });
    expect(partial.eligibleForIndependentReview).toBe(false);
    expect(partial.blockers.join(" ")).toMatch(/duplicated|Missing/i);
    const negative = evaluateTransportCandidate(source, codec, {
      ...perfect(), scenarios: [{ scenario: "undo-redo", status: "pass", durationMs: -3 }],
    });
    expect(negative.blockers.join(" ")).toMatch(/Invalid performance/);
  });
  it("cannot approve a lossy provider codec even with perfect claimed test cases", () => {
    const lossy: CollaborationCodec<string> = {
      candidate: "blocknote-yjs",
      encode: (blocks) => JSON.stringify(blocks),
      decode: (wire) => (JSON.parse(wire) as { id: string }[]).slice(1),
    };
    const report = evaluateTransportCandidate(source, lossy, perfect());
    expect(report.codecCompatible).toBe(false);
    expect(report.eligibleForIndependentReview).toBe(false);
  });
  it("never selects either transport or enables production collaboration", () => {
    const report = evaluateTransportCandidate(source, codec, perfect());
    const comparison = compareTransportCandidates([report, {
      ...report, candidate: "convex-prosemirror-sync",
    }]);
    expect(comparison).toMatchObject({
      compared: true, selected: null, canEnableCollaboration: false,
    });
    expect(compareTransportCandidates([report]).compared).toBe(false);
  });
});
