import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { getTableName } from 'drizzle-orm';
import { readStoredOverallEvidence, overallModelEvidenceRegistry } from '../../server/modules/canonical-host/overall-assessment-reading';
import { DerivedSummaryMembersService, mergeSummaryEvidence } from '../../server/modules/canonical-host/derived-summary-members.service';

const actor = { tenantId: 'fixture-tenant', actorUserId: 'fixture-owner' };
import { tdmsNativeEvidenceFixture as nativeEvidence } from './fixtures/tdms-native-evidence.fixture';

describe('Default-off actual native consumers', () => {
  it('round-trips exact saved native carrier through the actual Overall decoder', () => {
    const evidence = nativeEvidence();
    expect(readStoredOverallEvidence([evidence])).toEqual([evidence]);
  });
  it('preserves exact native source/scope/receipt in the actual model projection', () => {
    const evidence = nativeEvidence();
    expect(overallModelEvidenceRegistry([evidence], 'SOURCE_CONTEXT_V2')[0]).toMatchObject({
      nativeSource: evidence.nativeSource, nativeScope: evidence.nativeScope, nativeReadReceipt: evidence.nativeReadReceipt,
    });
  });
  it('rejects native-bearing Summary original verification without an explicitly injected native verifier', async () => {
    const service = new DerivedSummaryMembersService({} as never, {} as never);
    await expect(service.verifyOriginalEvidence([nativeEvidence()], actor))
      .rejects.toThrow('TDMS_NATIVE_EVIDENCE_VERIFIER_UNAVAILABLE');
  });
});

import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import { parseAssessmentTdmsEvidence, parseAssessmentTdmsApprovalProvenance } from '@shared/assessment-tdms-evidence';
import { verifyTdmsNativeEvidence, type TdmsNativeEvidenceAuthorization } from '../../server/modules/canonical-host/tdms-native-evidence-verifier.port';
import type { DerivedSummaryMember } from '@shared/derived-summary.interface';

