function requiredText(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw Object.assign(new Error(`${fieldName} is required.`), {
      code: 'PHASE5_BOEING_SB_HANDOFF_INVALID',
    });
  }
  return normalized;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * Exact local-only handoff for the first ordinary Boeing SB vertical.
 *
 * The values below reuse the accepted DM classification envelope, Parser
 * profile/crosswalk, and module-source frozen.2 package. They do not claim a
 * hosted FileService locator, Catalog receipt, WorkItem, or Assessment result.
 */
export const PHASE5_737_34_3830_HANDOFF = deepFreeze({
  source: {
    sourceRootRelativePath:
      'Docs/uploads/SB/机身/BOEING/2026/202605/737-34-3830 Original.pdf',
    sha256: 'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
    byteLength: 1_060_204,
    mediaType: 'application/pdf',
    migrationShadowReference: {
      driveFileToken: 'GbmQbpK83ohkMCxYWlccTPLOnxc',
      driveSourceVersion: '7672068979543772122',
      authority: 'MIGRATION_SHADOW_REFERENCE_ONLY',
    },
  },
  descriptor: {
    originalFilename: '737-34-3830 Original.pdf',
    documentTitle: '737-34-3830 Original Issue',
    documentCode: '737-34-3830',
    documentFamily: 'SB',
    sourceType: 'boeing_sb',
    issuer: 'BOEING',
    businessRevision: 'Original Issue',
    revisionDate: '2026-05-13',
    documentCodeProvenance: {
      schemaVersion: 'wiselink.document_code_provenance.v1',
      source: 'controlled_metadata',
      candidates: ['737-34-3830'],
      inspectedSha256:
        'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
      conflict: false,
    },
  },
  catalogIdentity: {
    familyId: 'family_58068371edd11c2b3c8aecf0',
    documentId: 'document_10085d27e5c05266403bb74c',
    revisionId: 'revision_f4813607b91ee1a20e754e2d',
    documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
    canonicalRevisionIdentity: 'DATE:2026-05-13',
  },
  classificationEnvelope: {
    schemaVersion: 'wiselink.v3_1.document_classification_envelope.v1',
    classificationId: 'CLS-F87850CDDC741F2969280DB0',
    classificationHash:
      'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
    status: 'CONFIRMED',
    normalizedFamily: 'SB',
    issuer: 'BOEING',
    subtype: 'service_bulletin',
    profileId: 'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
    nativeParseProfileId: 'boeing.sb',
  },
  canonicalHostClassification: {
    status: 'CONFIRMED',
    normalizedFamily: 'SB',
    classifierReleaseId: 'intake-classifier-release:q1-native-migration@1.0.0',
    classifierReleaseHash:
      'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
    parserProfileId: 'parser-profile:boeing.sb@1.0.0',
    parserProfileHash:
      'sha256:f87dbe8607c4958f253f980bc459cea062e7ebc1e7e8c65353549399cb07f3c0',
    fingerprint:
      'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
  },
  parserRouteEvidence: {
    classifierProfileHash:
      'sha256:2cc9a08790c186be13d379d00b186bddb971e3271148e5b2ba33f212a55b0de0',
    parserProfileReleaseId: 'PPR-69FF23C88F0F5CB715C60722',
    parserProfileReleaseHash:
      'sha256:69ff23c88f0f5cb715c60722fc7ede1658e17287bd2f1894bb894f841d81f3d1',
    classifierParserCrosswalkId: 'CPX-9C586B8FB0FF80960EB295AF',
    classifierParserCrosswalkHash:
      'sha256:9c586b8fb0ff80960eb295afa5a9174ff1458c262925854612c54659c9adab4f',
  },
  parsedPackageImport: {
    sourceRepositoryRole: 'SB_JOB_AID_MODULE_SOURCE',
    sourceCommit: '56d35d2b0ebf83e235b1583303bb996e5a93081f',
    sourcePath:
      'test/fixtures/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
    artifactRecordPath:
      'test/fixtures/real-sb/737-34-3830-original-issue/artifact-record.frozen-2.json',
    schemaVersion: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    packageId:
      'urn:techpub:package:v1:sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d',
    artifactSha256:
      'sha256:84d37eda63352934a69f7b1b37c0e174b74c7274e47d9041513e990c5091e1ac',
    artifactByteLength: 273_349,
    contentHash:
      'sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d',
    authority: 'LOCAL_MODULE_SOURCE_NOT_CANONICAL_ARTIFACT_STORE',
  },
});

export function createPhase5BoeingSbIngestRequest({
  selection,
  sourceRef,
  idempotencyKey,
} = {}) {
  const bucketId = requiredText(selection?.bucketId, 'selection.bucketId');
  const filePath = requiredText(selection?.filePath, 'selection.filePath');
  return {
    selection: { bucketId, filePath },
    sourceChannel: 'canonical_miaoda_document_selection',
    sourceRef: requiredText(sourceRef, 'sourceRef'),
    idempotencyKey: requiredText(idempotencyKey, 'idempotencyKey'),
    descriptor: structuredClone(PHASE5_737_34_3830_HANDOFF.descriptor),
  };
}
