import type {
  TdmsSourceVersion,
  TdmsCompleteOwnedField,
} from '../../../shared/tdms-source.interface';
import {
  prepareTdmsDailySourceImport,
  type TdmsDailyMetadataEnvelope,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import type { TdmsImportMemberClaims } from '../../../server/modules/tdms-source/tdms-source.types';
import { validateReviewedAdHandlingSurfaceEvidence } from '../../../server/modules/tdms-source/tdms-reviewed-ad-handling-required-surfaces';
import { validateReviewedAdItemDetailsQueryEvidence } from '../../../server/modules/tdms-source/tdms-reviewed-ad-item-native-model';
import { validateReviewedEfRequestRelatedSurfaceEvidence } from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';
import { syntheticHandling, resealT1 } from './tdms-source-t1.fixture';
import { copyComplete } from './tdms-complete-owned.fixture';
import {
  syntheticAdItem,
  resealMetadata,
  currentRecordHash,
  metadataAdItemGolden,
} from './tdms-metadata-aditem.fixture';
import { syntheticAdItemLegacyProjection } from './tdms-source268-ui-tree.fixture';
import {
  syntheticHRequiredSurfaces,
  syntheticItemQuery,
} from './tdms-h-item-query.fixture';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';

interface TestOwner {
  sourceRecordId: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion: TdmsSourceVersion | null;
  stateRaw: string;
}
interface TestWindow {
  rowOccurrenceIds: string[];
  globalIndices: number[];
  reportedTotal: number | null;
  nextControl: {
    present: boolean;
    enabled: boolean;
    terminalDeclared: boolean;
  };
}
interface TestFrame {
  controls: Array<{
    rawValue: string | null;
    valueEvidenceState: string;
    rawClassName: string;
  }>;
  counts: Array<{ rawText: string }>;
  columns: Array<{ actualLabel: string; nativeColumnToken: string }>;
  position: TestWindow;
}
interface TestItemProof {
  scopeId: string;
  ownerSourceRecordId: string;
  ownerSourceVersion: TdmsSourceVersion;
  ownerSourceModifiedRaw: string;
  before: TestFrame;
  after: TestFrame;
}
interface TestHandlingProof {
  ownerSourceVersion: TdmsSourceVersion;
  ownModifiedRaw: string;
  queryDefinition: string;
  windows: Array<{
    controls: Array<{ valueState: string }>;
    frames: Array<{ rawSrc: string }>;
    grids: Array<{
      pagerPresent: boolean;
      columns: Array<{ actualLabel: string; nativeColumnToken: string }>;
    }>;
  }>;
}
interface TestTable {
  tableId: string;
  tabId: string;
  gridId: string;
  relationshipRole: string;
  direction: string;
  scanMode: string;
  rawHeaders: string[];
  reportedTotal: number | null;
  countEvidence: { locator: string; rawText: string | null; exact: boolean };
  rows: Array<{
    treeDepth: number | null;
    treePath: string[];
    sourceLinks: unknown[];
    cells: Array<{
      state: string;
      rawValue: string | null;
      observedTotalCodepoints: number;
    }>;
  }>;
  windows: TestWindow[];
  terminal: {
    kind: string;
    nativeTerminal: boolean;
    trueZero: boolean;
    allGlobalIndices: boolean;
  };
  enumerationState: string;
  relatedSurfaceEvidence?: TestItemProof;
  relatedQueryEvidence?: unknown;
}
interface TestRead {
  owner: TestOwner;
  fields: TdmsCompleteOwnedField[];
  tabs: Array<{
    tabId: string;
    required: boolean;
    purposeEvidence?: TestHandlingProof;
  }>;
  relationTables: TestTable[];
}
interface TestProof {
  reads: TestRead[];
  targetOccurrences: unknown[];
}
const proof = (env: TdmsDailyMetadataEnvelope): TestProof =>
  env.package.records[0]!.rawFields.completeOwnedSource as TestProof;
const firstDetails = (read: TestRead): TestTable =>
  read.relationTables.find(
    (t: TestTable) => t.relatedSurfaceEvidence !== undefined,
  )!;
const firstPurpose = (read: TestRead): TestHandlingProof =>
  read.tabs.find(
    (t: TestRead['tabs'][number]) => t.purposeEvidence !== undefined,
  )!.purposeEvidence!;
function edit(
  env: TdmsDailyMetadataEnvelope,
  change: (read: TestRead) => void,
  h: boolean = false,
): void {
  for (const read of proof(env).reads) change(read);
  if (h) resealT1(env);
  else resealMetadata(env);
}
function memory(env: TdmsDailyMetadataEnvelope = syntheticItemQuery()) {
  const claims: TdmsImportMemberClaims = adaptTdmsDailySource(env).memberClaims;
  const repository: MemoryTdmsRepository = new MemoryTdmsRepository();
  const state: { allowed: boolean } = { allowed: true };
  const authorization: HostDecisionTdmsSourceAuthorization =
    new HostDecisionTdmsSourceAuthorization(
      async ({ actor: a }) =>
        state.allowed &&
        a.tenantId === nativeScope.tenantId &&
        a.canonicalSubject.id === '123'
          ? [
              {
                scope: nativeScope,
                permissionRevision: 'synthetic-h-item-query',
              },
            ]
          : [],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-query-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-query-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      }),
    );
  const artifacts: { acquire: jest.Mock } = { acquire: jest.fn() };
  const documents: { assertRead: jest.Mock } = { assertRead: jest.fn() };
  return {
    repository,
    state,
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
async function retainedItem(env: TdmsDailyMetadataEnvelope): Promise<void> {
  const before: string = JSON.stringify(env);
  expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
  const adapted: ReturnType<typeof adaptTdmsDailySource> =
    adaptTdmsDailySource(env);
  expect(adapted.output.nativePackage.records[0]!.rawFields).toEqual(
    env.package.records[0]!.rawFields,
  );
  expect(adapted.output.nativePackage.records[0]!.state.rawName).toBe(
    'Estimated',
  );
  expect(adapted.output.nativePackage.query).toMatchObject({
    scopeMatch: 'UNKNOWN',
    actualCriteria: null,
  });
  expect(adapted.output.nativePackage.coverage).toMatchObject({
    status: 'PARTIAL',
    gaps: expect.arrayContaining([
      'COMPLETION_CERTIFICATE_NOT_ISSUED',
      'RELATION_ENUMERATION_UNVERIFIED',
    ]),
  });
  const h: ReturnType<typeof memory> = memory(env);
  const receipt: Awaited<ReturnType<TdmsSourceService['importDailyMetadata']>> =
    await h.service.importDailyMetadata(actor(), env);
  expect(
    (await h.service.readDailyMetadataImport(actor(), receipt.requestId))
      .package,
  ).toEqual(env.package);
  const snapshot: string = receipt.sourceRefs.find((ref: string) =>
    ref.startsWith('TDMS:SNAPSHOT:'),
  )!;
  expect(
    (await h.service.readDailySourceRef(actor(), snapshot)).snapshot,
  ).toEqual(env.package.records[0]);
  expect(
    await h.service.importDailyMetadata(actor(), copyComplete(env)),
  ).toEqual(receipt);
  expect(h.repository.state.captures).toHaveLength(1);
  expect(h.repository.state.captures[0]!.receipt).toMatchObject({
    engineeringAdoption: 'NOT_CREATED',
    executionVerified: false,
  });
  expect(h.artifacts.acquire).not.toHaveBeenCalled();
  expect(h.documents.assertRead).not.toHaveBeenCalled();
  expect(JSON.stringify(env)).toBe(before);
}
async function refused(
  env: TdmsDailyMetadataEnvelope,
  code: string = 'TDMS_',
): Promise<void> {
  const before: string = JSON.stringify(env);
  expect(() => prepareTdmsDailySourceImport(env)).toThrow(code);
  expect(() => adaptTdmsDailySource(env)).toThrow(code);
  const h: ReturnType<typeof memory> = memory();
  await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
    code,
  );
  expect(h.repository.state.captures).toHaveLength(0);
  expect(h.repository.state.revisions).toHaveLength(0);
  expect(JSON.stringify(env)).toBe(before);
}
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((entry: unknown) => reversedKeys(entry));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]: [string, unknown]) => [key, reversedKeys(entry)]),
    );
  return value;
}

