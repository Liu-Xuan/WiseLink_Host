import { Inject, Injectable } from '@nestjs/common';

import {
  AEO_WORK_ITEM_BINDING_VERSION,
  type AeoCanonicalRole,
  type AeoCanonicalRoleGateResult,
  type AeoCanonicalRoleResolution,
  type AeoWorkItemBindingBlocker,
  type AeoWorkItemBindingPreflightRequest,
  type AeoWorkItemBindingPreflightResult,
} from '../../../shared/aeo-editor';

import {
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
  requireSha256,
} from './aeo-editor-projection.utils';

const REQUIRED_ROLES: readonly AeoCanonicalRole[] = [
  'CanonicalMiaodaApp',
  'CanonicalAily',
  'CanonicalWorkItemStore',
  'CanonicalDocumentCatalog',
  'CanonicalArtifactStore',
  'CanonicalUnifiedReader',
];

const ROLE_SET: ReadonlySet<string> = new Set(REQUIRED_ROLES);
const ROLE_STATUS_SET: ReadonlySet<string> = new Set([
  'UNRESOLVED',
  'PROPOSED_REUSE_ANCHOR',
  'PROVISIONED_CANDIDATE',
  'VERIFIED_CANONICAL',
  'REJECTED',
]);

export const AEO_CANONICAL_ROLE_RESOLVER = Symbol(
  'AEO_CANONICAL_ROLE_RESOLVER',
);

export interface AeoCanonicalRoleResolver {
  resolveAll(): {
    resolutionVersion: string;
    roles: AeoCanonicalRoleResolution[];
  };
}

export class UnresolvedAeoCanonicalRoleResolver implements AeoCanonicalRoleResolver {
  resolveAll() {
    const roles: AeoCanonicalRoleResolution[] = REQUIRED_ROLES.map(
      (role: AeoCanonicalRole): AeoCanonicalRoleResolution => ({
        role,
        status: 'UNRESOLVED',
        resolutionVersion: 'UNRESOLVED',
        exactIdentityRef: null,
        tenantRef: null,
        environmentRef: null,
        accessBaseUrl: null,
        verifiedAt: null,
      }),
    );
    return { resolutionVersion: 'UNRESOLVED', roles };
  }
}

@Injectable()
export class AeoWorkItemBindingService {
  constructor(
    @Inject(AEO_CANONICAL_ROLE_RESOLVER)
    private readonly roleResolver: AeoCanonicalRoleResolver,
  ) {}

  preflight(value: unknown): AeoWorkItemBindingPreflightResult {
    return preflightAeoWorkItemBinding(value, this.roleResolver.resolveAll());
  }

  readRoleGate(): AeoCanonicalRoleGateResult {
    return inspectAeoCanonicalRoles(this.roleResolver.resolveAll());
  }
}

