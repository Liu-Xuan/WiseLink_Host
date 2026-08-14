import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

import {
  AEO_HOSTED_PLATFORM_BINDING_VERSION,
  AEO_HOSTED_PLATFORM_ACTIVATION_VERSION,
  AEO_HOSTED_ACTIVATION_RECEIPT_VERSION,
  AEO_HOSTED_PLATFORM_READINESS_VERSION,
  AEO_UNIFIED_ACCEPTANCE_READER_PORT,
  AEO_UNIFIED_ACCEPTANCE_READER_REVISION,
  UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_TOKEN,
  UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_REVISION,
  UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_FINGERPRINT,
  WISELINK_3_1_AEO_VALIDATION_PURPOSE,
  WISELINK_3_1_R1_SELECTION_COMMIT,
  WISELINK_3_1_TECHPUB_PACKAGE_CONTRACT,
  WISELINK_3_1_U0_MANIFEST_SHA256,
  WISELINK_3_1_U0_VALIDATOR_COMMIT,
  WISELINK_3_1_UNIFIED_ACCEPTANCE_FACADE_REVISION,
  WISELINK_3_1_UNIFIED_ACCEPTANCE_RECEIPT_VERSION,
  WISELINK_3_1_UNIFIED_ACCEPTANCE_OWNED_RECEIPT_VERSION,
  WISELINK_3_1_UNIFIED_POST_VALIDATOR_RECEIPT_OWNER_COMMIT,
  WISELINK_3_1_UNIFIED_SOURCE_BASELINE_COMMIT,
  type AeoHostedActivationAuthorityVerification,
  type AeoHostedActivationReceipt,
  type AeoHostedPlatformActivationManifest,
  type AeoHostedPlatformBindingDescriptor,
  type AeoHostedPlatformPortName,
  type AeoHostedPlatformReadinessBlocker,
  type AeoHostedPlatformReadinessResult,
  type AeoRegistrarCommitReceipt,
  type AeoRegistrarCommitRequest,
  type AeoSimilarCandidateSummary,
  type AeoWorkItemReadModel,
  type AeoWorkItemReadRequest,
  type AeoArtifactPersistReceipt,
  type AeoArtifactIndexEntry,
} from '../../../shared/aeo-integration';

import {
  type AeoArtifactStorePort,
  type AeoHubRegistrarPort,
} from './aeo-artifact-action.service';
import {
  type AeoSimilarSearchPort,
  type AeoWorkItemReadPort,
} from './aeo-aily.service';
import {
  type AeoCanonicalRoleResolver,
  AeoWorkItemBindingService,
  UnresolvedAeoCanonicalRoleResolver,
} from './aeo-work-item-binding.service';
import { projectionError } from './aeo-editor-projection.utils';
import {
  canonicalStringify,
  compareText,
  isRecord,
  requireNonEmptyString,
  requirePrefixedSha256,
  requireSha256,
  sha256Prefixed,
} from './aeo-editor-projection.utils';
import type {
  AeoCanonicalRoleGateResult,
  AeoCanonicalRoleResolution,
} from '../../../shared/aeo-editor';

export const AEO_HOSTED_PLATFORM_PORT_BUNDLE = Symbol(
  'AEO_HOSTED_PLATFORM_PORT_BUNDLE',
);
export const AEO_HOSTED_ACTIVATION_AUTHORITY_PORT = Symbol(
  'AEO_HOSTED_ACTIVATION_AUTHORITY_PORT',
);

export interface AeoHostedActivationAuthorityPort {
  readReceiptActualBytes(): Promise<{
    artifactRef: string;
    artifactSha256: string;
    bytes: Uint8Array;
  }>;
  readActivationManifestActualBytes(artifactRef: string): Promise<Uint8Array>;
}

export class UnconfiguredAeoHostedActivationAuthorityPort implements AeoHostedActivationAuthorityPort {
  async readReceiptActualBytes(): Promise<never> {
    projectionError(
      'AEO_HOSTED_ACTIVATION_AUTHORITY_UNAVAILABLE',
      'WiseLink 3.1 主控尚未注入独立 activation receipt readback port。',
    );
  }

  async readActivationManifestActualBytes(
    _artifactRef: string,
  ): Promise<never> {
    projectionError(
      'AEO_HOSTED_ACTIVATION_AUTHORITY_UNAVAILABLE',
      'WiseLink 3.1 主控尚未注入 activation manifest actual-byte readback port。',
    );
  }
}

