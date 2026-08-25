import {
  UNKNOWN,
  evaluateAssertWithTrace,
  evaluateWithTrace,
  evaluateDocumentEffectivitySetWithTrace,
  evaluateInlineRuleSetWithTrace,
  evaluateApplicabilityFragmentSetWithTrace,
} from '../../server/modules/assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import {
  matchAircraftAgainstFragments,
} from '../../server/modules/assessment-workbench/applicability-fleet/applicabilityRuleMatcher';
import {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  resolveFleetSnapshot,
  type FleetMasterDataSource,
} from '../../server/modules/assessment-workbench/applicability-fleet/fleetMasterData';
import {
  evaluateApplicabilityForAircraft,
} from '../../server/modules/assessment-workbench/applicability-fleet/applicabilityFleetEvaluator';

function buildDataSource(overrides: Partial<FleetMasterDataSource> = {}): FleetMasterDataSource {
  return {
    schemaVersion: FLEET_MASTER_DATA_SCHEMA_VERSION,
    sourceSnapshotId: 'FLEET-SNAP-2026-08-01',
    sourceRevisionKey: 'FLEET-REV-77',
    authorityRevision: 'FLEET-AUTH-12',
    sourceAsOf: '2026-08-01',
    assets: [
      {
        assetId: 'ASSET-001',
        assetVersionId: 'ASSET-001-V3',
        aircraftNumber: 'B-1001',
        aliases: [{ aliasValue: 'B-1001-X' }],
        fleetFamily: 'B787',
        aircraftModel: 'B787-9',
        series: 'B787-9',
        msn: '44921',
        deliveryDate: '2017-06-23',
        sourceRef: { sourceTable: 'HostDV.fleetAssets', sourceRecordId: 'rec-001' },
        recordHash: 'sha256:asset-001',
      },
    ],
    facts: [
      {
        factId: 'FACT-SB-1',
        assetId: 'ASSET-001',
        factType: 'sb_incorporation',
        property: 'sbIncorporated',
        qualifier: '737-47-1015',
        value: true,
        validAsOf: '2026-01-12',
        sourceRef: { sourceTable: 'HostDV.sbFacts', sourceRecordId: 'rec-sb-001' },
        recordHash: 'sha256:fact-sb-1',
      },
      {
        factId: 'FACT-PN-1',
        assetId: 'ASSET-001',
        factType: 'fleet_configuration',
        property: 'pnInstalled',
        qualifier: 'GGM-2120',
        value: true,
        validAsOf: '2026-02-01',
        sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-001' },
        recordHash: 'sha256:fact-pn-1',
      },
      {
        factId: 'FACT-PN-ABSENCE',
        assetId: 'ASSET-001',
        factType: 'fleet_configuration',
        property: 'pnInstalled',
        qualifier: 'ABC-0001',
        value: false,
        validAsOf: '2026-01-05',
        sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-002' },
        recordHash: 'sha256:fact-pn-absence',
      },
      {
        factId: 'FACT-PN-FUTURE',
        assetId: 'ASSET-001',
        factType: 'fleet_configuration',
        property: 'pnInstalled',
        qualifier: 'FTR-0001',
        value: true,
        validAsOf: '2027-01-01',
        sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-003' },
        recordHash: 'sha256:fact-pn-future',
      },
    ],
    ...overrides,
  };
}

