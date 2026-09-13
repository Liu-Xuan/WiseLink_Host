import { bindOriginalApplicabilityCandidate } from '../../server/modules/canonical-host/original-applicability-candidate';
import type {
  ApplicabilityCandidateContract,
  ApplicabilityTaskContract,
} from '../../server/modules/canonical-host/canonical-host-openclaw-applicability.contract';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  const base = original.source.units[0];
  original.source.units = [
    {
      ...base,
      unitId: 'h1',
      kind: 'heading',
      payload: { text: 'Effectivity', level: 1 },
    },
    {
      ...base,
      unitId: 'condition',
      payload: { text: 'Applicable to model B737-8.' },
    },
    {
      ...base,
      unitId: 'h2',
      kind: 'heading',
      payload: { text: 'Procedure', level: 1 },
    },
    {
      ...base,
      unitId: 'limit',
      payload: { text: 'Only when option X is installed.' },
    },
    { ...base, unitId: 'step1', payload: { text: 'Inspect the valve.' } },
    { ...base, unitId: 'step2', payload: { text: 'Record the reading.' } },
    {
      ...base,
      unitId: 'h3',
      kind: 'heading',
      payload: { text: 'Appendix', level: 1 },
    },
    {
      ...base,
      unitId: 'appendix',
      payload: { text: 'Reference information.' },
    },
  ].map((unit, order) => ({ ...unit, order }));
  original.coverage.unresolvedRanges = [];
  const expressions = [
    {
      expressionId: 'doc',
      sourceRefIds: base.sourceRefIds,
      extractionStatus: 'extracted',
      expressionAst: { type: 'literal', value: true },
      original: {
        quote: { unitId: 'condition', text: 'Applicable to model B737-8.' },
        scope: { kind: 'document', headingUnitId: 'h1', targetUnitIds: [] },
      },
    },
    {
      expressionId: 'inline',
      sourceRefIds: base.sourceRefIds,
      extractionStatus: 'extracted',
      expressionAst: { type: 'literal', value: true },
      original: {
        quote: { unitId: 'limit', text: 'Only when option X is installed.' },
        scope: {
          kind: 'unit',
          headingUnitId: 'h2',
          targetUnitIds: ['step1', 'step2'],
        },
      },
    },
  ];
  const candidate = {
    originalBinding: original.binding,
    expressions,
    unitDispositions: original.source.units.map((unit) => ({
      unitId: unit.unitId,
      disposition: ['condition', 'limit'].includes(unit.unitId)
        ? 'CONDITIONS'
        : 'NO_CONDITION',
      conditionIds:
        unit.unitId === 'condition'
          ? ['doc']
          : unit.unitId === 'limit'
            ? ['inline']
            : [],
    })),
  } as ApplicabilityCandidateContract;
  const task = {
    originalInput: original,
  } as unknown as ApplicabilityTaskContract;
  return { candidate, task, original };
}

describe('original applicability evidence binding', () => {
  it('retains every actual inline target separately from the quote unit', () => {
    const { candidate, task } = fixture();
    const result = bindOriginalApplicabilityCandidate(candidate, task);
    expect(result.unknowns).toEqual([]);
    expect(
      result.targetBindings
        .get('inline')
        ?.map((item) => [item.targetId, item.contentRef]),
    ).toEqual([
      ['step1', 'step1'],
      ['step2', 'step2'],
    ]);
  });
  it.each(['fabricated condition', '   ', 'condition'])(
    'rejects non-source quote %p',
    (text) => {
      const { candidate, task } = fixture();
      candidate.expressions[0].original!.quote.text = text;
      expect(() => bindOriginalApplicabilityCandidate(candidate, task)).toThrow(
        'QUOTE_BINDING_INVALID',
      );
    },
  );
  it('rejects a skipped source unit', () => {
    const { candidate, task } = fixture();
    candidate.unitDispositions!.pop();
    expect(() => bindOriginalApplicabilityCandidate(candidate, task)).toThrow(
      'DISPOSITION_COVERAGE_INVALID',
    );
  });
  it('keeps a cross-section target unknown', () => {
    const { candidate, task } = fixture();
    candidate.expressions[1].original!.scope.targetUnitIds = ['appendix'];
    expect(
      bindOriginalApplicabilityCandidate(candidate, task).unknowns,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'UNRESOLVED_INLINE_SCOPE' }),
      ]),
    );
  });
  it('does not treat no extracted conditions as universally applicable', () => {
    const { candidate, task } = fixture();
    candidate.expressions = [];
    candidate.unitDispositions!.forEach((item) => {
      item.disposition = 'NO_CONDITION';
      item.conditionIds = [];
    });
    expect(
      bindOriginalApplicabilityCandidate(candidate, task).unknowns,
    ).toEqual([
      expect.objectContaining({ reason: 'MISSING_DOCUMENT_EFFECTIVITY' }),
    ]);
  });
  it('keeps unread source coverage unknown', () => {
    const { candidate, task, original } = fixture();
    original.coverage.unresolvedRanges = [
      { reason: 'UNREAD', pageIndexes: [2], unitIds: [], message: 'Not read' },
    ];
    expect(
      bindOriginalApplicabilityCandidate(candidate, task).unknowns,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'UNREAD_SOURCE_RANGE' }),
      ]),
    );
  });
  it('rejects candidates from another parse', () => {
    const { candidate, task } = fixture();
    candidate.originalBinding = {
      ...candidate.originalBinding!,
      parseRunId: 'different',
    };
    expect(() => bindOriginalApplicabilityCandidate(candidate, task)).toThrow(
      'CANDIDATE_BINDING_MISMATCH',
    );
  });
});
