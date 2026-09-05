import {
  readableReferenceTarget,
  referenceMaterialGroups,
  reviewMaterialReferences,
} from '../../client/src/features/review/review-materials';
import {
  referenceUiMention,
  referenceUiPreview,
  reviewUiTurn,
} from './fixtures/review-ui';

describe('review material usage boundaries', () => {
  it('keeps repeated attachment refs together while preserving every contributing turn', () => {
    const first = reviewUiTurn(1);
    first.attachmentRefs = ['ATT-A', 'ATT-A'];
    first.engineerSuppliedInput.attachmentRefs = ['ATT-A', 'ATT-B'];
    const second = reviewUiTurn(2);
    second.attachmentRefs = ['ATT-A'];
    expect(reviewMaterialReferences([second, first])).toEqual({
      attachments: [
        { ref: 'ATT-A', turnNos: [1, 2] },
        { ref: 'ATT-B', turnNos: [1] },
      ],
      citedSources: [],
    });
  });

  it('deduplicates source locations, not documents, and retains historical candidate revision attribution', () => {
    const first = reviewUiTurn(1, true);
    first.assistantCandidate!.sourceRefs = ['SRC-1', 'SRC-1', 'SRC-2'];
    const second = reviewUiTurn(2, true);
    second.inputRevision = 8;
    const result = reviewMaterialReferences([first, second]);
    expect(result.attachments).toEqual([]);
    expect(result.citedSources).toEqual([
      {
        sourceRef: 'SRC-1',
        citations: [
          { turnNo: 1, inputRevision: 7 },
          { turnNo: 2, inputRevision: 8 },
        ],
      },
      { sourceRef: 'SRC-2', citations: [{ turnNo: 1, inputRevision: 7 }] },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /adopted|readAt|selected|documentCount/,
    );
  });

  it('groups repeated mentions by the Host target and retains an ungrouped unresolved occurrence', () => {
    const first = referenceUiMention('M1');
    const second = referenceUiMention('M2');
    const preview = referenceUiPreview([first, second]);
    preview.mentions.push({
      ...referenceUiMention('M3'),
      targetResolution: { status: 'UNRESOLVED' },
    });
    const groups = referenceMaterialGroups(preview);
    expect(
      groups.map((group) =>
        group.mentions.map((mention) => mention.mentionRef),
      ),
    ).toEqual([['M1', 'M2'], ['M3']]);
    expect(readableReferenceTarget(groups[1].mentions)).toBeNull();
  });

  it.each(['DENIED', 'NOT_CHECKED'] as const)(
    'does not expose target navigation when a grouped reference is %s',
    (permissionState) => {
      const first = referenceUiMention('M1');
      const second = { ...referenceUiMention('M2'), permissionState };
      expect(readableReferenceTarget([first, second])).toBeNull();
    },
  );

  it('opens only the exact authorized target and does not turn resolution into reading or adoption', () => {
    const mention = referenceUiMention('M1');
    expect(readableReferenceTarget([mention])).toEqual({
      workItemId: 'WI-RELATED',
      businessRevision: 'R1',
    });
    expect(mention.evidenceStance).toBe('NOT_EVALUATED');
    expect(mention.targetApplicability).toBe('NOT_EVALUATED');
    const different = referenceUiMention('M2');
    different.targetResolution = {
      status: 'RESOLVED_EXACT',
      workItemId: 'WI-OTHER',
      documentVersionId: 'DV-OTHER',
      canonicalDocumentNumber: '777-34-0425',
      businessRevision: 'R2',
    };
    expect(readableReferenceTarget([mention, different])).toBeNull();
  });
});
