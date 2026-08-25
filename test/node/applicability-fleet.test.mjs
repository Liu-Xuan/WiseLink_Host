import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

// Node >= 23.6 strips erasable TS syntax natively, so the applicability-fleet
// modules are imported straight from source (no build, no jest needed).
const modulePath = (name) =>
  pathToFileURL(
    resolve(
      process.cwd(),
      'server/modules/assessment-workbench/applicability-fleet',
      name,
    ),
  );

const {
  UNKNOWN,
  evaluateAssertWithTrace,
  evaluateWithTrace,
  evaluateDocumentEffectivitySetWithTrace,
  evaluateInlineRuleSetWithTrace,
  evaluateApplicabilityFragmentSetWithTrace,
} = await import(modulePath('applicabilityKleeneEngine.ts'));
const { matchAircraftAgainstFragments } = await import(
  modulePath('applicabilityRuleMatcher.ts')
);
const {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  resolveFleetSnapshot,
} = await import(modulePath('fleetMasterData.ts'));
const { evaluateApplicabilityForAircraft } = await import(
  modulePath('applicabilityFleetEvaluator.ts')
);

function buildDataSource(overrides = {}) {
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

test('kleene: qualifier normalization before snapshot lookup (option/SB/PN/equipment)', () => {
  const optionTrace = evaluateAssertWithTrace(
    { property: 'optionInstalled', operator: 'eq', value: true, qualifier: 'wifi' },
    { properties: { optionInstalled: { WIFI: true } } },
  );
  assert.equal(optionTrace.result, true);

  const sbTrace = evaluateAssertWithTrace(
    { property: 'sbIncorporated', operator: 'eq', value: true, qualifier: 'Boeing SB 737 47 1015' },
    { properties: { sbIncorporated: { '737471015': true } } },
  );
  assert.equal(sbTrace.result, true);

  const pnTrace = evaluateAssertWithTrace(
    { property: 'pnInstalled', operator: 'eq', value: true, qualifier: 'ggm 2120' },
    { properties: { pnInstalled: { GGM2120: true } } },
  );
  assert.equal(pnTrace.result, true);

  const eqTrace = evaluateAssertWithTrace(
    { property: 'equipmentModelInstalled', operator: 'eq', value: true, qualifier: 'ggm 2120' },
    { properties: { equipmentModelInstalled: { GGM2120: true } } },
  );
  assert.equal(eqTrace.result, true);
});

test('kleene: model family matches, sibling minor model does not', () => {
  assert.equal(
    evaluateAssertWithTrace(
      { property: 'model', operator: 'eq', value: '787' },
      { properties: { model: 'B787-9' } },
    ).result,
    true,
  );
  assert.equal(
    evaluateAssertWithTrace(
      { property: 'model', operator: 'eq', value: '787-8' },
      { properties: { model: 'B787-9' } },
    ).result,
    false,
  );
});

test('kleene: deliveryDate comparisons from fleet master data', () => {
  assert.equal(
    evaluateAssertWithTrace(
      { property: 'deliveryDate', operator: 'lte', value: '2025-01-01' },
      { properties: { deliveryDate: '2017-06-23' } },
    ).result,
    true,
  );
  assert.equal(
    evaluateAssertWithTrace(
      { property: 'deliveryDate', operator: 'lte', value: '2025-01-01' },
      { properties: { deliveryDate: '2025-02-01' } },
    ).result,
    false,
  );
});

test('kleene: missing qualified PN fact after model match is fact_unknown', () => {
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
  assert.equal(trace.result, UNKNOWN);
  assert.equal(trace.blockingUnknowns[0].kind, 'fact_unknown');
  assert.equal(trace.blockingUnknowns[0].property, 'pnInstalled');
  assert.equal(trace.blockingUnknowns[0].qualifier, 'GGM2120');
});

test('kleene: boolean property with non-boolean value is interpretation_unknown', () => {
  const trace = evaluateAssertWithTrace(
    { property: 'optionInstalled', operator: 'eq', value: 'true', qualifier: 'WIFI' },
    { properties: { optionInstalled: { WIFI: true } } },
  );
  assert.equal(trace.result, UNKNOWN);
  assert.equal(trace.blockingUnknowns[0].kind, 'interpretation_unknown');
  assert.equal(trace.blockingUnknowns[0].reason, 'invalid_value_type');
});

test('kleene: unregistered property stays interpretation_unknown (no guessing)', () => {
  const trace = evaluateAssertWithTrace(
    { property: 'engineThrust', operator: 'eq', value: 100 },
    { properties: { engineThrust: 100 } },
  );
  assert.equal(trace.result, UNKNOWN);
  assert.equal(trace.blockingUnknowns[0].reason, 'unsupported_property');
});

test('kleene: and/or short-circuit and not-propagation', () => {
  assert.equal(
    evaluateWithTrace(
      {
        type: 'and',
        children: [
          { type: 'literal', value: false },
          { type: 'assert', property: 'model', operator: 'eq', value: 'A320' },
        ],
      },
      { properties: {} },
    ).result,
    false,
  );
  assert.equal(
    evaluateWithTrace(
      {
        type: 'or',
        children: [
          { type: 'literal', value: true },
          { type: 'assert', property: 'model', operator: 'eq', value: 'A320' },
        ],
      },
      { properties: {} },
    ).result,
    true,
  );
  assert.equal(
    evaluateWithTrace(
      { type: 'not', child: { type: 'assert', property: 'model', operator: 'eq', value: 'A320' } },
      { properties: {} },
    ).result,
    UNKNOWN,
  );
});

test('kleene: document effectivity combines by OR', () => {
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
  assert.equal(trace.result, true);
});

test('kleene: extraction_failed inline rule is interpretation_unknown', () => {
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
  assert.equal(trace.result, UNKNOWN);
  assert.equal(trace.blockingUnknowns[0].kind, 'interpretation_unknown');
  assert.equal(trace.blockingUnknowns[0].reason, 'extraction_failed');
});

test('kleene: inline defaults to AND, alternativeGroup honors OR', () => {
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
  assert.equal(andTrace.result, false);

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
  assert.equal(orTrace.result, true);
});

test('kleene: fragment set short-circuits on document effectivity false', () => {
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
        expressionAst: {
          type: 'assert',
          property: 'pnInstalled',
          operator: 'eq',
          value: true,
          qualifier: 'GGM-2120',
        },
      },
    ],
    { properties: {} },
  );
  assert.equal(trace.result, false);
  assert.equal(trace.inheritedFrom, 'document_effectivity_short_circuit');
});

