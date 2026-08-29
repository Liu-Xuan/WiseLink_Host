import { summarizeWorkbenchEvidence } from '../../client/src/features/workbench/evidence-summary';

describe('workbench evidence summary', () => {
  it('reports a true 0/0 state instead of treating the panel component as evidence', () => {
    expect(summarizeWorkbenchEvidence([], null)).toEqual({
      unitCount: 0,
      referenceCount: 0,
      contentCount: 0,
    });
  });

  it('counts real content units and SourceRefs', () => {
    expect(
      summarizeWorkbenchEvidence(
        [
          {
            unitId: 'unit-a',
            kind: 'SECTION',
            text: '正文',
            sourceRefIds: ['source-a', 'source-b'],
            sourceLocators: [],
          },
        ],
        null,
      ),
    ).toEqual({
      unitCount: 1,
      referenceCount: 2,
      contentCount: 3,
    });
  });

  it('counts an explicitly located structured source when query units are empty', () => {
    expect(
      summarizeWorkbenchEvidence([], {
        sourceRefId: 'source-a',
        kind: 'PAGE',
        pageStart: 3,
        pageEnd: 3,
        quote: '受控原文',
      }),
    ).toEqual({
      unitCount: 1,
      referenceCount: 1,
      contentCount: 2,
    });
  });
});
