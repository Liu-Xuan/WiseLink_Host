import {
  prepareTdmsDailySourceImport,
  type TdmsDailyMetadataEnvelope,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { copyComplete } from './tdms-complete-owned.fixture';
import {
  syntheticAdItem,
  resealMetadata,
  currentRecordHash,
  metadataAdItemGolden,
} from './tdms-metadata-aditem.fixture';
import { actor } from './tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import {
  adItemUiProof,
  adItemUiTree,
  syntheticAdItemPresentedTree,
  syntheticAdItemLegacyProjection,
  type SyntheticAdItemUiTable,
  type SyntheticAdItemUiRow,
} from './tdms-source268-ui-tree.fixture';

function memory(
  env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree(),
) {
  const claims = adaptTdmsDailySource(env).memberClaims;
  const repository: MemoryTdmsRepository = new MemoryTdmsRepository();
  const state = { allowed: true };
  const authorization: HostDecisionTdmsSourceAuthorization =
    new HostDecisionTdmsSourceAuthorization(
      async ({ actor: a }) =>
        state.allowed &&
        a.tenantId === nativeScope.tenantId &&
        a.canonicalSubject.id === '123'
          ? [
              {
                scope: nativeScope,
                permissionRevision: 'synthetic-ui-tree-268',
              },
            ]
          : [],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-ui-tree-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-ui-tree-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      }),
    );
  const artifacts = { acquire: jest.fn() };
  const documents = { assertRead: jest.fn() };
  return {
    repository,
    artifacts,
    documents,
    state,
    service: new TdmsSourceService(
      repository,
      authorization,
      artifacts,
      documents,
    ),
  };
}

async function accepted(env: TdmsDailyMetadataEnvelope): Promise<void> {
  const before: string = JSON.stringify(env);
  expect(prepareTdmsDailySourceImport(env).envelope).toEqual(env);
  const adapted = adaptTdmsDailySource(env);
  const native = adapted.output.nativePackage;
  expect(native.records[0]!.rawFields).toEqual(
    env.package.records[0]!.rawFields,
  );
  expect(native.records[0]!.fieldProvenance).toEqual(
    env.package.records[0]!.provenance,
  );
  expect(native.records[0]!.state.rawName).toBe('Estimated');
  expect(native.records[0]!.sourceVersion.confirmation).toBe(
    'VERSION_UNCONFIRMED',
  );
  expect(native.records[0]!.businessVersion).toBeNull();
  expect(native.coverage.status).toBe('PARTIAL');
  expect(native.coverage.gaps).toEqual(
    expect.arrayContaining([
      'REQUIRED_TARGET_OWN_SOURCES_PENDING',
      'COMPLETION_CERTIFICATE_NOT_ISSUED',
      'TECHNICAL_VERSION_UNCONFIRMED',
      'RELATION_ENUMERATION_UNVERIFIED',
    ]),
  );
  expect(native.query.scopeMatch).toBe('UNKNOWN');
  expect(
    native.relations.every(
      (relation) =>
        relation.authority === 'CANDIDATE_ONLY' &&
        relation.controlledKind === null &&
        relation.from.kind === 'UNRESOLVED' &&
        relation.to.kind === 'UNRESOLVED',
    ),
  ).toBe(true);
  const h = memory(env);
  const receipt = await h.service.importDailyMetadata(actor(), env);
  expect(Object.keys(receipt)).toHaveLength(10);
  expect(
    (await h.service.readDailyMetadataImport(actor(), receipt.requestId))
      .package,
  ).toEqual(env.package);
  const snapshotRef: string = receipt.sourceRefs.find((ref: string) =>
    ref.startsWith('TDMS:SNAPSHOT:'),
  )!;
  const readback = await h.service.readDailySourceRef(actor(), snapshotRef);
  expect(readback.snapshot).toEqual(env.package.records[0]);
  expect(readback.limitations).toMatchObject({
    nativeRelationsVerified: false,
    engineeringEvidenceAuthorization: 'NOT_GRANTED_BY_IMPORT',
    executionVerified: false,
  });
  expect(
    await h.service.importDailyMetadata(actor(), copyComplete(env)),
  ).toEqual(receipt);
  expect(h.repository.state.captures).toHaveLength(1);
  expect(
    h.repository.state.captures[0]!.dailyMetadata?.adapter?.outputDigest,
  ).toBe(adapted.outputDigest);
  expect(h.repository.state.captures[0]!.receipt).toMatchObject({
    engineeringAdoption: 'NOT_CREATED',
    executionVerified: false,
  });
  expect(h.artifacts.acquire).not.toHaveBeenCalled();
  expect(h.documents.assertRead).not.toHaveBeenCalled();
  expect(JSON.stringify(env)).toBe(before);
}

