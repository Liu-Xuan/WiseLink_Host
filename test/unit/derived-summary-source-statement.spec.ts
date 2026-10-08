import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { DerivedSummaryMembersService } from '../../server/modules/canonical-host/derived-summary-members.service';

const actor = { tenantId: 'tenant-exact', actorUserId: 'actor-exact' };
const statement = { kind: 'PRIOR_RESULT', evidenceRef: 'DOCUMENT_ACTIVITY:RUN-exact:3:statement-exact',
  title: 'Saved candidate source statement', excerpt: 'Conditions remain unknown', resultRef: 'RUN-exact',
  resultRevision: 3, originalEvidenceRefs: ['DOCUMENT_ORIGINAL:DV-exact:PR-exact:SR-exact'],
  sourceStatement: { reference: { runRef: 'RUN-exact', candidateRevision: 3, statementId: 'statement-exact' },
    sourceBinding: { original: { documentVersionId: 'DV-exact', parseRunId: 'PR-exact' }, semanticRevision: 2 } },
} as unknown as AssessmentEvidence;

function projection(v2 = false) {
  const carrier = (statement as unknown as { sourceStatement: { reference: { runRef: string; candidateRevision: number; statementId: string }; sourceBinding: unknown }; originalEvidenceRefs: string[] }).sourceStatement;
  return [{ schemaVersion: 'wiselink.document.activity-assessment-projection.v1', availability: 'AVAILABLE',
    sourceBinding: structuredClone(carrier.sourceBinding),
    records: [{ ref: statement.evidenceRef, reference: structuredClone(carrier.reference), sourceBinding: structuredClone(carrier.sourceBinding),
      candidateOnly: true, requiredContextRootRefs: ['DOCUMENT_ORIGINAL:DV-exact:PR-exact:SR-exact'],
      sourceSchemaVersion: `wiselink.document.activity-candidate.${v2 ? 'v2' : 'v1'}`,
      semanticFieldsAvailability: v2 ? 'V2_CAPTURED_FIELDS_ONLY' : 'LEGACY_PARTIAL', scopeBasis: v2 ? 'ACTUAL_DELIVERED_RUN_SCOPE' : 'LEGACY_RUN_SCOPE',
      statement: { statementId: carrier.reference.statementId, statementKey: 'statement-key', label: statement.excerpt,
        quotes: [{ anchorId: 'anchor-exact', start: 2, end: 9, text: 'PN-1234' },
          { anchorId: 'anchor-exact', start: 10, end: 14, text: '2027' },
          { anchorId: 'anchor-exact', start: 15, end: 32, text: 'only if installed' }], subject: null, action: null, modality: null, status: null,
        times: [{ role: 'TARGET', precision: 'YEAR', expression: 'CALENDAR', raw: '2027', quoteIndex: 1 }],
        technicalIds: [{ kind: 'PART_NUMBER', raw: 'PN-1234', quoteIndex: 0 }], scope: { sectionIds: ['S-exact'],
          conditions: [{ raw: 'only if installed', quoteIndex: 2, kind: 'PREREQUISITE', appliesTo: 'STATEMENT', sectionIds: [] }], completeness: 'DELIVERED_SCOPE_ONLY' }, limitations: ['Synthetic flow contract, not quote semantic validation'] } }],
    activityContexts: [{ runRef: carrier.reference.runRef, candidateRevision: carrier.reference.candidateRevision,
      readCoverage: { status: 'DELIVERED_RANGES_ONLY' }, ...(v2 ? { sourceContext: { schemaVersion: 'wiselink.document.activity-source-context.v1',
        sourceBinding: structuredClone(carrier.sourceBinding), sections: [], organizationWarnings: [] } } : {}) }] }];
}
function fixture(overrides: Record<string, unknown> = {}) {
  const verifier = { assertSourceStatementReferences: jest.fn().mockResolvedValue(undefined),
    readSourceStatementProjections: jest.fn().mockResolvedValue(projection()), ...overrides };
  const matters = { withActorScope: jest.fn(async (_actor: string, work: () => Promise<unknown>) => work()) };
  const database = { execute: jest.fn().mockResolvedValue([{ allowed: true }]) };
  const service = new DerivedSummaryMembersService(verifier as never, matters as never);
  const authorize = (service as unknown as { authorizeEvidence(evidence: AssessmentEvidence[], scopedActor: typeof actor,
    database: unknown, ancestors: Set<string>): Promise<void> }).authorizeEvidence.bind(service);
  return { verifier, matters, database, service, authorize };
}

