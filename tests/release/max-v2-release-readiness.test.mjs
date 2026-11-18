import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_GATES, evaluateReleaseEvidence, verifyReleaseLock
} from '../../scripts/max-v2-release-readiness.mjs';

const sha = 'a'.repeat(40);
const proof = 'https://github.com/iomarsuleiman/max/issues/42';
const stamp = '2026-11-15T12:00:00Z';

function verifiedFixture() {
  return {
    schemaVersion: 1, plannedMilestones: 44, createdMilestones: 44,
    candidateSha: sha, releaseApproved: true,
    approval: { approvedForSha: sha, approvedBy: 'independent-owner',
      approvedAt: stamp, evidenceUrl: proof },
    gates: Object.fromEntries(REQUIRED_GATES.map(id => [id, {
      status: 'verified', verifiedForSha: sha, evidenceUrl: proof,
      performedBy: 'operator-one', reviewedBy: 'reviewer-two',
      reviewedAt: stamp,
    }])),
  };
}
function denied(evidence, expected = null) {
  return evaluateReleaseEvidence(evidence, expected);
}
test('all exact-head, independently reviewed assertions permit only a hypothetical ready state', () => {
  assert.equal(denied(verifiedFixture(), sha).ready, true);
});
test('missing evidence fails closed', () => {
  assert.equal(denied(null).ready, false);
  assert.equal(denied({}).ready, false);
});
test('must enumerate all 44 milestones', () => {
  const x = verifiedFixture(); x.createdMilestones = 43;
  assert.equal(denied(x).ready, false);
});
test('requires an actual immutable commit sha and rejects a stale expected head', () => {
  const x = verifiedFixture(); x.candidateSha = null;
  assert.equal(denied(x).ready, false);
  assert.equal(denied(verifiedFixture(), 'b'.repeat(40)).ready, false);
});
test('every required gate must be present', () => {
  const x = verifiedFixture(); delete x.gates.live_multi_account_auth;
  assert.equal(denied(x).ready, false);
});
test('unknown gates cannot masquerade as a reviewed release schema', () => {
  const x = verifiedFixture(); x.gates.fake = x.gates.stack_integrity;
  assert.equal(denied(x).ready, false);
});
test('pending and falsely formatted proof links never certify verification', () => {
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://u:p@site.test',
    'https://site.test/#anchor', '', 'https://site.test/ with-space']) {
    const x = verifiedFixture(); x.gates.stack_integrity.evidenceUrl = url;
    assert.equal(denied(x).ready, false, url);
  }
  const x = verifiedFixture(); x.gates.stack_integrity.status = 'pending';
  assert.equal(denied(x).ready, false);
});
test('same-person self-review cannot satisfy independence marker', () => {
  const x = verifiedFixture();
  x.gates.independent_security_review.reviewedBy = 'operator-one';
  assert.equal(denied(x).ready, false);
});
test('stale, invalid or missing reviewer records fail closed', () => {
  const x = verifiedFixture();
  x.gates.isolated_cloud_restore.verifiedForSha = 'b'.repeat(40);
  assert.equal(denied(x).ready, false);
  x.gates.isolated_cloud_restore.verifiedForSha = sha;
  x.gates.isolated_cloud_restore.reviewedAt = 'tomorrow';
  assert.equal(denied(x).ready, false);
});
test('release requires a separate explicit approval with evidence', () => {
  const x = verifiedFixture(); x.releaseApproved = false;
  assert.equal(denied(x).ready, false);
  x.releaseApproved = true; x.approval.evidenceUrl = null;
  assert.equal(denied(x).ready, false);
});
test('the shipped manifest is locked, blocked, and contains no approval proof', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(
    new URL('../../docs/max-v2-release-evidence.json', import.meta.url), 'utf8'));
  assert.equal(verifyReleaseLock(manifest), true);
  assert.equal(denied(manifest).ready, false);
  assert.equal(manifest.candidateSha, null);
});
test('lock verification denies an accidental approval flip', () => {
  const x = verifiedFixture();
  assert.equal(verifyReleaseLock(x), false);
  x.releaseApproved = false; x.approval = null;
  assert.equal(verifyReleaseLock(x), false);
});
