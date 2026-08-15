import {
  AEO_STRUCTURED_PARSE_CONTRACT_VERSION,
  type AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate,
} from '../../../shared/aeo-structured-parse';

import {
  canonicalStringify,
  isRecord,
  projectionError,
  requireNonEmptyString,
  requireSha256,
  sha256Hex,
} from './aeo-editor-projection.utils';

export interface AeoSpecialistDocxPackageBinding {
  formalAeoIdentity: string;
  revision: string;
  iteration: string;
  sourceMediaType: string;
  sourceByteLength: number;
  sourceSha256: string;
  currentness: string;
  parsePackageId: string;
  parsePackageHash: string;
}

export function normalizeAeoSpecialistDocxFinalPackage(
  value: unknown,
  source: AeoSpecialistDocxPackageBinding,
): AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate {
  if (!isRecord(value))
    projectionError(
      'AEO_SPECIALIST_PACKAGE_INVALID',
      'AEO 解析产物必须是对象。',
    );
  const required = [
    'contractVersion',
    'projectorVersion',
    'parsePackageId',
    'packageHash',
    'formalIdentity',
    'originalSource',
    'projectionKind',
    'reuseClass',
    'currentness',
    'mappingAuthority',
    'knowledgeAuthority',
    'knowledgeEligibility',
    'packageState',
    'taxonomyCandidate',
    'nodes',
    'findings',
    'authoringRenderedRegionReview',
  ];
  if (required.some((key) => !(key in value)))
    projectionError(
      'AEO_SPECIALIST_PACKAGE_NOT_FINAL_DOCX',
      'AEO 解析产物不是当前 DOCX 编写区域最终候选形状。',
    );
  if (
    value.contractVersion !== AEO_STRUCTURED_PARSE_CONTRACT_VERSION ||
    value.projectorVersion !== 'aeo_docx_table_projector_v1.candidate.1' ||
    value.projectionKind !== 'DOCX_TABLE_OBSERVATION_PROJECTION' ||
    value.reuseClass !== 'ADAPT_AND_REVIEW' ||
    value.mappingAuthority !== 'LOCAL_EXACT_DOCX_OBSERVATION' ||
    value.knowledgeAuthority !== 'DOCUMENT_OCCURRENCE' ||
    value.knowledgeEligibility !== 'NOT_EVALUATED'
  )
    projectionError(
      'AEO_SPECIALIST_PACKAGE_AUTHORITY_INVALID',
      '解析产物的 producer、复用类别或知识权限超出 AEO 专项候选边界。',
    );
  if (
    [
      'engineeringApproved',
      'airworthinessApproved',
      'releaseApproved',
      'productionEligible',
      'importApproved',
    ].some((key) => key in value)
  )
    projectionError(
      'AEO_SPECIALIST_PACKAGE_AUTHORITY_INVALID',
      '解析产物包含专项解析模块无权创建的批准或发布字段。',
    );
  if (!Array.isArray(value.nodes) || !Array.isArray(value.findings))
    projectionError(
      'AEO_SPECIALIST_PACKAGE_INVALID',
      '解析产物缺少节点或 Finding 数组。',
    );
  const parsePackageId = normalizeParsePackageId(value.parsePackageId);
  const packageHash = requireSha256(
    value.packageHash,
    'AEO_SPECIALIST_PACKAGE_HASH_INVALID',
    'packageHash',
  );
  const { parsePackageId: _id, packageHash: _hash, ...packageCore } = value;
  if (
    sha256Hex(canonicalStringify(packageCore)) !== packageHash ||
    parsePackageId !== `AEOPARSE-${packageHash.slice(0, 24).toUpperCase()}`
  )
    projectionError(
      'AEO_SPECIALIST_PACKAGE_INTEGRITY_FAILED',
      '解析产物 ID/hash 与 canonical package core 不一致。',
    );
  if (!isRecord(value.formalIdentity) || !isRecord(value.originalSource))
    projectionError(
      'AEO_SPECIALIST_PACKAGE_IDENTITY_INVALID',
      '解析产物缺少正式身份或原件身份。',
    );
  if (
    value.formalIdentity.organization !== 'AMECO' ||
    value.formalIdentity.formalAeoIdentity !== source.formalAeoIdentity ||
    value.formalIdentity.revision !== source.revision ||
    value.formalIdentity.iteration !== source.iteration ||
    value.originalSource.mediaType !== source.sourceMediaType ||
    value.originalSource.byteLength !== source.sourceByteLength ||
    value.originalSource.sha256 !== source.sourceSha256 ||
    value.currentness !== source.currentness ||
    parsePackageId !== source.parsePackageId ||
    packageHash !== source.parsePackageHash
  )
    projectionError(
      'AEO_SPECIALIST_PACKAGE_BINDING_MISMATCH',
      '解析产物与 DocumentVersion、正式 AEO 版次或原件 hash 不一致。',
    );
  value.nodes.forEach((node, index) =>
    validateNode(node, index, source.sourceSha256),
  );
  value.findings.forEach((finding, index) => validateFinding(finding, index));
  return value as unknown as AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate;
}

function validateNode(
  value: unknown,
  index: number,
  sourceSha256: string,
): void {
  if (!isRecord(value))
    projectionError(
      'AEO_SPECIALIST_NODE_INVALID',
      `解析节点 ${index} 不是对象。`,
    );
  const nodeId = requireNonEmptyString(
    value.nodeId,
    'AEO_SPECIALIST_NODE_INVALID',
    `nodes[${index}].nodeId`,
  );
  const nodeHash = requireSha256(
    value.nodeHash,
    'AEO_SPECIALIST_NODE_HASH_INVALID',
    `nodes[${index}].nodeHash`,
  );
  const { nodeId: _id, nodeHash: _hash, ...nodeCore } = value;
  if (sha256Hex(canonicalStringify(nodeCore)) !== nodeHash)
    projectionError(
      'AEO_SPECIALIST_NODE_INTEGRITY_FAILED',
      `解析节点 ${nodeId} 的 hash 不一致。`,
    );
  if (
    value.knowledgeAuthority !== 'DOCUMENT_OCCURRENCE' ||
    value.reviewState !== 'NEEDS_STRUCTURAL_REVIEW' ||
    value.importEligibility !== 'BLOCKED_PENDING_STRUCTURAL_REVIEW' ||
    !Array.isArray(value.sourceRefs) ||
    value.sourceRefs.some(
      (ref) => !isRecord(ref) || ref.sourceArtifactSha256 !== sourceSha256,
    )
  )
    projectionError(
      'AEO_SPECIALIST_NODE_AUTHORITY_INVALID',
      `解析节点 ${nodeId} 不满足候选知识关闭边界。`,
    );
}

function validateFinding(value: unknown, index: number): void {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    (value.severity !== 'WARNING' && value.severity !== 'BLOCKING_REVIEW') ||
    typeof value.message !== 'string'
  )
    projectionError(
      'AEO_SPECIALIST_FINDING_INVALID',
      `Finding ${index} 形状无效。`,
    );
}

function normalizeParsePackageId(value: unknown): string {
  const id = requireNonEmptyString(
    value,
    'AEO_SPECIALIST_PACKAGE_INVALID',
    'parsePackageId',
  );
  if (!/^AEOPARSE-[A-F0-9]{24}$/u.test(id))
    projectionError(
      'AEO_SPECIALIST_PACKAGE_INVALID',
      'parsePackageId 形状无效。',
    );
  return id;
}
