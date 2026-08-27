import { createHash } from 'node:crypto';

import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '../../shared/api.interface';
import {
  CanonicalHostApplicabilityInputProducer,
  type CanonicalApplicabilityControlledSelection,
} from '../../server/modules/canonical-host/canonical-host-applicability-input.producer';

describe('CanonicalHostApplicabilityInputProducer', () => {
  it('authorizes an opaque context, minimizes controlled Fleet, and CAS-writes projection_json shape', async () => {
    const harness = producerHarness();
    const produced = await harness.producer.produce(
      'APCTX-OPAQUE-1',
      'request-1',
    );

    expect(produced.revision).toBe(8);
    expect(produced.applicabilityInput).toMatchObject({
      workItemId: 'WI-APP-1',
      documentVersionId: 'DV-1',
      sourcePackageId: 'PKG-1',
      sourcePackageContentHash: 'sha256:package-content',
      sourcePackageArtifactSha256: harness.packageArtifact.sha256,
      selectionRevision: 'selection-r1',
      currentness: 'CURRENT',
      aircraftNumber: 'B-1234',
      assessmentAsOf: '2026-08-27',
    });
    expect(produced.applicabilityInput!.bindingRevision).toMatch(
      /^host-applicability:[0-9a-f]{64}$/u,
    );
    expect(produced.applicabilityInput!.targetBindingHash).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(
      produced.applicabilityInput!.fleetMasterData.assets.map(
        (asset) => asset.assetId,
      ),
    ).toEqual(['ASSET-1']);
    expect(
      produced.applicabilityInput!.fleetMasterData.facts.map(
        (fact) => fact.factId,
      ),
    ).toEqual(['FACT-1']);
    expect(harness.registrar.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-APP-1',
        expectedRevision: 7,
        syncPrimaryAttempt: false,
      }),
    );

    const resolved = await harness.producer.resolveCurrent({
      tenantId: 'tenant-1',
      workItemId: 'WI-APP-1',
      applicabilityContextRef: 'APCTX-OPAQUE-1',
    });
    expect(resolved.applicabilityInput).toEqual(produced.applicabilityInput);

    const ownerValidated = await harness.producer.readCurrentOwnerValidated({
      tenantId: 'tenant-1',
      workItemId: 'WI-APP-1',
      applicabilityContextRef: 'APCTX-OPAQUE-1',
    });
    expect(ownerValidated.applicabilityInput).toEqual(
      produced.applicabilityInput,
    );

    await expect(
      harness.producer.produce('APCTX-OPAQUE-1', 'request-1'),
    ).resolves.toEqual(produced);
    expect(harness.registrar.compareAndSet).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-DocumentVersion and ambiguous aircraft owner selections before CAS', async () => {
    const crossDv = producerHarness();
    crossDv.selection.documentVersionId = 'DV-FORGED';
    await expect(
      crossDv.producer.produce('APCTX-OPAQUE-1', 'request-1'),
    ).rejects.toThrow('APPLICABILITY_CONTROLLED_SELECTION_INVALID');
    expect(crossDv.registrar.compareAndSet).not.toHaveBeenCalled();

    const ambiguous = producerHarness();
    ambiguous.selection.fleetMasterData.assets[1].aliases = [
      { aliasValue: 'B-1234' },
    ];
    await expect(
      ambiguous.producer.produce('APCTX-OPAQUE-1', 'request-1'),
    ).rejects.toThrow('APPLICABILITY_FLEET_AIRCRAFT_AMBIGUOUS');
    expect(ambiguous.registrar.compareAndSet).not.toHaveBeenCalled();
  });

  it('read-only commit validation detects owner selection/Fleet drift without CAS', async () => {
    const harness = producerHarness();
    await harness.producer.produce('APCTX-OPAQUE-1', 'request-1');
    const casCount = harness.registrar.compareAndSet.mock.calls.length;
    harness.selection.selectionRevision = 'selection-r2';
    harness.selection.fleetMasterData.sourceRevisionKey = 'fleet-r2';
    harness.selection.fleetMasterData.authorityRevision = 'authority-r2';

    await expect(
      harness.producer.readCurrentOwnerValidated({
        tenantId: 'tenant-1',
        workItemId: 'WI-APP-1',
        applicabilityContextRef: 'APCTX-OPAQUE-1',
      }),
    ).rejects.toThrow('APPLICABILITY_CONTROLLED_SELECTION_DRIFT');
    expect(harness.registrar.compareAndSet).toHaveBeenCalledTimes(casCount);
  });
});

