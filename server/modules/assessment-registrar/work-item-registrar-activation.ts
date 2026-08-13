import { createHash } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

export const WORK_ITEM_REGISTRAR_ACTIVATION_AUTHORITY = Symbol(
  'WORK_ITEM_REGISTRAR_ACTIVATION_AUTHORITY',
);

export const WORK_ITEM_REGISTRAR_ACTIVATION_MANIFEST_SCHEMA =
  'wiselink.v3_1.work_item_registrar_hosted_activation_manifest.v4';
export const WORK_ITEM_REGISTRAR_SIGNING_RECEIPT_SCHEMA =
  'wiselink.v3_1.master_hosted_activation_signing_receipt.v3';
export const WORK_ITEM_REGISTRAR_VALIDATION_WRITE_DECISION_SCHEMA =
  'wiselink.v3_1.work_item_registrar_validation_write_decision.v2';
export const WORK_ITEM_REGISTRAR_VALIDATION_WRITE_RECEIPT_SCHEMA =
  'wiselink.v3_1.master_validation_write_signing_receipt.v2';
export const WORK_ITEM_REGISTRAR_READINESS_SCHEMA =
  'wiselink.v3_1.work_item_registrar_activation_readiness.v4';

const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;
const RAW_SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VALIDATION_PURPOSE = 'SB_JOB_AID_REAL_VERTICAL_VALIDATION';
const SERVICE_IDENTITY = 'CanonicalHubRegistrar';
const MASTER_ROLE = 'WiseLink3_1Master';
const ARTIFACT_STORE_ROLE = 'CanonicalArtifactStore';
const ACCEPTED_PACKAGE_SCHEMA = 'techpub.parsed-package.v1';
const ACCEPTED_PACKAGE_REVISION = 'frozen.2';
const U0_VALIDATOR_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
const U0_MANIFEST_SHA256 =
  '730baa88e7254bac6d3808ca2ddbfb1824c5891d6ce3d6d29ce177431cd5ffc0';
const UNIFIED_HOST_BASELINE = '0ae998139ea6ccf0800e1aac380d5c06a1aec4c2';
const AEO_PORT_REVISION = '2e67277668d3ac3dd445af96b1212bbca7369819';
const AEO_PORT_TOKEN = 'wiselink.3_1.port.aeo_specialist_reader.v0.candidate';
const AEO_PURPOSE = 'AEO_CANDIDATE_VERTICAL';
export const PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER = {
  sourceCommit: '04e21300dfbfe8ca501e62ea4ccd56be71f55ba4',
  token: 'IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER',
  revision:
    'wiselink.3_1.port.immutable_acceptance_receipt_owner.v0.candidate.1',
  fingerprint:
    'sha256:ae9b18dbe086a04e5a8a8acaca2192d2f1075f572a0adea7fc3f1d56f975da5c',
} as const;
const STORE_IDENTITY = {
  baseToken: 'VorbbDXAkaHbLMsUTV2cBCW5nRd',
  workItemsTableId: 'tblre53IWbymz982',
  decisionsTableId: 'tbln5DlxOHYSJJ3p',
  executionLogsTableId: 'tbl8v4CB4VZUcb5e',
} as const;

export interface RegistrarArtifactPointer {
  artifactRef: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: 'application/json';
}

export interface WorkItemRegistrarActivationManifest {
  schemaVersion: typeof WORK_ITEM_REGISTRAR_ACTIVATION_MANIFEST_SCHEMA;
  activationId: string;
  activationRevision: number;
  status: 'ACTIVE';
  environment: 'VALIDATION';
  purpose: typeof VALIDATION_PURPOSE;
  host: {
    miaodaAppId: string;
    hostedDeploymentId: string;
    tenantId: string;
    environmentId: string;
  };
  roleResolution: {
    revision: string;
    fingerprint: string;
  };
  store: {
    baseToken: typeof STORE_IDENTITY.baseToken;
    workItemsTableId: typeof STORE_IDENTITY.workItemsTableId;
    decisionsTableId: typeof STORE_IDENTITY.decisionsTableId;
    executionLogsTableId: typeof STORE_IDENTITY.executionLogsTableId;
    permissionReceipt: RegistrarArtifactPointer;
    schemaReceipt: RegistrarArtifactPointer;
  };
  writer: {
    serviceIdentity: typeof SERVICE_IDENTITY;
    servicePrincipalId: string;
    soleWriterBindingRevision: string;
    soleWriterBindingFingerprint: string;
  };
  artifactStore: {
    role: typeof ARTIFACT_STORE_ROLE;
    adapterRevision: string;
    storeId: string;
    bucketId: string;
    permissionSnapshotRef: string;
    permissionSnapshotHash: string;
    retentionPolicyRevision: string;
  };
  masterAuthority: {
    issuerRole: typeof MASTER_ROLE;
    trustStoreRevision: string;
    signerKeyId: string;
  };
  r1Pins: {
    packageSchema: typeof ACCEPTED_PACKAGE_SCHEMA;
    packageRevision: typeof ACCEPTED_PACKAGE_REVISION;
    u0ValidatorCommit: typeof U0_VALIDATOR_COMMIT;
    u0ValidatorManifestSha256: typeof U0_MANIFEST_SHA256;
    unifiedHostSourceBaselineCommit: typeof UNIFIED_HOST_BASELINE;
    unifiedPortRevision: string;
    unifiedReaderRevision: string;
    aeoSpecialistPortRevision: typeof AEO_PORT_REVISION;
    aeoSpecialistPortToken: typeof AEO_PORT_TOKEN;
    aeoValidationPurpose: typeof AEO_PURPOSE;
    noFallbackRegistryRevision: string;
  };
  registrarHostAcceptanceReceipt: RegistrarArtifactPointer & {
    ownerServiceIdentity: typeof SERVICE_IDENTITY;
    ownerServicePrincipalId: string;
    schemaVersion: string;
    receiptId: string;
    canonicalHash: string;
  };
  parsedPackageAcceptanceReceiptOwner: typeof PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER;
  parsedPackageReceiptThinIndex: {
    workItemRefField: 'accepted_result_ref';
    workItemHashField: 'accepted_result_sha256';
    packageArtifactRefField: 'parsed_package_artifact_ref';
    packageArtifactHashField: 'parsed_package_artifact_sha256';
    ownerMayMutateWorkItem: false;
  };
  issuedAt: number;
  expiresAt: number;
}

