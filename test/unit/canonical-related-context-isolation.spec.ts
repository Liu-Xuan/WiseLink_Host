import type {
  CanonicalReferenceMentionPreviewItem,
  CanonicalReferenceTargetResolution,
  CanonicalStructuredContentUnit,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

import { CanonicalEntryFacadeService } from '../../server/modules/canonical-host/canonical-entry-facade.service';
import { CanonicalFailureRecordingService } from '../../server/modules/canonical-host/canonical-failure-recording.service';
import { CanonicalHostVerticalService } from '../../server/modules/canonical-host/canonical-host-vertical.service';
import type {
  CanonicalAuthorizationDecision,
  CanonicalHostActor,
  CanonicalPdfProducerPort,
  CanonicalWorkItemRegistrarPort,
} from '../../server/modules/canonical-host/canonical-host.types';
import {
  canonicalReferenceResolutionOr,
  deriveCanonicalReferenceMentionPreview,
  finalizeCanonicalReferenceMentionPreview,
} from '../../server/modules/canonical-host/canonical-reference-mention-preview';
import { buildCanonicalRelatedContextSnapshot } from '../../server/modules/canonical-host/canonical-related-context-snapshot';
import { UnconfiguredFailureValidationWriteAuthorizationAdapter } from '../../server/modules/canonical-host/unconfigured-failure-validation-write-authorization.adapter';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { UnconfiguredU0Frozen2FailureAdapter } from '../../server/modules/unified-reader/unconfigured-u0-frozen2-failure-adapter.adapter';
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const ACTOR: CanonicalHostActor = {
  userId: 'engineer-related-context',
  tenantId: 'tenant-related-context',
  appId: 'app-related-context-test',
  roles: ['engineer'],
  env: 'preview',
};

class ReadOnlyRegistrar implements CanonicalWorkItemRegistrarPort {
  compareAndSetCallCount = 0;

  constructor(private readonly projection: CanonicalWorkItemProjection) {}

  async loadOrCreate(
    _seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection> {
    return structuredClone(this.projection);
  }

  async compareAndSet(_input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
    syncPrimaryAttempt?: boolean;
  }): Promise<CanonicalWorkItemProjection> {
    this.compareAndSetCallCount += 1;
    throw new Error('RELATED_CONTEXT_PREVIEW_MUST_NOT_WRITE_WORKITEM');
  }

  async getExact(_input: {
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalWorkItemProjection> {
    return structuredClone(this.projection);
  }

  async getByWorkItemId(
    _workItemId: string,
  ): Promise<CanonicalWorkItemProjection> {
    return structuredClone(this.projection);
  }

  async getTenantScopedByWorkItemId(_input: {
    workItemId: string;
    tenantId: string;
  }): Promise<CanonicalWorkItemProjection> {
    return structuredClone(this.projection);
  }
}

class PreviewArtifactStore implements UnifiedArtifactStorePort {
  persistCallCount = 0;

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    this.persistCallCount += 1;
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `artifact://related-context-preview/${this.persistCallCount}`,
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    return {
      artifact,
      bytes: Uint8Array.from(bytes),
      reused: false,
    };
  }

  async readActualBytes(): Promise<Uint8Array> {
    throw new Error('RELATED_CONTEXT_TEST_SOURCE_BYTES_NOT_REQUIRED');
  }
}

class PreviewReader extends UnifiedReaderService {
  constructor(
    artifactStore: UnifiedArtifactStorePort,
    private readonly units: UnifiedReaderQueryResult[],
  ) {
    super(artifactStore, new Frozen2CandidateReaderService(), validator(), {
      mode: 'HOST_CONFIGURED',
      artifactStoreConfigured: true,
      fullU0ValidatorConfigured: true,
      immutableAcceptanceReceiptOwnerConfigured: false,
      aeoSpecialistReaderConfigured: false,
      authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
    });
  }

  override async readAllSourceUnits(): Promise<UnifiedReaderQueryResult[]> {
    return structuredClone(this.units);
  }
}

describe('canonical related-context preview ordinary isolation', () => {
  it('keeps applicability, job-aid, and overall inputs unchanged in EXPLICIT_PREVIEW mode', async () => {
    const workItem: CanonicalWorkItemProjection = evaluationWorkItem();
    const registrar: ReadOnlyRegistrar = new ReadOnlyRegistrar(workItem);
    const artifactStore: PreviewArtifactStore = new PreviewArtifactStore();
    const service: CanonicalHostVerticalService = previewService(
      registrar,
      artifactStore,
      [explicitReferenceSourceUnit()],
    );
    const offProjection: CanonicalWorkItemProjection =
      await registrar.getByWorkItemId(workItem.workItemId);
    const offInputs: Record<string, unknown> =
      evaluationInputVector(offProjection);

    const preview = await service.explicitRelatedContextPreview(
      {
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
      },
      ACTOR,
    );

    const explicitPreviewProjection: CanonicalWorkItemProjection =
      await registrar.getByWorkItemId(workItem.workItemId);
    const explicitPreviewInputs: Record<string, unknown> =
      evaluationInputVector(explicitPreviewProjection);

    expect(preview).toMatchObject({
      status: 'FRESH_READ',
      mode: 'EXPLICIT_PREVIEW',
      revision: workItem.revision,
      totalMentionCount: 1,
      authority: {
        candidateOnly: true,
        readOnly: true,
        includedInAssessmentInput: false,
      },
      snapshot: {
        mode: 'EXPLICIT_PREVIEW',
        candidateOnly: true,
        readOnly: true,
        includedInAssessmentInput: false,
      },
    });
    expect(preview.mentions[0]).toMatchObject({
      primaryDocumentVersionRef: 'DV-PRIMARY',
      mentionSourceRef: 'source-explicit-reference',
      citationText: 'Service Bulletin 777-34-0425',
      normalizedIdentity: {
        documentNumber: '777-34-0425',
      },
      documentTypeCandidate: 'SB',
      extractionMethod: 'DETERMINISTIC_TEXT',
      resolutionState: 'UNAVAILABLE',
      candidateOnly: true,
      normalizedTarget: '777-34-0425',
      documentType: 'SB',
      contextRole: 'CONCURRENT_REQUIREMENT',
      targetResolution: { status: 'UNAVAILABLE' },
      targetApplicability: 'NOT_EVALUATED',
    });
    expect(explicitPreviewInputs).toEqual(offInputs);
    expect(explicitPreviewProjection).toEqual(offProjection);
    expect(registrar.compareAndSetCallCount).toBe(0);
    expect(artifactStore.persistCallCount).toBe(1);
  });

  it('does not create a mention from a legacy family label without document identity', () => {
    const units: CanonicalStructuredContentUnit[] = [
      {
        ordinal: 1,
        displayKind: 'body',
        outlineKind: 'NONE',
        sectionTitle: null,
        displayText:
          'Reference families available for classification are SB, SL, FTD and AMM.',
        sourceRefIds: ['source-family-only'],
        sourceLocators: [],
      },
      {
        ordinal: 2,
        displayKind: 'body',
        outlineKind: 'NONE',
        sectionTitle: null,
        displayText: 'Service Bulletin',
        sourceRefIds: ['source-structured-family-only'],
        sourceLocators: [],
      },
    ];
    const sourceUnits: UnifiedReaderQueryResult[] = [
      {
        unitId: 'unit-family-only',
        kind: 'paragraph',
        text: units[0].displayText,
        sourceRefIds: ['source-family-only'],
      },
      {
        unitId: 'unit-structured-family-only',
        kind: 'paragraph',
        text: JSON.stringify({
          sourceSectionField: 'referenceCategories',
          referenceFamily: 'SB',
          sourceLine: 'Service Bulletin',
        }),
        sourceRefIds: ['source-structured-family-only'],
      },
    ];

    expect(
      deriveCanonicalReferenceMentionPreview(
        units,
        '777-FTD-31-21015',
        sourceUnits,
      ),
    ).toEqual([]);
  });

  it('keeps explicit unsupported and unresolved references visible in the production extractor path', () => {
    const units: CanonicalStructuredContentUnit[] = [
      {
        ordinal: 1,
        displayKind: 'body',
        outlineKind: 'NONE',
        sectionTitle: null,
        displayText: 'See MPD 777-MPD-01-001 for the maintenance programme.',
        sourceRefIds: ['source-mpd'],
        sourceLocators: [],
      },
      {
        ordinal: 2,
        displayKind: 'body',
        outlineKind: 'NONE',
        sectionTitle: null,
        displayText: 'Service Bulletin TBD',
        sourceRefIds: ['source-unresolved'],
        sourceLocators: [],
      },
    ];
    const sourceUnits: UnifiedReaderQueryResult[] = [
      {
        unitId: 'unit-mpd',
        kind: 'paragraph',
        text: units[0].displayText,
        sourceRefIds: ['source-mpd'],
      },
      {
        unitId: 'unit-unresolved',
        kind: 'paragraph',
        text: JSON.stringify({
          sourceSectionField: 'referenceCategories',
          referenceFamily: 'SB',
          referenceNumber: 'TBD',
          sourceLine: 'Service Bulletin TBD',
        }),
        sourceRefIds: ['source-unresolved'],
      },
    ];

    const mentions = deriveCanonicalReferenceMentionPreview(
      units,
      '777-FTD-31-21015',
      sourceUnits,
    ).map((candidate) =>
      finalizeCanonicalReferenceMentionPreview({
        candidate,
        primaryDocumentVersionRef: 'DV-PRIMARY',
        targetResolution: canonicalReferenceResolutionOr(candidate, {
          status: 'UNAVAILABLE',
        }),
        targetApplicability: 'NOT_EVALUATED',
      }),
    );

    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          citationText: 'MPD 777-MPD-01-001',
          documentTypeCandidate: 'UNKNOWN',
          resolutionState: 'UNSUPPORTED_DOCUMENT',
          normalizedIdentity: expect.objectContaining({
            documentNumber: '777-MPD-01-001',
          }),
        }),
        expect.objectContaining({
          citationText: 'Service Bulletin TBD',
          documentTypeCandidate: 'SB',
          resolutionState: 'UNRESOLVED',
          normalizedIdentity: expect.objectContaining({ documentNumber: null }),
        }),
      ]),
    );
  });

  it('maps every resolution state without inventing identity or accepted use', () => {
    const resolutions: Array<{
      target: string;
      resolution: CanonicalReferenceTargetResolution;
    }> = [
      {
        target: '777-SB-34-1001',
        resolution: {
          status: 'RESOLVED_EXACT',
          workItemId: 'WI-RELATED-EXACT',
          documentVersionId: 'DV-RELATED-EXACT',
          canonicalDocumentNumber: '777-SB-34-1001',
          businessRevision: 'REV 1',
        },
      },
      {
        target: '777-SB-34-1002',
        resolution: { status: 'RESOLVED_MULTIPLE', candidateCount: 2 },
      },
      {
        target: '777-SB-34-1003',
        resolution: { status: 'UNRESOLVED' },
      },
      {
        target: '777-SB-34-1004',
        resolution: { status: 'DOCUMENT_NOT_INGESTED' },
      },
      {
        target: '777-SB-34-1005',
        resolution: { status: 'UNAVAILABLE' },
      },
      {
        target: '777-SB-34-1006',
        resolution: { status: 'ACCESS_DENIED' },
      },
      {
        target: '777-SB-34-1007',
        resolution: { status: 'UNSUPPORTED_DOCUMENT' },
      },
    ];
    const built = buildCanonicalRelatedContextSnapshot({
      workItemId: 'WI-PRIMARY',
      inputRevision: 8,
      primaryDocumentVersionId: 'DV-PRIMARY',
      assessmentTargetContextRef: 'applicability-context://B-1266',
      assessmentAsOf: '2026-06-05',
      mentions: resolutions.map(
        (
          item: {
            target: string;
            resolution: CanonicalReferenceTargetResolution;
          },
          index: number,
        ): CanonicalReferenceMentionPreviewItem =>
          referenceMention(item.target, item.resolution, index),
      ),
    });
    const snapshot = built.snapshot;

    expect(snapshot.items[0]).toMatchObject({
      normalizedTarget: '777-SB-34-1001',
      resolvedDocumentVersionRef: 'DV-RELATED-EXACT',
      resolvedWorkItemRef: 'WI-RELATED-EXACT',
      currentness: 'CURRENT',
      targetApplicability: 'APPLICABLE',
      applicabilityResultRef: 'openclaw-applicability://RELATED-EXACT',
      availability: 'AVAILABLE',
      acceptedContributionRoles: [],
      acceptedRelationTypes: [],
      evidenceStance: 'NOT_EVALUATED',
      conflicts: [],
      missingInputs: [],
    });
    expect(snapshot.items[1]).toMatchObject({
      normalizedTarget: '777-SB-34-1002',
      unresolvedIdentity: '777-SB-34-1002',
      currentness: 'UNKNOWN',
      availability: 'AMBIGUOUS',
      conflicts: ['MULTIPLE_CURRENT_DOCUMENTS'],
      missingInputs: ['RESOLVED_DOCUMENT_VERSION', 'TARGET_APPLICABILITY'],
    });
    expect(snapshot.items[2]).toMatchObject({
      normalizedTarget: '777-SB-34-1003',
      unresolvedIdentity: '777-SB-34-1003',
      currentness: 'UNKNOWN',
      availability: 'UNRESOLVED',
      conflicts: [],
    });
    expect(snapshot.items[3]).toMatchObject({
      normalizedTarget: '777-SB-34-1004',
      unresolvedIdentity: '777-SB-34-1004',
      currentness: 'UNKNOWN',
      availability: 'NOT_INGESTED',
      conflicts: [],
    });
    expect(snapshot.items[4]).toMatchObject({
      normalizedTarget: '777-SB-34-1005',
      unresolvedIdentity: '777-SB-34-1005',
      currentness: 'UNKNOWN',
      availability: 'UNAVAILABLE',
      conflicts: [],
    });
    expect(snapshot.items[5]).toMatchObject({
      normalizedTarget: '777-SB-34-1006',
      unresolvedIdentity: '777-SB-34-1006',
      currentness: 'UNKNOWN',
      availability: 'ACCESS_DENIED',
      conflicts: [],
    });
    expect(snapshot.items[6]).toMatchObject({
      normalizedTarget: '777-SB-34-1007',
      unresolvedIdentity: '777-SB-34-1007',
      currentness: 'UNKNOWN',
      availability: 'UNSUPPORTED',
      conflicts: [],
    });
    expect(
      snapshot.items
        .slice(1)
        .every(
          (item): boolean =>
            item.resolvedDocumentVersionRef === undefined &&
            item.resolvedWorkItemRef === undefined,
        ),
    ).toBe(true);
    expect(
      snapshot.items.every(
        (item): boolean =>
          item.acceptedContributionRoles.length === 0 &&
          item.acceptedRelationTypes.length === 0 &&
          item.evidenceStance === 'NOT_EVALUATED' &&
          item.candidateOnly,
      ),
    ).toBe(true);
  });
});