export function preflightAeoWorkItemBinding(
  value: unknown,
  roleResolution: ReturnType<AeoCanonicalRoleResolver['resolveAll']>,
): AeoWorkItemBindingPreflightResult {
  const request: AeoWorkItemBindingPreflightRequest = normalizeRequest(value);
  const roleGate = inspectAeoCanonicalRoles(roleResolution);
  const resolutionVersion: string = roleGate.resolutionVersion;
  const roles: AeoCanonicalRoleResolution[] = roleGate.roles;
  const blockers: AeoWorkItemBindingBlocker[] = [];

  if (request.expectedRoleResolutionVersion !== resolutionVersion) {
    blockers.push({
      code: 'ROLE_RESOLUTION_VERSION_CONFLICT',
      role: null,
      message: '请求绑定的 canonical role resolver 版本已变化，请重新读取。',
    });
  }
  blockers.push(...roleGate.blockers);

  if (request.document.family !== 'AEO') {
    blockers.push({
      code: 'DOCUMENT_FAMILY_NOT_AEO',
      role: null,
      message: '非 AEO family 不得进入 AEO 专业模块。',
    });
  }
  if (request.document.classificationStatus !== 'CONFIRMED') {
    blockers.push({
      code: 'DOCUMENT_CLASSIFICATION_NOT_CONFIRMED',
      role: null,
      message: '只有 CONFIRMED 分类才允许路由到 AEO 专业模块。',
    });
  }
  if (request.document.classificationAuthority !== 'DocumentManagement') {
    blockers.push({
      code: 'DOCUMENT_CLASSIFICATION_AUTHORITY_INVALID',
      role: null,
      message: 'AEO family 必须由 Document Management owner 确认。',
    });
  }
  if (request.parsedPackage.readerReceipt.validationStatus !== 'ACCEPTED') {
    blockers.push({
      code: 'PARSED_PACKAGE_READER_NOT_ACCEPTED',
      role: 'CanonicalUnifiedReader',
      message: 'ParsedPackage 尚未由 CanonicalUnifiedReader 接受。',
    });
  }
  if (
    request.parsedPackage.readerReceipt.packageArtifactSha256 !==
    request.parsedPackage.sha256
  ) {
    blockers.push({
      code: 'PARSED_PACKAGE_READER_HASH_MISMATCH',
      role: 'CanonicalUnifiedReader',
      message: 'Reader receipt 的实际 artifact hash 与 ParsedPackage 不一致。',
    });
  }

  const ready: boolean = blockers.length === 0;
  return {
    schemaVersion: AEO_WORK_ITEM_BINDING_VERSION,
    status: ready ? 'READY' : 'BLOCKED',
    route: ready ? 'AEO_SPECIALIST' : 'NONE',
    routeEligible: ready,
    workItemId: request.workItemId,
    requestId: request.requestId,
    stateVersion: request.stateVersion,
    documentVersionId: request.document.documentVersionId,
    parsedPackageRef: request.parsedPackage.ref,
    parsedPackageHash: request.parsedPackage.sha256,
    aeoState: request.aeoState,
    roleResolutionVersion: resolutionVersion,
    blockers,
    deepLink: ready
      ? {
          applicationRole: 'CanonicalMiaodaApp',
          route: '/aeo-authoring',
          query: {
            workItemId: request.workItemId,
            requestId: request.requestId,
            stateVersion: String(request.stateVersion),
            permissionSnapshotVersion: request.permissionSnapshot.version,
          },
        }
      : null,
    authority: 'PREFLIGHT_ONLY_NOT_APPROVAL_NOT_RELEASE',
  };
}

export function inspectAeoCanonicalRoles(
  roleResolution: ReturnType<AeoCanonicalRoleResolver['resolveAll']>,
): AeoCanonicalRoleGateResult {
  const resolutionVersion: string = requireNonEmptyString(
    roleResolution.resolutionVersion,
    'AEO_ROLE_RESOLUTION_INVALID',
    'roleResolution.resolutionVersion',
  );
  const roles: AeoCanonicalRoleResolution[] = normalizeRoleResolutions(
    roleResolution.roles,
    resolutionVersion,
  );
  const blockers: AeoWorkItemBindingBlocker[] = [];
  for (const role of roles) appendRoleBlocker(role, blockers);

  const environmentKeys: Set<string> = new Set(
    roles
      .filter(
        (role: AeoCanonicalRoleResolution): boolean =>
          role.status === 'VERIFIED_CANONICAL' &&
          Boolean(role.tenantRef) &&
          Boolean(role.environmentRef),
      )
      .map(
        (role: AeoCanonicalRoleResolution): string =>
          `${role.tenantRef}:${role.environmentRef}`,
      ),
  );
  if (environmentKeys.size > 1) {
    blockers.push({
      code: 'CANONICAL_ROLE_ENVIRONMENT_MISMATCH',
      role: null,
      message: '六个 canonical 角色没有解析到同一租户和环境。',
    });
  }

  const miaoda = roles.find(
    (role: AeoCanonicalRoleResolution): boolean =>
      role.role === 'CanonicalMiaodaApp',
  );
  const miaodaBaseUrl =
    miaoda?.status === 'VERIFIED_CANONICAL' && miaoda.accessBaseUrl
      ? normalizeCanonicalMiaodaBaseUrl(miaoda.accessBaseUrl, blockers)
      : null;
  return {
    resolutionVersion,
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    roles,
    blockers,
    miaodaBaseUrl,
  };
}

function normalizeCanonicalMiaodaBaseUrl(
  value: string,
  blockers: AeoWorkItemBindingBlocker[],
): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const forbidden =
      url.protocol !== 'https:' ||
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^127\./u.test(hostname) ||
      /^10\./u.test(hostname) ||
      /^192\.168\./u.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./u.test(hostname);
    if (forbidden || url.username || url.password) throw new Error('unsafe');
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    blockers.push({
      code: 'CANONICAL_MIAODA_URL_INVALID',
      role: 'CanonicalMiaodaApp',
      message: 'CanonicalMiaodaApp 正式入口必须是无凭据的公网 HTTPS URL。',
    });
    return null;
  }
}

