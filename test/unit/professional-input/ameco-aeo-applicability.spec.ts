import type { SourceBoundAeoEffectivity } from '../../../server/modules/professional-input/builders/ameco-aeo-structure.builder';
import { buildAeoDeterministicApplicability } from '../../../server/modules/professional-input/builders/structured-parse-package.builder';

describe('AMECO AEO grouped applicability', () => {
  it('keeps each aircraft model correlated with only its declared registrations', () => {
    const applicability = buildAeoDeterministicApplicability(
      effectivity(),
      'module-aeo',
    );
    const expression = applicability.normalizedCandidates[0].expression;

    expect(expression).toEqual({
      operator: 'any',
      children: [
        {
          operator: 'all',
          children: [
            {
              operator: 'predicate',
              predicate: {
                property: 'model',
                comparator: 'eq',
                values: ['B787-9'],
              },
            },
            {
              operator: 'predicate',
              predicate: {
                property: 'registrationNumber',
                comparator: 'in',
                values: ['B-1466'],
              },
            },
          ],
        },
        {
          operator: 'all',
          children: [
            {
              operator: 'predicate',
              predicate: {
                property: 'model',
                comparator: 'eq',
                values: ['B737-8'],
              },
            },
            {
              operator: 'predicate',
              predicate: {
                property: 'registrationNumber',
                comparator: 'in',
                values: ['B-1234'],
              },
            },
          ],
        },
      ],
    });
  });
});

function effectivity(): SourceBoundAeoEffectivity {
  return {
    semanticState: 'CONTENT',
    effectivityStructured: true,
    unstructuredReason: null,
    groups: [
      group('G1', 'B787-9', ['B-1466'], 'SU-G1', 'SR-G1'),
      group('G2', 'B737-8', ['B-1234'], 'SU-G2', 'SR-G2'),
    ],
  };
}

function group(
  groupId: string,
  aircraftModel: string,
  aircraftRegistrations: string[],
  sourceUnitId: string,
  sourceRefId: string,
) {
  return {
    groupId,
    aircraftModel,
    declaredAircraftCount: aircraftRegistrations.length,
    aircraftRegistrations,
    zoneId: `${groupId}-ZONE`,
    workTypeId: `${groupId}-WORK`,
    phaseId: `${groupId}-PHASE`,
    applicabilitySourceUnitIds: [sourceUnitId],
    applicabilitySourceRefIds: [sourceRefId],
    sourceUnitIds: [sourceUnitId],
    sourceRefIds: [sourceRefId],
  };
}