describe('H272 and Item275 frozen pure consumers, fabricated Memory evidence only', () => {
  it.each([0, 1])(
    'retains H structure with %i rendered rows while adapter/service preserve the existing body-owner refusal',
    async (rows: number) => {
      const env: TdmsDailyMetadataEnvelope = syntheticHRequiredSurfaces(rows);
      expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
      const read: TestRead = proof(env).reads[1]!;
      expect(read.fields).toHaveLength(74);
      expect(
        read.fields.filter(
          (f: TdmsCompleteOwnedField) => f.rawTextQualification,
        ),
      ).toHaveLength(6);
      expect(
        read.tabs.filter((t: TestRead['tabs'][number]) => t.purposeEvidence),
      ).toHaveLength(7);
      expect(read.relationTables).toHaveLength(15);
      expect(
        new Set(read.relationTables.map((t: TestTable) => t.tableId)).size,
      ).toBe(15);
      expect(
        read.relationTables.filter(
          (t: TestTable) => t.gridId === 'attachments.table.secondary',
        ),
      ).toHaveLength(2);
      for (const tab of read.tabs.filter(
        (t: TestRead['tabs'][number]) => t.purposeEvidence,
      ))
        expect(
          validateReviewedAdHandlingSurfaceEvidence(tab.purposeEvidence, {
            scopeId: 'AD_HANDLING_FORM',
            owner: read.owner,
            tab,
            read,
          }),
        ).toMatchObject({
          complete: false,
          structureCaptured: true,
          queryKnown: false,
          bodyCoverage: 'UNPROVEN',
        });
      expect(
        read.relationTables.every(
          (t: TestTable) =>
            t.reportedTotal === null &&
            !t.terminal.trueZero &&
            !t.terminal.nativeTerminal,
        ),
      ).toBe(true);
      expect(env.package.coverage.status).toBe('PARTIAL');
      expect(env.package.query).toMatchObject({
        scopeMatch: 'UNKNOWN',
        actualCriteria: null,
      });
      expect(env.package.edges).toEqual([]);
      expect(proof(env).targetOccurrences).toEqual([]);
      expect(() => adaptTdmsDailySource(env)).toThrow(
        'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
      );
      const h: ReturnType<typeof memory> = memory();
      await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
        'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
      );
      expect(h.repository.state.captures).toHaveLength(0);
      expect(h.repository.state.revisions).toHaveLength(0);
    },
  );
  it('keeps old H prepare and the same existing formal-body refusal', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticHandling();
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    expect(() => adaptTdmsDailySource(env)).toThrow(
      'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
    );
    const h: ReturnType<typeof memory> = memory();
    await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
      'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
    );
    expect(h.repository.state.captures).toHaveLength(0);
  });
  it.each(['whole envelope', 'proof owner version'])(
    'accepts H object key reordering in the %s with the existing body refusal',
    async (target: string) => {
      let env: TdmsDailyMetadataEnvelope = syntheticHRequiredSurfaces();
      if (target === 'whole envelope')
        env = reversedKeys(env) as TdmsDailyMetadataEnvelope;
      else
        for (const read of proof(env).reads)
          for (const tab of read.tabs)
            if (tab.purposeEvidence)
              tab.purposeEvidence.ownerSourceVersion = reversedKeys(
                tab.purposeEvidence.ownerSourceVersion,
              ) as TdmsSourceVersion;
      const before: string = JSON.stringify(env);
      expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
      expect(env.package.coverage.status).toBe('PARTIAL');
      expect(env.package.query).toMatchObject({
        scopeMatch: 'UNKNOWN',
        actualCriteria: null,
      });
      expect(() => adaptTdmsDailySource(env)).toThrow(
        'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
      );
      const h: ReturnType<typeof memory> = memory();
      await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
        'TDMS_SOURCE_BODY_OWNER_UNCONFIRMED',
      );
      expect(h.repository.state.captures).toHaveLength(0);
      expect(h.repository.state.revisions).toHaveLength(0);
      expect(JSON.stringify(env)).toBe(before);
    },
  );
  it.each(['native column order', 'owner version value'])(
    'refuses H %s changes after object key canonicalization',
    async (target: string) => {
      const env: TdmsDailyMetadataEnvelope = syntheticHRequiredSurfaces();
      edit(
        env,
        (read: TestRead) => {
          const p: TestHandlingProof = firstPurpose(read);
          if (target === 'native column order')
            for (const window of p.windows) window.grids[0]!.columns.reverse();
          else p.ownerSourceVersion.rawRevision = '9';
        },
        true,
      );
      await refused(env, 'TDMS_COMPLETE_AD_HANDLING_SURFACE_MODEL_INVALID');
    },
  );
  const invalidH: Array<[string, (read: TestRead) => void]> = [
    [
      'row text promotion',
      (r: TestRead) =>
        Object.assign(r.relationTables[0]!.rows[0]!.cells[0]!, {
          state: 'VALUE',
          rawValue: 'SYNTHETIC',
          observedTotalCodepoints: 9,
        }),
    ],
    [
      'relationship role promotion',
      (r: TestRead) => {
        r.relationTables[0]!.relationshipRole = 'CURRENT_CONTENT';
      },
    ],
    [
      'terminal promotion',
      (r: TestRead) => {
        r.relationTables[0]!.terminal.nativeTerminal = true;
      },
    ],
    [
      'known query promotion',
      (r: TestRead) => {
        firstPurpose(r).queryDefinition = 'PROVEN';
      },
    ],
    [
      'foreign iframe owner',
      (r: TestRead) => {
        const p: TestHandlingProof = r.tabs.find(
          (t: TestRead['tabs'][number]) =>
            t.purposeEvidence?.windows[0]!.frames.length,
        )!.purposeEvidence!;
        for (const w of p.windows)
          w.frames[0]!.rawSrc =
            'timeline.jsp?oid=OR%3Awt.change2.WTChangeRequest2%3A1';
      },
    ],
    [
      'changed second window',
      (r: TestRead) => {
        firstPurpose(r).windows[1]!.grids[0]!.pagerPresent = true;
      },
    ],
    [
      'required tab exclusion',
      (r: TestRead) => {
        r.tabs.find(
          (t: TestRead['tabs'][number]) => t.purposeEvidence,
        )!.required = false;
      },
    ],
    [
      'Modified mismatch',
      (r: TestRead) => {
        firstPurpose(r).ownModifiedRaw = 'SYNTHETIC-OTHER-MODIFIED';
      },
    ],
    [
      'global grid identity replacing tab scope',
      (r: TestRead) => {
        r.relationTables[0]!.tableId = r.relationTables[0]!.gridId;
      },
    ],
    [
      'read control value promotion',
      (r: TestRead) => {
        firstPurpose(r).windows[0]!.controls[0]!.valueState = 'VALUE';
      },
    ],
  ];
  it.each(invalidH)(
    'refuses H %s before any persistence',
    async (_name: string, change: (read: TestRead) => void) => {
      const env: TdmsDailyMetadataEnvelope = syntheticHRequiredSurfaces();
      edit(env, change, true);
      await refused(env);
    },
  );
  it.each([false, true])(
    'preserves Item literal native queries and unknown end through prepare/adapter/Memory readback (zero=%s)',
    async (zeroDetails: boolean) => {
      const env: TdmsDailyMetadataEnvelope = syntheticItemQuery({
        zeroDetails,
      });
      const read: TestRead = proof(env).reads[1]!;
      expect(read.relationTables).toHaveLength(6);
      expect(
        read.relationTables.every(
          (t: TestTable) =>
            t.enumerationState === 'NOT_READ' &&
            t.terminal.kind === 'UNCONFIRMED' &&
            !t.terminal.nativeTerminal &&
            !t.terminal.trueZero,
        ),
      ).toBe(true);
      for (const table of read.relationTables) {
        const result: ReturnType<
          typeof validateReviewedEfRequestRelatedSurfaceEvidence
        > = validateReviewedEfRequestRelatedSurfaceEvidence(
          table.relatedSurfaceEvidence,
          { scopeId: 'AD_ITEM', owner: read.owner, table },
        );
        expect(result).toMatchObject({ complete: false, queryKnown: false });
        if (table.relatedSurfaceEvidence) {
          expect(result).toMatchObject({
            rawControlStateCaptured: true,
            requiredControlsObserved: true,
            backendCriteria: 'UNKNOWN',
          });
          expect(
            table.relatedSurfaceEvidence.after.controls.some(
              (c: TestFrame['controls'][number]) =>
                c.rawValue === 'Search in table' &&
                c.rawClassName.includes('x-form-empty-field') &&
                c.valueEvidenceState === 'VALUE',
            ),
          ).toBe(true);
          expect(table.relatedSurfaceEvidence.after.counts[1]!.rawText).toBe(
            '(0 objects selected)',
          );
          if (zeroDetails) expect(table.terminal.allGlobalIndices).toBe(true);
        }
      }
      await retainedItem(env);
    },
  );
  it('accepts serialized object key reordering while retaining native array order', async () => {
    const env: TdmsDailyMetadataEnvelope = reversedKeys(
      syntheticItemQuery(),
    ) as TdmsDailyMetadataEnvelope;
    await retainedItem(env);
  });
  it('keeps a missing native control missing and cannot certify a query', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticItemQuery();
    edit(env, (r: TestRead) => {
      const t: TestTable = r.relationTables.find(
        (v: TestTable) => v.gridId === 'changeTask_affectedItems_table',
      )!;
      t.relatedSurfaceEvidence!.before.controls.shift();
      t.relatedSurfaceEvidence!.after.controls.shift();
    });
    const r: TestRead = proof(env).reads[1]!;
    const t: TestTable = r.relationTables.find(
      (v: TestTable) => v.gridId === 'changeTask_affectedItems_table',
    )!;
    expect(
      validateReviewedAdItemDetailsQueryEvidence(t.relatedSurfaceEvidence, {
        scopeId: 'AD_ITEM',
        owner: r.owner,
        table: t,
      }),
    ).toMatchObject({ complete: false, requiredControlsObserved: false });
    await retainedItem(env);
  });
  it('decodes old missing-proof Item tables but returns pending instead of completeness', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticItemQuery({
      legacyTree: true,
    });
    edit(env, (r: TestRead) => {
      for (const t of r.relationTables) delete t.relatedSurfaceEvidence;
    });
    const r: TestRead = proof(env).reads[1]!;
    expect(
      validateReviewedAdItemDetailsQueryEvidence(undefined, {
        scopeId: 'AD_ITEM',
        owner: r.owner,
        table: r.relationTables[0],
      }),
    ).toMatchObject({
      complete: false,
      queryKnown: false,
      reasonCode: 'TDMS_COMPLETE_AD_ITEM_DETAILS_RAW_QUERY_MISSING',
    });
    await retainedItem(env);
  });
  const invalidItem: Array<[string, (table: TestTable) => void]> = [
    [
      'foreign owner',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.ownerSourceRecordId =
          'OR:wt.change2.WTChangeActivity2:1';
      },
    ],
    [
      'owner version',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.ownerSourceVersion.rawRevision = '9';
      },
    ],
    [
      'Modified',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.ownerSourceModifiedRaw =
          'SYNTHETIC-OTHER-MODIFIED';
      },
    ],
    [
      'scope',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.scopeId = 'ENGINEERING_ASSESSMENT';
      },
    ],
    [
      'unknown control with readable value',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.before.controls[0]!.rawClassName =
          'foreign-class';
      },
    ],
    [
      'count mismatch',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.before.counts[0]!.rawText = '(999 objects)';
      },
    ],
    [
      'window mismatch',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.after.controls[0]!.rawValue = 'OTHER';
      },
    ],
    [
      'native column order',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.before.columns.reverse();
        t.relatedSurfaceEvidence!.after.columns.reverse();
      },
    ],
    [
      'window row membership',
      (t: TestTable) => {
        t.relatedSurfaceEvidence!.before.position.rowOccurrenceIds = [];
        t.relatedSurfaceEvidence!.after.position.rowOccurrenceIds = [];
      },
    ],
    [
      'native terminal',
      (t: TestTable) => {
        t.terminal.nativeTerminal = true;
      },
    ],
    [
      'completion claim',
      (t: TestTable) => {
        t.enumerationState = 'VALUE';
      },
    ],
    [
      'foreign count locator',
      (t: TestTable) => {
        t.countEvidence.locator += ' synthetic-foreign-count';
      },
    ],
  ];
  it.each(invalidItem)(
    'refuses Item %s before any persistence',
    async (_name: string, change: (table: TestTable) => void) => {
      const env: TdmsDailyMetadataEnvelope = syntheticItemQuery();
      edit(env, (r: TestRead) => change(firstDetails(r)));
      await refused(env);
    },
  );
  it.each(['first', 'next', 'tree', 'scroll'])(
    'refuses an unreviewed Item %s query-operation proof',
    async (operation: string) => {
      const env: TdmsDailyMetadataEnvelope = syntheticItemQuery();
      edit(env, (r: TestRead) => {
        firstDetails(r).relatedQueryEvidence = {
          schemaVersion: 'SYNTHETIC-UNREVIEWED-OPERATION',
          operation,
        };
      });
      await refused(env, 'TDMS_EFREQUEST_RELATED_QUERY_INVALID');
    },
  );
  it('rejects a Details raw proof attached to a different native Item surface', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticItemQuery();
    edit(env, (r: TestRead) => {
      r.relationTables[3]!.relatedSurfaceEvidence = copyComplete(
        firstDetails(r).relatedSurfaceEvidence!,
      );
    });
    await refused(env, 'TDMS_COMPLETE_AD_ITEM_DETAILS_QUERY_SURFACE_INVALID');
  });
  it.each(['TREE', 'DOM_ROWS'] as const)(
    'preserves the old all-absent paired %s projection',
    async (mode: 'TREE' | 'DOM_ROWS') => {
      await retainedItem(syntheticAdItemLegacyProjection(mode));
    },
  );
  it('still validates the whole hierarchy when any tree evidence is supplied', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticItemQuery();
    edit(env, (r: TestRead) => {
      const tree: TestTable = r.relationTables.find(
        (t: TestTable) => t.gridId === 'mytreetable',
      )!;
      tree.rows[1]!.treeDepth = null;
      tree.rows[1]!.treePath = [];
    });
    await refused(env, 'TDMS_COMPLETE_AD_ITEM_DETAIL_MODEL_INVALID');
  });
  it('keeps archived pins and In Work assessment-body refusal unchanged', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItem();
    expect(currentRecordHash(env)).toBe(
      metadataAdItemGolden.producerQualification.adItem.recordSha256,
    );
    expect(env.package.records[0]!.snapshotId).toBe(
      metadataAdItemGolden.producerQualification.adItem.snapshotId,
    );
    expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
    expect(() => adaptTdmsDailySource(env)).toThrow(
      'TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN',
    );
    const h: ReturnType<typeof memory> = memory();
    await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
      'TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN',
    );
    expect(h.repository.state.captures).toHaveLength(0);
  });
  it('retains tenant and current read authorization on the saved query observations', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticItemQuery();
    const h: ReturnType<typeof memory> = memory(env);
    const receipt: Awaited<
      ReturnType<TdmsSourceService['importDailyMetadata']>
    > = await h.service.importDailyMetadata(actor(), env);
    await expect(
      h.service.readDailyMetadataImport(
        { ...actor(), tenantId: 'tenant-other' },
        receipt.requestId,
      ),
    ).rejects.toThrow('TDMS_');
    h.state.allowed = false;
    await expect(
      h.service.readDailyMetadataImport(actor(), receipt.requestId),
    ).rejects.toThrow('TDMS_');
    await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
      'TDMS_',
    );
    expect(h.repository.state.captures).toHaveLength(1);
  });
});