export const AEO_HOSTED_PLATFORM_PORT_NAMES = [
  'CANONICAL_ROLE_RESOLVER',
  'WORK_ITEM_READ',
  'SIMILAR_SEARCH',
  'ARTIFACT_STORE',
  'HUB_REGISTRAR',
  'U0_FULL_PACKAGE_VALIDATOR',
  'AEO_SPECIALIST_READER',
  'UNIFIED_ACCEPTANCE_FACADE',
  'IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER',
] as const satisfies readonly AeoHostedPlatformPortName[];

export const AEO_HOSTED_PLATFORM_EXPECTED_PORT_OWNERS = {
  CANONICAL_ROLE_RESOLVER: 'WiseLink3_1Master',
  WORK_ITEM_READ: 'CanonicalWorkItemStore',
  SIMILAR_SEARCH: 'AeoModule',
  ARTIFACT_STORE: 'CanonicalArtifactStore',
  HUB_REGISTRAR: 'CanonicalWorkItemStore',
  U0_FULL_PACKAGE_VALIDATOR: 'CanonicalUnifiedReader',
  AEO_SPECIALIST_READER: 'AeoModule',
  UNIFIED_ACCEPTANCE_FACADE: 'CanonicalUnifiedReader',
  IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER:
    'CanonicalUnifiedAcceptanceReceiptOwner',
} as const;

export interface AeoHostedPlatformPortBundle
  extends
    AeoCanonicalRoleResolver,
    AeoWorkItemReadPort,
    AeoSimilarSearchPort,
    AeoArtifactStorePort,
    AeoHubRegistrarPort {
  describe(): AeoHostedPlatformBindingDescriptor;
}

export class UnconfiguredAeoHostedPlatformPortBundle implements AeoHostedPlatformPortBundle {
  private readonly unresolved = new UnresolvedAeoCanonicalRoleResolver();

  describe(): AeoHostedPlatformBindingDescriptor {
    return {
      schemaVersion: AEO_HOSTED_PLATFORM_BINDING_VERSION,
      bindingId: 'UNCONFIGURED',
      bindingRevision: 'UNCONFIGURED',
      mode: 'UNCONFIGURED',
      activationManifest: null,
      activationManifestSha256: null,
      authority: 'BINDING_DESCRIPTOR_NOT_WRITE_AUTHORIZATION',
    };
  }

  resolveAll() {
    return this.unresolved.resolveAll();
  }

  async read(_request: AeoWorkItemReadRequest): Promise<AeoWorkItemReadModel> {
    projectionError(
      'CANONICAL_WORKITEM_READ_UNAVAILABLE',
      'AEO hosted platform bundle 尚未绑定 CanonicalWorkItemStore fresh-read。',
    );
  }

  async search(_request: {
    workItem: AeoWorkItemReadModel;
    query: string;
    sourceKinds?: AeoSimilarCandidateSummary['sourceKind'][];
  }): Promise<AeoSimilarCandidateSummary[]> {
    projectionError(
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      'AEO hosted platform bundle 尚未绑定候选知识检索。',
    );
  }

