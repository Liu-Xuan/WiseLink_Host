import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  REVIEWED_EFREQUEST_RELATED_MODEL,
  REVIEWED_EFREQUEST_RELATED_QUERY_MODEL,
  validateReviewedEfRequestRelatedQueryEvidence,
} from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { sealComplete, copyComplete } from './tdms-complete-owned.fixture';
import { resealT1 } from './tdms-source-t1.fixture';
import { syntheticEfRelatedQueries } from './tdms-source-t1-current-notice.fixture';
import {
  syntheticEfRelatedWindows,
  windowTable,
  mirrorRawQuerySurfaces,
} from './tdms-source267-window.fixture';

function memory(env: ReturnType<typeof syntheticEfRelatedWindows>) {
  const claims = adaptTdmsDailySource(env).memberClaims,
    repository = new MemoryTdmsRepository();
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async ({ actor: a }) =>
      a.tenantId === nativeScope.tenantId && a.canonicalSubject.id === '123'
        ? [{ scope: nativeScope, permissionRevision: 'synthetic-window-267' }]
        : [],
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-window-import',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: claims,
    }),
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-window-read',
      retainedCaptureReadAllowed: true,
      permittedMembers: claims,
    }),
  );
  const artifacts = { acquire: jest.fn() },
    documents = { assertRead: jest.fn() };
  return {
    repository,
    artifacts,
    documents,
    service: new TdmsSourceService(
      repository,
      authorization,
      artifacts,
      documents,
    ),
  };
}

function axes(env: ReturnType<typeof syntheticEfRelatedWindows>, index = 0) {
  const p = proofOfCurrent(env),
    read = p.reads[1],
    table = windowTable(read, index);
  return validateReviewedEfRequestRelatedQueryEvidence(
    table.relatedQueryEvidence,
    { scopeId: p.scopeId, owner: read.owner, table },
  );
}

async function accepted(env: ReturnType<typeof syntheticEfRelatedWindows>) {
  const before = JSON.stringify(env);
  expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
  const adapted = adaptTdmsDailySource(env),
    native = adapted.output.nativePackage;
  expect(native.coverage.status).toBe('PARTIAL');
  expect(native.coverage.gaps).toContain('COMPLETION_CERTIFICATE_NOT_ISSUED');
  expect(native.coverage.gaps).toContain('RELATION_ENUMERATION_UNVERIFIED');
  expect(
    native.relations.every(
      (relation) =>
        relation.authority === 'CANDIDATE_ONLY' &&
        relation.controlledKind === null,
    ),
  ).toBe(true);
  const h = memory(env),
    receipt = await h.service.importDailyMetadata(actor(), env);
  expect(
    (await h.service.readDailyMetadataImport(actor(), receipt.requestId))
      .package,
  ).toEqual(env.package);
  expect(h.repository.state.captures).toHaveLength(1);
  expect(h.repository.state.captures[0]!.receipt).toMatchObject({
    engineeringAdoption: 'NOT_CREATED',
    executionVerified: false,
  });
  expect(h.artifacts.acquire).not.toHaveBeenCalled();
  expect(h.documents.assertRead).not.toHaveBeenCalled();
  expect(JSON.stringify(env)).toBe(before);
}

