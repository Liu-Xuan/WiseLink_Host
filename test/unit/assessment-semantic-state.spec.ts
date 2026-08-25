import {
  classifyResourceAvailability,
} from '../../server/modules/assessment-workbench/evaluation-context.service';

describe('assessment semantic state', () => {
  it('keeps explicit predicate FALSE as NOT_APPLICABLE even with source candidates', () => {
    expect(
      classifyResourceAvailability({
        item: item('FALSE'),
        confirmedReview: true,
        sourceCandidateCount: 3,
        adoptionCount: 1,
      }),
    ).toBe('NOT_APPLICABLE');
  });

  it('keeps predicate UNKNOWN as MISSING when FleetFacts/installation input is absent', () => {
    expect(
      classifyResourceAvailability({
        item: item('UNKNOWN'),
        confirmedReview: false,
        sourceCandidateCount: 4,
        adoptionCount: 0,
      }),
    ).toBe('MISSING');
  });

  it('allows a TRUE rule with source-bound candidates to remain candidate-only', () => {
    expect(
      classifyResourceAvailability({
        item: item('TRUE'),
        confirmedReview: false,
        sourceCandidateCount: 2,
        adoptionCount: 0,
      }),
    ).toBe('AVAILABLE_CANDIDATE');
  });

  it('does not let document candidates satisfy a missing controlled predicate', () => {
    expect(
      classifyResourceAvailability({
        item: item('UNKNOWN'),
        confirmedReview: true,
        sourceCandidateCount: 4,
        adoptionCount: 2,
      }),
    ).toBe('MISSING');
  });
});

function item(predicateResult: 'TRUE' | 'FALSE' | 'UNKNOWN') {
  return {
    analysis: { predicateResult },
    evidenceRefCount: 0,
    missingInformation: null,
    status: 'EVIDENCE_MISSING',
  } as any;
}
