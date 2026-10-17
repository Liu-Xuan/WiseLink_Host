import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { validateEngineeringClassificationInput } from '../../../server/modules/tdms-source/tdms-current-source-classification.validation';
import sealedDirectory from '../../fixtures/tdms-source/engineering-directory-row-digest-0254.synthetic.json';
import { prepareTdmsDailyMetadataImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import {
  hash,
  sourcePackage,
  assertOpinionCollectionIngress,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  fileServiceImport,
  TDMS_COMPLETE_ORIGINAL_FILE_WRAPPER_MAX_BYTES,
} from '../../../server/modules/tdms-source/tdms-file-service-import.validation';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor, fixture } from './tdms-fixtures';
import {
  copyComplete,
  sealComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import {
  currentClassification,
  currentDerivedOriginal,
  currentManyEdges,
  currentOwnReference,
  proofOfCurrent,
  resealClassification,
  resealCurrent,
} from './tdms-current-contract.fixture';
function setup(
  env: ReturnType<typeof syntheticCompleteEnvelope>,
  artifacts: any = { acquire: jest.fn() },
) {
  const claims = copyComplete(adaptTdmsDailySource(env).memberClaims),
    repository = new MemoryTdmsRepository();
  const authority = new HostDecisionTdmsSourceAuthorization(
    async () => [{ scope: nativeScope, permissionRevision: 'synthetic-1' }],
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
  return {
    repository,
    artifacts,
    service: new TdmsSourceService(repository, authority, artifacts, {
      assertRead: jest.fn(),
    }),
  };
}
const rehash = (env: ReturnType<typeof syntheticCompleteEnvelope>) => {
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
};
function fileEnvelope(format = 'PDF', large = false) {
  const data = currentDerivedOriginal(format, large);
  return {
    ...data,
    input: {
      sourceKey: nativeScope.sourceKey,
      sourceInstanceId: nativeScope.sourceInstanceId,
      scopeId: nativeScope.scopeId,
      package: adaptTdmsDailySource(data.env).output.nativePackage,
      artifactSelections: [data.selection],
    },
  };
}
describe('frozen TDMS 0.2.54 current Host wire alignment', () => {
  it('accepts sealed producer directory samples with unchanged rowDigest when only observedAt changes', () => {
    expect(sealedDirectory.input.directoryProof.rowDigest).toBe(
      '14e2e65c907b8d7ddea7cbc5dde8d633888d34a5f7ce25a33a1ff2a5ba05e1e5',
    );
    expect(sealedDirectory.laterInput.directoryProof.rowDigest).toBe(
      sealedDirectory.producerRowDigest,
    );
    expect(sealedDirectory.laterInput.expectedRow.observedAt).not.toBe(
      sealedDirectory.input.expectedRow.observedAt,
    );
    expect(
      validateEngineeringClassificationInput(
        copyComplete(sealedDirectory.input),
      ),
    ).toEqual(sealedDirectory.input);
    expect(
      validateEngineeringClassificationInput(
        copyComplete(sealedDirectory.laterInput),
      ),
    ).toEqual(sealedDirectory.laterInput);
  });
  it('preserves sealed directory row/timestamp in the native projection and changes only the request digest', () => {
    const first = currentClassification('engineering', true),
      later = copyComplete(first);
    const p = later.package.records[0].rawFields
      .engineeringClassification as any;
    p.requestedCriteria = copyComplete(sealedDirectory.laterInput);
    resealClassification(later);
    const before = adaptTdmsDailySource(first),
      after = adaptTdmsDailySource(later);
    expect(
      after.envelope.package.records[0].rawFields.engineeringClassification,
    ).toEqual(p);
    expect(
      after.output.nativePackage.records[0].rawFields.engineeringClassification,
    ).toEqual(p);
    expect(later.requestId).not.toBe(first.requestId);
    expect(later.package.records[0].snapshotId).toBe(
      first.package.records[0].snapshotId,
    );
    expect(after.payloadDigest).not.toBe(before.payloadDigest);
  });
  it('rejects sealed producer-invalid whole-row digest including observedAt', () => {
    const input = copyComplete(sealedDirectory.input);
    input.directoryProof.rowDigest = sealedDirectory.legacyFullRowDigest;
    expect(sealedDirectory.legacyFullRowDigestRejectedWith).toBe(
      'TDMS_ENGINEERING_CLASSIFICATION_BINDING_INVALID',
    );
    expect(() => validateEngineeringClassificationInput(input)).toThrow(
      'TDMS_ENGINEERING_CLASSIFICATION_BINDING_INVALID',
    );
  });
  it.each([
    'sourceRecordId',
    'number',
    'sourceVersion',
    'sourceModifiedRaw',
  ] as const)(
    'rejects sealed directory %s identity tamper under the unchanged proof',
    (change) => {
      const input = copyComplete(sealedDirectory.input),
        row = input.expectedRow;
      if (change === 'sourceRecordId')
        input.sourceObjectRef = row.sourceRecordId =
          'OR:wt.epm.EPMDocument:99126';
      if (change === 'number')
        input.documentCode = row.number = 'SYNTHETIC-OTHER-DIRECTORY';
      if (change === 'sourceVersion') {
        row.sourceVersion.rawIteration = '2';
        row.technicalVersionRaw = row.technicalVersionEvidence.rawValue = 'A.2';
      }
      if (change === 'sourceModifiedRaw')
        row.sourceModifiedRaw = '2026-10-12 08:01';
      expect(() => validateEngineeringClassificationInput(input)).toThrow(
        'TDMS_ENGINEERING_CLASSIFICATION_BINDING_INVALID',
      );
    },
  );
  it('retains required WTDocument classification operation and parent link index', () => {
    const env = syntheticCompleteEnvelope('SL'),
      p = proofOfCurrent(env);
    const parent = copyComplete(
      proofOfCurrent(syntheticCompleteEnvelope('AD_ITEM')).requestedCriteria
        .sourceProof,
    );
    parent.targetRef = env.package.records[0].sourceRecordId;
    parent.classificationOperationId =
      'TDMSOP-55555555-5555-5555-5555-555555555555';
    parent.linkIndex = 2;
    p.requestedCriteria.sourceProof = parent;
    for (const read of p.reads)
      read.owner.scopeEvidence.nativeTypeOrigin = 'REQUIRED_RELATION_TARGET';
    resealCurrent(env);
    expect(
      adaptTdmsDailySource(env).output.nativePackage.records[0].rawFields
        .completeOwnedSource,
    ).toEqual(p);
    const wrong = copyComplete(env);
    proofOfCurrent(
      wrong,
    ).requestedCriteria.sourceProof.classificationOperationId =
      'unverified-operation';
    resealCurrent(wrong);
    expect(() => adaptTdmsDailySource(wrong)).toThrow(
      'TDMS_COMPLETE_OWN_PARENT_REQUIRED',
    );
  });
  it('normalizes only reviewed bound-directory capture identifiers in snapshot identity', () => {
    const env = syntheticCompleteEnvelope(),
      p = proofOfCurrent(env);
    for (const read of p.reads) {
      read.owner.nativeTypeEvidence.actualLabel =
        'Bound directory nativeTypeId';
      read.owner.nativeTypeEvidence.locator =
        'CURRENT_DIRECTORY:' + p.requestedCriteria.sourceProof.operationId;
    }
    resealCurrent(env);
    const later = copyComplete(env),
      next = proofOfCurrent(later);
    next.requestedCriteria.sourceProof.operationId =
      'TDMSOP-66666666-6666-6666-6666-666666666666';
    for (const read of next.reads)
      read.owner.nativeTypeEvidence.locator =
        'CURRENT_DIRECTORY:' + next.requestedCriteria.sourceProof.operationId;
    resealCurrent(later);
    expect(later.package.records[0].snapshotId).toBe(
      env.package.records[0].snapshotId,
    );
    expect(later.requestId).not.toBe(env.requestId);
    expect(adaptTdmsDailySource(later).envelope).toEqual(later);
  });
  it.each(['document', 'engineering'] as const)(
    'retains %s OUT_OF_SCOPE classification without complete foreign evidence',
    (kind) => {
      const env = currentClassification(kind),
        r = env.package.records[0];
      const p = r.rawFields[
        kind === 'document'
          ? 'documentTargetClassification'
          : 'engineeringClassification'
      ] as any;
      if (kind === 'document') {
        p.requestedCriteria.expectedOwner.nativeTypeId = null;
        p.resolvedScopeId = null;
        for (const read of p.reads) {
          read.owner.nativeTypeId =
            'WCTYPE|wt.doc.WTDocument|com.synthetic.OutOfScope';
          read.owner.nativeTypeEvidence = {
            ...read.owner.nativeTypeEvidence,
            actualLabel: 'Type:',
            rawValue: read.owner.nativeTypeId,
            observedTotalCodepoints: read.owner.nativeTypeId.length,
          };
        }
      } else {
        p.resolvedSubtype = null;
        for (const read of p.reads) {
          read.owner.scopeEvidence.engineeringSubtype = 'XX';
          read.nativeSubtype.rawValue = 'XX';
        }
      }
      p.disposition = 'OUT_OF_SCOPE';
      resealClassification(env);
      const native = adaptTdmsDailySource(env).output.nativePackage;
      expect(native.records[0].content).toEqual({});
      expect(native.artifacts).toEqual([]);
      expect(native.records[0].coverage.gaps).toContain(
        'OWN_COMPLETE_CONTENT_NOT_READ',
      );
    },
  );
  it('retains required fresh reload proof separately from semantic identity', () => {
    const env = syntheticCompleteEnvelope(),
      other = copyComplete(env),
      p = proofOfCurrent(other);
    p.documentIdentity = 'synthetic-second-document';
    p.nativeReloadProvenance.documentIdentity = p.documentIdentity;
    p.nativeReloadProvenance.beforeDocumentIdentity =
      'synthetic-first-document';
    resealCurrent(other);
    expect(other.package.records[0].snapshotId).toBe(
      env.package.records[0].snapshotId,
    );
    expect(other.requestId).not.toBe(env.requestId);
    expect(
      adaptTdmsDailySource(other).output.nativePackage.records[0].rawFields
        .completeOwnedSource,
    ).toEqual(p);
  });
  it.each([
    'missing',
    'cross-owner',
    'same-document',
    'wrong-trigger',
    'wrong-cache',
    'not-settled',
    'future-time',
    'extra-key',
  ])('refuses %s reload evidence', (change) => {
    const env = syntheticCompleteEnvelope(),
      p = proofOfCurrent(env),
      reload = p.nativeReloadProvenance;
    if (change === 'missing') delete p.nativeReloadProvenance;
    if (change === 'cross-owner')
      reload.sourceRecordId = 'OR:wt.change2.WTChangeRequest2:902';
    if (change === 'same-document')
      reload.beforeDocumentIdentity = reload.documentIdentity;
    if (change === 'wrong-trigger') reload.trigger = 'CAPTURE_TIMESTAMP';
    if (change === 'wrong-cache') reload.cacheMode = 'DEFAULT';
    if (change === 'not-settled') reload.settledReads = 1;
    if (change === 'future-time') reload.settledAt = '2026-10-14T00:00:00.000Z';
    if (change === 'extra-key') reload.sourceReady = true;
    resealCurrent(env);
    expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_');
  });
  it.each(['current', 'outside', 'unknown'] as const)(
    'keeps reviewed %s own references and exact edge projection',
    (kind) => {
      const env = currentOwnReference(kind),
        result = adaptTdmsDailySource(env);
      expect(result.output.nativePackage.relations).toHaveLength(
        kind === 'outside' ? 0 : 1,
      );
      expect(result.envelope).toEqual(env);
      const wrong = copyComplete(env),
        p = proofOfCurrent(wrong);
      p.targetOccurrences[0].relationshipRole =
        kind === 'current' ? 'UNKNOWN' : 'CURRENT_CONTENT';
      resealCurrent(wrong);
      expect(() => adaptTdmsDailySource(wrong)).toThrow(
        'TDMS_COMPLETE_OWN_RECORD_INVALID',
      );
    },
  );
  it('rejects 已批准 own assessment opinion text outside exact Estimated admission', () => {
    const env = syntheticCompleteEnvelope('SB_ASSESSMENT_FORM'),
      p = proofOfCurrent(env);
    for (const read of p.reads) {
      read.owner.stateRaw = '已批准';
      read.fields[0].value.actualLabel = '评估意见:';
    }
    env.package.records[0].state.rawName = '已批准';
    env.package.records[0].content.completeOwnedFields = copyComplete(
      p.reads[1].fields,
    );
    sealComplete(env);
    expect(() => adaptTdmsDailySource(env)).toThrow(
      'TDMS_OPINION_STATE_NOT_ELIGIBLE',
    );
    expect(env.package.records[0].state.rawName).toBe('已批准');
    expect(p.reads[1].fields[0].value.rawValue).toContain('TBD');
  });
  it('accepts 201 exact observed edges through inner projection and retained service assertions', async () => {
    const env = currentManyEdges(),
      s = setup(env);
    expect(
      adaptTdmsDailySource(env).output.nativePackage.relations,
    ).toHaveLength(201);
    const receipt = await s.service.importDailyMetadata(actor(), env);
    expect(receipt.relationCount).toBe(201);
    expect(s.repository.state.assertions).toHaveLength(201);
    expect(
      s.repository.state.assertions.every(
        (a: any) => a.assertion.authority === 'CANDIDATE_ONLY',
      ),
    ).toBe(true);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
  });
  it('preserves legacy native list max200 and byte max512KiB', () => {
    const legacy = fixture();
    legacy.relations = Array.from({ length: 201 }, () => ({}) as never);
    expect(() => sourcePackage(legacy)).toThrow('TDMS_PACKAGE_LIST_INVALID');
    const original = fileEnvelope();
    delete original.input.package.query.originalAcquisition;
    expect(() => fileServiceImport(original.input)).toThrow(
      'TDMS_COMPLETE_OWN_NATIVE_BINDING_INVALID',
    );
    const large = fixture();
    large.records[0].rawFields.synthetic = 'a'.repeat(512 * 1024);
    expect(() => sourcePackage(large)).toThrow('TDMS_SMALL_PACKAGE_LIMIT');
  });
  it.each(['document', 'engineering'] as const)(
    'retains %s classification only as exact PARTIAL self observation',
    async (kind) => {
      const env = currentClassification(kind),
        result = adaptTdmsDailySource(env),
        s = setup(env);
      expect(result.output.nativePackage.records[0].recordKind).toBe(
        kind === 'document' ? 'OBSERVATION' : 'ENGINEERING_FILE',
      );
      expect(result.output.nativePackage.records[0].content).toEqual({});
      expect(result.output.nativePackage.records[0].coverage).toMatchObject({
        status: 'PARTIAL',
        readback: 'NON_ATOMIC',
      });
      const receipt = await s.service.importDailyMetadata(actor(), env);
      expect(Object.keys(receipt)).toHaveLength(10);
      expect(receipt.artifactCount).toBe(0);
      expect(
        (await s.service.readDailyMetadataImport(actor(), env.requestId))
          .package,
      ).toEqual(env.package);
      expect(() => prepareTdmsDailyMetadataImport(env)).toThrow('TDMS_');
    },
  );
  it('accepts the exact engineering directory-row/digest classification path', () => {
    const env = currentClassification('engineering', true);
    expect(
      adaptTdmsDailySource(env).output.nativePackage.records[0].recordKind,
    ).toBe('ENGINEERING_FILE');
    const wrong = copyComplete(env),
      p = wrong.package.records[0].rawFields.engineeringClassification as any;
    p.requestedCriteria.directoryProof.rowDigest = 'f'.repeat(64);
    resealClassification(wrong);
    expect(() => adaptTdmsDailySource(wrong)).toThrow(
      'TDMS_ENGINEERING_CLASSIFICATION_BINDING_INVALID',
    );
  });
  it.each(['document', 'engineering'] as const)(
    'rejects %s classification tamper at daily and native boundaries',
    (kind) => {
      const key =
        kind === 'document'
          ? 'documentTargetClassification'
          : 'engineeringClassification';
      for (const change of [
        'kind',
        'version',
        'owner',
        'reload',
        'second-read',
        'disposition',
        'complete',
        'content',
        'mixed-mode',
        'parent-link-index',
        'native-version',
      ]) {
        const env = currentClassification(kind),
          r = env.package.records[0],
          p = r.rawFields[key] as any;
        if (change === 'kind') r.kind = 'MANUFACTURER_FILE';
        if (change === 'version') p.classificationRevision = 'unknown@2';
        if (change === 'owner')
          p.reads[1].owner.sourceRecordId = 'OR:wt.doc.WTDocument:9999';
        if (change === 'reload') p.nativeReloadProvenance.cacheMode = 'DEFAULT';
        if (change === 'second-read')
          p.reads[1].sourceContext.principalDisplayName = 'different';
        if (change === 'disposition') p.disposition = 'UNKNOWN';
        if (change === 'complete') r.coverage.status = 'COMPLETE';
        if (change === 'content')
          r.content.conditions = ['foreign full content'];
        if (change === 'mixed-mode') r.rawFields.completeOwnedSource = {};
        if (change === 'parent-link-index')
          p.requestedCriteria.sourceProof.linkIndex = 30;
        if (change === 'native-version')
          p.reads[1].owner.sourceVersion.rawIteration = '2';
        resealClassification(env);
        expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_');
      }
      const native = copyComplete(
        adaptTdmsDailySource(currentClassification(kind)).output.nativePackage,
      );
      native.records[0].recordKind = 'MANUFACTURER_FILE';
      expect(() => sourcePackage(native)).toThrow(
        'TDMS_CLASSIFICATION_NATIVE_BINDING_INVALID',
      );
    },
  );
  it.each(['PDF', 'ZIP', 'DOCX', 'XLSX', 'PPTX'])(
    'preserves declared native %s original through exact controlled selection',
    (format) => {
      const { env, input, selection } = fileEnvelope(format);
      const checked = fileServiceImport(input);
      expect(checked.artifactSelections).toEqual([selection]);
      expect(checked.package.query.originalAcquisition).toEqual(
        env.package.query.originalAcquisition,
      );
      expect(checked.package.records[0].artifactMemberIds).toEqual([]);
      expect(
        checked.package.records[0].formalDocumentArtifactMemberId,
      ).toBeNull();
      expect(
        adaptTdmsDailySource(env).mappings.artifacts[0].sourceAttachmentVersion,
      ).toBeNull();
    },
  );
  it('rejects malformed PRIMARY rosters with a typed native error before selection', () => {
    const { input } = fileEnvelope();
    const p = input.package.records[0].rawFields.completeOwnedSource as any;
    for (const read of p.reads) read.attachments = {};
    expect(() => fileServiceImport(input)).toThrow('TDMS_COMPLETE_OWN_LIMIT');
  });
  it('cannot substitute client inline bytes for the independent FileService selection', () => {
    const { input, bytes, selection } = fileEnvelope();
    const native = copyComplete(input.package);
    const {
      selection: ignoredSelection,
      ownerItemIds: ignoredOwners,
      ...artifact
    } = selection;
    void ignoredSelection;
    void ignoredOwners;
    native.artifacts = [{ ...artifact, bytesBase64: bytes.toString('base64') }];
    native.records[0].artifactMemberIds = [artifact.memberId];
    expect(() => sourcePackage(native)).toThrow(
      'TDMS_COMPLETE_ORIGINAL_FILE_SELECTION_REQUIRED',
    );
  });
  it.each(['a'.repeat(201), '../guessed.pdf'])(
    'rejects a producer-invalid original filename even if all owner declarations agree',
    (filename) => {
      const { env } = currentDerivedOriginal(),
        p = proofOfCurrent(env);
      for (const read of p.reads) {
        read.attachments[0].filename = filename;
        read.attachments[0].primaryMetadata.filename = filename;
      }
      env.package.artifactBindings[0].filename = filename;
      resealCurrent(env);
      const binding = env.package.artifactBindings[0];
      binding.ownerSnapshotId = env.package.records[0].snapshotId;
      const {
        bindingId: ignored,
        observedAt: ignoredTime,
        ...identity
      } = binding;
      void ignored;
      void ignoredTime;
      binding.bindingId = 'TDMSBIND-' + hash(identity);
      rehash(env);
      expect(() => adaptTdmsDailySource(env)).toThrow(
        'TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID',
      );
    },
  );
  it('keeps >512KiB original metadata within the strict 2MiB core plus bounded selection wrapper', () => {
    const { input } = fileEnvelope('ZIP', true);
    expect(Buffer.byteLength(JSON.stringify(input.package))).toBeGreaterThan(
      512 * 1024,
    );
    expect(
      Buffer.byteLength(JSON.stringify(input)) -
        Buffer.byteLength(JSON.stringify(input.package)),
    ).toBeLessThan(TDMS_COMPLETE_ORIGINAL_FILE_WRAPPER_MAX_BYTES);
    expect(fileServiceImport(input).package).toEqual(input.package);
    const legacy = fixture();
    legacy.records[0].rawFields.padding = 'a'.repeat(520 * 1024);
    expect(() => fileServiceImport({ ...input, package: legacy })).toThrow(
      'TDMS_SMALL_PACKAGE_LIMIT',
    );
  });
  it.each([
    'no-marker',
    'extra-marker',
    'wrong-revision',
    'wrong-mode',
    'wrong-operation',
    'wrong-receipt',
    'cross-owner',
    'wrong-version',
    'wrong-format',
    'bad-primary',
    'normal-artifact',
  ])('rejects derived original %s without discarding evidence', (change) => {
    const { env } = currentDerivedOriginal(),
      p = proofOfCurrent(env),
      m = env.package.query.originalAcquisition as any,
      b = env.package.artifactBindings[0];
    if (change === 'no-marker') delete env.package.query.originalAcquisition;
    if (change === 'extra-marker') m.sourceReady = true;
    if (change === 'wrong-revision')
      m.originalRevision = 'tdms-complete-primary-bytes@2';
    if (change === 'wrong-mode') m.contentMode = 'LEGACY';
    if (change === 'wrong-operation') m.ownOperationId = 'unverified-operation';
    if (change === 'wrong-receipt') m.receiptSha256 = 'bad';
    if (change === 'cross-owner')
      b.ownerSnapshotId = 'TDMSSNAP-' + 'f'.repeat(64);
    if (change === 'wrong-version') b.sourceVersion.rawIteration = '2';
    if (change === 'wrong-format')
      for (const read of p.reads)
        read.attachments[0].primaryMetadata.format = 'unknown-file';
    if (change === 'bad-primary')
      for (const read of p.reads)
        read.attachments[0].primaryMetadata.ownerTechnicalVersion.rawIteration =
          '2';
    if (change === 'normal-artifact') {
      delete env.package.query.originalAcquisition;
      env.package.artifactBindings.push(copyComplete(b));
    }
    rehash(env);
    expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_');
  });
  it.each([
    'owner',
    'attachment-version',
    'attachment-id',
    'hash',
    'length',
    'media',
    'name',
  ])('refuses original selection %s identity drift', (change) => {
    const { input } = fileEnvelope(),
      a = input.artifactSelections[0];
    if (change === 'owner') a.ownerItemIds = ['TDMSSNAP-' + 'f'.repeat(64)];
    if (change === 'attachment-version')
      a.sourceAttachmentVersion = '2' as never;
    if (change === 'attachment-id')
      a.sourceAttachmentId = 'OR:wt.content.ApplicationData:9901';
    if (change === 'hash') a.sha256 = 'b'.repeat(64);
    if (change === 'length') a.byteLength += 1;
    if (change === 'media') a.mediaType = 'application/zip';
    if (change === 'name') a.fileName = 'guessed.pdf';
    expect(() => fileServiceImport(input)).toThrow('TDMS_');
  });
  it('requires independent authority and resolver before original acquisition and exact receipt/readback', async () => {
    const { env, selection } = currentDerivedOriginal();
    const s = setup(env);
    await expect(
      s.service.importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_ARTIFACT_TRANSPORT_UNCONFIGURED',
      statusCode: 503,
    });
    expect(s.repository.state.captures).toHaveLength(0);
    const closed = new TdmsSourceService(
      s.repository,
      new UnconfiguredTdmsSourceAuthorization(),
      s.artifacts,
      { assertRead: jest.fn() },
    );
    await expect(
      closed.importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
    s.artifacts.resolveDailySelection = jest.fn(async () =>
      copyComplete(selection),
    );
    s.artifacts.acquireSelection = jest.fn(async ({ artifact: a }: any) => ({
      memberId: a.memberId,
      sourceArtifactId: 'synthetic-artifact',
      acquisitionId: 'synthetic-acquisition',
      fileName: a.fileName,
      mediaType: a.mediaType,
      sha256: a.sha256,
      byteLength: a.byteLength,
      immutableReadbackVerified: true,
      documentVersionId: null,
      registrationGap: 'INDEPENDENT_FORMAL_REGISTRATION_REQUIRED',
    }));
    const receipt = await s.service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt.artifactCount).toBe(1);
    expect(receipt.documentVersionMappings[0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      documentVersionId: null,
      preflightId: null,
      readbackVerified: false,
    });
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(await s.service.importDailyMetadata(actor(), env)).toEqual(receipt);
    expect(s.artifacts.acquireSelection).toHaveBeenCalledTimes(1);
    const saved = s.repository.state.revisions[0].record;
    expect(saved.artifacts.map((a) => a.memberId)).toEqual([
      selection.memberId,
    ]);
    expect(saved.artifacts[0].documentVersionId).toBeNull();
    const native = copyComplete(
      adaptTdmsDailySource(env).output.nativePackage.records[0],
    );
    native.artifactMemberIds = [selection.memberId];
    expect(() =>
      assertOpinionCollectionIngress({
        ...adaptTdmsDailySource(env).output.nativePackage,
        records: [native],
        artifacts: [selection],
      }),
    ).not.toThrow();
  });
});
