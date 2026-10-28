import { canonical, hash } from '@server/modules/tdms-source/tdms-source.validation';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import type { TdmsSourceAuthorization } from '@server/modules/tdms-source/tdms-source.types';
import { alternateParentChain, laterProcessingObservation, observedEnvelope, observedFixture, sourceFactoryCase } from './tdms-observed-links.fixture';

describe('document original to independently retained Source observations', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the exact original → processing → each own assessment through real controllers and receipts', async () => {
    const f = await observedFixture(), dv = f.registration.documentVersionId!;
    expect(f.data.metadata.packageId).toMatch(/^TDMSCOMPLETEOWNPKG-[a-f0-9]{64}$/u);
    expect(f.data.original.packageId).toMatch(/^TDMSORIGINALPKG-[a-f0-9]{64}$/u);
    expect(f.data.original.edges).toHaveLength(1);
    const root = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef, limit: '1' });
    expect(root.diagnostic).toBe('AVAILABLE');
    expect(root.links).toHaveLength(1);
    const processing = root.links[0]!;
    expect(processing.evidence).toMatchObject({ kind: 'SOURCE_OBSERVED_ASSOCIATION', rootRevisionRef: f.rootRef,
      parentRevisionRef: f.rootRef, parentSourcePackageId: f.data.metadata.packageId,
      parentOperationVerification: 'NOT_RETAINED', applicability: 'UNKNOWN', currentness: 'UNKNOWN',
      completeness: 'UNKNOWN', readback: 'NON_ATOMIC' });
    expect(processing.evidence.sourceParentRevisionRef).not.toBe(f.rootRef);
    expect(processing.child.record.relatedDocumentVersionIds).toEqual([]);
    expect(processing.child.receipt).toMatchObject({ purpose: 'WIKI_NATIVE_RECORD', readPerformed: true,
      sourceRevisionRef: processing.child.record.sourceRevisionRef, engineeringAdoption: 'NOT_CREATED' });

    const parent = processing.child.record.sourceRevisionRef;
    const page1 = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef, parent, limit: '1' });
    expect(page1.links).toHaveLength(1);
    expect(page1.hasMore).toBe(true);
    const page2 = await f.controller.documentObservedLinks(f.request, dv, {
      root: f.rootRef, parent, limit: '1', after: page1.nextAfter!,
    });
    expect(page2.links).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    const assessments = [...page1.links, ...page2.links];
    expect(new Set(assessments.map(link => link.child.record.sourceRecordId)).size).toBe(2);
    const approved = assessments.find(link => link.child.record.state?.rawName === 'Estimated')!;
    const unapproved = assessments.find(link => link.child.record.state?.rawName === 'Estimating')!;
    expect(approved.child.bodyReadPolicy?.kind).toBe('ESTIMATED_ASSESSMENT');
    expect(JSON.stringify(approved.child.record.content)).toContain('Synthetic approved opinion');
    expect(unapproved.child.bodyReadPolicy?.kind).toBe('METADATA_ONLY');
    expect(unapproved.child.record.content).toEqual({});
    expect(unapproved.child.record.rawFields).toEqual({});
    expect(assessments.every(link => link.child.record.relatedDocumentVersionIds.length === 0)).toBe(true);
    expect(f.repository.state.receipts.filter(value => value.receipt.purpose === 'WIKI_NATIVE_RECORD').length).toBe(3);
  });

  it('requires current relation rights and does not use the prior IMPORT admission', async () => {
    const f = await observedFixture();
    f.f.actions.IMPORT.allowed = false;
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .resolves.toMatchObject({ diagnostic: 'AVAILABLE' });
    f.f.actions.READ_RELATIONS.allowed = false;
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });

  it('does not request relations from an unrelated catalogue scope', async () => {
    const f = await observedFixture();
    const authorization = Reflect.get(f.service, 'authorization') as TdmsSourceAuthorization;
    const catalogue = authorization.catalogue.bind(authorization);
    const authorize = authorization.authorize.bind(authorization);
    jest.spyOn(authorization, 'catalogue').mockImplementation(async (actor, context) => {
      const grants = await catalogue(actor, context);
      return [...grants, { ...grants[0], scope: { ...grants[0].scope, scopeId: 'unrelated-scope' } }];
    });
    const access = jest.spyOn(authorization, 'authorize').mockImplementation((actor, scope, action, context) => {
      if (scope.scopeId === 'unrelated-scope') throw new Error('UNRELATED_SCOPE_ACCESSED');
      return authorize(actor, scope, action, context);
    });
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .resolves.toMatchObject({ diagnostic: 'AVAILABLE' });
    expect(access.mock.calls.every(([, scope]) => scope.scopeId !== 'unrelated-scope')).toBe(true);
  });

  it('fails when the retained metadata digest no longer matches the child parent proof', async () => {
    const f = await observedFixture();
    const metadata = f.repository.state.captures.find(row => row.packageId === 'TDMSIMPORT-' + hash(f.data.metadata))!;
    metadata.packageHash = '0'.repeat(64);
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT' });
  });

  it('does not bridge an original to a later observation with a different full owner', async () => {
    const f = await observedFixture();
    const metadata = f.repository.state.captures.find(row => row.dailyMetadata?.envelope.package.packageId === f.data.metadata.packageId)!;
    metadata.dailyMetadata!.envelope.package.records[0].observedAt = '2026-10-13T00:00:02.000Z';
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT' });
  });

  it('does not substitute a separately retained full capture with the same owner and snapshot', async () => {
    const f = await observedFixture();
    const other = alternateParentChain(f.data.metadata, f.data.processing);
    expect(other.metadata.records[0].snapshotId).toBe(f.data.original.records[0].snapshotId);
    expect(canonical(other.metadata.records[0])).not.toBe(canonical(f.data.original.records[0]));
    const additions = [other.metadata, other.processing].map(pkg => adaptTdmsDailySource(observedEnvelope(pkg)).memberClaims);
    const unique = <T>(values: T[]) => [...new Map(values.map(value => [canonical(value), value])).values()];
    for (const action of Object.values(f.f.actions)) {
      const members = action.permittedMembers;
      action.permittedMembers = { ...members, records: unique([...members.records, ...additions.flatMap(item => item.records)]),
        artifacts: unique([...members.artifacts, ...additions.flatMap(item => item.artifacts)]),
        relationIds: [...new Set([...members.relationIds, ...additions.flatMap(item => item.relationIds)])] };
    }
    await f.dailyController.submit(f.request, observedEnvelope(other.metadata), {});
    await f.dailyController.submit(f.request, observedEnvelope(other.processing), {});
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_OBSERVED_CAPTURE_INVALID' });
  });

  it('returns an explicit gap when the exact parent metadata capture was not retained', async () => {
    const f = await observedFixture();
    f.repository.state.captures = f.repository.state.captures.filter(row =>
      row.dailyMetadata?.envelope.package.packageId !== f.data.metadata.packageId);
    const result = await f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef });
    expect(result.links).toEqual([]);
    expect(result.gaps).toEqual(['PARENT_METADATA_CAPTURE_NOT_RETAINED']);
  });

  it('returns no association when the retained original observation has no relation table', async () => {
    const f = await observedFixture({ noRelationOriginal: true });
    const result = await f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef });
    expect(result).toMatchObject({ diagnostic: 'NO_OBSERVED_LINKS', links: [], hasMore: false, gaps: [] });
  });

  it('uses the actual current Host head while keeping the exact linked historical revision', async () => {
    const f = await observedFixture();
    const processing = f.repository.state.revisions.find(row => row.record.sourceRecordId === f.data.processing.records[0].sourceRecordId)!;
    await f.dailyController.submit(f.request, observedEnvelope(laterProcessingObservation(f.data.processing)), {});
    const head = f.repository.state.heads.find(row => row.recordRef === processing.record.recordRef)!;
    expect(head.sourceRevisionRef).not.toBe(processing.record.sourceRevisionRef);
    const result = await f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef });
    const historical = result.links.find(link => link.child.record.sourceRevisionRef === processing.record.sourceRevisionRef)!;
    expect(historical.child.record.selectedHead).toBe(false);
    expect(historical.evidence.currentness).toBe('UNKNOWN');
  });

  it('rejects a Source-declared target version that differs from the child own observation', async () => {
    const f = await observedFixture({ mismatchedRootTargetVersion: true });
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_OBSERVED_CAPTURE_INVALID' });
  });

  it('does not expand links from an assessment whose own body is withheld', async () => {
    const f = await observedFixture(), dv = f.registration.documentVersionId!;
    const root = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef });
    const processing = root.links[0].child.record.sourceRevisionRef;
    const page = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef, parent: processing });
    const unapproved = page.links.find(link => link.child.bodyReadPolicy?.kind === 'METADATA_ONLY')!;
    const withheld = await f.controller.documentObservedLinks(f.request, dv, {
      root: f.rootRef, parent: [processing, unapproved.child.record.sourceRevisionRef],
    });
    expect(withheld).toMatchObject({ diagnostic: 'PARENT_BODY_WITHHELD', links: [], hasMore: false });
  });

  it('retains AEO source execution-window facts on the exact associated revision', async () => {
    const f = await observedFixture({ includeAeo: true }), dv = f.registration.documentVersionId!;
    const root = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef });
    const processing = root.links[0].child.record.sourceRevisionRef;
    const page = await f.controller.documentObservedLinks(f.request, dv, { root: f.rootRef, parent: processing });
    const aeo = page.links.find(link => link.child.record.sourceRecordId === f.data.engineering!.records[0].sourceRecordId)!;
    expect(aeo.evidence).toMatchObject({ kind: 'SOURCE_OBSERVED_ASSOCIATION', applicability: 'UNKNOWN', currentness: 'UNKNOWN' });
    expect(aeo.child.engineeringExecution).toMatchObject({ sourceRevisionRef: aeo.child.record.sourceRevisionRef,
      sourceVersion: { rawRevision: 'N', rawIteration: '3' }, businessVersion: { rawRevision: 'R17' },
      executionVerified: false, requirementCoverage: 'NOT_CAPTURED', targetAircraftCoverage: 'UNKNOWN' });
    const rawCells = aeo.child.engineeringExecution!.applicabilityWindows![0].rows.flatMap(row => row.cells);
    expect(rawCells.find(cell => cell.actualLabel === 'Execute Time')?.rawValue).toBe('SYNTHETIC PRIOR SOURCE ASSERTION');
    expect(aeo.child.receipt.engineeringAdoption).toBe('NOT_CREATED');
  });

  it('rejects a member revocation while producing the read receipt', async () => {
    const f = await observedFixture();
    f.repository.state.receipts = [];
    f.repository.beforeReceipt = () => {
      f.f.actions.READ_RECORD.permittedMembers = { records: [], artifacts: [], relationIds: [] };
    };
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' });
    expect(f.repository.state.receipts).toHaveLength(0);
  });

  it('does not extend an admitted deadline across the transaction return', async () => {
    const f = await observedFixture(), now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    f.f.row.validUntil = new Date(now + 1000).toISOString();
    f.repository.state.receipts = [];
    f.repository.beforeCommit = () => clock.mockReturnValue(now + 1001);
    await expect(f.controller.documentObservedLinks(f.request, f.registration.documentVersionId!, { root: f.rootRef }))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED' });
  });

  it('the Source-shaped fixture preserves metadata owner and candidate edges in the derived original', () => {
    const f = sourceFactoryCase();
    expect(canonical(f.original.records[0])).toBe(canonical(f.metadata.records[0]));
    expect(canonical(f.original.edges)).toBe(canonical(f.metadata.edges));
  });
});