function set(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.');
  let current = value as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) current = current[key] as Record<string, unknown>;
  if (replacement === undefined) delete current[keys[keys.length - 1]!];
  else current[keys[keys.length - 1]!] = replacement;
}
function fixtureAuthority() {
  // Explicit retained fixture and fixed owner, never an allow-any production provider.
  const retained = nativeEvidence();
  let permissionRevision = 'fixture-current-permission-2';
  let allowed = true;
  const authorize = jest.fn(async (evidence: AssessmentTdmsNativeEvidence[], owner = actor): Promise<TdmsNativeEvidenceAuthorization[]> => {
    if (owner.tenantId !== actor.tenantId || owner.actorUserId !== actor.actorUserId || evidence.some(item => item.evidenceRef !== retained.evidenceRef || JSON.stringify(item.nativeScope.processingSetBinding) !== JSON.stringify(retained.nativeScope.processingSetBinding))) throw new Error('FIXTURE_NATIVE_SCOPE_DENIED');
    if (!allowed) throw new Error('FIXTURE_NATIVE_ACCESS_REVOKED');
    return evidence.map(item => ({ evidenceRef: item.evidenceRef, sourceRevisionRef: item.nativeSource.sourceRevisionRef,
      processingSetBinding: structuredClone(item.nativeScope.processingSetBinding), permissionRevision,
      sourceAudienceAuthorized: true, selectedObjectAuthorized: true }));
  });
  const readExactEvidence = jest.fn(async (evidence: AssessmentTdmsNativeEvidence[]) => evidence.map(item => {
    if (item.evidenceRef !== retained.evidenceRef) throw new Error('FIXTURE_NATIVE_RECORD_UNAVAILABLE');
    return structuredClone(retained);
  }));
  const assertCurrentEvidence = jest.fn(async ({evidence, authorization}: {evidence: AssessmentTdmsNativeEvidence[]; authorization: TdmsNativeEvidenceAuthorization[]}) => {
    if (!allowed) throw new Error('FIXTURE_NATIVE_ACCESS_REVOKED');
    if (authorization.some(item => item.permissionRevision !== permissionRevision) || evidence.some(item => item.excerpt !== retained.excerpt))
      throw new Error('FIXTURE_NATIVE_FINAL_SNAPSHOT_CHANGED');
  });
  const assertInTransaction = jest.fn(async ({evidence, actor: owner}: {evidence: AssessmentTdmsNativeEvidence[]; actor: typeof actor; database: unknown}) => {
    if (owner.tenantId !== actor.tenantId || owner.actorUserId !== actor.actorUserId) throw new Error('FIXTURE_NATIVE_SCOPE_DENIED');
    if (!allowed) throw new Error('FIXTURE_NATIVE_ACCESS_REVOKED');
    const body = (item: AssessmentTdmsNativeEvidence) => { const {nativeReadReceipt: _receipt, ...value} = item; return value; };
    if (evidence.some(item => JSON.stringify(body(item)) !== JSON.stringify(body(retained)))) throw new Error('FIXTURE_NATIVE_FINAL_SNAPSHOT_CHANGED');
  });
  return { authorize, readExactEvidence, assertCurrentEvidence, assertInTransaction, mutateRetainedBody: () => { retained.excerpt = 'MUTATED_DURING_FINAL_AUTHORIZATION'; }, revoke: () => { allowed = false; },
    advancePermission: () => { permissionRevision = 'fixture-current-permission-3'; } };
}
const leaf = (id = '1'): Extract<DerivedSummaryMember, {kind: 'WORK_ITEM_WORK'}> => ({
  kind: 'WORK_ITEM_WORK', workItemId: `work-${id}`, documentVersionId: `document-${id}`,
  workRef: `saved-${id}`, workRevision: 7, issueKeys: [],
});
function summaryFixture(evidence: AssessmentEvidence[] = [nativeEvidence()], withVerifier = true) {
  const authority = fixtureAuthority();
  const selected = leaf();
  const content = { headline: 'Saved exact work', understanding: 'Immutable prior body', issues: [], evidence, overviewStatus: 'CURRENT' };
  const jobAid = { readSummaryMemberInTransaction: jest.fn(async () => ({ current: true,
    revision: { workRevision: selected.workRevision, documentVersionId: selected.documentVersionId, content } })) };
  const matters = { withActorScope: jest.fn(async (_actor: string, callback: () => Promise<unknown>) => callback()) };
  const database = { execute: jest.fn(async () => [{allowed: true}]),
    select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'fixture-active-mapping' }] }) }) })) };
  const service = new DerivedSummaryMembersService(jobAid as never, matters as never, undefined, withVerifier ? authority : undefined);
  return { authority, service, database, jobAid, matters, selected, content };
}