describe('applicability-fleet Kleene engine (migrated semantics)', () => {
  it('keeps boolean value typed and normalizes qualifiers before snapshot lookup', () => {
    const trace = evaluateAssertWithTrace(
      {
        property: 'optionInstalled',
        operator: 'eq',
        value: true,
        qualifier: 'wifi',
      },
      {
        assetId: 'ASSET-001',
        assessmentAsOf: '2026-08-25',
        properties: { optionInstalled: { WIFI: true } },
      },
    );
    expect(trace.result).toBe(true);
    expect(trace.blockingUnknowns).toEqual([]);
  });

  it('normalizes SB / P/N / equipment-model qualifiers before snapshot lookup', () => {
    const sbTrace = evaluateAssertWithTrace(
      { property: 'sbIncorporated', operator: 'eq', value: true, qualifier: 'Boeing SB 737 47 1015' },
      {
        assetId: 'ASSET-QUAL-001',
        assessmentAsOf: '2026-08-25',
        properties: { sbIncorporated: { '737471015': true } },
      },
    );
    expect(sbTrace.result).toBe(true);

    const pnTrace = evaluateAssertWithTrace(
      { property: 'pnInstalled', operator: 'eq', value: true, qualifier: 'ggm 2120' },
      {
        assetId: 'ASSET-QUAL-002',
        assessmentAsOf: '2026-08-25',
        properties: { pnInstalled: { GGM2120: true } },
      },
    );
    expect(pnTrace.result).toBe(true);

    const eqTrace = evaluateAssertWithTrace(
      { property: 'equipmentModelInstalled', operator: 'eq', value: true, qualifier: 'ggm 2120' },
      {
        assetId: 'ASSET-QUAL-003',
        assessmentAsOf: '2026-08-25',
        properties: { equipmentModelInstalled: { GGM2120: true } },
      },
    );
    expect(eqTrace.result).toBe(true);
  });

  it('matches model family patterns but not sibling minor models', () => {
    const familyTrace = evaluateAssertWithTrace(
      { property: 'model', operator: 'eq', value: '787' },
      { properties: { model: 'B787-9' } },
    );
    expect(familyTrace.result).toBe(true);

    const minorTrace = evaluateAssertWithTrace(
      { property: 'model', operator: 'eq', value: '787-8' },
      { properties: { model: 'B787-9' } },
    );
    expect(minorTrace.result).toBe(false);
  });

  it('supports deliveryDate comparisons from fleet master data', () => {
    const prior = evaluateAssertWithTrace(
      { property: 'deliveryDate', operator: 'lte', value: '2025-01-01' },
      { properties: { deliveryDate: '2017-06-23' } },
    );
    expect(prior.result).toBe(true);

    const future = evaluateAssertWithTrace(
      { property: 'deliveryDate', operator: 'lte', value: '2025-01-01' },
      { properties: { deliveryDate: '2025-02-01' } },
    );
    expect(future.result).toBe(false);
  });

  it('reports missing qualified P/N fact as fact_unknown after model match', () => {
    const trace = evaluateWithTrace(
      {
        type: 'and',
        children: [
          { type: 'assert', property: 'model', operator: 'eq', value: '787' },
          { type: 'assert', property: 'pnInstalled', operator: 'eq', value: true, qualifier: 'GGM-2120' },
        ],
      },
      { assetId: 'FLEET-B787-003', properties: { model: 'B787-9', pnInstalled: {} } },
    );
    expect(trace.result).toBe(UNKNOWN);
    expect(trace.blockingUnknowns?.[0]?.kind).toBe('fact_unknown');
    expect(trace.blockingUnknowns?.[0]?.property).toBe('pnInstalled');
    expect(trace.blockingUnknowns?.[0]?.qualifier).toBe('GGM2120');
  });

  it('rejects boolean property with non-boolean value as interpretation_unknown', () => {
    const trace = evaluateAssertWithTrace(
      { property: 'optionInstalled', operator: 'eq', value: 'true', qualifier: 'WIFI' },
      { properties: { optionInstalled: { WIFI: true } } },
    );
    expect(trace.result).toBe(UNKNOWN);
    expect(trace.blockingUnknowns?.[0]?.kind).toBe('interpretation_unknown');
    expect(trace.blockingUnknowns?.[0]?.reason).toBe('invalid_value_type');
  });

  it('keeps unregistered properties as interpretation_unknown instead of guessing', () => {
    const trace = evaluateAssertWithTrace(
      { property: 'engineThrust', operator: 'eq', value: 100 },
      { properties: { engineThrust: 100 } },
    );
    expect(trace.result).toBe(UNKNOWN);
    expect(trace.blockingUnknowns?.[0]?.reason).toBe('unsupported_property');
  });

  it('applies Kleene short-circuit for and/or', () => {
    const andTrace = evaluateWithTrace(
      {
        type: 'and',
        children: [
          { type: 'literal', value: false },
          { type: 'assert', property: 'model', operator: 'eq', value: 'A320' },
        ],
      },
      { properties: {} },
    );
    expect(andTrace.result).toBe(false);
    expect(andTrace.blockingUnknowns).toEqual([]);

    const orTrace = evaluateWithTrace(
      {
        type: 'or',
        children: [
          { type: 'literal', value: true },
          { type: 'assert', property: 'model', operator: 'eq', value: 'A320' },
        ],
      },
      { properties: {} },
    );
    expect(orTrace.result).toBe(true);
    expect(orTrace.blockingUnknowns).toEqual([]);
  });

  it('propagates unknown through not without inventing a value', () => {
    const trace = evaluateWithTrace(
      { type: 'not', child: { type: 'assert', property: 'model', operator: 'eq', value: 'A320' } },
      { properties: {} },
    );
    expect(trace.result).toBe(UNKNOWN);
  });

  it('combines document effectivity fragments by OR', () => {
    const trace = evaluateDocumentEffectivitySetWithTrace(
      [
        {
          ruleFragmentId: 'frag_doc_1',
          applicabilityLevel: 'document_effectivity',
          extractionStatus: 'extracted',
          expressionAst: { type: 'assert', property: 'model', operator: 'eq', value: 'B737-8' },
        },
        {
          ruleFragmentId: 'frag_doc_2',
          applicabilityLevel: 'document_effectivity',
          extractionStatus: 'extracted',
          expressionAst: { type: 'assert', property: 'model', operator: 'eq', value: 'A320' },
        },
      ],
      { properties: { model: 'A320' } },
    );
    expect(trace.result).toBe(true);
  });

  it('keeps extraction_failed inline rules as interpretation_unknown', () => {
    const trace = evaluateInlineRuleSetWithTrace(
      [
        {
          ruleFragmentId: 'frag_inline_ok',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          expressionAst: { type: 'literal', value: true },
        },
        {
          ruleFragmentId: 'frag_inline_failed',
          applicabilityLevel: 'inline',
          extractionStatus: 'extraction_failed',
          rawText: 'minor models only',
        },
      ],
      { properties: {} },
    );
    expect(trace.result).toBe(UNKNOWN);
    expect(trace.blockingUnknowns?.[0]?.kind).toBe('interpretation_unknown');
    expect(trace.blockingUnknowns?.[0]?.reason).toBe('extraction_failed');
  });

  it('defaults to AND for same-scope inline conditions and honors alternativeGroup OR', () => {
    const andTrace = evaluateInlineRuleSetWithTrace(
      [
        {
          ruleFragmentId: 'frag_a',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          expressionAst: { type: 'literal', value: true },
        },
        {
          ruleFragmentId: 'frag_b',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          expressionAst: { type: 'literal', value: false },
        },
      ],
      { properties: {} },
    );
    expect(andTrace.result).toBe(false);

    const orTrace = evaluateInlineRuleSetWithTrace(
      [
        {
          ruleFragmentId: 'frag_alt_1',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          alternativeGroup: 'A',
          expressionAst: { type: 'literal', value: false },
        },
        {
          ruleFragmentId: 'frag_alt_2',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          alternativeGroup: 'A',
          expressionAst: { type: 'literal', value: true },
        },
        {
          ruleFragmentId: 'frag_alt_3',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          expressionAst: { type: 'literal', value: true },
        },
      ],
      { properties: {} },
      { inlineTemplate: { multiPatternCombination: 'or' } },
    );
    expect(orTrace.result).toBe(true);
  });

  it('short-circuits the fragment set on document effectivity false', () => {
    const trace = evaluateApplicabilityFragmentSetWithTrace(
      [
        {
          ruleFragmentId: 'frag_doc_false',
          applicabilityLevel: 'document_effectivity',
          extractionStatus: 'extracted',
          expressionAst: { type: 'literal', value: false },
        },
        {
          ruleFragmentId: 'frag_inline_unknown',
          applicabilityLevel: 'inline',
          extractionStatus: 'extracted',
          expressionAst: { type: 'assert', property: 'pnInstalled', operator: 'eq', value: true, qualifier: 'GGM-2120' },
        },
      ],
      { properties: {} },
    );
    expect(trace.result).toBe(false);
    expect(trace.inheritedFrom).toBe('document_effectivity_short_circuit');
  });
});