interface InvalidUiCase {
  name: string;
  nativeIds?: boolean;
  mutate: (table: SyntheticAdItemUiTable) => void;
}
const invalidUiCases: InvalidUiCase[] = [
  {
    name: 'foreign prefix',
    mutate: (t) => {
      t.rows[1]!.treePath[0] = 'FOREIGN-UI-NODE';
    },
  },
  {
    name: 'path length',
    mutate: (t) => {
      t.rows[1]!.treePath.push('EXTRA');
    },
  },
  {
    name: 'depth mismatch',
    mutate: (t) => {
      t.rows[1]!.treeDepth = 0;
    },
  },
  {
    name: 'child before root',
    mutate: (t) => {
      t.rows[0]!.treeDepth = 1;
      t.rows[0]!.treePath.unshift('UNOBSERVED-ROOT');
    },
  },
  {
    name: 'unreviewed level',
    mutate: (t) => {
      t.rows[1]!.treeDepth = 2;
      t.rows[1]!.treePath.splice(1, 0, 'EXTRA-LEVEL');
    },
  },
  {
    name: 'native row identity',
    mutate: (t) => {
      t.rows[1]!.treePath[1] = 'WRONG-NATIVE-ID';
    },
  },
  {
    name: 'fallback token',
    nativeIds: false,
    mutate: (t) => {
      t.rows[1]!.treePath[1] = 'GUESS';
    },
  },
  {
    name: 'available ROW ordinal',
    nativeIds: false,
    mutate: (t) => {
      t.rows[1]!.treePath[1] = 'ROW-8';
    },
  },
  {
    name: 'mixed absent row',
    mutate: (t) => {
      t.rows[1]!.treeDepth = null;
      t.rows[1]!.treePath = [];
    },
  },
  {
    name: 'missing depth only',
    mutate: (t) => {
      t.rows[1]!.treeDepth = null;
    },
  },
  {
    name: 'missing path only',
    mutate: (t) => {
      t.rows[1]!.treePath = [];
    },
  },
  {
    name: 'path evidence without any depths',
    mutate: (t) => {
      for (const row of t.rows) row.treeDepth = null;
    },
  },
  {
    name: 'depth evidence without any paths',
    mutate: (t) => {
      for (const row of t.rows) row.treePath = [];
    },
  },
];