describe('Strict TDMS source-declared carrier decoder', () => {
  it.each([
    ['nativeScope', undefined], ['nativeScope.processingSetBinding', undefined], ['nativeScope.approval', undefined],
    ['nativeScope.processingSetBinding.generation', 0], ['nativeScope.processingSetBinding.generation', 1.5],
    ['nativeScope.processingSetBinding.assessmentObservationRef', 'foreign-observation'],
    ['nativeScope.processingSetBinding.scope.sourceInstanceId', 'foreign-instance'],
    ['nativeScope.processingSetBinding.cohortRef', ''], ['nativeScope.sourceRevisionRef', 'foreign-observation'],
    ['nativeScope.fieldSelectors.0.selector', '/foreign-selector'], ['nativeScope.fieldSelectors', []],
    ['nativeSource.recordKind', 'PROCESSING_SHEET'], ['nativeSource.state.rawName', 'Estimating'],
    ['nativeSource.state.rawCode', 'Unknown'], ['nativeSource.currentness', 'OFFICIALLY_CURRENT'],
    ['nativeSource.sourceVerification', 'VERIFIED'], ['nativeSource.coverage.status', 'VERIFIED'],
    ['nativeSource.observedAt', '2026-02-30T10:00:00Z'], ['nativeSource.sourceVersion.rawIteration', null],
    ['nativeScope.approval.after.state.rawName', 'Estimating'], ['nativeScope.approval.before', null],
    ['nativeScope.approval.approvalSubject.sourceRecordId', 'parent-processing-record'],
    ['nativeScope.approval.after.sourceVersion.rawRevision', 'R01'],
    ['nativeScope.approval.after.observedAt', '2026-09-30T10:00:00Z'],
    ['nativeScope.approval.before.sourceModifiedAt', '2026-09-30T10:00:00Z'],
    ['nativeReadReceipt.purpose', 'WIKI_NATIVE_RECORD'], ['nativeReadReceipt.taskContextRef', ''],
    ['nativeReadReceipt.sourceRevisionRef', 'foreign-observation'], ['nativeReadReceipt.fieldPaths', null],
    ['nativeReadReceipt.fieldPaths', ['content.opinions']], ['nativeReadReceipt.fieldPaths', ['content.opinions[0]', 'content.opinions[0]']],
    ['nativeReadReceipt.permissionRevision', ''], ['nativeReadReceipt.readPerformed', false],
    ['nativeReadReceipt.engineeringAdoption', 'ADOPTED'], ['nativeReadReceipt.executionVerified', true],
    ['nativeReadReceipt.extraAuthority', true], ['nativeSource.rawFields', { leaked: 'not-allowlisted' }],
    ['nativeScope.approval.extraApproval', true], ['unexpectedBody', 'not-allowlisted'],
  ])('refuses malformed or unbound %s (%p)', (path, replacement) => {
    const evidence = nativeEvidence(); set(evidence, String(path), replacement);
    expect(() => readStoredOverallEvidence([evidence])).toThrow('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID');
    expect(() => overallModelEvidenceRegistry([evidence], 'SOURCE_CONTEXT_V2')).toThrow('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID');
  });
  it('retains historical versions, unknown coverage, original receipt and exact byte strings', () => {
    const evidence = nativeEvidence(); const saved = JSON.stringify(evidence);
    const parsed = parseAssessmentTdmsEvidence(evidence);
    expect(JSON.stringify(parsed)).toBe(saved); expect(parsed).not.toBe(evidence);
    expect(parsed.nativeSource.businessVersion?.rawRevision).toBe('B');
    expect(parsed.nativeSource.sourceVersion.rawRevision).toBe('R00');
    expect(parsed.nativeReadReceipt.readAt).toBe('2026-10-03T10:00:00Z');
  });
  it('preserves full shared-foundation permission decision snapshots beyond identifier length', () => {
    const evidence = nativeEvidence(); evidence.nativeReadReceipt.permissionRevision = JSON.stringify(['shared-foundation-v1', 'x'.repeat(2048)]);
    expect(readStoredOverallEvidence([evidence])).toEqual([evidence]);
  });
  it('leaves old non-native projections and decoder bytes unchanged for every existing projection version', () => {
    const ordinary: AssessmentEvidence = { kind: 'HOST_FACT', evidenceRef: 'fact-1', title: 'Saved Host fact', versionLabel: null,
      excerpt: 'Old exact body', workItemId: 'work-1', workItemRevision: 3, factRef: 'fact-source', recordedAt: '2026-10-01T10:00:00Z' };
    expect(readStoredOverallEvidence([ordinary])).toEqual([ordinary]);
    expect(overallModelEvidenceRegistry([ordinary])[0]).toEqual({ evidenceRef: ordinary.evidenceRef, kind: ordinary.kind,
      title: ordinary.title, versionLabel: null, excerpt: ordinary.excerpt, locator: null });
    expect(overallModelEvidenceRegistry([ordinary], 'SOURCE_CONTEXT_V1')[0]).toEqual({ evidenceRef: ordinary.evidenceRef, kind: ordinary.kind,
      title: ordinary.title, versionLabel: null, excerpt: ordinary.excerpt, locator: null,
      sourceContext: { factRef: ordinary.factRef, workItemRevision: 3, recordedAt: ordinary.recordedAt } });
    // The accepted S1 V2 sealed projection leaves this ordinary Host fact shape
    // unchanged; TDMS integration must not broaden the older projection.
    expect(overallModelEvidenceRegistry([ordinary], 'SOURCE_CONTEXT_V2')[0]).toEqual({ evidenceRef: ordinary.evidenceRef, kind: ordinary.kind,
      title: ordinary.title, versionLabel: null, excerpt: ordinary.excerpt, locator: null });
  });
});