export interface WorkItemRegistrarMasterSigningReceipt {
  schemaVersion: typeof WORK_ITEM_REGISTRAR_SIGNING_RECEIPT_SCHEMA;
  receiptId: string;
  status: 'MASTER_SIGNED';
  issuerRole: typeof MASTER_ROLE;
  manifestArtifactRef: string;
  manifestArtifactSha256: string;
  registrarHostAcceptanceReceiptArtifactRef: string;
  registrarHostAcceptanceReceiptArtifactSha256: string;
  trustStoreRevision: string;
  signerKeyId: string;
  algorithm: string;
  signature: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WorkItemRegistrarActivationBootstrap {
  manifestArtifactRef: string;
  manifestArtifactSha256: string;
  signingReceiptArtifactRef: string;
  signingReceiptArtifactSha256: string;
}

export interface WorkItemRegistrarValidationWriteDecision {
  schemaVersion: typeof WORK_ITEM_REGISTRAR_VALIDATION_WRITE_DECISION_SCHEMA;
  decisionId: string;
  decisionRevision: number;
  status: 'AUTHORIZED';
  environment: 'VALIDATION';
  purpose: typeof VALIDATION_PURPOSE;
  issuerRole: typeof MASTER_ROLE;
  activation: {
    activationId: string;
    activationRevision: number;
    manifestArtifactRef: string;
    manifestArtifactSha256: string;
  };
  authorization: {
    workItemId: string;
    initialInputManifestRef: string;
    initialInputManifestSha256: string;
    authenticatedActor: RegistrarAuthenticatedActorIdentity;
    businessActions: RegistrarBusinessActionIdentity[];
    userAuthorizationRef: string;
    userAuthorizationHash: string;
  };
  issuedAt: number;
  expiresAt: number;
}

export interface WorkItemRegistrarValidationWriteSigningReceipt {
  schemaVersion: typeof WORK_ITEM_REGISTRAR_VALIDATION_WRITE_RECEIPT_SCHEMA;
  receiptId: string;
  status: 'MASTER_SIGNED';
  issuerRole: typeof MASTER_ROLE;
  decisionArtifactRef: string;
  decisionArtifactSha256: string;
  activationManifestArtifactRef: string;
  activationManifestArtifactSha256: string;
  trustStoreRevision: string;
  signerKeyId: string;
  algorithm: string;
  signature: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WorkItemRegistrarValidationWriteBootstrap {
  decisionArtifactRef: string;
  decisionArtifactSha256: string;
  signingReceiptArtifactRef: string;
  signingReceiptArtifactSha256: string;
}

export interface WorkItemRegistrarRuntimeBinding {
  miaodaAppId: string;
  hostedDeploymentId: string;
  tenantId: string;
  environmentId: string;
  serviceIdentity: typeof SERVICE_IDENTITY;
  servicePrincipalId: string;
  baseToken: typeof STORE_IDENTITY.baseToken;
  workItemsTableId: typeof STORE_IDENTITY.workItemsTableId;
  decisionsTableId: typeof STORE_IDENTITY.decisionsTableId;
  executionLogsTableId: typeof STORE_IDENTITY.executionLogsTableId;
  artifactStoreAdapterRevision: string;
  artifactStoreId: string;
  artifactStoreBucketId: string;
  unifiedPortRevision: string;
  unifiedReaderRevision: string;
  noFallbackRegistryRevision: string;
}

export interface RegistrarArtifactReadback {
  artifactRef: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: string;
  storeId: string;
  bucketId: string;
  adapterRevision: string;
  bytes: Uint8Array;
}

export interface RegistrarActivationArtifactStorePort {
  readActualBytes(artifactRef: string): Promise<RegistrarArtifactReadback>;
}

export interface MasterSignatureVerificationResult {
  verified: boolean;
  issuerRole: string;
  trustStoreRevision: string;
  signerKeyId: string;
  algorithm: string;
}

export interface RegistrarMasterSignatureVerificationPort {
  verifyMasterSignature(input: {
    manifestBytes: Uint8Array;
    manifestArtifactSha256: string;
    signingReceipt: WorkItemRegistrarMasterSigningReceipt;
  }): Promise<MasterSignatureVerificationResult>;
  verifyValidationWriteSignature(input: {
    decisionBytes: Uint8Array;
    decisionArtifactSha256: string;
    signingReceipt: WorkItemRegistrarValidationWriteSigningReceipt;
  }): Promise<MasterSignatureVerificationResult>;
}

export interface RegistrarValidationWriteAuthorizationSourcePort {
  resolveCurrentAuthorization(input: {
    activationId: string;
    activationRevision: number;
    activationManifestArtifactRef: string;
    activationManifestArtifactSha256: string;
    operation: RegistrarMutationIntent['operation'];
    workItemId: string;
    actorId: string;
    businessActionId: string;
  }): Promise<WorkItemRegistrarValidationWriteBootstrap | null>;
}

export interface RegistrarSoleWriterPermissionReadback {
  tenantId: string;
  environmentId: string;
  baseToken: string;
  workItemsTableId: string;
  decisionsTableId: string;
  executionLogsTableId: string;
  servicePrincipalId: string;
  bindingRevision: string;
  bindingFingerprint: string;
  registrarMayWrite: boolean;
  browserMayWrite: boolean;
  ailyMayWrite: boolean;
  moduleMayWriteDirectly: boolean;
}

export interface RegistrarSoleWriterPermissionReadPort {
  readSoleWriterPermission(input: {
    tenantId: string;
    environmentId: string;
    servicePrincipalId: string;
    baseToken: string;
  }): Promise<RegistrarSoleWriterPermissionReadback>;
}

export interface RegistrarActivationPorts {
  artifactStore: RegistrarActivationArtifactStorePort;
  masterSignature: RegistrarMasterSignatureVerificationPort;
  soleWriterPermission: RegistrarSoleWriterPermissionReadPort;
  validationWriteAuthorization: RegistrarValidationWriteAuthorizationSourcePort;
}

export interface RegistrarMutationIntent {
  operation:
    | 'CREATE_WORK_ITEM'
    | 'TRANSITION_WORK_ITEM'
    | 'APPEND_ENGINEER_DECISION';
  workItemId: string;
  inputManifestRef?: string;
  inputManifestSha256?: string;
  authenticatedActor: RegistrarAuthenticatedActorIdentity;
  businessAction: RegistrarBusinessActionIdentity;
}

/**
 * The host adapter constructs this value from its authenticated server context.
 * It is deliberately a separate argument from every user-supplied command body.
 */
export interface RegistrarAuthenticatedActorIdentity {
  actorId: string;
  principalKind: 'HUMAN_USER' | 'HOSTED_SERVICE';
  tenantId: string;
  sessionId: string;
  authenticationRevision: string;
  authenticationContextRef: string;
  authenticationContextHash: string;
}

/** Exact immutable identity of the one business action authorized by Master. */
export interface RegistrarBusinessActionIdentity {
  operation: RegistrarMutationIntent['operation'];
  actionType: string;
  actionId: string;
  actionRevision: number;
  actionArtifactRef: string;
  actionArtifactHash: string;
}

export interface WorkItemRegistrarActivationReadiness {
  schemaVersion: typeof WORK_ITEM_REGISTRAR_READINESS_SCHEMA;
  status: 'READY' | 'BLOCKED';
  writeAuthorized: boolean;
  writeAuthorizationRequired: boolean;
  source: 'UNCONFIGURED' | 'MASTER_SIGNED_ARTIFACT_READBACK';
  blockerCodes: string[];
  activationId: string | null;
  activationRevision: number | null;
  manifestArtifactRef: string | null;
  manifestArtifactSha256: string | null;
  signingReceiptArtifactRef: string | null;
  signingReceiptArtifactSha256: string | null;
  expiresAt: number | null;
  bindings: {
    hostedDeploymentId: string | null;
    tenantId: string | null;
    environmentId: string | null;
    roleResolutionRevision: string | null;
    roleResolutionFingerprint: string | null;
    serviceIdentity: typeof SERVICE_IDENTITY;
    servicePrincipalId: string | null;
    baseToken: typeof STORE_IDENTITY.baseToken;
    workItemsTableId: typeof STORE_IDENTITY.workItemsTableId;
    decisionsTableId: typeof STORE_IDENTITY.decisionsTableId;
    executionLogsTableId: typeof STORE_IDENTITY.executionLogsTableId;
    artifactStoreRole: typeof ARTIFACT_STORE_ROLE;
    artifactStoreId: string | null;
    packageRevision: typeof ACCEPTED_PACKAGE_REVISION;
    u0ValidatorCommit: typeof U0_VALIDATOR_COMMIT;
    u0ValidatorManifestSha256: typeof U0_MANIFEST_SHA256;
    unifiedPortRevision: string | null;
    unifiedReaderRevision: string | null;
    aeoSpecialistPortRevision: typeof AEO_PORT_REVISION;
    aeoValidationPurpose: typeof AEO_PURPOSE;
  };
  nonClaims: string[];
}

export interface WorkItemRegistrarActivationAuthority {
  assertAuthorized(intent: RegistrarMutationIntent): Promise<void>;
  readiness(): WorkItemRegistrarActivationReadiness;
}

export interface WorkItemRegistrarActivationLoadResult {
  authority: WorkItemRegistrarActivationAuthority;
  diagnostic: WorkItemRegistrarActivationReadiness;
}

export class UnconfiguredWorkItemRegistrarActivationAuthority implements WorkItemRegistrarActivationAuthority {
  constructor(
    private readonly blockerCodes: string[] = ['CANONICAL_ROLE_NOT_VERIFIED'],
  ) {}

