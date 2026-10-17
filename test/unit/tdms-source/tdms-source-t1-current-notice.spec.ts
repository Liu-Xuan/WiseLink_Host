import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { validateReviewedEfRequestRelatedQueryEvidence } from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  syntheticAeoNativeView,
  syntheticEfRelatedQueries,
} from './tdms-source-t1-current-notice.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { sealComplete } from './tdms-complete-owned.fixture';

describe('current 265-vector notice only: AEO v2 and distinct EF query/inventory/scope results', () => {
  it.each([
    ['AEO v2', syntheticAeoNativeView],
    ['EF related query', syntheticEfRelatedQueries],
  ] as const)(
    'retains the %s observation through actual prepare, adapter, service and authorized readback without formal adoption',
    async (_name, factory) => {
      const env = factory(),
        before = JSON.stringify(env),
        claims = adaptTdmsDailySource(env).memberClaims,
        repository = new MemoryTdmsRepository();
      expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
      const authorization = new HostDecisionTdmsSourceAuthorization(
        async ({ actor: a }) =>
          a.tenantId === nativeScope.tenantId && a.canonicalSubject.id === '123'
            ? [{ scope: nativeScope, permissionRevision: 'synthetic-265' }]
            : [],
        async ({ grant }) => ({
          ...grant,
          authorityRef: 'synthetic-265-import',
          captureRetentionAllowed: true,
          nativeProjectionAllowed: true,
          permittedMembers: claims,
        }),
        async ({ grant }) => ({
          ...grant,
          authorityRef: 'synthetic-265-read',
          retainedCaptureReadAllowed: true,
          permittedMembers: claims,
        }),
      );
      const artifacts = { acquire: jest.fn() },
        documents = { assertRead: jest.fn() },
        service = new TdmsSourceService(
          repository,
          authorization,
          artifacts,
          documents,
        );
      const receipt = await service.importDailyMetadata(actor(), env);
      expect(receipt.requestId).toBe(env.requestId);
      expect(
        (await service.readDailyMetadataImport(actor(), env.requestId)).package,
      ).toEqual(env.package);
      expect(repository.state.captures).toHaveLength(1);
      expect(repository.state.captures[0]!.receipt).toMatchObject({
        engineeringAdoption: 'NOT_CREATED',
        executionVerified: false,
      });
      expect(artifacts.acquire).not.toHaveBeenCalled();
      expect(documents.assertRead).not.toHaveBeenCalled();
      expect(JSON.stringify(env)).toBe(before);
    },
  );
  it('accepts exact AEO v2 owner/windows and preserves a prior execution assertion without converting it to a current outcome', () => {
    const env = syntheticAeoNativeView(),
      before = JSON.stringify(env);
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    const native = adaptTdmsDailySource(env).output.nativePackage;
    expect(native.coverage.status).toBe('PARTIAL');
    expect(native.records[0]!.content.executionDeclaration).toBeUndefined();
    expect(
      native.relations.every(
        (r) => r.authority === 'CANDIDATE_ONLY' && r.controlledKind === null,
      ),
    ).toBe(true);
    expect(
      proofOfCurrent(env).reads[1].relationTables[0].rows[0].cells.find(
        (c: { actualLabel: string }) => c.actualLabel === 'Execute Time',
      ).rawValue,
    ).toBe('SYNTHETIC PRIOR SOURCE ASSERTION');
    expect(JSON.stringify(env)).toBe(before);
  });
  it.each([
    'window-table',
    'own-subtype',
    'technical-version',
    'business-version',
    'owner',
    'EO-lane',
    'active-search',
    'toolbar',
    'one-read',
  ])(
    'rejects AEO v2 %s through the actual outer complete-owned consumer',
    (change) => {
      const env = syntheticAeoNativeView(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const view = read.relationTables[0].sourceViewEvidence;
        if (change === 'owner')
          view.ownerSourceRecordId = 'OR:wt.epm.EPMDocument:999001';
        if (change === 'EO-lane')
          p.scopeId = p.requestedCriteria.scopeId = 'EO';
        if (change === 'technical-version')
          view.ownerTechnicalVersion.rawIteration = '9';
        if (change === 'business-version')
          view.ownerBusinessVersion.rawRevision = 'R99';
        if (change === 'own-subtype')
          read.fields.find(
            (f: { value: { actualLabel: string } }) =>
              f.value.actualLabel === '指令类别:',
          ).value.rawValue = 'EO';
        for (const frame of [view.windows[0].before, view.windows[0].after]) {
          if (change === 'window-table')
            frame.position.rowOccurrenceIds[0] = 'another-source-row';
          if (change === 'active-search') frame.query.rawValue = 'filtered';
          if (change === 'toolbar')
            frame.toolbarRosters[0].nodes[0].childCount += 1;
          if (change === 'one-read') {
            frame.query.rawValue = 'filtered';
            break;
          }
        }
      }
      sealComplete(env);
      expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_');
    },
  );
  it('keeps known UI query and complete current-view inventory independent from UNKNOWN contract coverage for all four EF surfaces', () => {
    const env = syntheticEfRelatedQueries(),
      p = proofOfCurrent(env),
      read = p.reads[1];
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    for (const table of read.relationTables.filter(
      (t: { relatedQueryEvidence?: unknown }) => t.relatedQueryEvidence,
    )) {
      const result = validateReviewedEfRequestRelatedQueryEvidence(
        table.relatedQueryEvidence,
        { scopeId: p.scopeId, owner: read.owner, table },
      );
      expect(result).toMatchObject({
        complete: false,
        queryKnown: true,
        currentViewInventoryComplete: true,
        contractScopeCoverage: 'UNKNOWN',
      });
      expect(table.enumerationState).toBe('NOT_READ');
      expect(table.terminal.nativeTerminal).toBe(false);
      expect(table.terminal.trueZero).toBe(false);
    }
    const native = adaptTdmsDailySource(env).output.nativePackage;
    expect(native.coverage.gaps).toContain('RELATION_ENUMERATION_UNVERIFIED');
    expect(native.coverage.gaps).toContain('COMPLETION_CERTIFICATE_NOT_ISSUED');
  });
  it.each([
    'owner',
    'version',
    'scope-complete',
    'contract-proof',
    'enum-value',
    'zero-promotion',
    'view-name',
    'one-read',
    'raw-surface-binding',
  ])(
    'rejects EF related-query %s without granting contract scope from a native view name',
    (change) => {
      const env = syntheticEfRelatedQueries(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        const table = read.relationTables[4],
          q = table.relatedQueryEvidence;
        if (change === 'owner')
          q.ownerSourceRecordId = 'OR:wt.doc.WTDocument:999000';
        if (change === 'version') q.ownerSourceVersion.rawIteration = '9';
        if (change === 'scope-complete')
          q.contractScopeCoverage.state = 'COMPLETE';
        if (change === 'contract-proof')
          q.contractScopeCoverage.proof = { guessed: true };
        if (change === 'enum-value') table.enumerationState = 'VALUE';
        if (change === 'zero-promotion') table.terminal.trueZero = true;
        if (change === 'view-name') {
          q.windows[0].after.view.input.rawValue = 'All Revisions';
          q.windows[0].before.view.input.rawValue = 'All Revisions';
        }
        if (change === 'one-read')
          q.windows[0].before.view.input.rawValue = 'All Revisions';
        if (change === 'raw-surface-binding')
          q.windows[0].after.surface.counts[0].rawText = '(0 objects)';
      }
      sealComplete(env);
      if (change === 'view-name') {
        // Unknown/changed native query is preserved as a partial observation,
        // rather than rewritten to a known Default/Latest view.
        const prepared = prepareTdmsDailySourceImport(env);
        const read = proofOfCurrent(prepared.envelope).reads[1],
          t = read.relationTables[4];
        expect(
          validateReviewedEfRequestRelatedQueryEvidence(
            t.relatedQueryEvidence,
            { scopeId: p.scopeId, owner: read.owner, table: t },
          )?.queryKnown,
        ).toBe(false);
      } else expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_');
    },
  );
});
