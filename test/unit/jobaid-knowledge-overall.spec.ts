import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { AssessmentReadingResult } from '../../shared/assessment-reading.interface';

const actor = { tenantId: 'tenant-A', userId: 'owner' } as CanonicalHostActor;
const reading: AssessmentReadingResult = {
  resultRef: 'OVERALL-1', resultRevision: 1,
  scope: { kind: 'WORK_ITEM', workItemId: 'WI-1', documentVersionId: 'DV-1' },
  content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1',
    headline: '综合主题', listBrief: '简明意见', lead: '完整意见',
    claims: [], decisiveClaimIds: [] },
  evidence: [], candidateOnly: true,
};

function setup(overrides: { basedOnJobAidWorkRevisionRef?: string;
  readingResult?: AssessmentReadingResult } = {}) {
  const service = Object.create(
    CanonicalJobAidProblemService.prototype,
  ) as CanonicalJobAidProblemService;
  const revision = { workRevisionRef: 'JAWR-1' };
  const assertEvidenceOwned = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    readAuthorizedBrowserRevision: jest.fn().mockResolvedValue({
      workItem: { source: { documentVersionId: 'DV-1' },
        integratedAssessment: { overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          basedOnJobAidWorkRevisionRef: 'JAWR-1',
          readingResult: reading,
          ...overrides,
        } } },
      revision,
    }),
    assertEvidenceOwned,
  });
  return { service, revision, assertEvidenceOwned };
}

describe('exact Overall in authorized JobAid knowledge reads', () => {
  it('returns the saved result only for its exact work and rechecks evidence', async () => {
    const { service, revision, assertEvidenceOwned } = setup();
    await expect(service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .resolves.toEqual({ revision, overall: { status: 'CANDIDATE_ONLY', readingResult: reading } });
    expect(assertEvidenceOwned).toHaveBeenCalledWith(
      reading.evidence, 'tenant-A', 'owner', 'WI-1',
    );
  });

  it('does not attach an Overall based on another JobAid revision', async () => {
    const { service, revision, assertEvidenceOwned } = setup({
      basedOnJobAidWorkRevisionRef: 'JAWR-OLDER',
    });
    await expect(service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .resolves.toEqual({ revision, overall: null });
    expect(assertEvidenceOwned).not.toHaveBeenCalled();
  });

  it('rejects a mismatched source scope and propagates source revocation', async () => {
    const mismatch = setup({ readingResult: { ...reading,
      scope: { kind: 'WORK_ITEM', workItemId: 'WI-OTHER', documentVersionId: 'DV-1' } } });
    await expect(mismatch.service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .rejects.toThrow('JOBAID_OVERALL_SOURCE_BINDING_INVALID');
    expect(mismatch.assertEvidenceOwned).not.toHaveBeenCalled();

    const revoked = setup();
    revoked.assertEvidenceOwned.mockRejectedValue(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'));
    await expect(revoked.service.readBrowserKnowledgeRevision('WI-1', 'JAWR-1', actor))
      .rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
        message: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  });
});