test('matcher: model + msn applicable, out-of-range msn not applicable', () => {
  const aircraft = {
    fleetFamily: 'B787',
    aircraftModel: 'B787',
    series: 'B787-9',
    msn: '34308',
    aircraftNumber: 'B-7800',
    aliases: [],
  };
  assert.equal(
    matchAircraftAgainstFragments(aircraft, [
      { ruleFragmentId: 'frag_1', appliesToModels: ['787'], appliesToMsnRanges: [{ from: '32000', to: '36000' }] },
    ]).decision,
    'applicable',
  );
  assert.equal(
    matchAircraftAgainstFragments(
      { ...aircraft, msn: '40000' },
      [{ ruleFragmentId: 'frag_2', appliesToModels: ['787'], appliesToMsnRanges: [{ from: '32000', to: '36000' }] }],
    ).decision,
    'not_applicable',
  );
});

test('matcher: L0 aircraftNumber lists match registration aliases', () => {
  const result = matchAircraftAgainstFragments(
    {
      fleetFamily: 'B787',
      aircraftModel: 'B787',
      series: 'B787-9',
      msn: '34308',
      aircraftNumber: 'B-7800',
      aliases: [{ aliasValue: 'B-7800-ALT' }],
    },
    [{ ruleFragmentId: 'frag_l0', appliesToAircraftNumbers: ['b-7800-alt'] }],
  );
  assert.equal(result.decision, 'applicable');
  assert.deepEqual(result.matchedIds, ['frag_l0']);
});