describe('Exact saved source statement summary capabilities', () => {
  it('authorizes on the handed actor transaction before statement-only fresh IO', async () => {
    const f = fixture();
    await f.authorize([statement], actor, f.database, new Set());
    expect(f.verifier.assertSourceStatementReferences).toHaveBeenCalledWith([statement], actor, f.database);
    expect(f.verifier.readSourceStatementProjections).not.toHaveBeenCalled();
    await f.service.verifyOriginalEvidence([statement], actor);
    expect(f.matters.withActorScope).toHaveBeenCalledWith(actor.actorUserId, expect.any(Function));
    expect(f.verifier.readSourceStatementProjections).toHaveBeenCalledWith([statement], actor);
  });
  it.each(['assertSourceStatementReferences', 'readSourceStatementProjections'])('refuses a missing %s capability', async key => {
    const f = fixture({ [key]: undefined });
    await expect(f.authorize([statement], actor, f.database, new Set()))
      .rejects.toThrow('DERIVED_SUMMARY_SOURCE_STATEMENT_VERIFIER_UNAVAILABLE');
    await expect(f.service.verifyOriginalEvidence([statement], actor))
      .rejects.toThrow('DERIVED_SUMMARY_SOURCE_STATEMENT_VERIFIER_UNAVAILABLE');
    expect(f.matters.withActorScope).not.toHaveBeenCalled();
  });
  it.each([null, undefined, 'forged', []])('refuses malformed present sourceStatement %p rather than treating it as absent', async value => {
    const f = fixture();
    const malformed = { ...statement, sourceStatement: value } as unknown as AssessmentEvidence;
    await expect(f.service.verifyOriginalEvidence([malformed], actor))
      .rejects.toThrow('DERIVED_SUMMARY_SOURCE_STATEMENT_INVALID');
    expect(f.verifier.readSourceStatementProjections).not.toHaveBeenCalled();
  });
  it('preserves the exact withdrawal error and never promotes it to an empty read', async () => {
    const f = fixture();
    f.verifier.readSourceStatementProjections.mockRejectedValue(new Error('JOBAID_SOURCE_STATEMENT_UNAVAILABLE'));
    await expect(f.service.verifyOriginalEvidence([statement], actor)).rejects.toThrow('JOBAID_SOURCE_STATEMENT_UNAVAILABLE');
    expect(f.verifier.readSourceStatementProjections).toHaveBeenCalledTimes(1);
  });
  it('preserves a failed generic ACL before invoking saved-lineage authorization', async () => {
    const f = fixture(); f.database.execute.mockResolvedValue([{ allowed: false }]);
    await expect(f.authorize([statement], actor, f.database, new Set())).rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
    expect(f.verifier.assertSourceStatementReferences).not.toHaveBeenCalled();
  });
  it('leaves an empty ordinary evidence list usable without source capabilities', async () => {
    const f = fixture({ assertSourceStatementReferences: undefined, readSourceStatementProjections: undefined });
    await expect(f.service.verifyOriginalEvidence([], actor)).resolves.toBeUndefined();
    expect(f.matters.withActorScope).not.toHaveBeenCalled();
  });
});


describe('Explicit v2 saved source projection binding', () => {
  it('keeps complete captured fields, original quote offsets and unknowns unmodified', async () => {
    const value = projection(true); const frozen = structuredClone(value); const f = fixture();
    f.verifier.readSourceStatementProjections.mockResolvedValue(value);
    await expect(f.service.verifyOriginalEvidence([statement], actor)).resolves.toBeUndefined();
    expect(value).toEqual(frozen);
    expect(value[0]!.records[0]!.statement.technicalIds[0]!.raw).toBe('PN-1234');
    expect(value[0]!.records[0]!.statement.subject).toBeNull();
  });
  it.each(['unknown-schema','wrong-scope','missing-context','different-binding','different-run','missing-time','missing-condition','missing-source','wrong-carrier'])
    ('refuses %s without falling back to v1', async mutation => {
      const value = projection(true); const record = value[0]!.records[0]!; const context = value[0]!.activityContexts[0]!;
      if (mutation === 'unknown-schema') record.sourceSchemaVersion = 'wiselink.document.activity-candidate.v999';
      if (mutation === 'wrong-scope') record.scopeBasis = 'LEGACY_RUN_SCOPE';
      if (mutation === 'missing-context') delete (context as { sourceContext?: unknown }).sourceContext;
      if (mutation === 'different-binding') record.sourceBinding = { forged: true };
      if (mutation === 'different-run') context.runRef = 'other-run';
      if (mutation === 'missing-time') delete (record.statement as { times?: unknown }).times;
      if (mutation === 'missing-condition') delete (record.statement.scope as { conditions?: unknown }).conditions;
      if (mutation === 'missing-source') value[0]!.records = [];
      if (mutation === 'wrong-carrier') record.statement.statementId = 'other-statement';
      const f = fixture(); f.verifier.readSourceStatementProjections.mockResolvedValue(value);
      await expect(f.service.verifyOriginalEvidence([statement], actor)).rejects.toThrow('DERIVED_SUMMARY_SOURCE_STATEMENT_PROJECTION_INVALID');
    });
});
