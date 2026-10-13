import sourceView from '../../fixtures/tdms-source/related-status-source-view.synthetic.json';
import {
  completeOwnedTargetOccurrences,
  validateCompleteRelationTable,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  copyComplete,
  syntheticCompleteEnvelope,
  withCompleteRelation,
} from './tdms-complete-owned.fixture';
import { proofOfCurrent, resealCurrent } from './tdms-current-contract.fixture';

// sourceView is the authoritative pure Source factory's NOT_READ output with
// the existing synthetic EO owner. It is not a collected or reviewed view.
function relatedStatusEnvelope(includeView = true) {
  const env = withCompleteRelation(syntheticCompleteEnvelope('EO'));
  const proof = proofOfCurrent(env);
  for (const read of proof.reads) {
    const table = read.relationTables[0];
    Object.assign(table, {
      tabId: sourceView.tabId,
      panelLocator: sourceView.panelLocator,
      gridId: sourceView.gridId,
      ...(includeView ? { sourceViewEvidence: copyComplete(sourceView) } : {}),
    });
    read.tabs.push({
      ...read.tabs[0],
      tabId: table.tabId,
      panelLocator: table.panelLocator,
      label: 'Related Status',
    });
    read.rosterEvidence.tabIds.push(table.tabId);
    const empty = {
      fieldIds: [],
      sectionIds: [],
      fieldLocators: [],
      sectionLocators: [],
      declaredFieldCount: 0,
      declaredSectionCount: 0,
      loadingPresent: false,
      terminal: 'DOM_TREE_END',
    };
    read.rosterEvidence.structuralRosters.push({
      tabId: table.tabId,
      before: empty,
      after: copyComplete(empty),
      settledReads: 2,
    });
    const row = table.rows[0],
      link = row.sourceLinks[0];
    const columns = [
      [
        'Number',
        'number',
        'STATUS_LINK',
        'OR:com.airchina.tdms.statuslink.TDMSStatusLink:999',
      ],
      [
        'Feed Back Order',
        'feedbackOid',
        'FEEDBACK_LINK',
        'OR:wt.doc.WTDocument:998',
      ],
      [
        'Document Number',
        'docOid',
        'ENGINEERING_DOC_REFERENCE',
        read.owner.sourceRecordId,
      ],
    ];
    table.rawHeaders = columns.map(([label]) => label);
    row.cells = columns.map(([label]) => ({
      ...row.cells[0],
      actualLabel: label,
    }));
    row.sourceLinks = columns.map(([label, token, role, ref]) => ({
      ...link,
      nativeColumnLabel: label,
      nativeColumnToken: token,
      nativeRole: role,
      targetRef: ref,
      rawHref: '/infoPage?oid=' + ref,
      locator: table.panelLocator + ' #' + table.gridId + ' ' + token,
    }));
  }
  proof.targetOccurrences = completeOwnedTargetOccurrences(proof);
  const edge = env.package.edges[0];
  env.package.edges = proof.targetOccurrences.map((occurrence: any) => ({
    ...edge,
    toSourceRecordId: occurrence.targetRef,
    evidenceLocator: occurrence.locator,
  }));
  return resealCurrent(env);
}

const readTable = (env: ReturnType<typeof relatedStatusEnvelope>) =>
  proofOfCurrent(env).reads[1];
const validateTable = (read: any, scopeId = 'EO') =>
  validateCompleteRelationTable(
    read.relationTables[0],
    { scopeId, sourceObjectRef: read.owner.sourceRecordId },
    read.owner,
  );
