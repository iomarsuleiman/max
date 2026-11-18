/**
 * Max 2.0 PR14: a fail-closed A/B evidence harness, NOT a production provider.
 * Scenario outcomes are supplied by independently-run integration tests and
 * cannot, by themselves, establish authentication or permission to edit.
 */
import {
  inspectLegacyContent, probeCollaborationCodec,
  type CollaborationCodec, type TransportCandidate, type VerifiedLegacyContent,
} from "./collaborationCodec";

export const REQUIRED_PROVIDER_SCENARIOS = [
  "real-blocknote-mount",
  "custom-block-roundtrip",
  "two-client-convergence",
  "three-client-concurrent-edits",
  "disconnect-reconnect",
  "offline-crash-restart",
  "revocation-mid-session",
  "undo-redo",
  "rtl-ime-and-selection",
  "tables-columns-and-media",
  "history-and-remote-mutations",
  "performance-100-1000-5000-blocks",
] as const;

export type ProviderScenario = (typeof REQUIRED_PROVIDER_SCENARIOS)[number];
export type EvidenceStatus = "pass" | "fail" | "not-run";

export interface ProviderScenarioEvidence {
  scenario: ProviderScenario;
  status: EvidenceStatus;
  /** Measured elapsed time; only used for review, never automatic selection. */
  durationMs?: number;
}

export interface ProviderSpikeEvidence {
  candidate: TransportCandidate;
  /** Self-declared: a reviewer must verify the package, trace and test environment. */
  integration: "not-run" | "fixture-harness" | "real-provider";
  packageName: string | null;
  scenarios: readonly ProviderScenarioEvidence[];
}

export interface ProviderEvaluation {
  candidate: TransportCandidate;
  codecCompatible: boolean;
  completed: number;
  total: number;
  blockers: readonly string[];
  /** An invitation to independent review, NOT evidence of server-side authorization. */
  eligibleForIndependentReview: boolean;
  canEnableCollaboration: false;
}

const required = new Set<string>(REQUIRED_PROVIDER_SCENARIOS);

export function evaluateTransportCandidate<Wire>(
  source: VerifiedLegacyContent,
  codec: CollaborationCodec<Wire>,
  evidence: ProviderSpikeEvidence,
): ProviderEvaluation {
  const blockers: string[] = [];
  let codecCompatible = false;
  try {
    const verified = inspectLegacyContent(source.raw, source.schemaVersion);
    if (verified.canonical !== source.canonical ||
        verified.blockIds.length !== source.blockIds.length) {
      throw new Error("Source fixture does not match its verified snapshot");
    }
    const probe = probeCollaborationCodec(verified, codec);
    codecCompatible = probe.compatible;
    if (!probe.compatible) blockers.push("Lossless codec failed: " + (probe.reason ?? "unknown"));
  } catch {
    blockers.push("Invalid or changed legacy source");
  }

  if (!evidence || evidence.candidate !== codec.candidate) {
    blockers.push("Provider candidate does not match the evidence");
  }
  if (evidence?.integration !== "real-provider" ||
      !evidence.packageName || evidence.packageName.length > 150) {
    blockers.push("Real provider/package integration is not evidenced");
  }
  const cases = Array.isArray(evidence?.scenarios) ? evidence.scenarios : [];
  const seen = new Set<string>();
  if (cases.length > REQUIRED_PROVIDER_SCENARIOS.length) {
    blockers.push("Unexpected number of scenario results");
  }
  let completed = 0;
  for (const result of cases) {
    if (!result || !required.has(result.scenario) || seen.has(result.scenario)) {
      blockers.push("Unknown or duplicated scenario result");
      continue;
    }
    seen.add(result.scenario);
    if (result.durationMs !== undefined &&
        (!Number.isFinite(result.durationMs) || result.durationMs < 0 || result.durationMs > 120_000)) {
      blockers.push("Invalid performance measurement: " + result.scenario);
    }
    if (result.status === "pass") completed++;
    else if (result.status === "fail" || result.status === "not-run") {
      blockers.push("Scenario not passed: " + result.scenario);
    } else blockers.push("Invalid scenario result: " + result.scenario);
  }
  for (const scenario of REQUIRED_PROVIDER_SCENARIOS) {
    if (!seen.has(scenario)) blockers.push("Missing scenario: " + scenario);
  }
  return {
    candidate: codec.candidate,
    codecCompatible,
    completed,
    total: REQUIRED_PROVIDER_SCENARIOS.length,
    blockers,
    eligibleForIndependentReview: blockers.length === 0,
    canEnableCollaboration: false,
  };
}

/** A/B analysis remains deferred even if all self-reported experiments pass. */
export function compareTransportCandidates(
  reports: readonly ProviderEvaluation[],
): {
  compared: boolean;
  selected: null;
  canEnableCollaboration: false;
  blockers: readonly string[];
} {
  const names = new Set(reports.map((report) => report.candidate));
  const compared = reports.length === 2 &&
    names.has("convex-prosemirror-sync") && names.has("blocknote-yjs");
  const blockers = [
    ...(!compared ? ["Both distinct provider reports are required"] : []),
    ...reports.flatMap((report) =>
      report.blockers.map((blocker) => report.candidate + ": " + blocker)),
    "Independent editor compatibility, authenticated server authorization and release review are mandatory",
  ];
  return { compared, selected: null, canEnableCollaboration: false, blockers };
}