function producerHarness() {
  const packageBytes = new TextEncoder().encode(
    JSON.stringify({
      sourceRefs: [{ sourceRefId: 'SRC-1' }],
      modules: [{ moduleId: 'MODULE-1' }],
      applicability: {
        sourceExpressions: [
          {
            expressionId: 'EXP-1',
            text: 'Applicable to Boeing 737-8 airplanes.',
            form: 'display_text',
            authority: 'source_asserted',
            sourceRefIds: ['SRC-1'],
          },
        ],
        normalizedCandidates: [],
        assignments: [
          {
            assignmentId: 'ASSIGN-1',
            expressionId: 'EXP-1',
            authority: 'source_asserted',
            target: {
              kind: 'module',
              targetId: 'MODULE-1',
              sourceRefIds: ['SRC-1'],
            },
          },
        ],
      },
    }),
  );
  const packageArtifact = artifact('package.json', packageBytes);
  let current = workItem(packageArtifact);
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => structuredClone(current)),
    compareAndSet: jest.fn(async (input: any) => {
      if (input.expectedRevision !== current.revision) {
        throw new Error('WORK_ITEM_CAS_CONFLICT');
      }
      current = {
        ...structuredClone(input.next),
        revision: current.revision + 1,
      };
      return structuredClone(current);
    }),
  };
  const artifactStore = {
    readActualBytes: jest.fn(async () => packageBytes.slice()),
  };
  const reader = {
    readAllSourceUnits: jest.fn(async () => [
      {
        unitId: 'UNIT-1',
        kind: 'paragraph',
        text: 'Applicable to Boeing 737-8 airplanes.',
        sourceRefIds: ['SRC-1'],
      },
    ]),
  };
  const serviceScope = {
    authorizeOpenClawApplicabilityContext: jest.fn(
      async ({ applicabilityContextRef, requestId }: any) => ({
        principalId: 'service:openclaw-main',
        appId: 'app_17bzc551rsg',
        tenantId: 'tenant-1',
        workItemId: 'WI-APP-1',
        authorizationFingerprint: 'scope-fingerprint-1',
        applicabilityContextRef,
        requestId,
      }),
    ),
  };
  const selection = controlledSelection();
  const controlledSelectionPort = {
    readCurrent: jest.fn(async () => structuredClone(selection)),
  };
  const producer = new CanonicalHostApplicabilityInputProducer(
    registrar as never,
    artifactStore as never,
    reader as never,
    serviceScope as never,
    controlledSelectionPort,
  );
  return { producer, registrar, selection, packageArtifact };
}

function controlledSelection(): CanonicalApplicabilityControlledSelection {
  return {
    schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1',
    selectionRevision: 'selection-r1',
    currentness: 'CURRENT',
    documentVersionId: 'DV-1',
    aircraftNumber: 'B-1234',
    assessmentAsOf: '2026-08-27',
    fleetMasterData: {
      schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
      sourceSnapshotId: 'fleet-snapshot-1',
      sourceRevisionKey: 'fleet-r1',
      authorityRevision: 'authority-r1',
      sourceAsOf: '2026-08-27',
      assets: [
        {
          assetId: 'ASSET-1',
          assetVersionId: 'ASSET-V1',
          aircraftNumber: 'B-1234',
          aircraftModel: 'B737-8',
          sourceRef: { sourceTable: 'fleet_asset', sourceRecordId: 'asset-1' },
          recordHash: 'asset-hash-1',
        },
        {
          assetId: 'ASSET-2',
          assetVersionId: 'ASSET-V2',
          aircraftNumber: 'B-9999',
          sourceRef: { sourceTable: 'fleet_asset', sourceRecordId: 'asset-2' },
          recordHash: 'asset-hash-2',
        },
      ],
      facts: [
        {
          factId: 'FACT-1',
          assetId: 'ASSET-1',
          factType: 'fleet_configuration',
          property: 'optionInstalled',
          qualifier: 'OPT-X',
          value: true,
          validAsOf: '2026-08-20',
          sourceRef: { sourceTable: 'fleet_fact', sourceRecordId: 'fact-1' },
          recordHash: 'fact-hash-1',
        },
        {
          factId: 'FACT-2',
          assetId: 'ASSET-2',
          factType: 'fleet_configuration',
          property: 'optionInstalled',
          qualifier: 'OPT-OTHER',
          value: true,
          sourceRef: { sourceTable: 'fleet_fact', sourceRecordId: 'fact-2' },
          recordHash: 'fact-hash-2',
        },
      ],
    },
  };
}

function workItem(
  packageArtifact: UnifiedPackageArtifactDescriptor,
): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-APP-1',
    requestId: 'REQ-1',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'perm-1',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-1',
      decisionId: 'decision-1',
      decisionHash: 'decision-hash-1',
      permissionSnapshotVersion: 'perm-1',
    },
    source: {
      documentId: 'DOC-1',
      documentVersionId: 'DV-1',
      parserRequestId: 'PARSER-1',
      sourceArtifactId: 'SOURCE-1',
      sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 1,
      driveFileToken: 'drive-token',
      driveSourceVersion: 'v1',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-1',
      classifierReleaseHash: 'c'.repeat(64),
      parserProfileId: 'parser-1',
      parserProfileHash: 'd'.repeat(64),
      fingerprint: 'classification-1',
    },
    package: {
      packageId: 'PKG-1',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: packageArtifact,
      contentHash: 'sha256:package-content',
      semanticHash: 'sha256:semantic',
      provenanceHash: 'sha256:provenance',
      coverageHash: 'sha256:coverage',
      resultStatus: 'complete',
      title: 'SB test',
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'reader-1',
      usagePolicy: {
        presentationMode: 'ENGINEERING_DOCUMENT',
        qualityStatus: 'PASS',
        applicability: {
          sourceExpressionCount: 1,
          normalizedCandidateCount: 0,
          assignmentCount: 1,
        },
        assessmentAutoAdoptionAllowed: false,
        aeoAutoAdoptionAllowed: false,
        projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
      },
      fullValidatorProof: {} as never,
    },
    failure: null,
    recordingFailure: null,
  };
}

function artifact(
  name: string,
  bytes: Uint8Array,
): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://UnifiedArtifactStoreCandidate/${name}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
}