const valueEvidence = (filters: 'NONE' | 'VALUE') => ({
  ...copyComplete(sourceView),
  state: 'VALUE',
  modelRevision: 'synthetic-reviewed-model',
  nativeView: {
    state: 'VALUE',
    control: {
      locator: '#native-view',
      tag: 'SELECT',
      actualLabel: 'View',
      rawValue: 'All',
    },
  },
  nativeFilters:
    filters === 'NONE'
      ? {
          state: 'NONE',
          controls: [],
          noFilterDeclaration: {
            locator: '#native-filter-none',
            tag: 'SPAN',
            actualLabel: 'Filter',
            rawValue: 'None',
          },
        }
      : {
          state: 'VALUE',
          controls: [
            {
              locator: '#native-filter',
              tag: 'INPUT',
              actualLabel: 'Aircraft',
              rawValue: 'SYNTHETIC-AC',
            },
          ],
          noFilterDeclaration: null,
        },
});

describe('optional Related Status source view DTO', () => {
  it.each(['EO', 'EF', 'AEO'])(
    'admits the exact raw table view under %s only',
    (scope) => {
      const read = readTable(relatedStatusEnvelope());
      expect(validateTable(read, scope)).toBe(read.relationTables[0]);
      expect(read.relationTables[0].sourceViewEvidence).toEqual(sourceView);
    },
  );

  it('retains raw NOT_READ and all three typed references through the existing import/readback without expanding targets', async () => {
    const env = relatedStatusEnvelope(),
      adapted = adaptTdmsDailySource(env);
    const claims = copyComplete(adapted.memberClaims),
      repository = new MemoryTdmsRepository();
    const authority = new HostDecisionTdmsSourceAuthorization(
      async () => [
        { scope: nativeScope, permissionRevision: 'synthetic-view-1' },
      ],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      }),
    );
    const artifacts = { acquire: jest.fn() };
    const service = new TdmsSourceService(repository, authority, artifacts, {
      assertRead: jest.fn(),
    });
    const receipt = await service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(
      (await service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    const nativeProof = adapted.output.nativePackage.records[0].rawFields
      .completeOwnedSource as any;
    expect(nativeProof.reads[1].relationTables[0].sourceViewEvidence).toEqual(
      sourceView,
    );
    expect(nativeProof.reads[1].relationTables[0].rows[0].sourceLinks).toEqual(
      readTable(env).relationTables[0].rows[0].sourceLinks,
    );
    expect(adapted.output.nativePackage.records).toHaveLength(1);
    expect(adapted.output.nativePackage.records[0].coverage.status).toBe(
      'PARTIAL',
    );
    expect(adapted.output.nativePackage.records[0].coverage.gaps).toContain(
      'COMPLETION_CERTIFICATE_NOT_ISSUED',
    );
    expect(repository.state.captures[0].receipt.executionVerified).toBe(false);
    expect(artifacts.acquire).not.toHaveBeenCalled();
  });

  it('keeps historical absent evidence absent in both retained and native data', () => {
    const env = relatedStatusEnvelope(false),
      adapted = adaptTdmsDailySource(env);
    for (const packageValue of [
      adapted.envelope.package,
      adapted.output.nativePackage,
    ]) {
      const proof = packageValue.records[0].rawFields
        .completeOwnedSource as any;
      for (const read of proof.reads)
        expect(
          Object.hasOwn(read.relationTables[0], 'sourceViewEvidence'),
        ).toBe(false);
    }
  });

  it.each(['NONE', 'VALUE'] as const)(
    'retains synthetic VALUE/%s filter evidence as partial raw information',
    (state) => {
      const env = relatedStatusEnvelope(),
        proof = proofOfCurrent(env),
        evidence = valueEvidence(state);
      for (const read of proof.reads)
        read.relationTables[0].sourceViewEvidence = copyComplete(evidence);
      resealCurrent(env);
      const native = adaptTdmsDailySource(env).output.nativePackage.records[0];
      expect(
        (native.rawFields.completeOwnedSource as any).reads[1].relationTables[0]
          .sourceViewEvidence,
      ).toEqual(evidence);
      expect(native.coverage.status).toBe('PARTIAL');
      expect(native.coverage.gaps).toContain(
        'COMPLETION_CERTIFICATE_NOT_ISSUED',
      );
    },
  );

  it.each([
    [
      'owner',
      (v: any) => {
        v.ownerSourceRecordId = 'OR:wt.epm.EPMDocument:902';
      },
    ],
    [
      'technical version',
      (v: any) => {
        v.ownerTechnicalVersion.rawIteration = '2';
      },
    ],
    [
      'business version',
      (v: any) => {
        v.ownerBusinessVersion.rawRevision = '2';
      },
    ],
    [
      'missing key',
      (v: any) => {
        delete v.ownerBusinessVersion;
      },
    ],
    [
      'parent alias',
      (v: any) => {
        v.parentSourceRecordId = v.ownerSourceRecordId;
        delete v.ownerSourceRecordId;
      },
    ],
    [
      'extra key',
      (v: any) => {
        v.applicabilityComplete = true;
      },
    ],
    [
      'nested extra key',
      (v: any) => {
        v.nativeView.reviewed = true;
      },
    ],
    [
      'false NOT_READ model',
      (v: any) => {
        v.modelRevision = 'caller-model';
      },
    ],
    [
      'false NOT_READ filter',
      (v: any) => {
        v.nativeFilters.state = 'NONE';
      },
    ],
    [
      'timestamp',
      (v: any) => {
        v.observedAt = '2026-10-13T00:00:00Z';
      },
    ],
    [
      'tab',
      (v: any) => {
        v.tabId = 'other-tab';
      },
    ],
    [
      'panel',
      (v: any) => {
        v.panelLocator = '#other-panel';
      },
    ],
    [
      'grid',
      (v: any) => {
        v.gridId = 'other-grid';
      },
    ],
    [
      'locator',
      (v: any) => {
        v.evidenceLocator += ' other';
      },
    ],
  ])('rejects mismatched %s evidence', (_name, mutate) => {
    const read = readTable(relatedStatusEnvelope());
    (mutate as (v: any) => void)(read.relationTables[0].sourceViewEvidence);
    expect(() => validateTable(read)).toThrow(
      'TDMS_COMPLETE_RELATED_STATUS_VIEW_INVALID',
    );
  });

  it.each(['SB', 'SL', 'ENGINEERING_ASSESSMENT', 'AIRCRAFT_STATUS'])(
    'rejects view evidence under unrelated %s scope',
    (scope) => {
      expect(() =>
        validateTable(readTable(relatedStatusEnvelope()), scope),
      ).toThrow('TDMS_COMPLETE_RELATED_STATUS_VIEW_INVALID');
    },
  );

  it.each([
    'null object',
    'duplicate filter',
    'missing no-filter declaration',
    'unbound control',
    'oversize control',
    'extra nested control key',
    'too many filters',
  ])('rejects malformed %s', (change) => {
    const read = readTable(relatedStatusEnvelope()),
      table = read.relationTables[0];
    table.sourceViewEvidence = valueEvidence('VALUE');
    if (change === 'null object') table.sourceViewEvidence = null;
    else {
      const v = table.sourceViewEvidence;
      if (change === 'duplicate filter')
        v.nativeFilters.controls.push(
          copyComplete(v.nativeFilters.controls[0]),
        );
      if (change === 'missing no-filter declaration')
        v.nativeFilters = {
          state: 'NONE',
          controls: [],
          noFilterDeclaration: null,
        };
      if (change === 'unbound control')
        v.nativeView.control.locator = 'https://example.invalid/view';
      if (change === 'oversize control')
        v.nativeView.control.rawValue = 'x'.repeat(1001);
      if (change === 'extra nested control key')
        v.nativeView.control.reviewed = true;
      if (change === 'too many filters')
        v.nativeFilters.controls = Array.from({ length: 21 }, (_, i) => ({
          ...v.nativeFilters.controls[0],
          locator: '#filter-' + i,
        }));
    }
    expect(() => validateTable(read)).toThrow(
      'TDMS_COMPLETE_RELATED_STATUS_VIEW_INVALID',
    );
  });
});