describe('applicability-fleet rule matcher (aircraft-number applicability)', () => {
  const aircraft = {
    fleetFamily: 'B787',
    aircraftModel: 'B787',
    series: 'B787-9',
    msn: '34308',
    aircraftNumber: 'B-7800',
    aliases: [],
  };

  it('matches model and msn hits as applicable', () => {
    const result = matchAircraftAgainstFragments(aircraft, [
      {
        ruleFragmentId: 'frag_1',
        appliesToModels: ['787'],
        appliesToMsnRanges: [{ from: '32000', to: '36000' }],
      },
    ]);
    expect(result.decision).toBe('applicable');
    expect(result.matchedIds).toEqual(['frag_1']);
  });

  it('returns not_applicable for out-of-range msn', () => {
    const result = matchAircraftAgainstFragments(
      { ...aircraft, msn: '40000' },
      [
        {
          ruleFragmentId: 'frag_2',
          appliesToModels: ['787'],
          appliesToMsnRanges: [{ from: '32000', to: '36000' }],
        },
      ],
    );
    expect(result.decision).toBe('not_applicable');
  });

  it('matches aircraftNumber lists (L0) including registration aliases', () => {
    const result = matchAircraftAgainstFragments(
      { ...aircraft, aliases: [{ aliasValue: 'B-7800-ALT' }] },
      [{ ruleFragmentId: 'frag_l0', appliesToAircraftNumbers: ['b-7800-alt'] }],
    );
    expect(result.decision).toBe('applicable');
    expect(result.matchedIds).toEqual(['frag_l0']);
  });

  it('keeps 737NG and 737MAX as disjoint branches below B737', () => {
    const ngAsset = {
      fleetFamily: 'B737',
      aircraftModel: 'B737-89L',
      series: 'B737-800',
      msn: '41313',
      aircraftNumber: 'B-5851',
      aliases: [],
    };
    const maxAsset = {
      fleetFamily: 'B737',
      aircraftModel: 'B737-8',
      series: 'B737-8',
      msn: '65001',
      aircraftNumber: 'B-TEST-MAX8',
      aliases: [],
    };
    expect(
      matchAircraftAgainstFragments(ngAsset, [
        { ruleFragmentId: 'frag_ng', appliesToModels: ['737NG'] },
      ]).decision,
    ).toBe('applicable');
    expect(
      matchAircraftAgainstFragments(maxAsset, [
        { ruleFragmentId: 'frag_ng', appliesToModels: ['737NG'] },
      ]).decision,
    ).toBe('not_applicable');
    expect(
      matchAircraftAgainstFragments(maxAsset, [
        { ruleFragmentId: 'frag_max', appliesToModels: ['737MAX'] },
      ]).decision,
    ).toBe('applicable');
  });

  it('keeps bare A320 below the A320s fleet family for A319 assets', () => {
    const a319 = {
      fleetFamily: 'A320s',
      aircraftModel: 'A319-115',
      series: 'A319-100',
      msn: '02499',
      aircraftNumber: 'B-2364',
      aliases: [],
    };
    const a320 = {
      fleetFamily: 'A320s',
      aircraftModel: 'A320-214',
      series: 'A320-200',
      msn: '3500',
      aircraftNumber: 'B-TEST-A320',
      aliases: [],
    };
    expect(
      matchAircraftAgainstFragments(a319, [
        { ruleFragmentId: 'frag_a320', appliesToModels: ['A320'] },
      ]).decision,
    ).toBe('not_applicable');
    expect(
      matchAircraftAgainstFragments(a320, [
        { ruleFragmentId: 'frag_a320', appliesToModels: ['A320'] },
      ]).decision,
    ).toBe('applicable');
  });

  it('returns unknown when no fragments are available', () => {
    const result = matchAircraftAgainstFragments(aircraft, []);
    expect(result.decision).toBe('unknown');
  });
});