  async persistImmutable(_input: {
    workItemId: string;
    idempotencyKey: string;
    artifactKind: AeoArtifactIndexEntry['artifactKind'];
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<AeoArtifactPersistReceipt> {
    projectionError(
      'AEO_ARTIFACT_PERSIST_UNAVAILABLE',
      'AEO hosted platform bundle 尚未绑定 CanonicalArtifactStore persist。',
    );
  }

  async readActualBytes(_artifactRef: string): Promise<Uint8Array> {
    projectionError(
      'AEO_ARTIFACT_PERSIST_UNAVAILABLE',
      'AEO hosted platform bundle 尚未绑定 CanonicalArtifactStore readback。',
    );
  }

  async commitArtifact(
    _request: AeoRegistrarCommitRequest,
  ): Promise<AeoRegistrarCommitReceipt> {
    projectionError(
      'AEO_REGISTRAR_COMMIT_UNAVAILABLE',
      'AEO hosted platform bundle 尚未绑定唯一 Hub Registrar CAS。',
    );
  }
}

@Injectable()
export class AeoHostedPlatformReadinessService {
  constructor(
    private readonly binding: AeoWorkItemBindingService,
    @Inject(AEO_HOSTED_PLATFORM_PORT_BUNDLE)
    private readonly hosted: AeoHostedPlatformPortBundle,
    @Inject(AEO_HOSTED_ACTIVATION_AUTHORITY_PORT)
    private readonly activationAuthority: AeoHostedActivationAuthorityPort,
  ) {}

  async read(): Promise<AeoHostedPlatformReadinessResult> {
    const observedAt = new Date().toISOString();
    let descriptor: AeoHostedPlatformBindingDescriptor | null = null;
    let activationAuthority: AeoHostedActivationAuthorityVerification | null =
      null;
    const bindingBlockers: AeoHostedPlatformReadinessBlocker[] = [];
    try {
      descriptor = normalizeDescriptor(this.hosted.describe());
    } catch (error) {
      bindingBlockers.push({
        code: 'AEO_HOSTED_BINDING_INVALID',
        component: null,
        message: `${readCode(error)}: hosted platform binding descriptor 无效。`,
      });
    }

    let roleResolutionVersion: string | null = null;
    let roles: AeoHostedPlatformReadinessResult['roles'] = [];
    let roleBlockers: AeoHostedPlatformReadinessResult['roleBlockers'] = [];
    try {
      const roleGate = this.binding.readRoleGate();
      roleResolutionVersion = roleGate.resolutionVersion;
      roles = roleGate.roles;
      roleBlockers = roleGate.blockers;
      if (roleGate.status !== 'READY') {
        bindingBlockers.push({
          code: 'AEO_CANONICAL_ROLES_BLOCKED',
          component: 'CANONICAL_ROLE_RESOLVER',
          message: '新 3.1 canonical 角色尚未全部 VERIFIED_CANONICAL。',
        });
      }
    } catch (error) {
      bindingBlockers.push({
        code: 'AEO_CANONICAL_ROLES_BLOCKED',
        component: 'CANONICAL_ROLE_RESOLVER',
        message: `${readCode(error)}: canonical role resolution 无效。`,
      });
    }

    if (descriptor)
      appendDescriptorBlockers(
        descriptor,
        { resolutionVersion: roleResolutionVersion, roles },
        bindingBlockers,
      );
    // A malformed or identity-aliased descriptor is rejected before reading
    // even the activation artifacts. WorkItem and artifact actions are further
    // downstream and therefore cannot observe this binding.
    if (descriptor && bindingBlockers.length === 0) {
      try {
        activationAuthority = await verifyMasterActivationAuthority(
          descriptor,
          this.activationAuthority,
        );
      } catch (error) {
        bindingBlockers.push(activationAuthorityBlocker(error));
      }
    }
    return {
      schemaVersion: AEO_HOSTED_PLATFORM_READINESS_VERSION,
      status: bindingBlockers.length === 0 ? 'READY' : 'BLOCKED',
      observedAt,
      binding: descriptor,
      activationAuthority,
      roleResolutionVersion,
      roles,
      roleBlockers,
      bindingBlockers,
      authority: 'READINESS_ONLY_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
    };
  }
}

async function verifyMasterActivationAuthority(
  descriptor: AeoHostedPlatformBindingDescriptor,
  authority: AeoHostedActivationAuthorityPort,
): Promise<AeoHostedActivationAuthorityVerification> {
  const receiptArtifact = await authority.readReceiptActualBytes();
  const receiptArtifactRef = requireNonEmptyString(
    receiptArtifact.artifactRef,
    'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
    'receiptArtifactRef',
  );
  const receiptArtifactSha256 = requireSha256(
    receiptArtifact.artifactSha256,
    'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
    'receiptArtifactSha256',
  );
  if (!sha256BytesEqual(receiptArtifact.bytes, receiptArtifactSha256)) {
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_HASH_MISMATCH');
  }
  const receipt = normalizeActivationReceipt(receiptArtifact.bytes);
  if (receipt.receiptArtifactRef !== receiptArtifactRef) {
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_BINDING_MISMATCH');
  }
  const receiptCanonicalSha256 = hashAeoHostedActivationReceipt(receipt);
  if (receiptCanonicalSha256 !== receipt.receiptCanonicalSha256) {
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_CANONICAL_HASH_MISMATCH');
  }
  if (
    receipt.bindingId !== descriptor.bindingId ||
    receipt.bindingRevision !== descriptor.bindingRevision ||
    receipt.activationManifestCanonicalSha256 !==
      descriptor.activationManifestSha256
  ) {
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_BINDING_MISMATCH');
  }
  const manifestBytes = await authority.readActivationManifestActualBytes(
    receipt.activationManifestArtifactRef,
  );
  if (
    !sha256BytesEqual(manifestBytes, receipt.activationManifestArtifactSha256)
  ) {
    throw new Error('AEO_HOSTED_ACTIVATION_MANIFEST_READBACK_MISMATCH');
  }
  let manifest: AeoHostedPlatformActivationManifest;
  try {
    manifest = normalizeActivationManifest(parseJsonBytes(manifestBytes));
  } catch {
    throw new Error('AEO_HOSTED_ACTIVATION_MANIFEST_READBACK_MISMATCH');
  }
  const manifestCanonicalSha256 =
    hashAeoHostedPlatformActivationManifest(manifest);
  if (
    manifestCanonicalSha256 !== receipt.activationManifestCanonicalSha256 ||
    manifestCanonicalSha256 !== descriptor.activationManifestSha256
  ) {
    throw new Error('AEO_HOSTED_ACTIVATION_MANIFEST_READBACK_MISMATCH');
  }
  return {
    receiptId: receipt.receiptId,
    receiptArtifactRef,
    receiptArtifactSha256,
    receiptCanonicalSha256,
    activationManifestArtifactRef: receipt.activationManifestArtifactRef,
    activationManifestArtifactSha256: receipt.activationManifestArtifactSha256,
    activationManifestCanonicalSha256: manifestCanonicalSha256,
    issuedBy: 'WiseLink3_1Master',
    authorizedByDecisionId: receipt.authorizedByDecisionId,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    verified: true,
  };
}

function normalizeActivationReceipt(
  bytes: Uint8Array,
): AeoHostedActivationReceipt {
  const value = parseJsonBytes(bytes);
  if (!isRecord(value))
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_INVALID');
  const expected = [
    'schemaVersion',
    'receiptId',
    'receiptArtifactRef',
    'receiptCanonicalSha256',
    'bindingId',
    'bindingRevision',
    'activationManifestArtifactRef',
    'activationManifestArtifactSha256',
    'activationManifestCanonicalSha256',
    'issuedBy',
    'authorizedByDecisionId',
    'issuedAt',
    'expiresAt',
    'authority',
  ].sort();
  if (Object.keys(value).sort().join('|') !== expected.join('|'))
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_INVALID');
  if (
    value.schemaVersion !== AEO_HOSTED_ACTIVATION_RECEIPT_VERSION ||
    value.issuedBy !== 'WiseLink3_1Master' ||
    value.authority !== 'MASTER_ACTIVATION_RECEIPT_NOT_WRITE_AUTHORIZATION'
  ) {
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_INVALID');
  }
  const issuedAt = requireNonEmptyString(
    value.issuedAt,
    'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
    'issuedAt',
  );
  const expiresAt = requireNonEmptyString(
    value.expiresAt,
    'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
    'expiresAt',
  );
  const issuedAtTime = Date.parse(issuedAt);
  const expiresAtTime = Date.parse(expiresAt);
  if (
    Number.isNaN(issuedAtTime) ||
    Number.isNaN(expiresAtTime) ||
    issuedAtTime >= expiresAtTime ||
    issuedAtTime > Date.now()
  )
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_INVALID');
  if (expiresAtTime <= Date.now())
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_EXPIRED');
  return {
    schemaVersion: AEO_HOSTED_ACTIVATION_RECEIPT_VERSION,
    receiptId: requireNonEmptyString(
      value.receiptId,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'receiptId',
    ),
    receiptArtifactRef: requireNonEmptyString(
      value.receiptArtifactRef,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'receiptArtifactRef',
    ),
    receiptCanonicalSha256: requirePrefixedSha256(
      value.receiptCanonicalSha256,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'receiptCanonicalSha256',
    ),
    bindingId: requireNonEmptyString(
      value.bindingId,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'bindingId',
    ),
    bindingRevision: requireNonEmptyString(
      value.bindingRevision,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'bindingRevision',
    ),
    activationManifestArtifactRef: requireNonEmptyString(
      value.activationManifestArtifactRef,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'activationManifestArtifactRef',
    ),
    activationManifestArtifactSha256: requireSha256(
      value.activationManifestArtifactSha256,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'activationManifestArtifactSha256',
    ),
    activationManifestCanonicalSha256: requirePrefixedSha256(
      value.activationManifestCanonicalSha256,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'activationManifestCanonicalSha256',
    ),
    issuedBy: 'WiseLink3_1Master',
    authorizedByDecisionId: requireNonEmptyString(
      value.authorizedByDecisionId,
      'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
      'authorizedByDecisionId',
    ),
    issuedAt,
    expiresAt,
    authority: 'MASTER_ACTIVATION_RECEIPT_NOT_WRITE_AUTHORIZATION',
  };
}

export function hashAeoHostedActivationReceipt(
  receipt: AeoHostedActivationReceipt,
): string {
  const { receiptCanonicalSha256: _ignored, ...canonicalProjection } = receipt;
  return sha256Prefixed(canonicalStringify(canonicalProjection));
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('AEO_HOSTED_ACTIVATION_RECEIPT_INVALID');
  }
}

function activationAuthorityBlocker(
  error: unknown,
): AeoHostedPlatformReadinessBlocker {
  const code = readCode(error);
  const accepted = new Set<AeoHostedPlatformReadinessBlocker['code']>([
    'AEO_HOSTED_ACTIVATION_AUTHORITY_UNAVAILABLE',
    'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID',
    'AEO_HOSTED_ACTIVATION_RECEIPT_HASH_MISMATCH',
    'AEO_HOSTED_ACTIVATION_RECEIPT_CANONICAL_HASH_MISMATCH',
    'AEO_HOSTED_ACTIVATION_RECEIPT_EXPIRED',
    'AEO_HOSTED_ACTIVATION_RECEIPT_BINDING_MISMATCH',
    'AEO_HOSTED_ACTIVATION_MANIFEST_READBACK_MISMATCH',
  ]);
  return {
    code: accepted.has(code as AeoHostedPlatformReadinessBlocker['code'])
      ? (code as AeoHostedPlatformReadinessBlocker['code'])
      : 'AEO_HOSTED_ACTIVATION_AUTHORITY_UNAVAILABLE',
    component: null,
    message: `${code}: 主控 activation receipt/manifest actual-byte 验证失败。`,
  };
}

function normalizeDescriptor(
  value: unknown,
): AeoHostedPlatformBindingDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  }
  const candidate = value as Partial<AeoHostedPlatformBindingDescriptor>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    'authority',
    'activationManifest',
    'activationManifestSha256',
    'bindingId',
    'bindingRevision',
    'mode',
    'schemaVersion',
  ].sort();
  if (keys.join('|') !== expected.join('|')) {
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  }
  if (
    candidate.schemaVersion !== AEO_HOSTED_PLATFORM_BINDING_VERSION ||
    !candidate.bindingId?.trim() ||
    !candidate.bindingRevision?.trim() ||
    !['UNCONFIGURED', 'HOSTED_CANDIDATE', 'ACTIVE'].includes(
      String(candidate.mode),
    ) ||
    candidate.authority !== 'BINDING_DESCRIPTOR_NOT_WRITE_AUTHORIZATION'
  ) {
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  }
  const activationManifest =
    candidate.activationManifest === null
      ? null
      : normalizeActivationManifest(candidate.activationManifest);
  const activationManifestSha256 =
    candidate.activationManifestSha256 === null
      ? null
      : requirePrefixedSha256(
          candidate.activationManifestSha256,
          'AEO_HOSTED_BINDING_INVALID',
          'activationManifestSha256',
        );
  if (Boolean(activationManifest) !== Boolean(activationManifestSha256))
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  return {
    schemaVersion: AEO_HOSTED_PLATFORM_BINDING_VERSION,
    bindingId: candidate.bindingId,
    bindingRevision: candidate.bindingRevision,
    mode: candidate.mode as AeoHostedPlatformBindingDescriptor['mode'],
    activationManifest,
    activationManifestSha256,
    authority: 'BINDING_DESCRIPTOR_NOT_WRITE_AUTHORIZATION',
  };
}