function previewService(
  registrar: CanonicalWorkItemRegistrarPort,
  artifactStore: UnifiedArtifactStorePort,
  units: UnifiedReaderQueryResult[],
): CanonicalHostVerticalService {
  const producer: CanonicalPdfProducerPort = {
    producePdf: async () => {
      throw new Error('RELATED_CONTEXT_TEST_PDF_PRODUCER_NOT_REQUIRED');
    },
  };
  return new CanonicalHostVerticalService(
    registrar,
    producer,
    authorization(),
    {
      freshRead: async () => ({
        permissionSnapshotVersion: 'permission-related-context',
      }),
    },
    artifactStore,
    new PreviewReader(artifactStore, units),
    new CanonicalEntryFacadeService({
      deepLinkForWorkItem: (workItemId: string) => ({
        bindingStatus: 'VERIFIED_CANONICAL',
        appId: 'app-related-context-test',
        origin: 'https://related-context.example.test',
        deepLink:
          `https://related-context.example.test/work-items/` +
          `${encodeURIComponent(workItemId)}/documents`,
      }),
    }),
    new CanonicalFailureRecordingService(
      new UnconfiguredU0Frozen2FailureAdapter(),
      new UnconfiguredFailureValidationWriteAuthorizationAdapter(),
      artifactStore,
      { nowIso: () => '2026-09-04T00:00:00.000Z' },
    ),
    null,
  );
}

