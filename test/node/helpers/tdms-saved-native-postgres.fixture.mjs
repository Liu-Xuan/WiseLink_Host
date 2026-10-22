// Constructed sources in a caller-owned temporary cluster only. These reduced
// storage fixtures are not an online migration or deployed-policy assertion.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const schema = require('../../../server/database/schema.ts');
const APP = 'app_17bzc551rsg',
  SCHEMA = 'workspace_aadkpkjef3slu';
const role = 'service_role_' + SCHEMA,
  browserRole = 'authenticated_' + SCHEMA;
export async function seedReceivers(db) {
  await db.unsafe(`CREATE FUNCTION tdms_act_bound_identity(t text,c text) RETURNS boolean LANGUAGE SQL SECURITY INVOKER AS $$
  SELECT t='tenant-a' AND c='cli_aadde8b579f95bc9' AND current_schema()='${SCHEMA}' AND current_user IN ('${role}','${browserRole}') AND
   (SELECT count(*)=1 FROM identity_subject_mapping WHERE miaoda_user_id=current_setting('app.user_id',true)
    AND miaoda_tenant_id=t AND expected_client_id=c AND status='ACTIVE') $$;
  CREATE TABLE tdms_source_receiver(receiver_id text,tenant_id text,application_scope_id text,source_key text,source_instance_id text,
   scope_id text,source_subject_namespace text,source_subject_id text,authority_ref text,authority_revision text,authority_evidence_ref text,
   approved_by_subject text,approved_at timestamptz,valid_from timestamptz,valid_until timestamptz,status text,revoked_at timestamptz,revision integer);
  CREATE TABLE tdms_source_receiver_grant(receiver_id text,actor_subject_id text,source_subject_namespace text,source_subject_id text,
   permission_revision text,authority_evidence_ref text,approved_by_subject text,approved_at timestamptz,valid_from timestamptz,
   valid_until timestamptz,status text,revoked_at timestamptz,revision integer,actions_json jsonb);
  ALTER TABLE action_attempt ADD COLUMN summary_id text,ADD COLUMN summary_delegated_principal_id text;`);
  await db`INSERT INTO identity_subject_mapping(id,miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
  VALUES(${randomUUID()},'user-a','tenant-a','cli_aadde8b579f95bc9','ACTIVE')`;
  await db`INSERT INTO tdms_source_receiver VALUES('receiver','tenant-a',${APP},'TDMS','instance','shared-source','TDMS_USER','source-user',
  'authority','r1','proof','approver',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1)`;
}
export async function seedNative(admin, db, f, context, evidence) {
  const { binding, scope, set } = f;
  await db.insert(schema.workItem).values({
    workItemId: binding.workItemId,
    tenantId: binding.tenantId,
    requestedByUserId: binding.actorUserId,
    documentVersionId: binding.documentVersionId,
    revision: 1,
    documentId: 'doc',
    requestId: 'request',
    runKey: 'run',
  });
  await db.insert(schema.actionAttempt).values({
    id: randomUUID(),
    attemptId: 'attempt-original',
    operationRef: binding.taskContextRef,
    tenantId: binding.tenantId,
    workItemId: binding.workItemId,
    documentVersionId: binding.documentVersionId,
    actorUserId: 'service:openclaw-main',
    taskEnvelopeJson: JSON.stringify({
      modelInput: {
        actorUserId: binding.actorUserId,
        tdmsContext: context,
        privateBody: 'BODY_CANARY',
      },
    }),
    reviewActivityJson: JSON.stringify([
      { kind: 'ASSESSMENT_SOURCES_READ', nativeEvidence: [evidence] },
    ]),
  });
  for (const ref of ['work-selected', 'work-other'])
    await db.insert(schema.assessmentWorkRevision).values({
      assessmentWorkRevisionId: ref,
      workItemId: binding.workItemId,
      documentVersionId: binding.documentVersionId,
      tenantId: binding.tenantId,
      createdByUserId: binding.actorUserId,
      contentJson: JSON.stringify({ evidence: [evidence] }),
    });
  for (const [ref, value] of f.revisions)
    await admin`INSERT INTO tdms_record_revision(tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${value.record.recordRef},${JSON.stringify(value)}::jsonb)`;
  for (const [ref, value] of f.assertions)
    await admin`INSERT INTO tdms_relation_assertion(tenant_id,source_key,source_instance_id,scope_id,assertion_ref,relation_ref,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${value.assertion.relationRef},${JSON.stringify(value)}::jsonb)`;
  await admin`INSERT INTO tdms_processing_revision_set(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${set.setRevisionRef},${set.processingFamilyRef},${set.cohortRef},${set.processingObservationRef},${JSON.stringify(set)}::jsonb)`;
  await admin`INSERT INTO tdms_processing_set_head(tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${set.processingFamilyRef},${set.setRevisionRef},1,${JSON.stringify(f.head)}::jsonb)`;
  const receipt = f.receipts[0];
  await admin`INSERT INTO tdms_read_receipt(tenant_id,source_key,source_instance_id,scope_id,receipt_ref,source_revision_ref,actor_id,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${receipt.receipt.receiptRef},${receipt.receipt.sourceRevisionRef},${receipt.actorId},${JSON.stringify(receipt)}::jsonb)`;
  const source = {
    schemaVersion: 'wiselink.tdms-formal-document-binding.v1',
    scope,
    applicationScopeId: APP,
    actorSubjectId: binding.actorUserId,
    requestId: 'capture-package',
    bindingId: 'attachment-binding',
    payloadDigest: 'payload',
    ownerSnapshotId: 'source-snapshot',
    sourceRecordId: 'source',
    sourceVersion: f.revisions.get('source').record.sourceVersion,
    businessVersion: null,
    sourceAttachmentId: 'attachment',
    sourceAttachmentVersion: null,
    sha256: 'a'.repeat(64),
    byteLength: 42,
    selection: {
      bucketId: 'bucket',
      filePath: 'path',
      expectedProviderObjectId: 'object',
    },
  };
  const descriptor = {
    identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    pageCount: 1,
    sha256: source.sha256,
    sizeBytes: 42,
    sourceStorageKey: 'bucket:path',
    documentCode: 'SB',
    canonicalDocumentFamily: 'SB',
    issuer: 'TEST',
    businessRevision: 'A',
    revisionDate: '2026-10-01',
    sourceGeneratedDate: '2026-10-01',
    tdmsRegistration: source,
  };
  await db.insert(schema.dmPublicationFamily).values({
    id: randomUUID(),
    familyId: 'dm-family',
    canonicalIdentityKey: 'tenant:tenant-a:family:SB',
    documentFamily: 'SB',
    issuerAuthority: 'TEST',
    canonicalDocumentNumber: 'SB',
  });
  await db.insert(schema.dmSourceArtifact).values({
    id: randomUUID(),
    sourceArtifactId: 'artifact',
    sha256: source.sha256,
    byteLength: 42,
    mediaType: 'application/pdf',
    bucketId: 'bucket',
    filePath: 'path',
    readbackVerified: true,
  });
  await db.insert(schema.dmDocumentVersion).values({
    id: randomUUID(),
    documentVersionId: binding.documentVersionId,
    familyId: 'dm-family',
    sourceArtifactId: 'artifact',
    acquisitionId: 'acquisition',
    pdfSha256: source.sha256,
    byteLength: 42,
    businessRevision: 'A',
    revisionDate: '2026-10-01',
    sourceGeneratedDate: '2026-10-01',
  });
  await db.insert(schema.dmAcquisition).values({
    id: randomUUID(),
    acquisitionId: 'acquisition',
    documentVersionId: binding.documentVersionId,
    sourceArtifactId: 'artifact',
    status: 'COMMITTED_CANONICAL',
    acquiredBy: binding.actorUserId,
    selectionBucketId: 'bucket',
    selectionFilePath: 'path',
    providerObjectId: 'object',
    providerVersionId: 'v1',
    sourceDescriptorJson: JSON.stringify(descriptor),
  });
  await db.insert(schema.dmIngressPreflight).values({
    id: randomUUID(),
    preflightId: 'preflight',
    acquisitionId: 'acquisition',
    documentVersionId: binding.documentVersionId,
    status: 'COMMITTED',
    committedAt: new Date(),
    commitIdempotencyKey: 'catalog:acquisition',
    normalizedDescriptorJson: JSON.stringify(descriptor),
  });
  const capture = {
    scope,
    packageHash: 'payload',
    dailyMetadata: {
      applicationScopeId: APP,
      nativeRetention: {
        records: [
          {
            snapshotId: 'source-snapshot',
            sourceRecordId: 'source',
            nativeKind: 'MANUFACTURER_FILE',
            sourceRevisionRef: 'source',
          },
        ],
        artifacts: [
          {
            bindingId: source.bindingId,
            ownerSnapshotId: source.ownerSnapshotId,
            sourceAttachmentId: source.sourceAttachmentId,
            sourceAttachmentVersion: null,
            sha256: source.sha256,
            byteLength: 42,
            ownerSourceVersion: source.sourceVersion,
          },
        ],
      },
    },
  };
  await admin`INSERT INTO tdms_capture(tenant_id,source_key,source_instance_id,scope_id,capture_ref,package_id,data)
  VALUES(${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},'capture-source','capture-package',${JSON.stringify(capture)}::jsonb)`;
  const permittedMembers = {
    records: [...f.revisions.values()].map((v) => ({
      recordKind: v.record.recordKind,
      sourceRecordId: v.record.sourceRecordId,
    })),
    artifacts: [
      {
        memberId: source.bindingId,
        sourceAttachmentId: source.sourceAttachmentId,
        sourceAttachmentVersion: null,
        owners: [{ recordKind: 'MANUFACTURER_FILE', sourceRecordId: 'source' }],
      },
    ],
    relationIds: [...f.assertions.values()].map(
      (v) => v.assertion.sourceRelationId,
    ),
    relatedDocumentVersionIds: [],
  };
  const decision = {
    allowed: true,
    authorityRef: 'authority',
    authorityRevision: 'r1',
    authorityEvidenceRef: 'proof',
    approvedBySubject: 'approver',
    validFrom: new Date(Date.now() - 86400000).toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    purpose: 'read',
    retainedCaptureReadAllowed: true,
    permittedMembers,
  };
  await admin`INSERT INTO tdms_source_receiver_grant VALUES('receiver',${binding.actorUserId},'TDMS_USER','source-user','permission','proof','approver',
  now()-interval '1 day',now()-interval '1 day',now()+interval '1 day','ACTIVE',NULL,1,${JSON.stringify({ READ_RECORD: decision })}::jsonb)`;
}