  async assertAuthorized(_intent: RegistrarMutationIntent): Promise<never> {
    return fail(this.blockerCodes[0] ?? 'CANONICAL_ROLE_NOT_VERIFIED');
  }

  readiness(): WorkItemRegistrarActivationReadiness {
    return blockedReadiness(this.blockerCodes);
  }
}

class MasterSignedWorkItemRegistrarActivationAuthority implements WorkItemRegistrarActivationAuthority {
  private constructor(
    private readonly manifest: WorkItemRegistrarActivationManifest,
    private readonly bootstrap: WorkItemRegistrarActivationBootstrap,
    private readonly ports: RegistrarActivationPorts,
    private readonly runtime: WorkItemRegistrarRuntimeBinding,
    private readonly diagnostic: WorkItemRegistrarActivationReadiness,
    private readonly now: () => number,
  ) {}

  static create(
    manifest: WorkItemRegistrarActivationManifest,
    bootstrap: WorkItemRegistrarActivationBootstrap,
    ports: RegistrarActivationPorts,
    runtime: WorkItemRegistrarRuntimeBinding,
    now: () => number,
  ): MasterSignedWorkItemRegistrarActivationAuthority {
    return new MasterSignedWorkItemRegistrarActivationAuthority(
      manifest,
      bootstrap,
      ports,
      runtime,
      readyReadiness(manifest, bootstrap),
      now,
    );
  }

  async assertAuthorized(intent: RegistrarMutationIntent): Promise<void> {
    const now = this.now();
    if (now < this.manifest.issuedAt) fail('REGISTRAR_ACTIVATION_NOT_YET_VALID');
    if (now >= this.manifest.expiresAt) fail('REGISTRAR_ACTIVATION_EXPIRED');
    await assertFreshValidationWriteAuthorization({
      manifest: this.manifest,
      bootstrap: this.bootstrap,
      runtime: this.runtime,
      ports: this.ports,
      intent,
      now,
    });
  }

  readiness(): WorkItemRegistrarActivationReadiness {
    if (this.now() >= this.manifest.expiresAt) {
      return {
        ...this.diagnostic,
        status: 'BLOCKED',
        writeAuthorized: false,
        blockerCodes: ['REGISTRAR_ACTIVATION_EXPIRED'],
      };
    }
    return this.diagnostic;
  }
}

class BlockedWorkItemRegistrarActivationAuthority implements WorkItemRegistrarActivationAuthority {
  constructor(private readonly diagnostic: WorkItemRegistrarActivationReadiness) {}

  async assertAuthorized(_intent: RegistrarMutationIntent): Promise<never> {
    return fail(this.diagnostic.blockerCodes[0] ?? 'CANONICAL_ROLE_NOT_VERIFIED');
  }

