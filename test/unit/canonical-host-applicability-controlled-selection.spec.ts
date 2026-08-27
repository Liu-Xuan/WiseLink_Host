import type { Request } from 'express';

import type { CanonicalWorkItemProjection } from '../../shared/api.interface';
import type { FleetMasterDataSource } from '../../server/modules/assessment-workbench/applicability-fleet/fleetMasterData';
import { CanonicalHostApplicabilitySelectionService } from '../../server/modules/canonical-host/canonical-host-applicability-selection.service';
import { HostConfiguredApplicabilityControlledSelectionAdapter } from '../../server/modules/canonical-host/host-configured-applicability-controlled-selection.adapter';

describe('production applicability controlled selection', () => {
  it('persists only server-derived selection/Fleet revisions and exposes the real 0/0 frozen-source blocker', async () => {
    const harness = selectionHarness();
    const selected = await harness.service.configure(
      'WI-APP-1',
      { aircraftIdentifier: 'b-1234', asOf: '2026-08-27' },
      {} as Request,
    );

    expect(selected).toEqual({
      schemaVersion: 'wiselink.3_1.applicability_selection_read_model.v1',
      workItemId: 'WI-APP-1',
      workItemRevision: 8,
      documentVersionId: 'DV-1',
      aircraftIdentifier: 'B-1234',
      asOf: '2026-08-27',
      selectionRevision: 'work-item:WI-APP-1:applicability-selection:8',
      currentness: 'CURRENT',
      fleetSource: {
        sourceRevisionKey: 'fleet-r1',
        authorityRevision: 'authority-r1',
        sourceAsOf: '2026-08-26',
      },
      frozenSourceBinding: {
        status: 'MISSING',
        sourceExpressionCount: 0,
        assignmentCount: 0,
      },
    });
    expect(harness.current.applicabilityControlledSelection).toEqual(
      expect.objectContaining({
        documentVersionId: 'DV-1',
        aircraftIdentifier: 'B-1234',
        asOf: '2026-08-27',
        fleetSourceRevisionKey: 'fleet-r1',
        fleetAuthorityRevision: 'authority-r1',
      }),
    );
    expect(JSON.stringify(selected)).not.toContain('sourceTable');
    expect(JSON.stringify(selected)).not.toContain('recordHash');

    const provider = new HostConfiguredApplicabilityControlledSelectionAdapter(
      harness.registrar,
      harness.fleetConfiguration,
    );
    await expect(
      provider.readCurrent({
        tenantId: 'tenant-1',
        workItemId: 'WI-APP-1',
        documentVersionId: 'DV-1',
        applicabilityContextRef: 'APCTX-1',
      }),
    ).rejects.toThrow('APPLICABILITY_FROZEN_SOURCE_BINDING_UNAVAILABLE');
  });

  it('returns the exact WorkItem selection and Host Fleet versions once the same frozen producer has a real binding', async () => {
    const harness = selectionHarness();
    await harness.service.configure(
      'WI-APP-1',
      { aircraftIdentifier: 'B-1234', asOf: '2026-08-27' },
      {} as Request,
    );
    harness.current.package!.usagePolicy!.applicability = {
      sourceExpressionCount: 1,
      normalizedCandidateCount: 1,
      assignmentCount: 1,
    };
    const provider = new HostConfiguredApplicabilityControlledSelectionAdapter(
      harness.registrar,
      harness.fleetConfiguration,
    );

    await expect(
      provider.readCurrent({
        tenantId: 'tenant-1',
        workItemId: 'WI-APP-1',
        documentVersionId: 'DV-1',
        applicabilityContextRef: 'APCTX-1',
      }),
    ).resolves.toMatchObject({
      selectionRevision: 'work-item:WI-APP-1:applicability-selection:8',
      documentVersionId: 'DV-1',
      aircraftNumber: 'B-1234',
      assessmentAsOf: '2026-08-27',
      fleetMasterData: {
        sourceRevisionKey: 'fleet-r1',
        authorityRevision: 'authority-r1',
      },
    });
  });

  it('rejects a different WorkItem/tenant before a selection CAS', async () => {
    const harness = selectionHarness({ deny: true });
    await expect(
      harness.service.configure(
        'WI-OTHER',
        { aircraftIdentifier: 'B-1234', asOf: '2026-08-27' },
        {} as Request,
      ),
    ).rejects.toThrow('CANONICAL_WORK_ITEM_NOT_FOUND');
    expect(harness.registrar.compareAndSet).not.toHaveBeenCalled();
  });
});

function selectionHarness(options: { deny?: boolean } = {}) {
  const actor = {
    tenantId: 'tenant-1',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user-1' },
  };
  let current = workItem();
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => structuredClone(current)),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.expectedRevision !== current.revision) {
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        current = {
          ...structuredClone(input.next),
          revision: current.revision + 1,
        };
        return structuredClone(current);
      },
    ),
  };
  const objectAccess = {
    freshRead: jest.fn(async (input: { action: string }) =>
      options.deny
        ? {
            allowed: false as const,
            action: input.action,
            accessRoot: { kind: 'WORK_ITEM' as const, id: 'WI-OTHER' },
            code: 'CANONICAL_WORK_ITEM_NOT_FOUND' as const,
            statusCode: 404 as const,
            denialSource: 'MIAODA_OBJECT_ACCESS' as const,
          }
        : {
            allowed: true as const,
            action: input.action,
            workItemId: 'WI-APP-1',
            workItemRevision: current.revision,
            documentVersionId: 'DV-1',
            tenantId: 'tenant-1',
            actorUserId: 'user-1',
          },
    ),
  };
  const fleet = fleetMasterData();
  const fleetConfiguration = {
    readCurrent: jest.fn(() => structuredClone(fleet)),
  };
  const sessions = {
    resolve: jest.fn(async () => ({ actor })),
  };
  const service = new CanonicalHostApplicabilitySelectionService(
    sessions as never,
    objectAccess as never,
    registrar as never,
    fleetConfiguration as never,
  );
  return {
    service,
    registrar,
    fleetConfiguration: fleetConfiguration as never,
    get current(): CanonicalWorkItemProjection {
      return current;
    },
  };
}

function fleetMasterData(): FleetMasterDataSource {
  return {
    schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
    sourceSnapshotId: 'fleet-snapshot-1',
    sourceRevisionKey: 'fleet-r1',
    authorityRevision: 'authority-r1',
    sourceAsOf: '2026-08-26',
    assets: [
      {
        assetId: 'ASSET-1',
        assetVersionId: 'ASSET-V1',
        aircraftNumber: 'B-1234',
        aircraftModel: 'B737-8',
        sourceRef: { sourceTable: 'fleet_asset', sourceRecordId: 'asset-1' },
        recordHash: 'asset-hash-1',
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
        validAsOf: '2026-08-26',
        sourceRef: { sourceTable: 'fleet_fact', sourceRecordId: 'fact-1' },
        recordHash: 'fact-hash-1',
      },
    ],
  };
}

function workItem(): CanonicalWorkItemProjection {
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
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://UnifiedArtifactStoreCandidate/package.json',
        sha256: 'e'.repeat(64),
        byteLength: 1,
        mediaType: 'application/json',
      },
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
          sourceExpressionCount: 0,
          normalizedCandidateCount: 0,
          assignmentCount: 0,
        },
        assessmentAutoAdoptionAllowed: false,
        aeoAutoAdoptionAllowed: false,
        projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
      },
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'u0-r1',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: 'e'.repeat(64),
      },
    },
    failure: null,
    recordingFailure: null,
  };
}