function normalizeActivationManifest(
  value: unknown,
): AeoHostedPlatformActivationManifest {
  if (!isRecord(value)) throw new Error('AEO_HOSTED_BINDING_INVALID');
  const expected = [
    'activationId',
    'activationRevision',
    'authority',
    'environmentRef',
    'ports',
    'r1Selection',
    'roleResolutionVersion',
    'roleSetFingerprint',
    'runtimeBindings',
    'schemaVersion',
    'tenantRef',
  ].sort();
  if (Object.keys(value).sort().join('|') !== expected.join('|'))
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  if (
    value.schemaVersion !== AEO_HOSTED_PLATFORM_ACTIVATION_VERSION ||
    value.authority !== 'ACTIVATION_ATTESTATION_NOT_WRITE_AUTHORIZATION' ||
    !isRecord(value.ports)
  )
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  const expectedPortKeys = [...AEO_HOSTED_PLATFORM_PORT_NAMES].sort();
  if (Object.keys(value.ports).sort().join('|') !== expectedPortKeys.join('|'))
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  const ports = Object.fromEntries(
    AEO_HOSTED_PLATFORM_PORT_NAMES.map((port) => {
      const candidate = value.ports[port];
      if (!isRecord(candidate)) throw new Error('AEO_HOSTED_BINDING_INVALID');
      const keys = [
        'activationRef',
        'adapterId',
        'adapterFingerprint',
        'adapterRevision',
        'owner',
        'status',
      ].sort();
      if (Object.keys(candidate).sort().join('|') !== keys.join('|'))
        throw new Error('AEO_HOSTED_BINDING_INVALID');
      if (!['UNCONFIGURED', 'ACTIVE'].includes(String(candidate.status)))
        throw new Error('AEO_HOSTED_BINDING_INVALID');
      const active = candidate.status === 'ACTIVE';
      const owner = active
        ? requireNonEmptyString(
            candidate.owner,
            'AEO_HOSTED_BINDING_INVALID',
            `${port}.owner`,
          )
        : null;
      const allowedOwners = new Set([
        'WiseLink3_1Master',
        'CanonicalWorkItemStore',
        'CanonicalArtifactStore',
        'CanonicalUnifiedReader',
        'CanonicalUnifiedAcceptanceReceiptOwner',
        'CanonicalHubRegistrar',
        'AeoModule',
      ]);
      if (active && !allowedOwners.has(owner!))
        throw new Error('AEO_HOSTED_BINDING_INVALID');
      const metadata = active
        ? {
            adapterId: requireNonEmptyString(
              candidate.adapterId,
              'AEO_HOSTED_BINDING_INVALID',
              `${port}.adapterId`,
            ),
            adapterRevision: requireNonEmptyString(
              candidate.adapterRevision,
              'AEO_HOSTED_BINDING_INVALID',
              `${port}.adapterRevision`,
            ),
            adapterFingerprint: requirePrefixedSha256(
              candidate.adapterFingerprint,
              'AEO_HOSTED_BINDING_INVALID',
              `${port}.adapterFingerprint`,
            ),
            activationRef: requireNonEmptyString(
              candidate.activationRef,
              'AEO_HOSTED_BINDING_INVALID',
              `${port}.activationRef`,
            ),
          }
        : {
            adapterId: null,
            adapterRevision: null,
            adapterFingerprint: null,
            activationRef: null,
          };
      if (
        !active &&
        (candidate.owner !== null ||
          candidate.adapterId !== null ||
          candidate.adapterRevision !== null ||
          candidate.adapterFingerprint !== null ||
          candidate.activationRef !== null)
      )
        throw new Error('AEO_HOSTED_BINDING_INVALID');
      return [port, { status: candidate.status, owner, ...metadata }];
    }),
  ) as AeoHostedPlatformActivationManifest['ports'];
  const runtimeBindings = normalizeRuntimeBindings(value.runtimeBindings);
  const r1Selection = normalizeR1Selection(value.r1Selection);
  return {
    schemaVersion: AEO_HOSTED_PLATFORM_ACTIVATION_VERSION,
    activationId: requireNonEmptyString(
      value.activationId,
      'AEO_HOSTED_BINDING_INVALID',
      'activationId',
    ),
    activationRevision: requireNonEmptyString(
      value.activationRevision,
      'AEO_HOSTED_BINDING_INVALID',
      'activationRevision',
    ),
    roleResolutionVersion: requireNonEmptyString(
      value.roleResolutionVersion,
      'AEO_HOSTED_BINDING_INVALID',
      'roleResolutionVersion',
    ),
    roleSetFingerprint: requirePrefixedSha256(
      value.roleSetFingerprint,
      'AEO_HOSTED_BINDING_INVALID',
      'roleSetFingerprint',
    ),
    tenantRef: requireNonEmptyString(
      value.tenantRef,
      'AEO_HOSTED_BINDING_INVALID',
      'tenantRef',
    ),
    environmentRef: requireNonEmptyString(
      value.environmentRef,
      'AEO_HOSTED_BINDING_INVALID',
      'environmentRef',
    ),
    runtimeBindings,
    r1Selection,
    ports,
    authority: 'ACTIVATION_ATTESTATION_NOT_WRITE_AUTHORIZATION',
  };
}

