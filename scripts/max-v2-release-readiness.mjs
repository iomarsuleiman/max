// Max 2.0 PR44: offline, evidence-only release decision. No production access.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUIRED_GATES = Object.freeze([
  'stack_integrity',
  'baseline_issue_42',
  'independent_security_review',
  'live_multi_account_auth',
  'revocation_and_races',
  'isolated_cloud_restore',
  'asset_digest_integrity',
  'retention_export_and_deletion',
  'dependency_review',
  'performance_and_cost_budgets',
  'rtl_accessibility_and_mobile',
  'browser_and_offline_qa',
  'mcp_and_ai_boundary',
  'automation_execution_boundary',
  'rollout_and_rollback',
  'privacy_and_consent',
]);

const SHA = /^[a-f0-9]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validUtc(value) {
  return typeof value === 'string' && UTC.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace(/Z$/, '.000Z');
}

function validEvidenceUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function isReviewer(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{2,80}$/.test(value);
}

function validReview(entry, sha) {
  return isObject(entry) && entry.status === 'verified' &&
    entry.verifiedForSha === sha && validEvidenceUrl(entry.evidenceUrl) &&
    isReviewer(entry.performedBy) && isReviewer(entry.reviewedBy) &&
    entry.performedBy !== entry.reviewedBy && validUtc(entry.reviewedAt);
}

// Inputs are *human-supplied assertions*. A passing result cannot independently
// attest that a GitHub URL, reviewer, cloud restore, or external test is genuine.
export function evaluateReleaseEvidence(evidence, expectedSha = null) {
  const blockers = [];
  if (!isObject(evidence)) return { ready: false, blockers: ['invalid_manifest'] };
  if (evidence.schemaVersion !== 1) blockers.push('schema_version');
  if (evidence.plannedMilestones !== 44 || evidence.createdMilestones !== 44) {
    blockers.push('milestone_inventory');
  }
  const sha = evidence.candidateSha;
  if (typeof sha !== 'string' || !SHA.test(sha)) blockers.push('candidate_sha');
  if (expectedSha !== null && (typeof expectedSha !== 'string' ||
    !SHA.test(expectedSha) || sha !== expectedSha)) blockers.push('stale_candidate_sha');

  const gates = evidence.gates;
  if (!isObject(gates)) {
    blockers.push('missing_gates');
  } else {
    for (const id of Object.keys(gates)) {
      if (!REQUIRED_GATES.includes(id)) blockers.push('unknown_gate:' + id);
    }
    for (const id of REQUIRED_GATES) {
      if (!validReview(gates[id], sha)) blockers.push('unverified_gate:' + id);
    }
  }

  if (evidence.releaseApproved !== true) blockers.push('approval_not_granted');
  const approval = evidence.approval;
  if (!isObject(approval) || approval.approvedForSha !== sha ||
    !isReviewer(approval.approvedBy) || !validUtc(approval.approvedAt) ||
    !validEvidenceUrl(approval.evidenceUrl)) {
    blockers.push('approval_evidence');
  }
  return { ready: blockers.length === 0, blockers };
}

export function verifyReleaseLock(evidence) {
  const assessment = evaluateReleaseEvidence(evidence);
  return evidence?.releaseApproved === false && evidence?.approval === null &&
    !assessment.ready && evidence?.schemaVersion === 1 &&
    evidence?.createdMilestones === 44 &&
    isObject(evidence?.gates) &&
    REQUIRED_GATES.every((id) => evidence.gates[id]?.status === 'pending');
}

const invoked = process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const evidence = JSON.parse(readFileSync(
    new URL('../docs/max-v2-release-evidence.json', import.meta.url), 'utf8'
  ));
  const result = evaluateReleaseEvidence(evidence);
  if (process.argv.includes('--verify-locked')) {
    const locked = verifyReleaseLock(evidence);
    console.log(locked
      ? 'Max 2.0 release LOCKED: ' + result.blockers.length + ' unmet checks; no release authorization'
      : 'Max 2.0 release lock invalid or unexpectedly changed');
    if (!locked) process.exitCode = 1;
  } else if (process.argv.includes('--require-ready')) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