function appendRoleBlocker(
  role: AeoCanonicalRoleResolution,
  blockers: AeoWorkItemBindingBlocker[],
): void {
  if (role.status === 'UNRESOLVED') {
    blockers.push({
      code: 'CANONICAL_ROLE_UNRESOLVED',
      role: role.role,
      message: `${role.role} 尚未由新 3.1 主控解析。`,
    });
    return;
  }
  if (role.status === 'PROPOSED_REUSE_ANCHOR') {
    blockers.push({
      code: 'CANONICAL_ROLE_NOT_VERIFIED',
      role: role.role,
      message: `${role.role} 仍是待核验复用候选，不能用于线上写入。`,
    });
    return;
  }
  if (role.status === 'PROVISIONED_CANDIDATE') {
    blockers.push({
      code: 'CANONICAL_ROLE_NOT_VERIFIED',
      role: role.role,
      message: `${role.role} 仅完成隔离对象 provision，权限、合同映射和 writer activation 尚未验收。`,
    });
    return;
  }
  if (role.status === 'REJECTED') {
    blockers.push({
      code: 'CANONICAL_ROLE_REJECTED',
      role: role.role,
      message: `${role.role} 候选已被拒绝，必须重新解析。`,
    });
    return;
  }
  if (
    !role.exactIdentityRef ||
    !role.tenantRef ||
    !role.environmentRef ||
    (role.role === 'CanonicalMiaodaApp' && !role.accessBaseUrl) ||
    !role.verifiedAt
  ) {
    blockers.push({
      code: 'CANONICAL_ROLE_TARGET_INCOMPLETE',
      role: role.role,
      message: `${role.role} 虽标记已核验，但 exact target 或环境证据不完整。`,
    });
  }
}

function normalizeRoleResolutions(
  values: AeoCanonicalRoleResolution[],
  resolutionVersion: string,
): AeoCanonicalRoleResolution[] {
  if (!Array.isArray(values) || values.length !== REQUIRED_ROLES.length) {
    projectionError(
      'AEO_ROLE_RESOLUTION_INVALID',
      'roleResolution.roles 必须精确包含六个 canonical 角色。',
    );
  }
  const map: Map<AeoCanonicalRole, AeoCanonicalRoleResolution> = new Map();
  for (const value of values) {
    if (!isRecord(value)) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'roleResolution.roles 的每个条目都必须是对象。',
      );
    }
    requireExactKeys(
      value,
      [
        'role',
        'status',
        'resolutionVersion',
        'exactIdentityRef',
        'tenantRef',
        'environmentRef',
        'accessBaseUrl',
        'verifiedAt',
      ],
      'AEO_ROLE_RESOLUTION_INVALID',
      'roleResolution.roles[]',
    );
    if (!ROLE_SET.has(value.role) || map.has(value.role)) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'roleResolution.roles 含未知或重复角色。',
      );
    }
    if (value.resolutionVersion !== resolutionVersion) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        '每个角色的 resolutionVersion 必须与 resolver 一致。',
      );
    }
    if (!ROLE_STATUS_SET.has(value.status)) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'roleResolution.roles 含未知解析状态。',
      );
    }
    if (
      value.exactIdentityRef !== null &&
      typeof value.exactIdentityRef !== 'string'
    ) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'exactIdentityRef 必须是字符串或 null。',
      );
    }
    if (value.tenantRef !== null && typeof value.tenantRef !== 'string') {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'tenantRef 必须是字符串或 null。',
      );
    }
    if (
      value.environmentRef !== null &&
      typeof value.environmentRef !== 'string'
    ) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'environmentRef 必须是字符串或 null。',
      );
    }
    if (
      value.accessBaseUrl !== null &&
      typeof value.accessBaseUrl !== 'string'
    ) {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'accessBaseUrl 必须是字符串或 null。',
      );
    }
    if (value.verifiedAt !== null && typeof value.verifiedAt !== 'string') {
      projectionError(
        'AEO_ROLE_RESOLUTION_INVALID',
        'verifiedAt 必须是字符串或 null。',
      );
    }
    map.set(value.role as AeoCanonicalRole, {
      role: value.role as AeoCanonicalRole,
      status: value.status as AeoCanonicalRoleResolution['status'],
      resolutionVersion: value.resolutionVersion,
      exactIdentityRef: value.exactIdentityRef,
      tenantRef: value.tenantRef,
      environmentRef: value.environmentRef,
      accessBaseUrl: value.accessBaseUrl,
      verifiedAt: value.verifiedAt,
    });
  }
  return REQUIRED_ROLES.map(
    (role: AeoCanonicalRole): AeoCanonicalRoleResolution => {
      const resolution = map.get(role);
      if (!resolution) {
        projectionError(
          'AEO_ROLE_RESOLUTION_INVALID',
          `roleResolution.roles 缺少 ${role}。`,
        );
      }
      return resolution;
    },
  );
}