describe('applicability-fleet FleetMasterData resolution', () => {
  it('resolves an aircraft by number and alias, filtering facts by asOf', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-1001-X',
      asOf: '2026-08-25',
    });
    expect(resolution.status).toBe('RESOLVED');
    expect(resolution.snapshot?.assetId).toBe('ASSET-001');
    expect(resolution.snapshot?.assessmentAsOf).toBe('2026-08-25');
    expect(
      (resolution.snapshot?.properties.sbIncorporated as Record<string, unknown>)?.['737471015'],
    ).toBe(true);
    // Explicit absence is a fact; future facts are excluded by asOf.
    expect(
      (resolution.snapshot?.properties.pnInstalled as Record<string, unknown>)?.['ABC0001'],
    ).toBe(false);
    expect(
      (resolution.snapshot?.properties.pnInstalled as Record<string, unknown>)?.FTR0001,
    ).toBeUndefined();
  });

  it('preserves source refs, assetVersionId, recordHash and currentness on resolution', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
    });
    expect(resolution.provenance?.assetVersionId).toBe('ASSET-001-V3');
    expect(resolution.provenance?.recordHash).toBe('sha256:asset-001');
    expect(resolution.provenance?.sourceRefs.length).toBeGreaterThan(0);
    expect(resolution.sourceCurrentness.status).toBe('CURRENT');
    expect(resolution.sourceCurrentness.sourceSnapshotId).toBe('FLEET-SNAP-2026-08-01');
    expect(resolution.sourceCurrentness.sourceRevisionKey).toBe('FLEET-REV-77');
    expect(resolution.sourceCurrentness.authorityRevision).toBe('FLEET-AUTH-12');
  });

  it('returns WAITING_INPUT with an observable missing fact for unknown aircraftNumber', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-NOT-EXIST',
      asOf: '2026-08-25',
    });
    expect(resolution.status).toBe('WAITING_INPUT');
    expect(resolution.snapshot).toBeNull();
    expect(resolution.missingFacts[0].kind).toBe('missing_fleet_fact');
    expect(resolution.missingFacts[0].property).toBe('aircraftNumber');
    expect(resolution.missingFacts[0].reason).toContain('FLEET_ASSET_NOT_FOUND_FOR_AIRCRAFT_NUMBER');
  });

  it('rejects unsupported FleetMasterData schema versions', () => {
    expect(() =>
      resolveFleetSnapshot({
        dataSource: { ...buildDataSource(), schemaVersion: 'wiselink.v0_11.fleet' },
        aircraftNumber: 'B-1001',
        asOf: '2026-08-25',
      }),
    ).toThrow('FLEET_MASTER_DATA_SCHEMA_VERSION_UNSUPPORTED');
  });

  it('marks currentness UNVERIFIED when the fleet source snapshot identity is incomplete', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource({ sourceSnapshotId: null, sourceRevisionKey: null }),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
    });
    expect(resolution.sourceCurrentness.status).toBe('UNVERIFIED');
    expect(resolution.sourceCurrentness.reason).toBe('FLEET_SOURCE_SNAPSHOT_IDENTITY_MISSING');
  });

  it('blocks conflicting qualified facts as WAITING_INPUT with evidence, no silent overwrite', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource({
        facts: [
          {
            factId: 'FACT-PN-CONFLICT-A',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'GGM-2120',
            value: true,
            validAsOf: '2026-01-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-conflict-a' },
            recordHash: 'sha256:fact-pn-conflict-a',
          },
          {
            factId: 'FACT-PN-CONFLICT-B',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'GGM 2120',
            value: false,
            validAsOf: '2026-03-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-conflict-b' },
            recordHash: 'sha256:fact-pn-conflict-b',
          },
        ],
      }),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
    });
    expect(resolution.status).toBe('WAITING_INPUT');
    expect(resolution.snapshot).toBeNull();
    expect(resolution.conflictingFacts).toHaveLength(1);
    const conflict = resolution.conflictingFacts[0];
    expect(conflict.kind).toBe('conflicting_fleet_fact');
    expect(conflict.property).toBe('pnInstalled');
    expect(conflict.qualifier).toBe('GGM2120');
    expect(conflict.reason).toContain('FLEET_FACT_CONFLICT');
    expect(conflict.conflicts.map((entry) => entry.factId).sort()).toEqual(
      ['FACT-PN-CONFLICT-A', 'FACT-PN-CONFLICT-B'],
    );
    for (const evidence of conflict.conflicts) {
      expect(evidence.sourceRef.sourceRecordId).toBeTruthy();
      expect(evidence.recordHash.startsWith('sha256:')).toBe(true);
    }
    expect(resolution.provenance.assetVersionId).toBe('ASSET-001-V3');
  });

  it('treats same-value duplicate qualified facts as non-conflicting', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource({
        facts: [
          {
            factId: 'FACT-PN-DUP-A',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'GGM-2120',
            value: true,
            validAsOf: '2026-01-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-dup-a' },
            recordHash: 'sha256:fact-pn-dup-a',
          },
          {
            factId: 'FACT-PN-DUP-B',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'ggm 2120',
            value: true,
            validAsOf: '2026-03-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-dup-b' },
            recordHash: 'sha256:fact-pn-dup-b',
          },
        ],
      }),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
    });
    expect(resolution.status).toBe('RESOLVED');
    expect(resolution.conflictingFacts).toHaveLength(0);
    expect(resolution.snapshot.properties.pnInstalled.GGM2120).toBe(true);
  });

  it('does not misreport different qualifiers or future asOf facts as conflicts', () => {
    const resolution = resolveFleetSnapshot({
      dataSource: buildDataSource({
        facts: [
          {
            factId: 'FACT-PN-1',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'GGM-2120',
            value: true,
            validAsOf: '2026-02-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-001' },
            recordHash: 'sha256:fact-pn-1',
          },
          {
            factId: 'FACT-PN-OTHER-QUALIFIER',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'OTHER-0001',
            value: true,
            validAsOf: '2026-01-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-other' },
            recordHash: 'sha256:fact-pn-other',
          },
        {
      factId: 'FACT-PN-FUTURE-CONFLICTING',
      assetId: 'ASSET-001',
      factType: 'fleet_configuration',
    property: 'pnInstalled',
              qualifier: 'GGM-2120',
              value: false,
              validAsOf: '2027-06-01',
              sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-future' },
              recordHash: 'sha256:fact-pn-future-conflicting',
            },
          ],
        }),
        aircraftNumber: 'B-1001',
        asOf: '2026-08-25',
      });
    expect(resolution.status).toBe('RESOLVED');
    expect(resolution.conflictingFacts).toHaveLength(0);
    expect(resolution.snapshot.properties.pnInstalled.GGM2120).toBe(true);
  });
});