test('matcher: 737NG and 737MAX are disjoint branches; A320s family stays below A320', () => {
  const ngAsset = { fleetFamily: 'B737', aircraftModel: 'B737-89L', series: 'B737-800', msn: '41313', aircraftNumber: 'B-5851', aliases: [] };
  const maxAsset = { fleetFamily: 'B737', aircraftModel: 'B737-8', series: 'B737-8', msn: '65001', aircraftNumber: 'B-TEST-MAX8', aliases: [] };
  assert.equal(matchAircraftAgainstFragments(ngAsset, [{ ruleFragmentId: 'f', appliesToModels: ['737NG'] }]).decision, 'applicable');
  assert.equal(matchAircraftAgainstFragments(maxAsset, [{ ruleFragmentId: 'f', appliesToModels: ['737NG'] }]).decision, 'not_applicable');
  assert.equal(matchAircraftAgainstFragments(maxAsset, [{ ruleFragmentId: 'f', appliesToModels: ['737MAX'] }]).decision, 'applicable');

  const a319 = { fleetFamily: 'A320s', aircraftModel: 'A319-115', series: 'A319-100', msn: '02499', aircraftNumber: 'B-2364', aliases: [] };
  const a320 = { fleetFamily: 'A320s', aircraftModel: 'A320-214', series: 'A320-200', msn: '3500', aircraftNumber: 'B-TEST-A320', aliases: [] };
  assert.equal(matchAircraftAgainstFragments(a319, [{ ruleFragmentId: 'f', appliesToModels: ['A320'] }]).decision, 'not_applicable');
  assert.equal(matchAircraftAgainstFragments(a320, [{ ruleFragmentId: 'f', appliesToModels: ['A320'] }]).decision, 'applicable');
});

test('matcher: no fragments → unknown', () => {
  assert.equal(
    matchAircraftAgainstFragments(
      { fleetFamily: 'B787', aircraftModel: 'B787', series: 'B787-9', msn: '34308', aircraftNumber: 'B-7800', aliases: [] },
      [],
    ).decision,
    'unknown',
  );
});

test('fleetMasterData: resolves by alias, filters facts by asOf, keeps explicit absence', () => {
  const resolution = resolveFleetSnapshot({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-1001-X',
    asOf: '2026-08-25',
  });
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(resolution.snapshot.assetId, 'ASSET-001');
  assert.equal(resolution.snapshot.assessmentAsOf, '2026-08-25');
  assert.equal(resolution.snapshot.properties.sbIncorporated['737471015'], true);
  assert.equal(resolution.snapshot.properties.pnInstalled.ABC0001, false);
  assert.equal(resolution.snapshot.properties.pnInstalled.FTR0001, undefined);
});

test('fleetMasterData: preserves provenance and currentness on resolution', () => {
  const resolution = resolveFleetSnapshot({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-1001',
    asOf: '2026-08-25',
  });
  assert.equal(resolution.provenance.assetVersionId, 'ASSET-001-V3');
  assert.equal(resolution.provenance.recordHash, 'sha256:asset-001');
  assert.ok(resolution.provenance.sourceRefs.length > 0);
  assert.equal(resolution.sourceCurrentness.status, 'CURRENT');
  assert.equal(resolution.sourceCurrentness.sourceSnapshotId, 'FLEET-SNAP-2026-08-01');
  assert.equal(resolution.sourceCurrentness.sourceRevisionKey, 'FLEET-REV-77');
  assert.equal(resolution.sourceCurrentness.authorityRevision, 'FLEET-AUTH-12');
});

test('fleetMasterData: unknown aircraftNumber → WAITING_INPUT with observable missing fact', () => {
  const resolution = resolveFleetSnapshot({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-NOT-EXIST',
    asOf: '2026-08-25',
  });
  assert.equal(resolution.status, 'WAITING_INPUT');
  assert.equal(resolution.snapshot, null);
  assert.equal(resolution.missingFacts[0].kind, 'missing_fleet_fact');
  assert.equal(resolution.missingFacts[0].property, 'aircraftNumber');
  assert.ok(resolution.missingFacts[0].reason.includes('FLEET_ASSET_NOT_FOUND_FOR_AIRCRAFT_NUMBER'));
});

test('fleetMasterData: unsupported schema version rejected', () => {
  assert.throws(
    () =>
      resolveFleetSnapshot({
        dataSource: { ...buildDataSource(), schemaVersion: 'wiselink.v0_11.fleet' },
        aircraftNumber: 'B-1001',
        asOf: '2026-08-25',
      }),
    /FLEET_MASTER_DATA_SCHEMA_VERSION_UNSUPPORTED/,
  );
});