function authorization() {
  return {
    authorize: async (input: {
      actor: CanonicalHostActor;
      action: CanonicalAuthorizationDecision['action'];
    }): Promise<CanonicalAuthorizationDecision> => ({
      action: input.action,
      allowed: true,
      actorFingerprint: 'actor-related-context',
      decisionId: `decision-${input.action.toLowerCase()}`,
      decisionHash: 'decision-hash-related-context',
      permissionSnapshotVersion: 'permission-related-context',
    }),
  };
}

function validator(): U0FullValidationService {
  return new U0FullValidationService({
    validateActualBytes: async ({ artifact, packageId }) => ({
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      validatorId: 'U0Frozen2SchemaSemanticValidator',
      validatorRevision: 'related-context-test',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      packageId,
      artifactSha256: artifact.sha256,
    }),
    validateFailureReportActualBytes: async ({ artifact, failureId }) => ({
      status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
      validatorId: 'U0Frozen2ParseFailureReportValidator',
      validatorRevision: 'related-context-test',
      contractId: 'techpub.parse-failure-report.v1',
      contractRevision: 'frozen.2',
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      failureId,
      artifactSha256: artifact.sha256,
    }),
  });
}

function explicitReferenceSourceUnit(): UnifiedReaderQueryResult {
  return {
    unitId: 'unit-explicit-reference',
    kind: 'paragraph',
    text: 'Concurrent Requirements: Service Bulletin 777-34-0425 must be incorporated concurrently.',
    sourceRefIds: ['source-explicit-reference'],
    sourceLocators: [
      {
        sourceRefId: 'source-explicit-reference',
        kind: 'page_text',
        artifactId: 'artifact-primary-pdf',
        pageStart: 1,
        pageEnd: 1,
        charStart: 0,
        charEnd: 94,
        charOffsetUnit: 'unicode_code_point',
        normalizedPath: null,
        xpath: null,
        elementId: null,
        quote:
          'Concurrent Requirements: Service Bulletin 777-34-0425 must be incorporated concurrently.',
        bbox: null,
      },
    ],
  };
}