describe('applicability-fleet evaluation gate', () => {
  const modelAssert = {
    type: 'assert' as const,
    property: 'model',
    operator: 'eq',
    value: '787',
  };

  it('evaluates the main path: applicable aircraft passes with full provenance', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
      applicabilityAst: modelAssert,
    });
    expect(result.status).toBe('EVALUATED');
    expect(result.decision).toBe('applicable');
    expect(result.kleeneResult).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.sourceProvenance.assetVersionId).toBe('ASSET-001-V3');
    expect(result.sourceProvenance.recordHash).toBe('sha256:asset-001');
    expect(result.sourceProvenance.sourceRefs.length).toBeGreaterThan(0);
    expect(result.sourceProvenance.sourceCurrentness.status).toBe('CURRENT');
    // assessmentAsOf stays the request asOf, distinct from source currentness.
    expect(result.sourceProvenance.assessmentAsOf).toBe('2026-08-25');
    expect(result.sourceProvenance.sourceCurrentness.sourceAsOf).toBe('2026-08-01');
    expect(result.authorityBoundary.outputAuthorityLevel).toBe('candidate_only');
    expect(result.authorityBoundary.createsEvidenceRef).toBe(false);
  });

  it('never promotes applicability false to PASS', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
      applicabilityAst: {
        type: 'assert',
        property: 'model',
        operator: 'eq',
        value: 'A320',
      },
    });
    expect(result.kleeneResult).toBe(false);
    expect(result.decision).toBe('not_applicable');
    expect(result.pass).toBe(false);
    expect(result.status).toBe('EVALUATED');
  });

  it('enters WAITING_INPUT when the aircraftNumber has no fleet asset', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-NOT-EXIST',
      asOf: '2026-08-25',
      applicabilityAst: modelAssert,
    });
    expect(result.status).toBe('WAITING_INPUT');
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('needs_review');
    expect(
      result.blockingUnknowns.some(
        (entry) => entry.kind === 'missing_fleet_fact' && entry.property === 'aircraftNumber',
      ),
    ).toBe(true);
  });

  it('enters WAITING_INPUT when a necessary fleet fact is missing', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
      applicabilityAst: {
        type: 'and',
        children: [
          modelAssert,
          {
            type: 'assert',
            property: 'pnInstalled',
            operator: 'eq',
            value: true,
            qualifier: 'NOT-RECORDED-PN',
          },
        ],
      },
    });
    expect(result.status).toBe('WAITING_INPUT');
    expect(result.decision).toBe('needs_review');
    expect(result.kleeneResult).toBe(UNKNOWN);
    expect(result.pass).toBe(false);
    expect(
      result.blockingUnknowns.some(
        (entry) => entry.kind === 'fact_unknown' && entry.property === 'pnInstalled',
      ),
    ).toBe(true);
    // Provenance of the resolved asset is still preserved for the record.
    expect(result.sourceProvenance.assetVersionId).toBe('ASSET-001-V3');
  });

  it('enters WAITING_INPUT with pass=false on conflicting qualified facts, evidence preserved', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource({
        facts: [
          {
            factId: 'FACT-PN-CONFLICT-A',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'GGM-2120',
            value: true,
            validAsOf: '2026-01-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-conflict-a' },
            recordHash: 'sha256:fact-pn-conflict-a',
          },
          {
            factId: 'FACT-PN-CONFLICT-B',
            assetId: 'ASSET-001',
            factType: 'fleet_configuration',
            property: 'pnInstalled',
            qualifier: 'GGM 2120',
            value: false,
            validAsOf: '2026-03-01',
            sourceRef: { sourceTable: 'HostDV.componentFacts', sourceRecordId: 'rec-pn-conflict-b' },
            recordHash: 'sha256:fact-pn-conflict-b',
          },
        ],
      }),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
      applicabilityAst: modelAssert,
    });
    expect(result.status).toBe('WAITING_INPUT');
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('needs_review');
    const conflict = result.blockingUnknowns.find(
      (entry) => entry.kind === 'conflicting_fleet_fact',
    );
    expect(conflict).toBeTruthy();
    expect(conflict?.property).toBe('pnInstalled');
    expect(conflict?.conflicts.map((entry: { factId: string }) => entry.factId).sort()).toEqual(
      ['FACT-PN-CONFLICT-A', 'FACT-PN-CONFLICT-B'],
    );
    for (const evidence of conflict?.conflicts ?? []) {
      expect(evidence.sourceRef.sourceRecordId).toBeTruthy();
      expect(evidence.recordHash.startsWith('sha256:')).toBe(true);
    }
    expect(result.sourceProvenance.assetVersionId).toBe('ASSET-001-V3');
  });

  it('stays NOT_EVALUABLE with pass=false when fleet source currentness is not CURRENT', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource({ sourceSnapshotId: null, sourceRevisionKey: null }),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
      applicabilityAst: modelAssert,
    });
    expect(result.status).toBe('NOT_EVALUABLE');
    expect(result.pass).toBe(false);
    expect(result.sourceProvenance.sourceCurrentness.status).toBe('UNVERIFIED');
  });

  it('does not treat assessmentAsOf as fleet currentness', () => {
    const result = evaluateApplicabilityForAircraft({
      dataSource: buildDataSource(),
      aircraftNumber: 'B-1001',
      asOf: '2026-08-25',
      applicabilityAst: modelAssert,
    });
    expect(result.sourceProvenance.assessmentAsOf).not.toBe(
      result.sourceProvenance.sourceCurrentness.sourceSnapshotId,
    );
    expect(result.sourceProvenance.sourceCurrentness.sourceAsOf).toBe('2026-08-01');
  });
});

describe('applicability-fleet boundary: no second evaluator or legacy runtime', () => {
  it('uses the single 3.1 registry — v8-only properties are unsupported', () => {
    const trace = evaluateAssertWithTrace(
      { property: 'operatorCode', operator: 'eq', value: 'ABC' },
      { properties: { operatorCode: 'ABC' } },
    );
    expect(trace.result).toBe(UNKNOWN);
    expect(trace.blockingUnknowns?.[0]?.reason).toBe('unsupported_property');
  });

  it('never resolves unknown legacy clauses into true', () => {
    const trace = evaluateWithTrace(
      {
        type: 'legacy_clause',
        clause: { attribute: 'operatorCode', op: 'in', value: ['ABC'] },
      },
      { properties: {} },
    );
    expect(trace.result).toBe(UNKNOWN);
  });
});