test('fleetMasterData: incomplete source identity → UNVERIFIED currentness', () => {
  const resolution = resolveFleetSnapshot({
    dataSource: buildDataSource({ sourceSnapshotId: null, sourceRevisionKey: null }),
    aircraftNumber: 'B-1001',
    asOf: '2026-08-25',
  });
  assert.equal(resolution.sourceCurrentness.status, 'UNVERIFIED');
  assert.equal(resolution.sourceCurrentness.reason, 'FLEET_SOURCE_SNAPSHOT_IDENTITY_MISSING');
});

test('fleetMasterData: conflicting qualified facts → WAITING_INPUT with evidence, no silent overwrite', () => {
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
  assert.equal(resolution.status, 'WAITING_INPUT');
  assert.equal(resolution.snapshot, null);
  assert.equal(resolution.conflictingFacts.length, 1);
  const conflict = resolution.conflictingFacts[0];
  assert.equal(conflict.kind, 'conflicting_fleet_fact');
  assert.equal(conflict.property, 'pnInstalled');
  assert.equal(conflict.qualifier, 'GGM2120');
  assert.ok(conflict.reason.includes('FLEET_FACT_CONFLICT'));
  assert.deepEqual(
    conflict.conflicts.map((entry) => entry.factId).sort(),
    ['FACT-PN-CONFLICT-A', 'FACT-PN-CONFLICT-B'],
  );
  // Every conflicting fact keeps its full source evidence.
  for (const evidence of conflict.conflicts) {
    assert.ok(evidence.sourceRef.sourceRecordId);
    assert.ok(evidence.recordHash.startsWith('sha256:'));
  }
  // Asset-level provenance is still preserved on the blocked resolution.
  assert.equal(resolution.provenance.assetVersionId, 'ASSET-001-V3');
});

test('fleetMasterData: same-value duplicate qualified facts are NOT conflicts', () => {
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
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(resolution.conflictingFacts.length, 0);
  assert.equal(resolution.snapshot.properties.pnInstalled.GGM2120, true);
});

test('fleetMasterData: different qualifiers and future asOf facts do not conflict', () => {
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
  assert.equal(resolution.status, 'RESOLVED');
  assert.equal(resolution.conflictingFacts.length, 0);
  // asOf filtering keeps the existing recorded value untouched.
  assert.equal(resolution.snapshot.properties.pnInstalled.GGM2120, true);
});

test('gate: conflicting qualified facts → WAITING_INPUT, pass=false, evidence preserved', () => {
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
    applicabilityAst: { type: 'assert', property: 'model', operator: 'eq', value: '787' },
  });
  assert.equal(result.status, 'WAITING_INPUT');
  assert.equal(result.pass, false);
  assert.equal(result.decision, 'needs_review');
  const conflict = result.blockingUnknowns.find(
    (entry) => entry.kind === 'conflicting_fleet_fact',
  );
  assert.ok(conflict);
  assert.equal(conflict.property, 'pnInstalled');
  assert.deepEqual(
    conflict.conflicts.map((entry) => entry.factId).sort(),
    ['FACT-PN-CONFLICT-A', 'FACT-PN-CONFLICT-B'],
  );
  for (const evidence of conflict.conflicts) {
    assert.ok(evidence.sourceRef.sourceRecordId);
    assert.ok(evidence.recordHash.startsWith('sha256:'));
  }
  // Asset provenance survives the blocked evaluation.
  assert.equal(result.sourceProvenance.assetVersionId, 'ASSET-001-V3');
});