function evaluationInputVector(
  workItem: CanonicalWorkItemProjection,
): Record<string, unknown> {
  return structuredClone({
    applicability: {
      input: workItem.applicabilityInput ?? null,
      currentCandidate: workItem.applicability ?? null,
    },
    jobAid: {
      sourcePackage: workItem.package,
      currentAssessment: workItem.assessment ?? null,
      baseRules: workItem.integratedAssessment?.baseRules ?? null,
      engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
    },
    overall: {
      applicability: workItem.applicability ?? null,
      baseRules: workItem.integratedAssessment?.baseRules ?? null,
      engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
      currentCandidate: workItem.integratedAssessment?.overallSynthesis ?? null,
      regenerationRequest: workItem.overallRegenerationRequest ?? null,
    },
  });
}

function evaluationWorkItem(): CanonicalWorkItemProjection {
  const packageArtifact: UnifiedPackageArtifactDescriptor = artifact(
    'artifact://primary-package',
    'b',
  );
  const applicabilityArtifact: UnifiedPackageArtifactDescriptor = artifact(
    'artifact://applicability',
    'c',
  );
  const assessmentArtifact: UnifiedPackageArtifactDescriptor = artifact(
    'artifact://assessment',
    'd',
  );
  const baseArtifact: UnifiedPackageArtifactDescriptor = artifact(
    'artifact://base-rules',
    'e',
  );
  const overallArtifact: UnifiedPackageArtifactDescriptor = artifact(
    'artifact://overall',
    'f',
  );
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-RELATED-CONTEXT-ISOLATION',
    requestId: 'REQ-RELATED-CONTEXT-ISOLATION',
    revision: 8,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-related-context',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-related-context',
      decisionId: 'decision-parse',
      decisionHash: 'decision-hash-parse',
      permissionSnapshotVersion: 'permission-related-context',
    },
    source: {
      documentId: 'DOC-PRIMARY',
      documentVersionId: 'DV-PRIMARY',
      parserRequestId: 'PARSER-PRIMARY',
      sourceArtifactId: 'SOURCE-PRIMARY',
      sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 100,
      driveFileToken: 'drive-primary',
      driveSourceVersion: 'drive-version-primary',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'FTD',
      classifierReleaseId: 'classifier-related-context',
      classifierReleaseHash: 'classifier-hash-related-context',
      parserProfileId: 'parser-related-context',
      parserProfileHash: 'parser-hash-related-context',
      fingerprint: 'classification-related-context',
    },
    package: {
      packageId: 'PKG-PRIMARY',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: packageArtifact,
      contentHash: 'package-content-primary',
      semanticHash: 'package-semantic-primary',
      provenanceHash: 'package-provenance-primary',
      coverageHash: 'package-coverage-primary',
      resultStatus: 'complete',
      title: 'Primary FTD',
      documentIdentity: {
        documentCode: '777-FTD-31-21015',
        businessRevision: 'REV 1',
      },
      contentUnitCount: 1,
      sourceRefCount: 1,
      readerReceiptId: 'reader-receipt-primary',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'related-context-test',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: packageArtifact.sha256,
      },
    },
    applicabilityInput: {
      schemaVersion: 'wiselink.3_1.applicability_input_projection.v1',
      applicabilityContextRef: 'applicability-context://B-1266',
      workItemId: 'WI-RELATED-CONTEXT-ISOLATION',
      documentVersionId: 'DV-PRIMARY',
      sourcePackageId: 'PKG-PRIMARY',
      sourcePackageContentHash: 'package-content-primary',
      sourcePackageArtifactSha256: packageArtifact.sha256,
      targetBindingHash: 'target-binding-primary',
      selectionRevision: 'selection-primary',
      bindingRevision: 'binding-primary',
      currentness: 'CURRENT',
      aircraftNumber: 'B-1266',
      assessmentAsOf: '2026-06-05',
      fleetMasterData: {
        schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1',
        sourceSnapshotId: 'fleet-snapshot-primary',
        sourceRevisionKey: 'fleet-revision-primary',
        authorityRevision: 'fleet-authority-primary',
        sourceAsOf: '2026-06-05T00:00:00.000Z',
        assets: [],
        facts: [],
      },
    },
    applicability: {
      schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
      status: 'CANDIDATE_ONLY',
      currentness: 'CURRENT',
      staleReason: null,
      sourceResultId: 'openclaw-applicability://PRIMARY',
      actionAttemptId: 'ATT-APPLICABILITY-PRIMARY',
      inputRevision: 8,
      documentId: 'DOC-PRIMARY',
      documentVersionId: 'DV-PRIMARY',
      sourcePackageId: 'PKG-PRIMARY',
      sourcePackageContentHash: 'package-content-primary',
      translationActionAttemptId: 'ATT-TRANSLATION-PRIMARY',
      applicabilityContextRef: 'applicability-context://B-1266',
      applicabilityBindingRevision: 'binding-primary',
      aircraftNumber: 'B-1266',
      assessmentAsOf: '2026-06-05',
      fleetSourceSnapshotId: 'fleet-snapshot-primary',
      fleetSourceRevisionKey: 'fleet-revision-primary',
      fleetAuthorityRevision: 'fleet-authority-primary',
      fleetSourceAsOf: '2026-06-05T00:00:00.000Z',
      sourceExpressionCount: 1,
      sourceRefCount: 1,
      decision: 'APPLICABLE',
      kleeneResult: true,
      pass: true,
      blockingUnknownCount: 0,
      artifact: applicabilityArtifact,
    },
    assessment: {
      status: 'CANDIDATE_ONLY',
      criterionSetId: 'JOB-AID-CURRENT',
      criterionCount: 150,
      evaluationItemCount: 150,
      packageStatus: 'complete',
      applicabilityOverall: 'APPLICABLE',
      authorityLevel: 'candidate_only',
      warningCodes: [],
      blocksEngineeringClosure: false,
      externalDiscoveryStatus: null,
      externalDiscoveryIsEvidence: false,
      previousOverallStale: false,
      staleReason: null,
      currentContextHash: 'assessment-context-primary',
      currentTransportHash: 'assessment-transport-primary',
      artifact: assessmentArtifact,
      evaluateAttemptId: 'ATT-ASSESSMENT-PRIMARY',
      resynthesisAttemptId: null,
    },
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 3,
        sourceResultId: 'BASE-RULE-PRIMARY',
        criterionSetId: 'JOB-AID-CURRENT',
        criterionCount: 150,
        evaluationItemCount: 150,
        unresolvedCount: 10,
        sourceBoundCandidateCount: 140,
        artifact: baseArtifact,
        actionAttemptId: 'ATT-BASE-PRIMARY',
      },
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 2,
        sourceResultId: 'OPENCLAW-OVERALL-PRIMARY',
        basedOnBaseRuleRevision: 3,
        basedOnBaseRuleArtifactSha256: baseArtifact.sha256,
        basedOnEngineerReviewRevision: null,
        basedOnEngineerReviewArtifactSha256: null,
        discoveryStatus: 'NOT_REQUESTED',
        gap: null,
        candidateRefCount: 0,
        findingCount: 1,
        unresolvedCount: 10,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: overallArtifact,
        actionAttemptId: 'ATT-OVERALL-PRIMARY',
        staleReason: null,
      },
      engineerReviews: null,
      overallForAeoConfirmation: null,
    },
    overallRegenerationRequest: null,
    failure: null,
    recordingFailure: null,
  };
}