function normalizeRuntimeBindings(
  value: unknown,
): AeoHostedPlatformActivationManifest['runtimeBindings'] {
  if (!isRecord(value)) throw new Error('AEO_HOSTED_BINDING_INVALID');
  const keys = [
    'canonicalMiaodaAppRef',
    'canonicalWorkItemStoreRef',
    'canonicalArtifactStoreRef',
    'canonicalUnifiedReaderRef',
    'canonicalHubRegistrarServiceRef',
    'artifactStoreLocationRef',
    'immutableAcceptanceReceiptOwnerRef',
  ].sort();
  if (Object.keys(value).sort().join('|') !== keys.join('|'))
    throw new Error('AEO_HOSTED_BINDING_INVALID');
  return Object.fromEntries(
    keys.map((key) => [
      key,
      requireNonEmptyString(
        value[key],
        'AEO_HOSTED_BINDING_INVALID',
        `runtimeBindings.${key}`,
      ),
    ]),
  ) as unknown as AeoHostedPlatformActivationManifest['runtimeBindings'];
}

function normalizeR1Selection(
  value: unknown,
): AeoHostedPlatformActivationManifest['r1Selection'] {
  if (!isRecord(value)) throw new Error('AEO_HOSTED_BINDING_INVALID');
  const exact = {
    selectionDecisionCommit: WISELINK_3_1_R1_SELECTION_COMMIT,
    techpubPackageContract: WISELINK_3_1_TECHPUB_PACKAGE_CONTRACT,
    u0ValidatorCommit: WISELINK_3_1_U0_VALIDATOR_COMMIT,
    u0ManifestSha256: WISELINK_3_1_U0_MANIFEST_SHA256,
    unifiedSourceBaselineCommit: WISELINK_3_1_UNIFIED_SOURCE_BASELINE_COMMIT,
    aeoValidationPurpose: WISELINK_3_1_AEO_VALIDATION_PURPOSE,
    scopeField: 'ABSENT',
    aeoSpecialistPortToken: AEO_UNIFIED_ACCEPTANCE_READER_PORT,
    aeoSpecialistRevision: AEO_UNIFIED_ACCEPTANCE_READER_REVISION,
    unifiedAcceptanceFacadeRevision:
      WISELINK_3_1_UNIFIED_ACCEPTANCE_FACADE_REVISION,
    unifiedAcceptanceReceiptVersion:
      WISELINK_3_1_UNIFIED_ACCEPTANCE_RECEIPT_VERSION,
    unifiedAcceptanceOwnedReceiptVersion:
      WISELINK_3_1_UNIFIED_ACCEPTANCE_OWNED_RECEIPT_VERSION,
    unifiedPostValidatorReceiptOwnerCommit:
      WISELINK_3_1_UNIFIED_POST_VALIDATOR_RECEIPT_OWNER_COMMIT,
    immutableAcceptanceReceiptOwnerToken:
      UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_TOKEN,
    immutableAcceptanceReceiptOwnerRevision:
      UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_REVISION,
    immutableAcceptanceReceiptOwnerFingerprint:
      UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_FINGERPRINT,
    artifactDigestWire: 'LOWERCASE_HEX_64',
    semanticDigestWire: 'SHA256_PREFIXED_LOWERCASE_HEX_64',
  } as const;
  if (
    Object.keys(value).sort().join('|') !== Object.keys(exact).sort().join('|')
  )
    throw new Error('AEO_HOSTED_R1_SELECTION_MISMATCH');
  for (const [key, expected] of Object.entries(exact)) {
    if (value[key] !== expected)
      throw new Error('AEO_HOSTED_R1_SELECTION_MISMATCH');
  }
  return exact;
}

