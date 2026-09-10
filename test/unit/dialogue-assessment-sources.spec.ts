import 'reflect-metadata';
import type { AssessmentEvidence } from '../../shared/assessment-reading.interface';
import { CanonicalHostOpenClawReviewService } from '../../server/modules/canonical-host/canonical-host-openclaw-review.service';
import { readStoredOverallEvidence } from '../../server/modules/canonical-host/overall-assessment-reading';

const catalog: AssessmentEvidence[] = Array.from(
  { length: 21 },
  (_, index) => ({
    evidenceRef: `dialogue-contribution:request:c${index}:1`,
    kind: 'ENGINEER_STATEMENT',
    origin: 'REVIEW_CONVERSATION',
    title: '对话补充 · 模型候选 · HYPOTHESIS',
    versionLabel: '贡献修订 1',
    excerpt: JSON.stringify({
      selectedText: `原文${index}`,
      sourcePart: 'ASSISTANT',
      kind: 'HYPOTHESIS',
      sourceContext: [{ userText: '原始问题' }],
    }),
    reviewConversationId: 'RC-1',
    reviewTurnId: 'RT-1',
    engineerSuppliedInputId: 'ESI-1',
    recordedAt: '2026-09-10T00:00:00Z',
    dialogueSource: {
      requestRef: 'request',
      contributionRef: `c${index}`,
      revision: 1,
      contextWorkItemIds: ['WI-A', 'WI-B'],
    },
  }),
);

describe('dialogue collection runtime source reads', () => {
  it('reads all 21 original snapshots across batches, records exact reads, rejects foreign refs and propagates revoked access', async () => {
    const authorize = jest.fn().mockResolvedValue({
      row: { operationRef: 'AQ-1' },
      contract: { resourceRefs: [], jobAidContext: { sourceCatalog: catalog } },
    });
    const record = jest.fn();
    const service = Object.assign(
      Object.create(CanonicalHostOpenClawReviewService.prototype),
      {
        requiredReviewAttempt: authorize,
        dispatch: { recordEvidenceActivity: record },
      },
    ) as CanonicalHostOpenClawReviewService;
    const refs = catalog.map((item) => item.evidenceRef);
    const first = await service.readSourceRefs('AQ-1', refs.slice(0, 20));
    const second = await service.readSourceRefs('AQ-1', refs.slice(20));
    expect(
      [...first.sourceRefs, ...second.sourceRefs].map((item) => item.excerpt),
    ).toEqual(catalog.map((item) => item.excerpt));
    expect(record.mock.calls.map((call) => call[1].sourceRefIds)).toEqual([
      refs.slice(0, 20),
      refs.slice(20),
    ]);
    await expect(
      service.readSourceRefs('AQ-1', ['foreign-ref']),
    ).rejects.toMatchObject({ code: 'REVIEW_SOURCE_REF_NOT_ALLOWED' });
    authorize.mockRejectedValueOnce(
      new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'),
    );
    await expect(service.readSourceRefs('AQ-1', [refs[0]])).rejects.toThrow(
      'JOBAID_SOURCE_AUTHORIZATION_CHANGED',
    );
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('preserves source ACL context and provenance when saved evidence is read back', () => {
    expect(
      readStoredOverallEvidence(JSON.parse(JSON.stringify(catalog))),
    ).toEqual(catalog);
  });
});