function referenceMention(
  normalizedTarget: string,
  targetResolution: CanonicalReferenceTargetResolution,
  index: number,
): CanonicalReferenceMentionPreviewItem {
  const exact: boolean = targetResolution.status === 'RESOLVED_EXACT';
  return {
    mentionRef: `reference-mention://${index + 1}`,
    mentionId: `RM-${index + 1}`,
    primaryDocumentVersionRef: 'DV-PRIMARY',
    mentionSourceRef: `source-${index + 1}`,
    citationText: `Service Bulletin ${normalizedTarget}`,
    normalizedIdentity: {
      documentNumber: normalizedTarget,
      title: null,
      publisher: null,
    },
    documentTypeCandidate: 'SB',
    extractionMethod: 'DETERMINISTIC_TEXT',
    relationCue: 'related information',
    relationRoleCandidates: ['GENERAL_BACKGROUND'],
    resolutionState: targetResolution.status,
    resolvedDocumentVersionRef:
      targetResolution.status === 'RESOLVED_EXACT'
        ? targetResolution.documentVersionId
        : null,
    permissionState:
      targetResolution.status === 'ACCESS_DENIED'
        ? 'DENIED'
        : exact
          ? 'AUTHORIZED'
          : 'NOT_CHECKED',
    sourceAuthority: 'OEM_FORMAL',
    evidenceStance: 'NOT_EVALUATED',
    candidateOnly: true,
    unitOrdinal: index + 1,
    matchedText: `Service Bulletin ${normalizedTarget}`,
    normalizedTarget,
    documentType: 'SB',
    contextRole: 'RELATED_INFORMATION',
    targetResolution,
    targetApplicability: exact ? 'APPLICABLE' : 'NOT_EVALUATED',
    ...(exact
      ? {
          applicabilityResultRef: 'openclaw-applicability://RELATED-EXACT',
        }
      : {}),
    sourceRefIds: [`source-${index + 1}`],
    sourceLocators: [],
  };
}

function artifact(
  ref: string,
  digestCharacter: string,
): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref,
    sha256: digestCharacter.repeat(64),
    byteLength: 100,
    mediaType: 'application/json',
  };
}