export function fingerprintAeoCanonicalRoleSet(
  roles: AeoCanonicalRoleResolution[],
): string {
  return sha256Prefixed(
    canonicalStringify(
      [...roles].sort((left, right) => compareText(left.role, right.role)),
    ),
  );
}

export function hashAeoHostedPlatformActivationManifest(
  manifest: AeoHostedPlatformActivationManifest,
): string {
  return sha256Prefixed(canonicalStringify(manifest));
}

function appendDescriptorBlockers(
  descriptor: AeoHostedPlatformBindingDescriptor,
  roleGate: Pick<AeoCanonicalRoleGateResult, 'resolutionVersion' | 'roles'> & {
    resolutionVersion: string | null;
  },
  blockers: AeoHostedPlatformReadinessBlocker[],
): void {
  if (descriptor.mode !== 'ACTIVE') {
    blockers.push({
      code: 'AEO_HOSTED_BINDING_NOT_ACTIVE',
      component: null,
      message: `hosted platform bundle 当前为 ${descriptor.mode}，未激活。`,
    });
  }
  const manifest = descriptor.activationManifest;
  if (!manifest || !descriptor.activationManifestSha256) {
    blockers.push({
      code: 'AEO_HOSTED_ACTIVATION_MISSING',
      component: null,
      message: 'hosted platform binding 缺少主控激活清单及其 hash。',
    });
    return;
  }
  if (
    !sha256Equals(
      hashAeoHostedPlatformActivationManifest(manifest),
      descriptor.activationManifestSha256,
    )
  ) {
    blockers.push({
      code: 'AEO_HOSTED_ACTIVATION_HASH_MISMATCH',
      component: null,
      message: 'hosted platform activation manifest hash 不一致。',
    });
  }
  if (manifest.roleResolutionVersion !== roleGate.resolutionVersion) {
    blockers.push({
      code: 'AEO_HOSTED_ROLE_RESOLUTION_MISMATCH',
      component: 'CANONICAL_ROLE_RESOLVER',
      message: 'activation manifest 未绑定当前 role resolver revision。',
    });
  }
  if (
    manifest.roleSetFingerprint !==
    fingerprintAeoCanonicalRoleSet(roleGate.roles)
  ) {
    blockers.push({
      code: 'AEO_HOSTED_ROLE_FINGERPRINT_MISMATCH',
      component: 'CANONICAL_ROLE_RESOLVER',
      message: 'activation manifest 未绑定当前六角色 exact resolution。',
    });
  }
  if (
    roleGate.roles.some(
      (role) =>
        role.tenantRef !== manifest.tenantRef ||
        role.environmentRef !== manifest.environmentRef,
    )
  ) {
    blockers.push({
      code: 'AEO_HOSTED_ENVIRONMENT_MISMATCH',
      component: null,
      message: 'activation manifest 与当前六角色租户/环境不一致。',
    });
  }
  const exactRoleRef = (roleName: AeoCanonicalRoleResolution['role']) =>
    roleGate.roles.find((role) => role.role === roleName)?.exactIdentityRef;
  if (
    manifest.runtimeBindings.canonicalMiaodaAppRef !==
      exactRoleRef('CanonicalMiaodaApp') ||
    manifest.runtimeBindings.canonicalWorkItemStoreRef !==
      exactRoleRef('CanonicalWorkItemStore') ||
    manifest.runtimeBindings.canonicalArtifactStoreRef !==
      exactRoleRef('CanonicalArtifactStore') ||
    manifest.runtimeBindings.canonicalUnifiedReaderRef !==
      exactRoleRef('CanonicalUnifiedReader') ||
    manifest.runtimeBindings.immutableAcceptanceReceiptOwnerRef ===
      manifest.runtimeBindings.canonicalHubRegistrarServiceRef
  ) {
    blockers.push({
      code: 'AEO_HOSTED_RUNTIME_BINDING_MISMATCH',
      component: null,
      message:
        'activation manifest 的 host/Store/Reader exact binding 无效，或 receipt owner 与 Registrar 使用了相同 service identity。',
    });
  }
  if (
    manifest.ports.AEO_SPECIALIST_READER.adapterId !==
      AEO_UNIFIED_ACCEPTANCE_READER_PORT ||
    manifest.ports.AEO_SPECIALIST_READER.adapterRevision !==
      AEO_UNIFIED_ACCEPTANCE_READER_REVISION ||
    manifest.ports.U0_FULL_PACKAGE_VALIDATOR.adapterRevision !==
      WISELINK_3_1_U0_VALIDATOR_COMMIT ||
    manifest.ports.UNIFIED_ACCEPTANCE_FACADE.adapterRevision !==
      WISELINK_3_1_UNIFIED_ACCEPTANCE_FACADE_REVISION ||
    manifest.ports.IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER.adapterId !==
      UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_TOKEN ||
    manifest.ports.IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER.adapterRevision !==
      UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_REVISION ||
    manifest.ports.IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER.adapterFingerprint !==
      UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_FINGERPRINT ||
    manifest.ports.IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER.activationRef !==
      manifest.runtimeBindings.immutableAcceptanceReceiptOwnerRef ||
    manifest.ports.HUB_REGISTRAR.activationRef !==
      manifest.runtimeBindings.canonicalHubRegistrarServiceRef ||
    manifest.ports.ARTIFACT_STORE.activationRef !==
      manifest.runtimeBindings.artifactStoreLocationRef
  ) {
    blockers.push({
      code: 'AEO_HOSTED_RUNTIME_BINDING_MISMATCH',
      component: null,
      message:
        'activation manifest 的 U0/AEO specialist/facade/receipt owner/Store/Registrar port binding 不完整或漂移。',
    });
  }
  for (const port of AEO_HOSTED_PLATFORM_PORT_NAMES) {
    const activation = manifest.ports[port];
    if (activation.status !== 'ACTIVE') {
      blockers.push({
        code: 'AEO_HOSTED_PORT_UNCONFIGURED',
        component: port,
        message: `${port} 尚未由同一 hosted platform bundle 激活。`,
      });
    }
    if (activation.owner !== AEO_HOSTED_PLATFORM_EXPECTED_PORT_OWNERS[port]) {
      blockers.push({
        code: 'AEO_HOSTED_PORT_OWNER_INVALID',
        component: port,
        message: `${port} owner 与 AEO hosted activation contract 不一致。`,
      });
    }
  }
}

function readCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : error instanceof Error
      ? error.message
      : 'UNKNOWN_ERROR';
}

function sha256Equals(actual: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(actual, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );
}

function sha256BytesEqual(bytes: Uint8Array, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(bytes).digest(),
    Buffer.from(expected, 'hex'),
  );
}