describe('Source268 presented AD_ITEM UI rows through actual Host consumers; synthetic Memory only', () => {
  it.each([true, false])(
    'retains exact 0/1 UI rows with native IDs=%s without authority promotion',
    async (nativeIds: boolean) => {
      const env: TdmsDailyMetadataEnvelope =
        syntheticAdItemPresentedTree(nativeIds);
      const proof = adItemUiProof(env);
      const tree: SyntheticAdItemUiTable = adItemUiTree(proof.reads[1]!);
      expect(
        tree.rows.map((row: SyntheticAdItemUiRow) => row.treePath),
      ).toEqual(
        nativeIds
          ? [
              ['SYNTHETIC-UI-NODE-0'],
              ['SYNTHETIC-UI-NODE-0', 'SYNTHETIC-UI-NODE-1'],
            ]
          : [['ROW-0'], ['ROW-0', 'ROW-1']],
      );
      expect(
        tree.rows.map((row: SyntheticAdItemUiRow) => row.globalIndex),
      ).toEqual([null, null]);
      expect(tree).toMatchObject({
        relationshipRole: 'UNKNOWN',
        direction: 'UNKNOWN',
        enumerationState: 'NOT_READ',
        terminal: {
          kind: 'UNCONFIRMED',
          nativeTerminal: false,
          allTreeNodesExpanded: false,
          allGlobalIndices: false,
          trueZero: false,
        },
      });
      expect(tree.nativeTreeEvidence).toBeUndefined();
      const number = proof.targetOccurrences.find(
        (o) => o.nativeColumnToken === 'number',
      )!;
      expect(number.collectionPurpose).toBeUndefined();
      expect(number).toMatchObject({
        relationshipRole: 'UNKNOWN',
        direction: 'UNKNOWN',
        sourceVersion: { confirmation: 'VERSION_UNCONFIRMED' },
      });
      expect(
        proof.targetOccurrences
          .filter((o) => o.origin === 'OWN_FIELD')
          .every((o) => o.relationshipRole === 'OUT_OF_SCOPE_REFERENCE'),
      ).toBe(true);
      expect(
        proof.targetOccurrences.find((o) => o.nativeColumnToken === 'creator'),
      ).toMatchObject({
        targetRef: 'OR:wt.org.WTUser:4321',
        relationshipRole: 'UNKNOWN',
      });
      await accepted(env);
    },
  );

  it('resets the prefix stack across sibling roots and children', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree(
      true,
      [0, 1, 1, 0, 1],
    );
    const paths: string[][] = adItemUiTree(
      adItemUiProof(env).reads[1]!,
    ).rows.map((row: SyntheticAdItemUiRow) => row.treePath);
    expect(paths[2]).toEqual(['SYNTHETIC-UI-NODE-0', 'SYNTHETIC-UI-NODE-2']);
    expect(paths[4]).toEqual(['SYNTHETIC-UI-NODE-3', 'SYNTHETIC-UI-NODE-4']);
    await accepted(env);
  });

  it.each(invalidUiCases)(
    'rejects the same $name corruption in both reads before persistence',
    async ({ nativeIds = true, mutate }: InvalidUiCase) => {
      const env: TdmsDailyMetadataEnvelope =
        syntheticAdItemPresentedTree(nativeIds);
      for (const read of adItemUiProof(env).reads) mutate(adItemUiTree(read));
      resealMetadata(env);
      const before: string = JSON.stringify(env);
      expect(adItemUiTree(adItemUiProof(env).reads[0]!).rows).toEqual(
        adItemUiTree(adItemUiProof(env).reads[1]!).rows,
      );
      expect(() => prepareTdmsDailySourceImport(env)).toThrow(
        'TDMS_COMPLETE_AD_ITEM_DETAIL_MODEL_INVALID',
      );
      expect(() => adaptTdmsDailySource(env)).toThrow(
        'TDMS_COMPLETE_AD_ITEM_DETAIL_MODEL_INVALID',
      );
      const h = memory();
      await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
        'TDMS_COMPLETE_AD_ITEM_DETAIL_MODEL_INVALID',
      );
      expect(h.repository.state.captures).toEqual([]);
      expect(h.repository.state.revisions).toEqual([]);
      expect(JSON.stringify(env)).toBe(before);
    },
  );

  it('rejects a stale parent prefix after a new root even when both reads agree', () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree(
      true,
      [0, 1, 0, 1],
    );
    for (const read of adItemUiProof(env).reads)
      adItemUiTree(read).rows[3]!.treePath[0] = 'SYNTHETIC-UI-NODE-0';
    resealMetadata(env);
    expect(() => adaptTdmsDailySource(env)).toThrow(
      'TDMS_COMPLETE_AD_ITEM_DETAIL_MODEL_INVALID',
    );
  });

  it.each(['mytreetable:ROWopaque', 'synthetic-no-ordinal'])(
    'does not invent a fallback ordinal from %s',
    async (occurrence: string) => {
      const env: TdmsDailyMetadataEnvelope =
        syntheticAdItemPresentedTree(false);
      for (const read of adItemUiProof(env).reads) {
        const tree: SyntheticAdItemUiTable = adItemUiTree(read);
        tree.rows[0]!.occurrenceId = occurrence;
        tree.rows[0]!.treePath[0] = tree.rows[1]!.treePath[0] = 'ROW-42';
        tree.windows[0]!.rowOccurrenceIds[0] = occurrence;
      }
      resealMetadata(env);
      await accepted(env);
    },
  );

  it.each(['TREE', 'DOM_ROWS'] as const)(
    'keeps old @1 %s null/empty paths exact and partial',
    async (mode: 'TREE' | 'DOM_ROWS') => {
      const env: TdmsDailyMetadataEnvelope =
        syntheticAdItemLegacyProjection(mode);
      expect(adItemUiTree(adItemUiProof(env).reads[1]!).rows[0]).toMatchObject({
        treeDepth: null,
        treePath: [],
        nativeRowId: 'native-row-0',
      });
      await accepted(env);
    },
  );

  it.each(['mytreetable:ROWopaque', 'synthetic-no-ordinal'])(
    'keeps absent legacy hierarchy with null native identity and %s unchanged',
    async (occurrence: string) => {
      const env: TdmsDailyMetadataEnvelope =
        syntheticAdItemLegacyProjection('TREE');
      for (const read of adItemUiProof(env).reads) {
        const tree: SyntheticAdItemUiTable = adItemUiTree(read);
        tree.rows[0]!.nativeRowId = null;
        tree.rows[0]!.occurrenceId = occurrence;
        tree.windows[0]!.rowOccurrenceIds[0] = occurrence;
      }
      resealMetadata(env);
      await accepted(env);
    },
  );

  it('treats a markerless all-absent hierarchy as the old partial shape without reconstructing paths', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree();
    for (const read of adItemUiProof(env).reads)
      for (const row of adItemUiTree(read).rows) {
        row.treeDepth = null;
        row.treePath = [];
      }
    resealMetadata(env);
    await accepted(env);
  });

  it('keeps archived Source265 pins and In Work body refusal unchanged', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItem();
    const before: string = JSON.stringify(env);
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
    const h = memory();
    await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
      'TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN',
    );
    expect(h.repository.state.captures).toEqual([]);
    expect(JSON.stringify(env)).toBe(before);
  });

  it('retains the actual row version and never derives one from its presented path', () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree();
    for (const read of adItemUiProof(env).reads)
      adItemUiTree(read).rows[1]!.observedVersion = {
        rawRevision: 'SYNTHETIC-R',
        rawIteration: '3',
        confirmation: 'SOURCE_DECLARED',
      };
    resealMetadata(env);
    const native = adaptTdmsDailySource(env).output.nativePackage;
    expect(
      adItemUiProof(env)
        .targetOccurrences.filter((o) => o.treePath.length === 2)
        .every((o) => o.sourceVersion.rawRevision === 'SYNTHETIC-R'),
    ).toBe(true);
    expect(native.records[0]!.sourceVersion.confirmation).toBe(
      'VERSION_UNCONFIRMED',
    );
    expect(native.records[0]!.businessVersion).toBeNull();
  });

  it.each(['role', 'direction', 'complete-tree'] as const)(
    'still refuses %s promotion',
    (change: 'role' | 'direction' | 'complete-tree') => {
      const env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree();
      for (const read of adItemUiProof(env).reads) {
        const table: SyntheticAdItemUiTable = adItemUiTree(read);
        if (change === 'role') table.relationshipRole = 'CURRENT_CONTENT';
        if (change === 'direction') table.direction = 'SOURCE_TO_TARGET';
        if (change === 'complete-tree') table.terminal.kind = 'NATIVE_END';
      }
      resealMetadata(env);
      expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_');
    },
  );

  it('retains current actor, tenant and read authorization on stored UI observations', async () => {
    const env: TdmsDailyMetadataEnvelope = syntheticAdItemPresentedTree();
    const h = memory(env);
    const receipt = await h.service.importDailyMetadata(actor(), env);
    await expect(
      h.service.readDailyMetadataImport(
        { ...actor(), tenantId: 'tenant-other' },
        receipt.requestId,
      ),
    ).rejects.toThrow('TDMS_');
    h.state.allowed = false;
    await expect(h.service.importDailyMetadata(actor(), env)).rejects.toThrow(
      'TDMS_',
    );
    await expect(
      h.service.readDailyMetadataImport(actor(), receipt.requestId),
    ).rejects.toThrow('TDMS_');
    expect(h.repository.state.captures).toHaveLength(1);
  });
});