function normalizeRequest(value: unknown): AeoWorkItemBindingPreflightRequest {
  if (!isRecord(value)) {
    projectionError('AEO_WORK_ITEM_BINDING_INVALID', 'request 必须是对象。');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'expectedRoleResolutionVersion',
      'workItemId',
      'requestId',
      'stateVersion',
      'document',
      'sourceArtifact',
      'parsedPackage',
      'aeoState',
      'permissionSnapshot',
    ],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'request',
  );
  if (value.schemaVersion !== AEO_WORK_ITEM_BINDING_VERSION) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_VERSION_UNSUPPORTED',
      `只接受 ${AEO_WORK_ITEM_BINDING_VERSION}。`,
    );
  }
  const document = normalizeDocument(value.document);
  const sourceArtifact = normalizeSourceArtifact(value.sourceArtifact);
  const parsedPackage = normalizeParsedPackage(value.parsedPackage);
  const aeoState = normalizeAeoState(value.aeoState);
  const permissionSnapshot = normalizePermissionSnapshot(
    value.permissionSnapshot,
  );
  return {
    schemaVersion: AEO_WORK_ITEM_BINDING_VERSION,
    expectedRoleResolutionVersion: requireNonEmptyString(
      value.expectedRoleResolutionVersion,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'expectedRoleResolutionVersion',
    ),
    workItemId: requireNonEmptyString(
      value.workItemId,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'workItemId',
    ),
    requestId: requireNonEmptyString(
      value.requestId,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'requestId',
    ),
    stateVersion: requirePositiveInteger(
      value.stateVersion,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'stateVersion',
    ),
    document,
    sourceArtifact,
    parsedPackage,
    aeoState,
    permissionSnapshot,
  };
}

function normalizeDocument(
  value: unknown,
): AeoWorkItemBindingPreflightRequest['document'] {
  if (!isRecord(value)) {
    projectionError('AEO_WORK_ITEM_BINDING_INVALID', 'document 必须是对象。');
  }
  requireExactKeys(
    value,
    [
      'documentId',
      'documentVersionId',
      'family',
      'classificationStatus',
      'classificationAuthority',
      'catalogRole',
      'classificationFingerprint',
    ],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'document',
  );
  if (value.catalogRole !== 'CanonicalDocumentCatalog') {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'document.catalogRole 必须是 CanonicalDocumentCatalog。',
    );
  }
  return {
    documentId: requireNonEmptyString(
      value.documentId,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'document.documentId',
    ),
    documentVersionId: requireNonEmptyString(
      value.documentVersionId,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'document.documentVersionId',
    ),
    family: requireNonEmptyString(
      value.family,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'document.family',
    ),
    classificationStatus: requireNonEmptyString(
      value.classificationStatus,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'document.classificationStatus',
    ),
    classificationAuthority: requireNonEmptyString(
      value.classificationAuthority,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'document.classificationAuthority',
    ),
    catalogRole: 'CanonicalDocumentCatalog',
    classificationFingerprint: requireSha256Fingerprint(
      value.classificationFingerprint,
      'document.classificationFingerprint',
    ),
  };
}

function normalizeSourceArtifact(
  value: unknown,
): AeoWorkItemBindingPreflightRequest['sourceArtifact'] {
  if (!isRecord(value)) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'sourceArtifact 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['storeRole', 'ref', 'sha256', 'mediaType', 'byteLength'],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'sourceArtifact',
  );
  if (value.storeRole !== 'CanonicalArtifactStore') {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'sourceArtifact.storeRole 必须是 CanonicalArtifactStore。',
    );
  }
  return {
    storeRole: 'CanonicalArtifactStore',
    ref: requireNonEmptyString(
      value.ref,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'sourceArtifact.ref',
    ),
    sha256: requireSha256(
      value.sha256,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'sourceArtifact.sha256',
    ),
    mediaType: requireNonEmptyString(
      value.mediaType,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'sourceArtifact.mediaType',
    ),
    byteLength: requirePositiveInteger(
      value.byteLength,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'sourceArtifact.byteLength',
    ),
  };
}