describe('frozen267 EF related windows through actual Host consumers; synthetic Memory only', () => {
  it('retains exact @1 raw/query decoding and its independent three-axis result through the existing service', async () => {
    const env = syntheticEfRelatedQueries();
    expect(axes(env)).toMatchObject({
      complete: false,
      queryKnown: true,
      currentViewInventoryComplete: true,
      contractScopeCoverage: 'UNKNOWN',
    });
    await accepted(env);
  });

  it.each([0, 1, 2, 3])(
    'retains @2 native pagination for related grid %s with known query/current-view inventory and UNKNOWN contract coverage',
    async (gridIndex) => {
      const env = syntheticEfRelatedWindows('NATIVE_PAGER', { gridIndex });
      expect(axes(env, gridIndex)).toMatchObject({
        complete: false,
        queryKnown: true,
        currentViewInventoryComplete: true,
        contractScopeCoverage: 'UNKNOWN',
      });
      const table = windowTable(proofOfCurrent(env).reads[1], gridIndex);
      expect(table.relatedSurfaceEvidence.windows).toHaveLength(2);
      expect(table.relatedQueryEvidence.windows).toHaveLength(2);
      expect(table.terminal).toMatchObject({
        kind: 'UNCONFIRMED',
        nativeTerminal: false,
        trueZero: false,
      });
      await accepted(env);
    },
  );

  it.each(['VIRTUAL_SCROLL', 'DOM_ROWS'])(
    'retains @2 %s with explicit native indices or simultaneous DOM order while remaining partial',
    async (scanMode) => {
      const env = syntheticEfRelatedWindows(scanMode, {
        nativeIndexed: scanMode === 'VIRTUAL_SCROLL',
      });
      expect(axes(env)).toMatchObject({
        complete: false,
        queryKnown: true,
        currentViewInventoryComplete: true,
        contractScopeCoverage: 'UNKNOWN',
      });
      await accepted(env);
    },
  );

  it.each([0, 1, 2, 3])(
    'keeps repeated unindexed payload partial in grid %s despite different page, occurrence/DOM ids and link locators',
    async (gridIndex) => {
      const env = syntheticEfRelatedWindows('NATIVE_PAGER', {
        gridIndex,
        duplicatePayload: true,
      });
      const table = windowTable(proofOfCurrent(env).reads[1], gridIndex);
      expect(table.relatedSurfaceEvidence.stopReason).toBeNull();
      expect(table.windows[0].pageRaw).not.toBe(table.windows[1].pageRaw);
      expect(table.rows[0].nativeRowId).not.toBe(table.rows[1].nativeRowId);
      expect(table.rows[0].sourceLinks[0].locator).not.toBe(
        table.rows[1].sourceLinks[0].locator,
      );
      expect(axes(env, gridIndex)).toMatchObject({
        complete: false,
        queryKnown: true,
        currentViewInventoryComplete: false,
        contractScopeCoverage: 'UNKNOWN',
        reasonCode: 'TDMS_EFREQUEST_RELATED_PAGE_OCCURRENCE_UNPROVEN',
      });
      await accepted(env);
    },
  );

  it('uses explicit native global indices to distinguish equal payload on distinct pager rows', async () => {
    const env = syntheticEfRelatedWindows('NATIVE_PAGER', {
      duplicatePayload: true,
      nativeIndexed: true,
    });
    expect(axes(env)).toMatchObject({
      queryKnown: true,
      currentViewInventoryComplete: true,
      complete: false,
      contractScopeCoverage: 'UNKNOWN',
    });
    await accepted(env);
  });

  it('does not treat virtual-scroll inferred row ordinals as native index evidence', async () => {
    const env = syntheticEfRelatedWindows('VIRTUAL_SCROLL');
    expect(axes(env)).toMatchObject({
      queryKnown: true,
      currentViewInventoryComplete: false,
      complete: false,
      reasonCode: 'TDMS_EFREQUEST_RELATED_VIEW_END_UNPROVEN',
    });
    await accepted(env);
  });

  it('preserves a changed per-window native query as unknown rather than joining inventories of two different views', async () => {
    const env = syntheticEfRelatedWindows('NATIVE_PAGER');
    for (const read of proofOfCurrent(env).reads) {
      const pair = windowTable(read).relatedQueryEvidence.windows[1];
      pair.before.view.input.rawValue = pair.after.view.input.rawValue =
        'All Revisions';
    }
    resealT1(env);
    expect(axes(env)).toMatchObject({
      queryKnown: false,
      currentViewInventoryComplete: false,
      complete: false,
      contractScopeCoverage: 'UNKNOWN',
      reasonCode: 'TDMS_EFREQUEST_RELATED_QUERY_CHANGED',
    });
    await accepted(env);
  });

  it('preserves an unvisited native next-page end as partial even with every currently reported row', async () => {
    const env = syntheticEfRelatedWindows('NATIVE_PAGER');
    for (const read of proofOfCurrent(env).reads) {
      const table = windowTable(read),
        last = table.relatedSurfaceEvidence.windows[1];
      for (const frame of [last.before, last.after]) {
        frame.paging.next.nativeDisabled = false;
        frame.paging.next.disabled = false;
      }
      table.windows[1].nextControl.enabled = true;
      table.windows[1].nextControl.terminalDeclared = false;
      last.position.nextControl = copyComplete(table.windows[1].nextControl);
      mirrorRawQuerySurfaces(table);
    }
    resealT1(env);
    expect(axes(env)).toMatchObject({
      queryKnown: true,
      currentViewInventoryComplete: false,
      complete: false,
      reasonCode: 'TDMS_EFREQUEST_RELATED_VIEW_END_UNPROVEN',
    });
    await accepted(env);
  });

  it.each([
    'raw-schema',
    'query-schema',
    'raw-version-pair',
    'query-version-pair',
    'owner-version',
    'query-owner',
    'actual-position',
    'raw-row',
    'window-order',
    'native-index',
    'disabled-control',
    'index-origin',
    'query-surface',
    'contract-coverage',
    'contract-proof',
    'enum-complete',
    'native-zero',
  ])(
    'rejects @2 %s in prepare/adapter/service without saving or rewriting the failed raw data',
    async (change) => {
      const env = syntheticEfRelatedWindows('NATIVE_PAGER', {
          nativeIndexed: true,
        }),
        h = memory(env);
      for (const read of proofOfCurrent(env).reads) {
        const table = windowTable(read),
          raw = table.relatedSurfaceEvidence,
          query = table.relatedQueryEvidence;
        if (change === 'raw-schema')
          raw.schemaVersion = 'wiselink.tdms-efrequest-related-raw-windows.v1';
        if (change === 'query-schema')
          query.schemaVersion =
            'wiselink.tdms-efrequest-related-native-query.v1';
        if (change === 'raw-version-pair') {
          raw.modelRevision = REVIEWED_EFREQUEST_RELATED_MODEL.modelRevision;
          raw.schemaVersion = REVIEWED_EFREQUEST_RELATED_MODEL.schemaVersion;
        }
        if (change === 'query-version-pair') {
          query.modelRevision =
            REVIEWED_EFREQUEST_RELATED_QUERY_MODEL.modelRevision;
          query.schemaVersion =
            REVIEWED_EFREQUEST_RELATED_QUERY_MODEL.schemaVersion;
        }
        if (change === 'owner-version')
          raw.ownerSourceVersion.rawRevision = 'B';
        if (change === 'query-owner')
          query.ownerSourceRecordId = 'OR:wt.doc.WTDocument:999000';
        if (change === 'actual-position')
          raw.windows[0].position.rowOccurrenceIds =
            raw.windows[1].position.rowOccurrenceIds;
        if (change === 'raw-row')
          for (const frame of [raw.windows[0].before, raw.windows[0].after])
            frame.rowShapes[0].occurrenceId = 'synthetic-other-window-row';
        if (change === 'window-order') raw.windows[1].windowOrdinal = 0;
        if (change === 'native-index')
          for (const frame of [raw.windows[0].before, raw.windows[0].after])
            frame.rowShapes[0].attributes.dataRowIndex = '99';
        if (change === 'disabled-control')
          raw.windows[1].after.paging.next.disabled = false;
        if (change === 'index-origin') raw.indexOrigin = 'COMPLETE_DOM_ORDER';
        if (change === 'query-surface')
          query.windows[0].after.surface.counts[0].rawText = '(99 objects)';
        if (change === 'contract-coverage')
          query.contractScopeCoverage.state = 'COMPLETE';
        if (change === 'contract-proof')
          query.contractScopeCoverage.proof = { guessed: true };
        if (change === 'enum-complete') table.enumerationState = 'VALUE';
        if (change === 'native-zero') table.terminal.trueZero = true;
        if (['raw-row', 'native-index', 'disabled-control'].includes(change))
          mirrorRawQuerySurfaces(table);
      }
      sealComplete(env);
      const before = JSON.stringify(env);
      expect(() => prepareTdmsDailySourceImport(env)).toThrow('TDMS_');
      expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_');
      await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
        'TDMS_',
      );
      expect(h.repository.state.captures).toHaveLength(0);
      expect(h.repository.state.revisions).toHaveLength(0);
      expect(h.artifacts.acquire).not.toHaveBeenCalled();
      expect(JSON.stringify(env)).toBe(before);
    },
  );
});