  readiness(): WorkItemRegistrarActivationReadiness {
    return this.diagnostic;
  }
}

export async function loadMasterSignedWorkItemRegistrarActivation(input: {
  bootstrap: WorkItemRegistrarActivationBootstrap;
  runtime: WorkItemRegistrarRuntimeBinding;
  ports: RegistrarActivationPorts;
  now?: () => number;
}): Promise<WorkItemRegistrarActivationLoadResult> {
  const now = input.now ?? Date.now;
  try {
    assertArtifactBootstrap(input.bootstrap);
    const [manifestReadback, signingReadback] = await Promise.all([
      input.ports.artifactStore.readActualBytes(
        input.bootstrap.manifestArtifactRef,
      ),
      input.ports.artifactStore.readActualBytes(
        input.bootstrap.signingReceiptArtifactRef,
      ),
    ]);
    assertArtifactReadback(
      manifestReadback,
      input.bootstrap.manifestArtifactRef,
      input.bootstrap.manifestArtifactSha256,
      input.runtime,
      'MANIFEST',
    );
    assertArtifactReadback(
      signingReadback,
      input.bootstrap.signingReceiptArtifactRef,
      input.bootstrap.signingReceiptArtifactSha256,
      input.runtime,
      'SIGNING_RECEIPT',
    );
    const manifest = parseJsonArtifact<WorkItemRegistrarActivationManifest>(
      manifestReadback.bytes,
      'REGISTRAR_ACTIVATION_MANIFEST_JSON_INVALID',
    );
    const signingReceipt =
      parseJsonArtifact<WorkItemRegistrarMasterSigningReceipt>(
        signingReadback.bytes,
        'REGISTRAR_ACTIVATION_SIGNING_RECEIPT_JSON_INVALID',
      );
    assertManifest(manifest);
    assertSigningReceipt(
      signingReceipt,
      input.bootstrap,
      manifest,
    );
    assertRuntimeBinding(manifest, input.runtime);
    const [hostAcceptanceReadback, permissionReceiptReadback, schemaReceiptReadback] =
      await Promise.all([
        input.ports.artifactStore.readActualBytes(
          manifest.registrarHostAcceptanceReceipt.artifactRef,
        ),
        input.ports.artifactStore.readActualBytes(
          manifest.store.permissionReceipt.artifactRef,
        ),
        input.ports.artifactStore.readActualBytes(
          manifest.store.schemaReceipt.artifactRef,
        ),
      ]);
    assertArtifactReadback(
      hostAcceptanceReadback,
      manifest.registrarHostAcceptanceReceipt.artifactRef,
      manifest.registrarHostAcceptanceReceipt.artifactSha256,
      input.runtime,
      'HOST_ACCEPTANCE_RECEIPT',
    );
    if (
      hostAcceptanceReadback.byteLength !==
        manifest.registrarHostAcceptanceReceipt.byteLength ||
      hostAcceptanceReadback.mediaType !==
        manifest.registrarHostAcceptanceReceipt.mediaType
    ) {
      fail('REGISTRAR_HOST_ACCEPTANCE_RECEIPT_METADATA_MISMATCH');
    }
    assertArtifactReadback(
      permissionReceiptReadback,
      manifest.store.permissionReceipt.artifactRef,
      manifest.store.permissionReceipt.artifactSha256,
      input.runtime,
      'PERMISSION_RECEIPT',
    );
    assertArtifactReadback(
      schemaReceiptReadback,
      manifest.store.schemaReceipt.artifactRef,
      manifest.store.schemaReceipt.artifactSha256,
      input.runtime,
      'SCHEMA_RECEIPT',
    );
    const hostAcceptanceReceipt = parseJsonArtifact<Record<string, unknown>>(
      hostAcceptanceReadback.bytes,
      'REGISTRAR_HOST_ACCEPTANCE_RECEIPT_JSON_INVALID',
    );
    if (
      hostAcceptanceReceipt.schemaVersion !==
        manifest.registrarHostAcceptanceReceipt.schemaVersion ||
      hostAcceptanceReceipt.receiptId !==
        manifest.registrarHostAcceptanceReceipt.receiptId ||
      hostAcceptanceReceipt.canonicalHash !==
        manifest.registrarHostAcceptanceReceipt.canonicalHash ||
      hostAcceptanceReceipt.ownerServiceIdentity !== SERVICE_IDENTITY ||
      hostAcceptanceReceipt.ownerServicePrincipalId !==
        manifest.writer.servicePrincipalId
    ) {
      fail('REGISTRAR_HOST_ACCEPTANCE_RECEIPT_IDENTITY_MISMATCH');
    }
    const signature = await input.ports.masterSignature.verifyMasterSignature({
      manifestBytes: manifestReadback.bytes,
      manifestArtifactSha256: manifestReadback.artifactSha256,
      signingReceipt,
    });
    assertMasterSignature(signature, manifest, signingReceipt);
    const soleWriter =
      await input.ports.soleWriterPermission.readSoleWriterPermission({
        tenantId: manifest.host.tenantId,
        environmentId: manifest.host.environmentId,
        servicePrincipalId: manifest.writer.servicePrincipalId,
        baseToken: manifest.store.baseToken,
      });
    assertSoleWriterPermission(soleWriter, manifest);
    if (now() < manifest.issuedAt) fail('REGISTRAR_ACTIVATION_NOT_YET_VALID');
    if (now() >= manifest.expiresAt) fail('REGISTRAR_ACTIVATION_EXPIRED');
    const authority =
      MasterSignedWorkItemRegistrarActivationAuthority.create(
        manifest,
        input.bootstrap,
        input.ports,
        input.runtime,
        now,
      );
    return { authority, diagnostic: authority.readiness() };
  } catch (error) {
    const blocker = conflictCode(error);
    const diagnostic = blockedReadiness([blocker]);
    return {
      authority: new BlockedWorkItemRegistrarActivationAuthority(diagnostic),
      diagnostic,
    };
  }
}

function assertArtifactBootstrap(
  bootstrap: WorkItemRegistrarActivationBootstrap,
): void {
  assertNonEmpty(bootstrap.manifestArtifactRef, 'MANIFEST_ARTIFACT_REF');
  assertRawHash(
    bootstrap.manifestArtifactSha256,
    'MANIFEST_ARTIFACT_SHA256',
  );
  assertNonEmpty(
    bootstrap.signingReceiptArtifactRef,
    'SIGNING_RECEIPT_ARTIFACT_REF',
  );
  assertRawHash(
    bootstrap.signingReceiptArtifactSha256,
    'SIGNING_RECEIPT_ARTIFACT_SHA256',
  );
}

function assertArtifactReadback(
  readback: RegistrarArtifactReadback,
  expectedRef: string,
  expectedHash: string,
  runtime: WorkItemRegistrarRuntimeBinding,
  kind: string,
): void {
  const actualHash = createHash('sha256').update(readback.bytes).digest('hex');
  if (
    readback.artifactRef !== expectedRef ||
    readback.artifactSha256 !== expectedHash ||
    actualHash !== expectedHash ||
    readback.byteLength !== readback.bytes.byteLength ||
    readback.mediaType !== 'application/json' ||
    readback.storeId !== runtime.artifactStoreId ||
    readback.bucketId !== runtime.artifactStoreBucketId ||
    readback.adapterRevision !== runtime.artifactStoreAdapterRevision
  ) {
    fail(`REGISTRAR_${kind}_ACTUAL_BYTE_READBACK_MISMATCH`);
  }
}

function assertManifest(manifest: WorkItemRegistrarActivationManifest): void {
  if (
    manifest.schemaVersion !== WORK_ITEM_REGISTRAR_ACTIVATION_MANIFEST_SCHEMA
  ) {
    fail('REGISTRAR_ACTIVATION_SCHEMA_UNSUPPORTED');
  }
  if (manifest.status !== 'ACTIVE' || manifest.environment !== 'VALIDATION') {
    fail('REGISTRAR_ACTIVATION_STATUS_INVALID');
  }
  if (manifest.purpose !== VALIDATION_PURPOSE) {
    fail('REGISTRAR_ACTIVATION_PURPOSE_INVALID');
  }
  assertPositiveInteger(manifest.activationRevision, 'ACTIVATION_REVISION');
  assertNonEmpty(manifest.activationId, 'ACTIVATION_ID');
  for (const [field, value] of Object.entries(manifest.host)) {
    assertNonEmpty(value, `HOST_${field.toUpperCase()}`);
  }
  assertNonEmpty(manifest.roleResolution.revision, 'ROLE_RESOLUTION_REVISION');
  assertPrefixedHash(
    manifest.roleResolution.fingerprint,
    'ROLE_RESOLUTION_FINGERPRINT',
  );
  if (
    manifest.store.baseToken !== STORE_IDENTITY.baseToken ||
    manifest.store.workItemsTableId !== STORE_IDENTITY.workItemsTableId ||
    manifest.store.decisionsTableId !== STORE_IDENTITY.decisionsTableId ||
    manifest.store.executionLogsTableId !== STORE_IDENTITY.executionLogsTableId
  ) {
    fail('REGISTRAR_ACTIVATION_STORE_IDENTITY_MISMATCH');
  }
  assertArtifactPointer(manifest.store.permissionReceipt, 'PERMISSION_RECEIPT');
  assertArtifactPointer(manifest.store.schemaReceipt, 'SCHEMA_RECEIPT');
  if (manifest.writer.serviceIdentity !== SERVICE_IDENTITY) {
    fail('REGISTRAR_ACTIVATION_SERVICE_IDENTITY_INVALID');
  }
  assertNonEmpty(manifest.writer.servicePrincipalId, 'SERVICE_PRINCIPAL_ID');
  assertNonEmpty(
    manifest.writer.soleWriterBindingRevision,
    'SOLE_WRITER_BINDING_REVISION',
  );
  assertPrefixedHash(
    manifest.writer.soleWriterBindingFingerprint,
    'SOLE_WRITER_BINDING_FINGERPRINT',
  );
  if (manifest.artifactStore.role !== ARTIFACT_STORE_ROLE) {
    fail('REGISTRAR_ARTIFACT_STORE_ROLE_INVALID');
  }
  for (const [field, value] of Object.entries(manifest.artifactStore)) {
    if (field === 'permissionSnapshotHash') {
      assertPrefixedHash(value, 'ARTIFACT_STORE_PERMISSION_SNAPSHOT_HASH');
    } else {
      assertNonEmpty(value, `ARTIFACT_STORE_${field.toUpperCase()}`);
    }
  }
  if (manifest.masterAuthority.issuerRole !== MASTER_ROLE) {
    fail('REGISTRAR_MASTER_AUTHORITY_INVALID');
  }
  assertNonEmpty(
    manifest.masterAuthority.trustStoreRevision,
    'MASTER_TRUST_STORE_REVISION',
  );
  assertNonEmpty(manifest.masterAuthority.signerKeyId, 'MASTER_SIGNER_KEY_ID');
  assertR1Pins(manifest.r1Pins);
  assertArtifactPointer(
    manifest.registrarHostAcceptanceReceipt,
    'HOST_ACCEPTANCE_RECEIPT',
  );
  if (
    manifest.registrarHostAcceptanceReceipt.ownerServiceIdentity !==
      SERVICE_IDENTITY ||
    manifest.registrarHostAcceptanceReceipt.ownerServicePrincipalId !==
      manifest.writer.servicePrincipalId
  ) {
    fail('REGISTRAR_HOST_ACCEPTANCE_RECEIPT_OWNER_MISMATCH');
  }
  assertNonEmpty(
    manifest.registrarHostAcceptanceReceipt.schemaVersion,
    'HOST_ACCEPTANCE_RECEIPT_SCHEMA_VERSION',
  );
  assertNonEmpty(
    manifest.registrarHostAcceptanceReceipt.receiptId,
    'HOST_ACCEPTANCE_RECEIPT_ID',
  );
  assertPrefixedHash(
    manifest.registrarHostAcceptanceReceipt.canonicalHash,
    'HOST_ACCEPTANCE_RECEIPT_CANONICAL_HASH',
  );
  assertParsedPackageAcceptanceReceiptOwner(
    manifest.parsedPackageAcceptanceReceiptOwner,
  );
  if (
    manifest.parsedPackageReceiptThinIndex.workItemRefField !==
      'accepted_result_ref' ||
    manifest.parsedPackageReceiptThinIndex.workItemHashField !==
      'accepted_result_sha256' ||
    manifest.parsedPackageReceiptThinIndex.packageArtifactRefField !==
      'parsed_package_artifact_ref' ||
    manifest.parsedPackageReceiptThinIndex.packageArtifactHashField !==
      'parsed_package_artifact_sha256' ||
    manifest.parsedPackageReceiptThinIndex.ownerMayMutateWorkItem !== false
  ) {
    fail('PARSED_PACKAGE_RECEIPT_THIN_INDEX_MAPPING_MISMATCH');
  }
  if (
    !Number.isSafeInteger(manifest.issuedAt) ||
    !Number.isSafeInteger(manifest.expiresAt) ||
    manifest.issuedAt >= manifest.expiresAt
  ) {
    fail('REGISTRAR_ACTIVATION_WINDOW_INVALID');
  }
}

function assertR1Pins(
  pins: WorkItemRegistrarActivationManifest['r1Pins'],
): void {
  if (
    pins.packageSchema !== ACCEPTED_PACKAGE_SCHEMA ||
    pins.packageRevision !== ACCEPTED_PACKAGE_REVISION ||
    pins.u0ValidatorCommit !== U0_VALIDATOR_COMMIT ||
    pins.u0ValidatorManifestSha256 !== U0_MANIFEST_SHA256 ||
    pins.unifiedHostSourceBaselineCommit !== UNIFIED_HOST_BASELINE ||
    pins.aeoSpecialistPortRevision !== AEO_PORT_REVISION ||
    pins.aeoSpecialistPortToken !== AEO_PORT_TOKEN ||
    pins.aeoValidationPurpose !== AEO_PURPOSE ||
    Object.hasOwn(pins, 'aeoScope')
  ) {
    fail('REGISTRAR_R1_PIN_MISMATCH');
  }
  assertCommit(pins.unifiedPortRevision, 'UNIFIED_PORT_REVISION');
  assertNonEmpty(pins.unifiedReaderRevision, 'UNIFIED_READER_REVISION');
  assertNonEmpty(
    pins.noFallbackRegistryRevision,
    'NO_FALLBACK_REGISTRY_REVISION',
  );
}

export function assertParsedPackageAcceptanceReceiptOwner(
  owner: WorkItemRegistrarActivationManifest['parsedPackageAcceptanceReceiptOwner'],
): void {
  if (
    owner.sourceCommit !== PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER.sourceCommit ||
    owner.token !== PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER.token ||
    owner.revision !== PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER.revision ||
    owner.fingerprint !== PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER.fingerprint
  ) {
    fail('PARSED_PACKAGE_ACCEPTANCE_RECEIPT_OWNER_IDENTITY_MISMATCH');
  }
}

function assertSigningReceipt(
  receipt: WorkItemRegistrarMasterSigningReceipt,
  bootstrap: WorkItemRegistrarActivationBootstrap,
  manifest: WorkItemRegistrarActivationManifest,
): void {
  if (
    receipt.schemaVersion !== WORK_ITEM_REGISTRAR_SIGNING_RECEIPT_SCHEMA ||
    receipt.status !== 'MASTER_SIGNED' ||
    receipt.issuerRole !== MASTER_ROLE
  ) {
    fail('REGISTRAR_MASTER_SIGNING_RECEIPT_INVALID');
  }
  if (
    receipt.manifestArtifactRef !== bootstrap.manifestArtifactRef ||
    receipt.manifestArtifactSha256 !== bootstrap.manifestArtifactSha256 ||
    receipt.registrarHostAcceptanceReceiptArtifactRef !==
      manifest.registrarHostAcceptanceReceipt.artifactRef ||
    receipt.registrarHostAcceptanceReceiptArtifactSha256 !==
      manifest.registrarHostAcceptanceReceipt.artifactSha256 ||
    receipt.trustStoreRevision !==
      manifest.masterAuthority.trustStoreRevision ||
    receipt.signerKeyId !== manifest.masterAuthority.signerKeyId ||
    receipt.issuedAt !== manifest.issuedAt ||
    receipt.expiresAt !== manifest.expiresAt
  ) {
    fail('REGISTRAR_MASTER_SIGNING_RECEIPT_BINDING_MISMATCH');
  }
  assertNonEmpty(receipt.receiptId, 'MASTER_SIGNING_RECEIPT_ID');
  assertNonEmpty(receipt.algorithm, 'MASTER_SIGNING_ALGORITHM');
  assertNonEmpty(receipt.signature, 'MASTER_SIGNATURE');
}

function assertMasterSignature(
  result: MasterSignatureVerificationResult,
  manifest: WorkItemRegistrarActivationManifest,
  receipt: WorkItemRegistrarMasterSigningReceipt,
): void {
  if (
    !result.verified ||
    result.issuerRole !== MASTER_ROLE ||
    result.trustStoreRevision !== manifest.masterAuthority.trustStoreRevision ||
    result.signerKeyId !== manifest.masterAuthority.signerKeyId ||
    result.algorithm !== receipt.algorithm
  ) {
    fail('REGISTRAR_MASTER_SIGNATURE_NOT_VERIFIED');
  }
}

function assertSoleWriterPermission(
  readback: RegistrarSoleWriterPermissionReadback,
  manifest: WorkItemRegistrarActivationManifest,
): void {
  if (
    readback.tenantId !== manifest.host.tenantId ||
    readback.environmentId !== manifest.host.environmentId ||
    readback.baseToken !== manifest.store.baseToken ||
    readback.workItemsTableId !== manifest.store.workItemsTableId ||
    readback.decisionsTableId !== manifest.store.decisionsTableId ||
    readback.executionLogsTableId !== manifest.store.executionLogsTableId ||
    readback.servicePrincipalId !== manifest.writer.servicePrincipalId ||
    readback.bindingRevision !== manifest.writer.soleWriterBindingRevision ||
    readback.bindingFingerprint !==
      manifest.writer.soleWriterBindingFingerprint ||
    readback.registrarMayWrite !== true ||
    readback.browserMayWrite !== false ||
    readback.ailyMayWrite !== false ||
    readback.moduleMayWriteDirectly !== false
  ) {
    fail('REGISTRAR_SOLE_WRITER_POLICY_INVALID');
  }
}

function assertRuntimeBinding(
  manifest: WorkItemRegistrarActivationManifest,
  runtime: WorkItemRegistrarRuntimeBinding,
): void {
  if (
    runtime.miaodaAppId !== manifest.host.miaodaAppId ||
    runtime.hostedDeploymentId !== manifest.host.hostedDeploymentId ||
    runtime.tenantId !== manifest.host.tenantId ||
    runtime.environmentId !== manifest.host.environmentId ||
    runtime.serviceIdentity !== manifest.writer.serviceIdentity ||
    runtime.servicePrincipalId !== manifest.writer.servicePrincipalId ||
    runtime.baseToken !== manifest.store.baseToken ||
    runtime.workItemsTableId !== manifest.store.workItemsTableId ||
    runtime.decisionsTableId !== manifest.store.decisionsTableId ||
    runtime.executionLogsTableId !== manifest.store.executionLogsTableId ||
    runtime.artifactStoreAdapterRevision !==
      manifest.artifactStore.adapterRevision ||
    runtime.artifactStoreId !== manifest.artifactStore.storeId ||
    runtime.artifactStoreBucketId !== manifest.artifactStore.bucketId ||
    runtime.unifiedPortRevision !== manifest.r1Pins.unifiedPortRevision ||
    runtime.unifiedReaderRevision !== manifest.r1Pins.unifiedReaderRevision ||
    runtime.noFallbackRegistryRevision !==
      manifest.r1Pins.noFallbackRegistryRevision
  ) {
    fail('REGISTRAR_RUNTIME_BINDING_MISMATCH');
  }
}

async function assertFreshValidationWriteAuthorization(input: {
  manifest: WorkItemRegistrarActivationManifest;
  bootstrap: WorkItemRegistrarActivationBootstrap;
  runtime: WorkItemRegistrarRuntimeBinding;
  ports: RegistrarActivationPorts;
  intent: RegistrarMutationIntent;
  now: number;
}): Promise<void> {
  const authorizationBootstrap =
    await input.ports.validationWriteAuthorization.resolveCurrentAuthorization({
      activationId: input.manifest.activationId,
      activationRevision: input.manifest.activationRevision,
      activationManifestArtifactRef: input.bootstrap.manifestArtifactRef,
      activationManifestArtifactSha256:
        input.bootstrap.manifestArtifactSha256,
      operation: input.intent.operation,
      workItemId: input.intent.workItemId,
      actorId: input.intent.authenticatedActor.actorId,
      businessActionId: input.intent.businessAction.actionId,
    });
  if (!authorizationBootstrap) {
    fail('REGISTRAR_VALIDATION_WRITE_AUTHORIZATION_NOT_ISSUED');
  }
  assertValidationWriteBootstrap(authorizationBootstrap);
  const [decisionReadback, receiptReadback] = await Promise.all([
    input.ports.artifactStore.readActualBytes(
      authorizationBootstrap.decisionArtifactRef,
    ),
    input.ports.artifactStore.readActualBytes(
      authorizationBootstrap.signingReceiptArtifactRef,
    ),
  ]);
  assertArtifactReadback(
    decisionReadback,
    authorizationBootstrap.decisionArtifactRef,
    authorizationBootstrap.decisionArtifactSha256,
    input.runtime,
    'VALIDATION_WRITE_DECISION',
  );
  assertArtifactReadback(
    receiptReadback,
    authorizationBootstrap.signingReceiptArtifactRef,
    authorizationBootstrap.signingReceiptArtifactSha256,
    input.runtime,
    'VALIDATION_WRITE_SIGNING_RECEIPT',
  );
  const decision = parseJsonArtifact<WorkItemRegistrarValidationWriteDecision>(
    decisionReadback.bytes,
    'REGISTRAR_VALIDATION_WRITE_DECISION_JSON_INVALID',
  );
  const receipt =
    parseJsonArtifact<WorkItemRegistrarValidationWriteSigningReceipt>(
      receiptReadback.bytes,
      'REGISTRAR_VALIDATION_WRITE_SIGNING_RECEIPT_JSON_INVALID',
    );
  assertValidationWriteDecision(
    decision,
    input.manifest,
    input.bootstrap,
    input.intent,
    input.now,
  );
  assertValidationWriteReceipt(
    receipt,
    authorizationBootstrap,
    decision,
    input.manifest,
    input.bootstrap,
  );
  const signature =
    await input.ports.masterSignature.verifyValidationWriteSignature({
      decisionBytes: decisionReadback.bytes,
      decisionArtifactSha256: decisionReadback.artifactSha256,
      signingReceipt: receipt,
    });
  assertValidationWriteSignature(signature, input.manifest, receipt);
}

function assertValidationWriteBootstrap(
  bootstrap: WorkItemRegistrarValidationWriteBootstrap,
): void {
  assertNonEmpty(
    bootstrap.decisionArtifactRef,
    'VALIDATION_WRITE_DECISION_ARTIFACT_REF',
  );
  assertRawHash(
    bootstrap.decisionArtifactSha256,
    'VALIDATION_WRITE_DECISION_ARTIFACT_SHA256',
  );
  assertNonEmpty(
    bootstrap.signingReceiptArtifactRef,
    'VALIDATION_WRITE_SIGNING_RECEIPT_ARTIFACT_REF',
  );
  assertRawHash(
    bootstrap.signingReceiptArtifactSha256,
    'VALIDATION_WRITE_SIGNING_RECEIPT_ARTIFACT_SHA256',
  );
}

function assertValidationWriteDecision(
  decision: WorkItemRegistrarValidationWriteDecision,
  manifest: WorkItemRegistrarActivationManifest,
  bootstrap: WorkItemRegistrarActivationBootstrap,
  intent: RegistrarMutationIntent,
  now: number,
): void {
  if (
    decision.schemaVersion !==
      WORK_ITEM_REGISTRAR_VALIDATION_WRITE_DECISION_SCHEMA ||
    decision.status !== 'AUTHORIZED' ||
    decision.environment !== 'VALIDATION' ||
    decision.purpose !== VALIDATION_PURPOSE ||
    decision.issuerRole !== MASTER_ROLE
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_DECISION_INVALID');
  }
  assertNonEmpty(decision.decisionId, 'VALIDATION_WRITE_DECISION_ID');
  assertPositiveInteger(
    decision.decisionRevision,
    'VALIDATION_WRITE_DECISION_REVISION',
  );
  if (
    decision.activation.activationId !== manifest.activationId ||
    decision.activation.activationRevision !== manifest.activationRevision ||
    decision.activation.manifestArtifactRef !== bootstrap.manifestArtifactRef ||
    decision.activation.manifestArtifactSha256 !==
      bootstrap.manifestArtifactSha256
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_ACTIVATION_BINDING_MISMATCH');
  }
  if (decision.authorization.workItemId !== intent.workItemId) {
    fail('REGISTRAR_WORK_ITEM_NOT_AUTHORIZED');
  }
  assertAuthenticatedActorIdentity(intent.authenticatedActor);
  assertAuthenticatedActorIdentity(decision.authorization.authenticatedActor);
  if (!sameAuthenticatedActor(
    decision.authorization.authenticatedActor,
    intent.authenticatedActor,
  )) {
    fail('REGISTRAR_AUTHENTICATED_ACTOR_NOT_AUTHORIZED');
  }
  assertBusinessActionIdentity(intent.businessAction);
  for (const action of decision.authorization.businessActions) {
    assertBusinessActionIdentity(action);
  }
  if (
    !decision.authorization.businessActions.some((action) =>
      sameBusinessAction(action, intent.businessAction),
    )
  ) {
    fail('REGISTRAR_BUSINESS_ACTION_NOT_AUTHORIZED');
  }
  assertNonEmpty(
    decision.authorization.userAuthorizationRef,
    'VALIDATION_WRITE_USER_AUTHORIZATION_REF',
  );
  assertPrefixedHash(
    decision.authorization.userAuthorizationHash,
    'VALIDATION_WRITE_USER_AUTHORIZATION_HASH',
  );
  assertNonEmpty(
    decision.authorization.initialInputManifestRef,
    'VALIDATION_WRITE_INITIAL_INPUT_MANIFEST_REF',
  );
  assertPrefixedHash(
    decision.authorization.initialInputManifestSha256,
    'VALIDATION_WRITE_INITIAL_INPUT_MANIFEST_SHA256',
  );
  if (
    intent.operation === 'CREATE_WORK_ITEM' &&
    (intent.inputManifestRef !==
      decision.authorization.initialInputManifestRef ||
      intent.inputManifestSha256 !==
        decision.authorization.initialInputManifestSha256)
  ) {
    fail('REGISTRAR_INITIAL_MANIFEST_IDENTITY_MISMATCH');
  }
  if (
    !Number.isSafeInteger(decision.issuedAt) ||
    !Number.isSafeInteger(decision.expiresAt) ||
    decision.issuedAt >= decision.expiresAt
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_WINDOW_INVALID');
  }
  if (now < decision.issuedAt) {
    fail('REGISTRAR_VALIDATION_WRITE_NOT_YET_VALID');
  }
  if (now >= decision.expiresAt) {
    fail('REGISTRAR_VALIDATION_WRITE_EXPIRED');
  }
  if (
    decision.issuedAt < manifest.issuedAt ||
    decision.expiresAt > manifest.expiresAt
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_OUTSIDE_ACTIVATION_WINDOW');
  }
}

function assertAuthenticatedActorIdentity(
  actor: RegistrarAuthenticatedActorIdentity,
): void {
  assertNonEmpty(actor.actorId, 'AUTHENTICATED_ACTOR_ID');
  if (actor.principalKind !== 'HUMAN_USER' && actor.principalKind !== 'HOSTED_SERVICE') {
    fail('REGISTRAR_AUTHENTICATED_ACTOR_KIND_INVALID');
  }
  assertNonEmpty(actor.tenantId, 'AUTHENTICATED_ACTOR_TENANT_ID');
  assertNonEmpty(actor.sessionId, 'AUTHENTICATED_ACTOR_SESSION_ID');
  assertNonEmpty(
    actor.authenticationRevision,
    'AUTHENTICATED_ACTOR_AUTHENTICATION_REVISION',
  );
  assertNonEmpty(
    actor.authenticationContextRef,
    'AUTHENTICATED_ACTOR_AUTHENTICATION_CONTEXT_REF',
  );
  assertPrefixedHash(
    actor.authenticationContextHash,
    'AUTHENTICATED_ACTOR_AUTHENTICATION_CONTEXT_HASH',
  );
}

function sameAuthenticatedActor(
  expected: RegistrarAuthenticatedActorIdentity,
  actual: RegistrarAuthenticatedActorIdentity,
): boolean {
  return (
    expected.actorId === actual.actorId &&
    expected.principalKind === actual.principalKind &&
    expected.tenantId === actual.tenantId &&
    expected.sessionId === actual.sessionId &&
    expected.authenticationRevision === actual.authenticationRevision &&
    expected.authenticationContextRef === actual.authenticationContextRef &&
    expected.authenticationContextHash === actual.authenticationContextHash
  );
}

function assertBusinessActionIdentity(
  action: RegistrarBusinessActionIdentity,
): void {
  if (
    action.operation !== 'CREATE_WORK_ITEM' &&
    action.operation !== 'TRANSITION_WORK_ITEM' &&
    action.operation !== 'APPEND_ENGINEER_DECISION'
  ) {
    fail('REGISTRAR_BUSINESS_ACTION_OPERATION_INVALID');
  }
  assertNonEmpty(action.actionType, 'BUSINESS_ACTION_TYPE');
  assertNonEmpty(action.actionId, 'BUSINESS_ACTION_ID');
  assertPositiveInteger(action.actionRevision, 'BUSINESS_ACTION_REVISION');
  assertNonEmpty(action.actionArtifactRef, 'BUSINESS_ACTION_ARTIFACT_REF');
  assertPrefixedHash(action.actionArtifactHash, 'BUSINESS_ACTION_ARTIFACT_HASH');
}

function sameBusinessAction(
  expected: RegistrarBusinessActionIdentity,
  actual: RegistrarBusinessActionIdentity,
): boolean {
  return (
    expected.operation === actual.operation &&
    expected.actionType === actual.actionType &&
    expected.actionId === actual.actionId &&
    expected.actionRevision === actual.actionRevision &&
    expected.actionArtifactRef === actual.actionArtifactRef &&
    expected.actionArtifactHash === actual.actionArtifactHash
  );
}

function assertValidationWriteReceipt(
  receipt: WorkItemRegistrarValidationWriteSigningReceipt,
  authorizationBootstrap: WorkItemRegistrarValidationWriteBootstrap,
  decision: WorkItemRegistrarValidationWriteDecision,
  manifest: WorkItemRegistrarActivationManifest,
  activationBootstrap: WorkItemRegistrarActivationBootstrap,
): void {
  if (
    receipt.schemaVersion !==
      WORK_ITEM_REGISTRAR_VALIDATION_WRITE_RECEIPT_SCHEMA ||
    receipt.status !== 'MASTER_SIGNED' ||
    receipt.issuerRole !== MASTER_ROLE
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_SIGNING_RECEIPT_INVALID');
  }
  if (
    receipt.decisionArtifactRef !==
      authorizationBootstrap.decisionArtifactRef ||
    receipt.decisionArtifactSha256 !==
      authorizationBootstrap.decisionArtifactSha256 ||
    receipt.activationManifestArtifactRef !==
      activationBootstrap.manifestArtifactRef ||
    receipt.activationManifestArtifactSha256 !==
      activationBootstrap.manifestArtifactSha256 ||
    receipt.trustStoreRevision !==
      manifest.masterAuthority.trustStoreRevision ||
    receipt.signerKeyId !== manifest.masterAuthority.signerKeyId ||
    receipt.issuedAt !== decision.issuedAt ||
    receipt.expiresAt !== decision.expiresAt
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_RECEIPT_BINDING_MISMATCH');
  }
  assertNonEmpty(receipt.receiptId, 'VALIDATION_WRITE_SIGNING_RECEIPT_ID');
  assertNonEmpty(receipt.algorithm, 'VALIDATION_WRITE_SIGNING_ALGORITHM');
  assertNonEmpty(receipt.signature, 'VALIDATION_WRITE_SIGNATURE');
}

function assertValidationWriteSignature(
  result: MasterSignatureVerificationResult,
  manifest: WorkItemRegistrarActivationManifest,
  receipt: WorkItemRegistrarValidationWriteSigningReceipt,
): void {
  if (
    !result.verified ||
    result.issuerRole !== MASTER_ROLE ||
    result.trustStoreRevision !== manifest.masterAuthority.trustStoreRevision ||
    result.signerKeyId !== manifest.masterAuthority.signerKeyId ||
    result.algorithm !== receipt.algorithm
  ) {
    fail('REGISTRAR_VALIDATION_WRITE_SIGNATURE_NOT_VERIFIED');
  }
}

function assertArtifactPointer(
  pointer: RegistrarArtifactPointer,
  field: string,
): void {
  assertNonEmpty(pointer.artifactRef, `${field}_ARTIFACT_REF`);
  assertRawHash(pointer.artifactSha256, `${field}_ARTIFACT_SHA256`);
  if (!Number.isSafeInteger(pointer.byteLength) || pointer.byteLength < 1) {
    fail(`REGISTRAR_ACTIVATION_${field}_BYTE_LENGTH_INVALID`);
  }
  if (pointer.mediaType !== 'application/json') {
    fail(`REGISTRAR_ACTIVATION_${field}_MEDIA_TYPE_INVALID`);
  }
}

function readyReadiness(
  manifest: WorkItemRegistrarActivationManifest,
  bootstrap: WorkItemRegistrarActivationBootstrap,
): WorkItemRegistrarActivationReadiness {
  return {
    schemaVersion: WORK_ITEM_REGISTRAR_READINESS_SCHEMA,
    status: 'READY',
    writeAuthorized: false,
    writeAuthorizationRequired: true,
    source: 'MASTER_SIGNED_ARTIFACT_READBACK',
    blockerCodes: [],
    activationId: manifest.activationId,
    activationRevision: manifest.activationRevision,
    manifestArtifactRef: bootstrap.manifestArtifactRef,
    manifestArtifactSha256: bootstrap.manifestArtifactSha256,
    signingReceiptArtifactRef: bootstrap.signingReceiptArtifactRef,
    signingReceiptArtifactSha256: bootstrap.signingReceiptArtifactSha256,
    expiresAt: manifest.expiresAt,
    bindings: {
      hostedDeploymentId: manifest.host.hostedDeploymentId,
      tenantId: manifest.host.tenantId,
      environmentId: manifest.host.environmentId,
      roleResolutionRevision: manifest.roleResolution.revision,
      roleResolutionFingerprint: manifest.roleResolution.fingerprint,
      serviceIdentity: SERVICE_IDENTITY,
      servicePrincipalId: manifest.writer.servicePrincipalId,
      baseToken: STORE_IDENTITY.baseToken,
      workItemsTableId: STORE_IDENTITY.workItemsTableId,
      decisionsTableId: STORE_IDENTITY.decisionsTableId,
      executionLogsTableId: STORE_IDENTITY.executionLogsTableId,
      artifactStoreRole: ARTIFACT_STORE_ROLE,
      artifactStoreId: manifest.artifactStore.storeId,
      packageRevision: ACCEPTED_PACKAGE_REVISION,
      u0ValidatorCommit: U0_VALIDATOR_COMMIT,
      u0ValidatorManifestSha256: U0_MANIFEST_SHA256,
      unifiedPortRevision: manifest.r1Pins.unifiedPortRevision,
      unifiedReaderRevision: manifest.r1Pins.unifiedReaderRevision,
      aeoSpecialistPortRevision: AEO_PORT_REVISION,
      aeoValidationPurpose: AEO_PURPOSE,
    },
    nonClaims: readinessNonClaims(),
  };
}

function blockedReadiness(
  blockerCodes: string[],
): WorkItemRegistrarActivationReadiness {
  return {
    schemaVersion: WORK_ITEM_REGISTRAR_READINESS_SCHEMA,
    status: 'BLOCKED',
    writeAuthorized: false,
    writeAuthorizationRequired: true,
    source: 'UNCONFIGURED',
    blockerCodes,
    activationId: null,
    activationRevision: null,
    manifestArtifactRef: null,
    manifestArtifactSha256: null,
    signingReceiptArtifactRef: null,
    signingReceiptArtifactSha256: null,
    expiresAt: null,
    bindings: {
      hostedDeploymentId: null,
      tenantId: null,
      environmentId: null,
      roleResolutionRevision: null,
      roleResolutionFingerprint: null,
      serviceIdentity: SERVICE_IDENTITY,
      servicePrincipalId: null,
      baseToken: STORE_IDENTITY.baseToken,
      workItemsTableId: STORE_IDENTITY.workItemsTableId,
      decisionsTableId: STORE_IDENTITY.decisionsTableId,
      executionLogsTableId: STORE_IDENTITY.executionLogsTableId,
      artifactStoreRole: ARTIFACT_STORE_ROLE,
      artifactStoreId: null,
      packageRevision: ACCEPTED_PACKAGE_REVISION,
      u0ValidatorCommit: U0_VALIDATOR_COMMIT,
      u0ValidatorManifestSha256: U0_MANIFEST_SHA256,
      unifiedPortRevision: null,
      unifiedReaderRevision: null,
      aeoSpecialistPortRevision: AEO_PORT_REVISION,
      aeoValidationPurpose: AEO_PURPOSE,
    },
    nonClaims: readinessNonClaims(),
  };
}

function readinessNonClaims(): string[] {
  return [
    'Readiness does not create a WorkItem, Decision or ExecutionLog.',
    'Hosted readiness never authorizes a mutation; each mutation requires a fresh master-signed validation-write decision.',
    'Readiness does not publish Miaoda or Aily.',
    'Readiness does not create an engineering conclusion.',
  ];
}

function parseJsonArtifact<T>(bytes: Uint8Array, code: string): T {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
  } catch {
    fail(code);
  }
}

function conflictCode(error: unknown): string {
  if (error instanceof ConflictException) {
    const response = error.getResponse();
    return typeof response === 'string'
      ? response
      : String((response as { message?: unknown }).message ?? 'CANONICAL_ROLE_NOT_VERIFIED');
  }
  return 'REGISTRAR_ACTIVATION_PORT_FAILURE';
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`REGISTRAR_ACTIVATION_${field}_INVALID`);
  }
}

function assertPrefixedHash(value: string, field: string): void {
  if (!PREFIXED_HASH.test(value)) {
    fail(`REGISTRAR_ACTIVATION_${field}_INVALID`);
  }
}

function assertRawHash(value: string, field: string): void {
  if (!RAW_SHA256.test(value)) {
    fail(`REGISTRAR_ACTIVATION_${field}_INVALID`);
  }
}

function assertCommit(value: string, field: string): void {
  if (!COMMIT.test(value)) {
    fail(`REGISTRAR_ACTIVATION_${field}_INVALID`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`REGISTRAR_ACTIVATION_${field}_INVALID`);
  }
}

function fail(code: string): never {
  throw new ConflictException(code);
}