function normalizeParsedPackage(
  value: unknown,
): AeoWorkItemBindingPreflightRequest['parsedPackage'] {
  if (!isRecord(value)) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['packageId', 'storeRole', 'ref', 'sha256', 'contract', 'readerReceipt'],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'parsedPackage',
  );
  if (value.storeRole !== 'CanonicalArtifactStore') {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage.storeRole 必须是 CanonicalArtifactStore。',
    );
  }
  const readerReceipt = normalizeReaderReceipt(value.readerReceipt);
  return {
    packageId: requireNonEmptyString(
      value.packageId,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage.packageId',
    ),
    storeRole: 'CanonicalArtifactStore',
    ref: requireNonEmptyString(
      value.ref,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage.ref',
    ),
    sha256: requireSha256(
      value.sha256,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage.sha256',
    ),
    contract: requireNonEmptyString(
      value.contract,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage.contract',
    ),
    readerReceipt,
  };
}

function normalizeReaderReceipt(
  value: unknown,
): AeoWorkItemBindingPreflightRequest['parsedPackage']['readerReceipt'] {
  if (!isRecord(value)) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'parsedPackage.readerReceipt 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'role',
      'receiptId',
      'readerRevision',
      'validationStatus',
      'packageArtifactSha256',
    ],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'parsedPackage.readerReceipt',
  );
  if (value.role !== 'CanonicalUnifiedReader') {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'readerReceipt.role 必须是 CanonicalUnifiedReader。',
    );
  }
  return {
    role: 'CanonicalUnifiedReader',
    receiptId: requireNonEmptyString(
      value.receiptId,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'readerReceipt.receiptId',
    ),
    readerRevision: requireNonEmptyString(
      value.readerRevision,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'readerReceipt.readerRevision',
    ),
    validationStatus: normalizeReaderValidationStatus(value.validationStatus),
    packageArtifactSha256: requireSha256(
      value.packageArtifactSha256,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'readerReceipt.packageArtifactSha256',
    ),
  };
}

function normalizeReaderValidationStatus(
  value: unknown,
): 'ACCEPTED' | 'REJECTED' {
  if (value !== 'ACCEPTED' && value !== 'REJECTED') {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'readerReceipt.validationStatus 必须是 ACCEPTED 或 REJECTED。',
    );
  }
  return value;
}

function requireSha256Fingerprint(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      `${field} 必须是 sha256:<64-hex>。`,
    );
  }
  return value;
}

function normalizeAeoState(
  value: unknown,
): AeoWorkItemBindingPreflightRequest['aeoState'] {
  if (!isRecord(value)) {
    projectionError('AEO_WORK_ITEM_BINDING_INVALID', 'aeoState 必须是对象。');
  }
  requireExactKeys(
    value,
    ['state', 'ref', 'version'],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'aeoState',
  );
  const allowedStates: ReadonlySet<string> = new Set([
    'NOT_STARTED',
    'PARSE_READY',
    'AUTHORING',
    'CHECKPOINTED',
    'BLOCKED',
  ]);
  if (typeof value.state !== 'string' || !allowedStates.has(value.state)) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'aeoState.state 含未知状态。',
    );
  }
  if (value.ref !== null && typeof value.ref !== 'string') {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'aeoState.ref 必须是字符串或 null。',
    );
  }
  return {
    state:
      value.state as AeoWorkItemBindingPreflightRequest['aeoState']['state'],
    ref: value.ref as string | null,
    version: requireNonEmptyString(
      value.version,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'aeoState.version',
    ),
  };
}

function normalizePermissionSnapshot(
  value: unknown,
): AeoWorkItemBindingPreflightRequest['permissionSnapshot'] {
  if (!isRecord(value)) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'permissionSnapshot 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['version', 'subjectRef', 'capturedAt'],
    'AEO_WORK_ITEM_BINDING_INVALID',
    'permissionSnapshot',
  );
  const capturedAt: string = requireNonEmptyString(
    value.capturedAt,
    'AEO_WORK_ITEM_BINDING_INVALID',
    'permissionSnapshot.capturedAt',
  );
  if (Number.isNaN(Date.parse(capturedAt))) {
    projectionError(
      'AEO_WORK_ITEM_BINDING_INVALID',
      'permissionSnapshot.capturedAt 必须是有效时间。',
    );
  }
  return {
    version: requireNonEmptyString(
      value.version,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'permissionSnapshot.version',
    ),
    subjectRef: requireNonEmptyString(
      value.subjectRef,
      'AEO_WORK_ITEM_BINDING_INVALID',
      'permissionSnapshot.subjectRef',
    ),
    capturedAt,
  };
}