describe('Native verifier exact bytes and current authority at await boundaries', () => {
  it('checks the selected source audience and object rights twice and preserves the historical receipt', async () => {
    const evidence = nativeEvidence(); const before = structuredClone(evidence); const authority = fixtureAuthority();
    await verifyTdmsNativeEvidence([evidence], actor, authority);
    expect(authority.authorize).toHaveBeenCalledTimes(2); expect(authority.readExactEvidence).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual(before);
    expect(evidence.nativeReadReceipt.permissionRevision).toBe('permission-at-original-read');
  });
  it.each(['sourceAudienceAuthorized', 'selectedObjectAuthorized', 'permissionRevision', 'sourceRevisionRef', 'processingSetBinding'])
    ('does not accept an invalid %s authorization snapshot', async key => {
      const authority = fixtureAuthority(); const allowed = await authority.authorize([nativeEvidence()]);
      set(allowed[0], key, key.endsWith('Authorized') ? false : key === 'permissionRevision' ? '' : 'foreign');
      authority.authorize.mockResolvedValue(allowed);
      await expect(verifyTdmsNativeEvidence([nativeEvidence()], actor, authority)).rejects.toThrow('TDMS_NATIVE_EVIDENCE_AUTHORIZATION_INVALID');
      expect(authority.readExactEvidence).not.toHaveBeenCalled();
    });
  it('denies missing actor/foreign tenant before any source body access', async () => {
    const authority = fixtureAuthority();
    await expect(verifyTdmsNativeEvidence([nativeEvidence()], { ...actor, actorUserId: '' }, authority)).rejects.toThrow('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
    await expect(verifyTdmsNativeEvidence([nativeEvidence()], { ...actor, tenantId: 'foreign' }, authority)).rejects.toThrow('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
    expect(authority.authorize).not.toHaveBeenCalled(); expect(authority.readExactEvidence).not.toHaveBeenCalled();
  });
  it('never touches bodies after initial permission revocation', async () => {
    const authority = fixtureAuthority(); authority.revoke();
    await expect(verifyTdmsNativeEvidence([nativeEvidence()], actor, authority)).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
    expect(authority.readExactEvidence).not.toHaveBeenCalled();
  });
  it.each(['revoke', 'advancePermission'] as const)('rejects %s while the retained body read is awaited', async mutation => {
    const authority = fixtureAuthority();
    authority.readExactEvidence.mockImplementation(async evidence => { authority[mutation](); return structuredClone(evidence); });
    await expect(verifyTdmsNativeEvidence([nativeEvidence()], actor, authority)).rejects.toThrow(
      mutation === 'revoke' ? 'FIXTURE_NATIVE_ACCESS_REVOKED' : 'TDMS_NATIVE_EVIDENCE_PERMISSION_CHANGED');
  });
  it.each(['excerpt', 'title', 'nativeReadReceipt.receiptRef', 'nativeReadReceipt.taskContextRef', 'nativeScope.processingSetBinding.setRevisionRef', 'nativeScope.processingSetBinding.generation'])
    ('rejects exact saved %s substitution instead of updating the evidence', async path => {
      const authority = fixtureAuthority(); const expected = nativeEvidence(); const saved = JSON.stringify(expected);
      authority.readExactEvidence.mockImplementation(async evidence => {
        const replacement = structuredClone(evidence); set(replacement[0], path, path.endsWith('generation') ? 3 : 'substituted'); return replacement;
      });
      await expect(verifyTdmsNativeEvidence([expected], actor, authority)).rejects.toThrow('TDMS_NATIVE_EVIDENCE_BODY_CHANGED');
      expect(JSON.stringify(expected)).toBe(saved);
    });
  it('cannot mutate the saved baseline through provider arguments', async () => {
    const authority = fixtureAuthority(); const evidence = nativeEvidence(); const saved = JSON.stringify(evidence);
    authority.readExactEvidence.mockImplementation(async input => { input[0]!.excerpt = 'changed'; return input; });
    await expect(verifyTdmsNativeEvidence([evidence], actor, authority)).rejects.toThrow('TDMS_NATIVE_EVIDENCE_BODY_CHANGED');
    expect(JSON.stringify(evidence)).toBe(saved);
  });
});

describe('Actual Summary member authorization and history reads', () => {
  it('refuses a native member before returning any task/read/save/history basis when no verifier is supplied', async () => {
    const f = summaryFixture(undefined, false);
    await expect(f.service.readAll([f.selected], actor, f.database as never)).rejects.toThrow('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
  });
  it('retains exact saved work/body/evidence and reports missing native currentness explicitly', async () => {
    const f = summaryFixture(); const saved = structuredClone(f.content);
    const [reading] = await f.service.readAll([f.selected], actor, f.database as never);
    expect(reading?.evidence).toEqual(saved.evidence); expect(reading?.body).toBe(`${saved.understanding}\n\n`);
    expect(reading?.limitations).toContain('NATIVE_CURRENTNESS_NOT_CONNECTED');
    expect(reading?.current).toBe(true); // Saved work currentness does not claim native source currentness.
    expect(f.authority.assertInTransaction.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(f.content).toEqual(saved);
  });
  it('catches revocation during an intervening ordinary ACL await', async () => {
    const f = summaryFixture(); f.database.execute.mockImplementation(async () => { f.authority.revoke(); return [{ allowed: true }]; });
    await expect(f.service.readAll([f.selected], actor, f.database as never)).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
  });
  it('reauthorizes earlier native members after a later member is awaited', async () => {
    const f = summaryFixture(); const second = leaf('2');
    f.jobAid.readSummaryMemberInTransaction.mockImplementationOnce(async () => ({ current: true,
      revision: { workRevision: f.selected.workRevision, documentVersionId: f.selected.documentVersionId, content: f.content } }))
      .mockImplementationOnce(async () => { f.authority.revoke(); return { current: true,
        revision: { workRevision: second.workRevision, documentVersionId: second.documentVersionId, content: { ...f.content, evidence: [] } } }; });
    await expect(f.service.readAll([f.selected, second], actor, f.database as never)).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
  });
  it('keeps ordinary evidence usable with the default unconfigured native provider', async () => {
    const f = summaryFixture([], false);
    await expect(f.service.readAll([f.selected], actor, f.database as never)).resolves.toHaveLength(1);
    await expect(f.service.verifyOriginalEvidence([], actor)).resolves.toBeUndefined();
  });
  it('rechecks native permission after a saved statement read suspends', async () => {
    const f = summaryFixture();
    const statement = { kind: 'PRIOR_RESULT', evidenceRef: 'DOCUMENT_ACTIVITY:run-1:1:statement-1', title: 'Statement',
      versionLabel: null, excerpt: 'Saved label', resultRef: 'run-1', resultRevision: 1, originalEvidenceRefs: ['root-1'],
      sourceStatement: { reference: { runRef: 'run-1', candidateRevision: 1, statementId: 'statement-1' }, sourceBinding: {} } } as unknown as AssessmentEvidence;
    Object.assign(f.jobAid, {
      assertSourceStatementReferences: async () => undefined,
      readSourceStatementProjections: async () => {
        f.authority.revoke();
        const carrier = statement as Extract<AssessmentEvidence, {kind: 'PRIOR_RESULT'}>;
        return [{schemaVersion: 'wiselink.document.activity-assessment-projection.v1', availability: 'AVAILABLE', sourceBinding: {},
          records: [{ ref: statement.evidenceRef, reference: carrier.sourceStatement!.reference, sourceBinding: {}, candidateOnly: true,
            requiredContextRootRefs: ['root-1'], sourceSchemaVersion: 'wiselink.document.activity-candidate.v1', semanticFieldsAvailability: 'LEGACY_PARTIAL',
            scopeBasis: 'LEGACY_RUN_SCOPE', statement: { statementId: 'statement-1', label: statement.excerpt } }],
          activityContexts: [{ runRef: 'run-1', candidateRevision: 1, readCoverage: {} }] }];
      },
    });
    await expect(f.service.verifyOriginalEvidence([nativeEvidence(), statement], actor)).rejects.toThrow('FIXTURE_NATIVE_ACCESS_REVOKED');
  });
});

describe('Nested native Summary saved-history boundary', () => {
  async function nestedFixture(withVerifier: boolean) {
    const f = summaryFixture([], withVerifier);
    const selected: DerivedSummaryMember = { kind: 'DERIVED_SUMMARY', summaryId: 'summary-1', summaryRef: 'summary-revision-1', summaryRevision: 1 };
    const [child] = await f.service.readAll([leaf()], actor, f.database as never);
    const saved = { ...selected, revision: 1, members: [child!], evidence: mergeSummaryEvidence(child!.evidence),
      usedEvidenceRefs: [child!.evidenceRef],
      content: { headline: 'Saved nested summary', body: 'Immutable nested body', limitations: [] } };
    f.database.select.mockImplementation(() => {
      let tableName = '';
      const query = { from: (table: unknown) => { tableName = getTableName(table as never); return query; }, where: () => query,
        limit: async () => tableName === 'identity_subject_mapping' ? [{ id: 'fixture-active-mapping' }]
          : tableName === 'derived_summary' ? [{ currentSummaryRef: selected.summaryRef }]
          : tableName === 'derived_summary_revision' ? [{ revision: 1, contentJson: saved }] : [] };
      return query as never;
    });
    return { ...f, selected, saved };
  }
  it('accepts the exact saved ordinary child registry before the negative native insertion', async () => {
    const f = await nestedFixture(true);
    await expect(f.service.readAll([f.selected], actor, f.database as never)).resolves.toHaveLength(1);
  });
  it('denies the nested native saved body if native authority is missing', async () => {
    const f = await nestedFixture(false); f.saved.evidence.push(nativeEvidence());
    await expect(f.service.readAll([f.selected], actor, f.database as never)).rejects.toThrow('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
  });
  it('rejects a native source inserted into a saved summary without exact child lineage', async () => {
    const f = await nestedFixture(true); f.saved.evidence.push(nativeEvidence());
    await expect(f.service.readAll([f.selected], actor, f.database as never)).rejects.toThrow('DERIVED_SUMMARY_PERSISTENCE_INVALID');
  });
});

describe('Approval-only pre-body gate reused by runtime and consumers', () => {
  it('returns exact proof without reading, enumerating or cloning retained source content', () => {
    const evidence = nativeEvidence(); const approval = evidence.nativeScope.approval;
    const bodyGetter = jest.fn(() => { throw new Error('NATIVE_BODY_MUST_NOT_BE_TOUCHED'); });
    const source = Object.defineProperty(evidence.nativeSource, 'content', { get: bodyGetter, enumerable: true });
    const result = parseAssessmentTdmsApprovalProvenance(approval, source);
    expect(result).toEqual(approval); expect(result).not.toBe(approval);
    expect(bodyGetter).not.toHaveBeenCalled();
  });
  it.each(['before.identitySelector', 'before.stateSelector', 'before.versionSelector', 'after.identitySelector', 'after.stateSelector', 'after.versionSelector'])
    ('rejects tampered %s before any body accessor', path => {
      const evidence = nativeEvidence(); set(evidence.nativeScope.approval, path, '/forged-selector');
      const bodyGetter = jest.fn(() => { throw new Error('NATIVE_BODY_MUST_NOT_BE_TOUCHED'); });
      const source = Object.defineProperty(evidence.nativeSource, 'content', { get: bodyGetter, enumerable: true });
      expect(() => parseAssessmentTdmsApprovalProvenance(evidence.nativeScope.approval, source))
        .toThrow('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID');
      expect(bodyGetter).not.toHaveBeenCalled();
    });
  it.each([['recordKind', 'PROCESSING_SHEET'], ['state.rawName', 'Estimating'], ['state', null], ['sourceRecordId', 'foreign-assessment'], ['sourceVersion.rawIteration', '3'], ['observedAt', '2026-09-01T00:00:00Z']])
    ('independently denies invalid source %s before body access', (path, replacement) => {
      const evidence = nativeEvidence(); set(evidence.nativeSource, String(path), replacement);
      const bodyGetter = jest.fn(() => { throw new Error('NATIVE_BODY_MUST_NOT_BE_TOUCHED'); });
      const source = Object.defineProperty(evidence.nativeSource, 'content', { get: bodyGetter, enumerable: true });
      expect(() => parseAssessmentTdmsApprovalProvenance(evidence.nativeScope.approval, source))
        .toThrow('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID');
      expect(bodyGetter).not.toHaveBeenCalled();
    });
});

describe('One native body across distinct immutable member READ receipts', () => {
  const anotherRead = () => {
    const evidence = nativeEvidence(); Object.assign(evidence.nativeReadReceipt, {
      receiptRef: 'native-receipt-2', taskContextRef: 'task-2', permissionRevision: 'other-original-permission', readAt: '2026-10-04T10:00:00Z' });
    return evidence;
  };
  it('deduplicates only the exact body while preserving both original member carriers', () => {
    const first = nativeEvidence(), second = anotherRead(); const saved = structuredClone([first, second]);
    expect(mergeSummaryEvidence([first, second])).toEqual([first]);
    expect([first, second]).toEqual(saved);
  });
  it.each(['excerpt', 'nativeScope.processingSetBinding.cohortRef', 'nativeScope.approval.captureRef', 'nativeReadReceipt.taskContextRef'])
    ('still rejects changed body/proof or reused receipt identity: %s', path => {
      const first = nativeEvidence(), second = path.startsWith('nativeReadReceipt') ? nativeEvidence() : anotherRead();
      set(second, path, 'changed');
      expect(() => mergeSummaryEvidence([first, second])).toThrow('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
    });
  it('rechecks every distinct receipt carrier together across native IO', async () => {
    const first = nativeEvidence(), second = anotherRead(); const authority = fixtureAuthority();
    authority.readExactEvidence.mockImplementation(async items => structuredClone(items));
    await verifyTdmsNativeEvidence([first, second, first], actor, authority);
    expect(authority.authorize).toHaveBeenCalledTimes(2);
    for (const call of authority.authorize.mock.calls) expect(call[0].map(item => item.nativeReadReceipt.receiptRef)).toEqual(['native-receipt-1', 'native-receipt-2']);
    expect(authority.readExactEvidence.mock.calls[0]?.[0]).toEqual([first, second]);
  });
  it('does not lose second-receipt revocation while awaiting the aggregate read', async () => {
    const first = nativeEvidence(), second = anotherRead(); const authority = fixtureAuthority();
    const original = authority.authorize.getMockImplementation()!;
    let secondRevoked = false;
    authority.authorize.mockImplementation(async items => {
      if (secondRevoked && items.some(item => item.nativeReadReceipt.receiptRef === second.nativeReadReceipt.receiptRef)) throw new Error('SECOND_RECEIPT_REVOKED');
      return original(items);
    });
    authority.readExactEvidence.mockImplementation(async items => { secondRevoked = true; return structuredClone(items); });
    await expect(verifyTdmsNativeEvidence([first, second], actor, authority)).rejects.toThrow('SECOND_RECEIPT_REVOKED');
  });
});

describe('Exact sourced per-opinion contribution provenance', () => {
  function contributed() {
    const evidence = nativeEvidence();
    evidence.nativeScope.opinionContribution = { opinionRef: evidence.evidenceRef, contributorRefs: ['contributor-1','contributor-2'],
      responsibilityRefs: ['responsibility-1'], ataScopes: ['46-00','31-00'], assertionRefs: ['source-contribution-assertion-1'] };
    return evidence;
  }
  it('preserves every contributor and ATA binding through saved decode and model projection', () => {
    const evidence = contributed();
    expect(readStoredOverallEvidence([evidence])).toEqual([evidence]);
    expect(overallModelEvidenceRegistry([evidence], 'SOURCE_CONTEXT_V2')[0]?.nativeScope?.opinionContribution)
      .toEqual(evidence.nativeScope.opinionContribution);
    expect(parseAssessmentTdmsEvidence(nativeEvidence()).nativeScope).not.toHaveProperty('opinionContribution');
  });
  it.each([['opinionRef','another-opinion'], ['contributorRefs',['contributor-1','contributor-1']], ['ataScopes',['46','46']],
    ['assertionRefs',[]], ['assertionRefs',['same','same']], ['extraAuthority',true]])('rejects malformed contribution %s', (key,value) => {
      const evidence = contributed(); set(evidence.nativeScope.opinionContribution,String(key),value);
      expect(() => parseAssessmentTdmsEvidence(evidence)).toThrow('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID');
    });
});


describe('Coordinated final native source snapshot', () => {
  it('rejects retained body mutation during the final authorization await', async () => {
    const authority = fixtureAuthority();
    const original = authority.authorize.getMockImplementation()!;
    let calls = 0;
    authority.authorize.mockImplementation(async evidence => {
      const decision = await original(evidence);
      if (++calls === 2) authority.mutateRetainedBody();
      return decision;
    });
    await expect(verifyTdmsNativeEvidence([nativeEvidence()], actor, authority)).rejects.toThrow('FIXTURE_NATIVE_FINAL_SNAPSHOT_CHANGED');
  });
});

describe('Actual Summary distinct-receipt members', () => {
  it('returns both immutable member receipts after verifying both, with one aggregate body', async () => {
    const f = summaryFixture(), second = nativeEvidence(), selected2 = leaf('2');
    Object.assign(second.nativeReadReceipt, {receiptRef: 'native-receipt-2', taskContextRef: 'task-2'});
    f.authority.readExactEvidence.mockImplementation(async items => structuredClone(items));
    f.jobAid.readSummaryMemberInTransaction.mockImplementationOnce(async () => ({current:true,
      revision:{workRevision:f.selected.workRevision,documentVersionId:f.selected.documentVersionId,content:f.content}}))
      .mockImplementationOnce(async () => ({current:true,revision:{workRevision:selected2.workRevision,documentVersionId:selected2.documentVersionId,
        content:{...f.content,evidence:[second]}}}));
    const readings = await f.service.readAll([f.selected,selected2],actor,f.database as never);
    expect(readings.map(item => (item.evidence[0] as AssessmentTdmsNativeEvidence).nativeReadReceipt.receiptRef))
      .toEqual(['native-receipt-1','native-receipt-2']);
    expect(mergeSummaryEvidence(readings.flatMap(item=>item.evidence))).toEqual([nativeEvidence()]);
    expect(f.authority.assertInTransaction.mock.calls.at(-1)?.[0].evidence.map(item=>item.nativeReadReceipt.receiptRef))
      .toEqual(['native-receipt-1','native-receipt-2']);
  });
});