test('gate: applicable aircraft passes with full provenance and candidate_only boundary', () => {
  const result = evaluateApplicabilityForAircraft({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-1001',
    asOf: '2026-08-25',
    applicabilityAst: { type: 'assert', property: 'model', operator: 'eq', value: '787' },
  });
  assert.equal(result.status, 'EVALUATED');
  assert.equal(result.decision, 'applicable');
  assert.equal(result.kleeneResult, true);
  assert.equal(result.pass, true);
  assert.equal(result.sourceProvenance.assetVersionId, 'ASSET-001-V3');
  assert.equal(result.sourceProvenance.recordHash, 'sha256:asset-001');
  assert.ok(result.sourceProvenance.sourceRefs.length > 0);
  assert.equal(result.sourceProvenance.sourceCurrentness.status, 'CURRENT');
  assert.equal(result.sourceProvenance.assessmentAsOf, '2026-08-25');
  assert.equal(result.sourceProvenance.sourceCurrentness.sourceAsOf, '2026-08-01');
  assert.equal(result.authorityBoundary.outputAuthorityLevel, 'candidate_only');
  assert.equal(result.authorityBoundary.createsEvidenceRef, false);
});

test('gate: applicability false is never promoted to PASS', () => {
  const result = evaluateApplicabilityForAircraft({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-1001',
    asOf: '2026-08-25',
    applicabilityAst: { type: 'assert', property: 'model', operator: 'eq', value: 'A320' },
  });
  assert.equal(result.kleeneResult, false);
  assert.equal(result.decision, 'not_applicable');
  assert.equal(result.pass, false);
  assert.equal(result.status, 'EVALUATED');
});

test('gate: unknown aircraftNumber → WAITING_INPUT with missing_fleet_fact', () => {
  const result = evaluateApplicabilityForAircraft({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-NOT-EXIST',
    asOf: '2026-08-25',
    applicabilityAst: { type: 'assert', property: 'model', operator: 'eq', value: '787' },
  });
  assert.equal(result.status, 'WAITING_INPUT');
  assert.equal(result.pass, false);
  assert.equal(result.decision, 'needs_review');
  assert.ok(
    result.blockingUnknowns.some(
      (entry) => entry.kind === 'missing_fleet_fact' && entry.property === 'aircraftNumber',
    ),
  );
});

test('gate: missing necessary fleet fact → WAITING_INPUT, asset provenance preserved', () => {
  const result = evaluateApplicabilityForAircraft({
    dataSource: buildDataSource(),
    aircraftNumber: 'B-1001',
    asOf: '2026-08-25',
    applicabilityAst: {
      type: 'and',
      children: [
        { type: 'assert', property: 'model', operator: 'eq', value: '787' },
        { type: 'assert', property: 'pnInstalled', operator: 'eq', value: true, qualifier: 'NOT-RECORDED-PN' },
      ],
    },
  });
  assert.equal(result.status, 'WAITING_INPUT');
  assert.equal(result.decision, 'needs_review');
  assert.equal(result.kleeneResult, UNKNOWN);
  assert.equal(result.pass, false);
  assert.ok(
    result.blockingUnknowns.some(
      (entry) => entry.kind === 'fact_unknown' && entry.property === 'pnInstalled',
    ),
  );
  assert.equal(result.sourceProvenance.assetVersionId, 'ASSET-001-V3');
});

test('gate: non-CURRENT fleet source → NOT_EVALUABLE with pass=false', () => {
  const result = evaluateApplicabilityForAircraft({
    dataSource: buildDataSource({ sourceSnapshotId: null, sourceRevisionKey: null }),
    aircraftNumber: 'B-1001',
    asOf: '2026-08-25',
    applicabilityAst: { type: 'assert', property: 'model', operator: 'eq', value: '787' },
  });
  assert.equal(result.status, 'NOT_EVALUABLE');
  assert.equal(result.pass, false);
  assert.equal(result.sourceProvenance.sourceCurrentness.status, 'UNVERIFIED');
});

test('boundary: v8-only properties are unsupported in the single 3.1 registry', () => {
  const trace = evaluateAssertWithTrace(
    { property: 'operatorCode', operator: 'eq', value: 'ABC' },
    { properties: { operatorCode: 'ABC' } },
  );
  assert.equal(trace.result, UNKNOWN);
  assert.equal(trace.blockingUnknowns[0].reason, 'unsupported_property');
});

test('boundary: unknown legacy clause never resolves to true', () => {
  const trace = evaluateWithTrace(
    { type: 'legacy_clause', clause: { attribute: 'operatorCode', op: 'in', value: ['ABC'] } },
    { properties: {} },
  );
  assert.equal(trace.result, UNKNOWN);
});
