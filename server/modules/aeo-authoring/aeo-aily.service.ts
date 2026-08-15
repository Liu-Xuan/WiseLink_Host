import { Inject, Injectable } from '@nestjs/common';

import {
  AEO_AILY_TOOLSET_VERSION,
  type AeoAilyToolRequestBase,
  type AeoAilyToolResponse,
  type AeoCheckDraftRequest,
  type AeoFindSimilarRequest,
  type AeoSimilarCandidateSummary,
  type AeoStartAuthoringRequest,
  type AeoWorkItemReadModel,
  type AeoWorkItemReadRequest,
} from '../../../shared/aeo-integration';
import type { AeoWorkItemBindingBlocker } from '../../../shared/aeo-editor';

import {
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
} from './aeo-editor-projection.utils';
import { AeoWorkItemBindingService } from './aeo-work-item-binding.service';

export const AEO_WORK_ITEM_READ_PORT = Symbol('AEO_WORK_ITEM_READ_PORT');
export const AEO_SIMILAR_SEARCH_PORT = Symbol('AEO_SIMILAR_SEARCH_PORT');

export interface AeoWorkItemReadPort {
  read(request: AeoWorkItemReadRequest): Promise<unknown>;
}

export interface AeoSimilarSearchPort {
  search(request: {
    workItem: AeoWorkItemReadModel;
    query: string;
    sourceKinds?: AeoSimilarCandidateSummary['sourceKind'][];
  }): Promise<unknown>;
}

export async function searchAeoAuthoringCandidates(
  similar: AeoSimilarSearchPort,
  workItem: AeoWorkItemReadModel,
  seed: AeoSimilarCandidateSummary[] = [],
): Promise<AeoSimilarCandidateSummary[]> {
  const searched = normalizeSimilarCandidates(
    await similar.search({
      workItem,
      query: [
        workItem.aeoTargetIdentity.value,
        workItem.aeo.summary,
        workItem.sourceContext.document.documentVersionId,
      ].join(' '),
    }),
  );
  const merged = new Map<string, AeoSimilarCandidateSummary>();
  for (const candidate of [...normalizeSimilarCandidates(seed), ...searched]) {
    merged.set(candidate.candidateId, candidate);
  }
  return Array.from(merged.values());
}

export class UnconfiguredAeoWorkItemReadPort implements AeoWorkItemReadPort {
  async read(): Promise<AeoWorkItemReadModel> {
    projectionError(
      'CANONICAL_WORKITEM_READ_UNAVAILABLE',
      'CanonicalWorkItemStore fresh-read port 尚未冻结。',
    );
  }
}

export class UnconfiguredAeoSimilarSearchPort implements AeoSimilarSearchPort {
  async search(): Promise<AeoSimilarCandidateSummary[]> {
    projectionError(
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      'AEO 相似检索 read port 尚未冻结。',
    );
  }
}

@Injectable()
export class AeoAilyService {
  constructor(
    private readonly workItemBinding: AeoWorkItemBindingService,
    @Inject(AEO_WORK_ITEM_READ_PORT)
    private readonly workItems: AeoWorkItemReadPort,
    @Inject(AEO_SIMILAR_SEARCH_PORT)
    private readonly similar: AeoSimilarSearchPort,
  ) {}

  async findSimilar(value: unknown): Promise<AeoAilyToolResponse> {
    const input = normalizeFindSimilar(value);
    return this.run('aeo.find_similar', input, async (workItem) => {
      const items = normalizeSimilarCandidates(
        await this.similar.search({
          workItem,
          query: input.query,
          sourceKinds: input.filters?.sourceKinds,
        }),
      );
      return {
        summary: items.length
          ? `找到 ${items.length} 条待工程师复核的相似候选。`
          : '没有找到满足当前权限和筛选条件的相似候选。',
        result: { kind: 'SIMILAR_CANDIDATES' as const, items },
      };
    });
  }

  async startAuthoring(value: unknown): Promise<AeoAilyToolResponse> {
    const input = normalizeStartAuthoring(value);
    return this.run('aeo.start_authoring', input, async (workItem) => ({
      summary: '请在同一 WorkItem 的妙搭 AEO 页面继续结构化编写。',
      result: {
        kind: 'AUTHORING_ENTRY' as const,
        aeoState: workItem.aeo.state,
        templateKey: input.templateKey ?? null,
        actionRequired: 'OPEN_MIAODA' as const,
      },
    }));
  }

  async checkDraft(value: unknown): Promise<AeoAilyToolResponse> {
    const input = normalizeCheckDraft(value);
    return this.run('aeo.check_draft', input, async (workItem) => {
      const drafts = workItem.artifactIndex.filter(
        (entry) => entry.artifactKind === 'DRAFT_PACKAGE',
      );
      const draft = input.draftRef
        ? (drafts.find((entry) => entry.artifactRef === input.draftRef) ?? null)
        : (drafts.at(-1) ?? null);
      return {
        summary: draft
          ? `草稿候选可读回；当前有 ${workItem.aeo.blockers.length} 个阻断项。`
          : '当前 WorkItem 尚无 DraftPackage artifact。',
        result: {
          kind: 'DRAFT_CHECK' as const,
          draft,
          blockingFindings: workItem.aeo.blockers,
        },
      };
    });
  }

  async listTodos(value: unknown): Promise<AeoAilyToolResponse> {
    const input = normalizeCommonRequest(value);
    return this.run('aeo.list_todos', input, async (workItem) => ({
      summary: `当前 WorkItem 有 ${workItem.todos.length} 个 AEO 待办。`,
      result: { kind: 'TODOS' as const, items: workItem.todos },
    }));
  }

  async getDeepLink(value: unknown): Promise<AeoAilyToolResponse> {
    const input = normalizeCommonRequest(value);
    return this.run('workitem.get_deep_link', input, async () => ({
      summary: '已生成同一 WorkItem 的 canonical 妙搭深链。',
      result: { kind: 'DEEP_LINK' as const },
    }));
  }

  private async run(
    tool: AeoAilyToolResponse['tool'],
    input: AeoAilyToolRequestBase,
    operation: (
      workItem: AeoWorkItemReadModel,
    ) => Promise<Pick<AeoAilyToolResponse, 'summary' | 'result'>>,
  ): Promise<AeoAilyToolResponse> {
    const observedAt = new Date().toISOString();
    const roleGate = this.workItemBinding.readRoleGate();
    if (roleGate.status === 'BLOCKED' || !roleGate.miaodaBaseUrl) {
      return blocked(tool, input.workItemId, observedAt, roleGate.blockers);
    }

    let workItem: AeoWorkItemReadModel;
    try {
      workItem = normalizeWorkItemReadModel(
        await this.workItems.read({
          workItemId: input.workItemId,
          requesterRef: input.requesterRef,
          permissionSnapshotVersion: input.permissionSnapshotVersion,
        }),
      );
    } catch (error) {
      const code = readErrorCode(error);
      return blocked(tool, input.workItemId, observedAt, [
        {
          code:
            code === 'WORKITEM_PROJECTION_INVALID'
              ? 'WORKITEM_PROJECTION_INVALID'
              : 'CANONICAL_WORKITEM_READ_UNAVAILABLE',
          role: 'CanonicalWorkItemStore',
          message: `${code}: WorkItem fresh-read 失败。`,
        },
      ]);
    }
    const deepLink = buildDeepLink(
      roleGate.miaodaBaseUrl,
      workItem.workItemId,
      workItem.requestId,
      workItem.stateVersion,
      workItem.permissionSnapshotVersion,
    );
    if (workItem.stateVersion !== input.expectedStateVersion) {
      return blocked(
        tool,
        input.workItemId,
        observedAt,
        [
          {
            code: 'WORKITEM_STATE_CONFLICT',
            role: 'CanonicalWorkItemStore',
            message: 'WorkItem stateVersion 已变化，请重新读取。',
          },
        ],
        workItem.stateVersion,
        deepLink,
      );
    }
    if (
      workItem.permissionSnapshotVersion !== input.permissionSnapshotVersion
    ) {
      return blocked(
        tool,
        input.workItemId,
        observedAt,
        [
          {
            code: 'PERMISSION_SNAPSHOT_STALE',
            role: 'CanonicalWorkItemStore',
            message: 'permission snapshot 已变化，请重新授权并读取。',
          },
        ],
        workItem.stateVersion,
        deepLink,
      );
    }
    if (
      workItem.authoringPurpose !== 'AEO' ||
      workItem.aeoTargetIdentity.confirmationStatus !== 'HUMAN_CONFIRMED' ||
      workItem.aeoTargetIdentity.authority !==
        'CANONICAL_WORKITEM_SERVER_FRESH_READ' ||
      workItem.sourceContext.document.classificationStatus !== 'CONFIRMED'
    ) {
      return blocked(
        tool,
        input.workItemId,
        observedAt,
        [
          {
            code: 'DOCUMENT_CLASSIFICATION_NOT_CONFIRMED',
            role: 'CanonicalDocumentCatalog',
            message:
              '只有 server fresh-read 且人工确认 AEO target 的 WorkItem 可调用 AEO 工具。',
          },
        ],
        workItem.stateVersion,
        deepLink,
      );
    }

    let output: Pick<AeoAilyToolResponse, 'summary' | 'result'>;
    try {
      output = await operation(workItem);
    } catch (error) {
      const code = readErrorCode(error);
      return blocked(
        tool,
        input.workItemId,
        observedAt,
        [
          {
            code:
              code === 'AEO_SIMILAR_SEARCH_UNAVAILABLE'
                ? 'AEO_SIMILAR_SEARCH_UNAVAILABLE'
                : 'AEO_TOOL_OPERATION_FAILED',
            role: null,
            message: `${code}: AEO 工具 read operation 失败。`,
          },
        ],
        workItem.stateVersion,
        deepLink,
      );
    }
    return {
      schemaVersion: AEO_AILY_TOOLSET_VERSION,
      status: 'READY',
      tool,
      workItemId: workItem.workItemId,
      stateVersion: workItem.stateVersion,
      observedAt: workItem.observedAt,
      blockers: [],
      deepLink,
      authority: 'AILY_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
      ...output,
    };
  }
}

function blocked(
  tool: AeoAilyToolResponse['tool'],
  workItemId: string,
  observedAt: string,
  blockers: AeoWorkItemBindingBlocker[],
  stateVersion: number | null = null,
  deepLink: string | null = null,
): AeoAilyToolResponse {
  return {
    schemaVersion: AEO_AILY_TOOLSET_VERSION,
    status: 'BLOCKED',
    tool,
    workItemId,
    stateVersion,
    observedAt,
    blockers,
    deepLink,
    summary: blockers.map((item) => item.message).join('；'),
    result: { kind: 'NONE' },
    authority: 'AILY_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
  };
}

function buildDeepLink(
  baseUrl: string,
  workItemId: string,
  requestId: string,
  stateVersion: number,
  permissionSnapshotVersion: string,
): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/aeo-authoring`;
  url.searchParams.set('workItemId', workItemId);
  url.searchParams.set('requestId', requestId);
  url.searchParams.set('stateVersion', String(stateVersion));
  url.searchParams.set('permissionSnapshotVersion', permissionSnapshotVersion);
  return url.toString();
}

function readErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'CANONICAL_WORKITEM_READ_FAILED';
}

function normalizeCommonRequest(value: unknown): AeoAilyToolRequestBase {
  return normalizeBase(value, []);
}

function normalizeFindSimilar(value: unknown): AeoFindSimilarRequest {
  const base = normalizeBase(value, ['query'], ['filters']);
  const record = value as Record<string, unknown>;
  const query = requireNonEmptyString(
    record.query,
    'AEO_AILY_REQUEST_INVALID',
    'query',
  );
  if (query.length > 2_000) {
    projectionError('AEO_AILY_REQUEST_INVALID', 'query 不能超过 2000 字符。');
  }
  return { ...base, query, filters: normalizeFilters(record.filters) };
}

function normalizeStartAuthoring(value: unknown): AeoStartAuthoringRequest {
  const base = normalizeBase(value, [], ['templateKey']);
  const templateKey = (value as Record<string, unknown>).templateKey;
  if (templateKey !== undefined && typeof templateKey !== 'string') {
    projectionError(
      'AEO_AILY_REQUEST_INVALID',
      'templateKey 如提供必须是字符串。',
    );
  }
  return {
    ...base,
    templateKey:
      typeof templateKey === 'string' ? templateKey.trim() : undefined,
  };
}

function normalizeCheckDraft(value: unknown): AeoCheckDraftRequest {
  const base = normalizeBase(value, [], ['draftRef']);
  const draftRef = (value as Record<string, unknown>).draftRef;
  if (draftRef !== undefined && typeof draftRef !== 'string') {
    projectionError(
      'AEO_AILY_REQUEST_INVALID',
      'draftRef 如提供必须是字符串。',
    );
  }
  return {
    ...base,
    draftRef: typeof draftRef === 'string' ? draftRef.trim() : undefined,
  };
}

function normalizeBase(
  value: unknown,
  requiredExtraKeys: string[],
  optionalExtraKeys: string[] = [],
): AeoAilyToolRequestBase {
  if (!isRecord(value)) {
    projectionError('AEO_AILY_REQUEST_INVALID', '请求必须是对象。');
  }
  const baseKeys = [
    'workItemId',
    'requesterRef',
    'permissionSnapshotVersion',
    'expectedStateVersion',
  ];
  const presentOptional = optionalExtraKeys.filter((key) => key in value);
  requireExactKeys(
    value,
    [...baseKeys, ...requiredExtraKeys, ...presentOptional],
    'AEO_AILY_REQUEST_INVALID',
    'request',
  );
  return {
    workItemId: requireNonEmptyString(
      value.workItemId,
      'AEO_AILY_REQUEST_INVALID',
      'workItemId',
    ),
    requesterRef: requireNonEmptyString(
      value.requesterRef,
      'AEO_AILY_REQUEST_INVALID',
      'requesterRef',
    ),
    permissionSnapshotVersion: requireNonEmptyString(
      value.permissionSnapshotVersion,
      'AEO_AILY_REQUEST_INVALID',
      'permissionSnapshotVersion',
    ),
    expectedStateVersion: requirePositiveInteger(
      value.expectedStateVersion,
      'AEO_AILY_REQUEST_INVALID',
      'expectedStateVersion',
    ),
  };
}

function normalizeFilters(value: unknown): AeoFindSimilarRequest['filters'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    projectionError('AEO_AILY_REQUEST_INVALID', 'filters 必须是对象。');
  }
  requireExactKeys(
    value,
    ['sourceKinds'],
    'AEO_AILY_REQUEST_INVALID',
    'filters',
  );
  if (!Array.isArray(value.sourceKinds)) {
    projectionError(
      'AEO_AILY_REQUEST_INVALID',
      'filters.sourceKinds 必须是数组。',
    );
  }
  const allowed = new Set([
    'HISTORICAL_AEO',
    'CATEGORY_PATTERN',
    'SB_SOURCE',
    'OEM_REFERENCE',
    'AI_SUGGESTION',
  ]);
  const sourceKinds = value.sourceKinds.map((item) => {
    if (typeof item !== 'string' || !allowed.has(item)) {
      projectionError(
        'AEO_AILY_REQUEST_INVALID',
        'filters.sourceKinds 含未知类型。',
      );
    }
    return item as AeoSimilarCandidateSummary['sourceKind'];
  });
  return { sourceKinds };
}

export function normalizeWorkItemReadModel(
  value: unknown,
): AeoWorkItemReadModel {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'WorkItem 投影必须是对象。');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'workItemId',
      'requestId',
      'stateVersion',
      'permissionSnapshotVersion',
      'sourceDocumentFamily',
      'authoringPurpose',
      'aeoTargetIdentity',
      'validationRun',
      'sourceContext',
      'authoringSeed',
      'aeo',
      'artifactIndex',
      'todos',
      'observedAt',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'workItem',
  );
  if (
    value.schemaVersion !== 'wiselink.3_1.aeo_artifact_index.v0.candidate.2'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'WorkItem 投影 schemaVersion 不受支持。',
    );
  }
  const sourceDocumentFamily = normalizeSourceDocumentFamily(
    value.sourceDocumentFamily,
  );
  if (value.authoringPurpose !== 'AEO') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringPurpose 必须是 AEO。',
    );
  }
  const aeoTargetIdentity = normalizeAeoTargetIdentity(value.aeoTargetIdentity);
  const sourceContext = normalizeSourceContext(
    value.sourceContext,
    sourceDocumentFamily,
  );
  const authoringSeed = normalizeAuthoringSeed(value.authoringSeed);
  const aeo = normalizeWorkItemAeo(value.aeo);
  if (!Array.isArray(value.artifactIndex) || !Array.isArray(value.todos)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'artifactIndex 和 todos 必须是数组。',
    );
  }
  const observedAt = requireNonEmptyString(
    value.observedAt,
    'WORKITEM_PROJECTION_INVALID',
    'observedAt',
  );
  if (Number.isNaN(Date.parse(observedAt))) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'observedAt 必须是有效时间。',
    );
  }
  return {
    schemaVersion: 'wiselink.3_1.aeo_artifact_index.v0.candidate.2',
    workItemId: requireNonEmptyString(
      value.workItemId,
      'WORKITEM_PROJECTION_INVALID',
      'workItemId',
    ),
    requestId: requireNonEmptyString(
      value.requestId,
      'WORKITEM_PROJECTION_INVALID',
      'requestId',
    ),
    stateVersion: requirePositiveInteger(
      value.stateVersion,
      'WORKITEM_PROJECTION_INVALID',
      'stateVersion',
    ),
    permissionSnapshotVersion: requireNonEmptyString(
      value.permissionSnapshotVersion,
      'WORKITEM_PROJECTION_INVALID',
      'permissionSnapshotVersion',
    ),
    sourceDocumentFamily,
    authoringPurpose: 'AEO',
    aeoTargetIdentity,
    validationRun: normalizeValidationRun(value.validationRun),
    sourceContext,
    authoringSeed,
    aeo,
    artifactIndex: value.artifactIndex.map(normalizeArtifactIndexEntry),
    todos: value.todos.map(normalizeTodo),
    observedAt,
  };
}

function normalizeValidationRun(
  value: unknown,
): AeoWorkItemReadModel['validationRun'] {
  if (value === null) return null;
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'validationRun 必须是对象或 null。',
    );
  }
  requireExactKeys(
    value,
    [
      'purpose',
      'runId',
      'manifestArtifactRef',
      'manifestArtifactSha256',
      'authorizedByDecisionId',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'validationRun',
  );
  if (value.purpose !== 'AEO_CANDIDATE_VERTICAL') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'validationRun purpose 不受支持。',
    );
  }
  return {
    purpose: 'AEO_CANDIDATE_VERTICAL',
    runId: requireNonEmptyString(
      value.runId,
      'WORKITEM_PROJECTION_INVALID',
      'validationRun.runId',
    ),
    manifestArtifactRef: requireArtifactRef(
      value.manifestArtifactRef,
      'validationRun.manifestArtifactRef',
    ),
    manifestArtifactSha256: requireSha256String(
      value.manifestArtifactSha256,
      'validationRun.manifestArtifactSha256',
    ),
    authorizedByDecisionId: requireNonEmptyString(
      value.authorizedByDecisionId,
      'WORKITEM_PROJECTION_INVALID',
      'validationRun.authorizedByDecisionId',
    ),
  };
}

function normalizeSourceDocumentFamily(
  value: unknown,
): AeoWorkItemReadModel['sourceDocumentFamily'] {
  if (value !== 'AEO' && value !== 'SB') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceDocumentFamily 必须是 AEO 或 SB。',
    );
  }
  return value;
}

function normalizeAeoTargetIdentity(
  value: unknown,
): AeoWorkItemReadModel['aeoTargetIdentity'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'aeoTargetIdentity 必须是 server fresh-read 对象。',
    );
  }
  requireExactKeys(
    value,
    ['value', 'confirmationStatus', 'authority', 'confirmationRef'],
    'WORKITEM_PROJECTION_INVALID',
    'aeoTargetIdentity',
  );
  if (
    value.confirmationStatus !== 'HUMAN_CONFIRMED' ||
    value.authority !== 'CANONICAL_WORKITEM_SERVER_FRESH_READ'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'aeoTargetIdentity 必须来自 server fresh-read 的人工确认记录。',
    );
  }
  return {
    value: requireNonEmptyString(
      value.value,
      'WORKITEM_PROJECTION_INVALID',
      'aeoTargetIdentity.value',
    ),
    confirmationStatus: 'HUMAN_CONFIRMED',
    authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
    confirmationRef: requireArtifactRef(
      value.confirmationRef,
      'aeoTargetIdentity.confirmationRef',
    ),
  };
}

function normalizeSourceContext(
  value: unknown,
  sourceDocumentFamily: AeoWorkItemReadModel['sourceDocumentFamily'],
): AeoWorkItemReadModel['sourceContext'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['document', 'parsedPackage', 'assessment'],
    'WORKITEM_PROJECTION_INVALID',
    'sourceContext',
  );
  const assessment = normalizeAssessmentContext(value.assessment);
  if (sourceDocumentFamily === 'SB' && assessment === null) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'SB source WorkItem 必须带 current Assessment exact ref。',
    );
  }
  return {
    document: normalizeSourceDocument(value.document),
    parsedPackage: normalizeSourceParsedPackage(
      value.parsedPackage,
      'sourceContext.parsedPackage',
    ),
    assessment,
  };
}

function normalizeSourceParsedPackage(
  value: unknown,
  field: string,
): AeoWorkItemReadModel['sourceContext']['parsedPackage'] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', `${field} 必须是对象。`);
  }
  requireExactKeys(
    value,
    [
      'packageId',
      'artifactRef',
      'artifactSha256',
      'contractId',
      'contractRevision',
      'readerReceiptId',
      'fullValidatorRevision',
      'validationStatus',
    ],
    'WORKITEM_PROJECTION_INVALID',
    field,
  );
  if (value.validationStatus !== 'ACCEPTED') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须有 ACCEPTED Reader receipt。`,
    );
  }
  return {
    packageId: requireNonEmptyString(
      value.packageId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.packageId`,
    ),
    artifactRef: requireArtifactRef(value.artifactRef, `${field}.artifactRef`),
    artifactSha256: requireSha256String(
      value.artifactSha256,
      `${field}.artifactSha256`,
    ),
    contractId: requireNonEmptyString(
      value.contractId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractId`,
    ),
    contractRevision: requireNonEmptyString(
      value.contractRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractRevision`,
    ),
    readerReceiptId: requireNonEmptyString(
      value.readerReceiptId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.readerReceiptId`,
    ),
    fullValidatorRevision: requireNonEmptyString(
      value.fullValidatorRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.fullValidatorRevision`,
    ),
    validationStatus: 'ACCEPTED',
  };
}

function normalizeSourceDocument(
  value: unknown,
): AeoWorkItemReadModel['sourceContext']['document'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'documentId',
      'documentVersionId',
      'classificationStatus',
      'catalogRole',
      'classificationFingerprint',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'sourceContext.document',
  );
  if (
    value.classificationStatus !== 'CONFIRMED' ||
    value.catalogRole !== 'CanonicalDocumentCatalog'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document 必须是 Catalog CONFIRMED exact version。',
    );
  }
  return {
    documentId: requireNonEmptyString(
      value.documentId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document.documentId',
    ),
    documentVersionId: requireNonEmptyString(
      value.documentVersionId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document.documentVersionId',
    ),
    classificationStatus: 'CONFIRMED',
    catalogRole: 'CanonicalDocumentCatalog',
    classificationFingerprint: requireSha256Fingerprint(
      value.classificationFingerprint,
      'sourceContext.document.classificationFingerprint',
    ),
  };
}

function normalizeAuthoringSeed(
  value: unknown,
): AeoWorkItemReadModel['authoringSeed'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['document', 'parsedPackage', 'aeoIdentity'],
    'WORKITEM_PROJECTION_INVALID',
    'authoringSeed',
  );
  const document = normalizeAuthoringSeedDocument(value.document);
  return {
    document,
    parsedPackage: normalizeAcceptedParsedPackage(
      value.parsedPackage,
      'authoringSeed.parsedPackage',
    ),
    aeoIdentity: requireNonEmptyString(
      value.aeoIdentity,
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.aeoIdentity',
    ),
  };
}

function normalizeAuthoringSeedDocument(
  value: unknown,
): AeoWorkItemReadModel['authoringSeed']['document'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'documentId',
      'documentVersionId',
      'family',
      'classificationStatus',
      'catalogRole',
      'classificationFingerprint',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'authoringSeed.document',
  );
  if (
    value.family !== 'AEO' ||
    value.classificationStatus !== 'CONFIRMED' ||
    value.catalogRole !== 'CanonicalDocumentCatalog'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document 必须是 Catalog CONFIRMED 的 AEO exact version。',
    );
  }
  return {
    documentId: requireNonEmptyString(
      value.documentId,
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document.documentId',
    ),
    documentVersionId: requireNonEmptyString(
      value.documentVersionId,
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document.documentVersionId',
    ),
    family: 'AEO',
    classificationStatus: 'CONFIRMED',
    catalogRole: 'CanonicalDocumentCatalog',
    classificationFingerprint: requireSha256Fingerprint(
      value.classificationFingerprint,
      'authoringSeed.document.classificationFingerprint',
    ),
  };
}

function normalizeAcceptedParsedPackage(
  value: unknown,
  field: string,
): AeoWorkItemReadModel['authoringSeed']['parsedPackage'] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', `${field} 必须是对象。`);
  }
  requireExactKeys(
    value,
    [
      'packageId',
      'artifactRef',
      'artifactSha256',
      'contractId',
      'contractRevision',
      'readerReceiptId',
      'readerRevision',
      'validationStatus',
    ],
    'WORKITEM_PROJECTION_INVALID',
    field,
  );
  if (value.validationStatus !== 'ACCEPTED') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须有 ACCEPTED Reader receipt。`,
    );
  }
  return {
    packageId: requireNonEmptyString(
      value.packageId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.packageId`,
    ),
    artifactRef: requireArtifactRef(value.artifactRef, `${field}.artifactRef`),
    artifactSha256: requireSha256String(
      value.artifactSha256,
      `${field}.artifactSha256`,
    ),
    contractId: requireNonEmptyString(
      value.contractId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractId`,
    ),
    contractRevision: requireNonEmptyString(
      value.contractRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractRevision`,
    ),
    readerReceiptId: requireNonEmptyString(
      value.readerReceiptId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.readerReceiptId`,
    ),
    readerRevision: requireNonEmptyString(
      value.readerRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.readerRevision`,
    ),
    validationStatus: 'ACCEPTED',
  };
}

function normalizeAssessmentContext(
  value: unknown,
): AeoWorkItemReadModel['sourceContext']['assessment'] {
  if (value === null) return null;
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment 必须是对象或 null。',
    );
  }
  requireExactKeys(
    value,
    [
      'status',
      'criterionSetId',
      'criterionCount',
      'evaluationItemCount',
      'packageStatus',
      'applicabilityOverall',
      'authorityLevel',
      'blocksEngineeringClosure',
      'externalDiscoveryStatus',
      'externalDiscoveryIsEvidence',
      'previousOverallStale',
      'staleReason',
      'currentContextHash',
      'currentTransportHash',
      'artifactRef',
      'artifactSha256',
      'artifactByteLength',
      'evaluateAttemptId',
      'resynthesisAttemptId',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'sourceContext.assessment',
  );
  if (
    !['CANDIDATE_ONLY', 'CANDIDATE_ONLY_RESYNTHESIZED'].includes(
      String(value.status),
    ) ||
    value.authorityLevel !== 'candidate_only' ||
    value.blocksEngineeringClosure !== true ||
    value.externalDiscoveryIsEvidence !== false
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'Assessment 必须保持 candidate_only、阻断工程关闭且 discovery 非证据。',
    );
  }
  if (
    value.staleReason !== null &&
    value.staleReason !== 'ENGINEER_ITEM_SET_CHANGED' &&
    value.staleReason !== 'EXTERNAL_CONTEXT_STALE'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'Assessment staleReason 不受支持。',
    );
  }
  return {
    status: value.status as NonNullable<
      AeoWorkItemReadModel['sourceContext']['assessment']
    >['status'],
    criterionSetId: requireNonEmptyString(
      value.criterionSetId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.criterionSetId',
    ),
    criterionCount: requirePositiveInteger(
      value.criterionCount,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.criterionCount',
    ),
    evaluationItemCount: requirePositiveInteger(
      value.evaluationItemCount,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.evaluationItemCount',
    ),
    packageStatus: requireNonEmptyString(
      value.packageStatus,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.packageStatus',
    ),
    applicabilityOverall: requireNonEmptyString(
      value.applicabilityOverall,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.applicabilityOverall',
    ),
    authorityLevel: 'candidate_only',
    blocksEngineeringClosure: true,
    externalDiscoveryStatus:
      value.externalDiscoveryStatus === null
        ? null
        : requireNonEmptyString(
            value.externalDiscoveryStatus,
            'WORKITEM_PROJECTION_INVALID',
            'sourceContext.assessment.externalDiscoveryStatus',
          ),
    externalDiscoveryIsEvidence: false,
    previousOverallStale: requireBoolean(
      value.previousOverallStale,
      'sourceContext.assessment.previousOverallStale',
    ),
    staleReason: value.staleReason as NonNullable<
      AeoWorkItemReadModel['sourceContext']['assessment']
    >['staleReason'],
    currentContextHash: requireSha256Fingerprint(
      value.currentContextHash,
      'sourceContext.assessment.currentContextHash',
    ),
    currentTransportHash: requireSha256Fingerprint(
      value.currentTransportHash,
      'sourceContext.assessment.currentTransportHash',
    ),
    artifactRef: requireArtifactRef(
      value.artifactRef,
      'sourceContext.assessment.artifactRef',
    ),
    artifactSha256: requireSha256String(
      value.artifactSha256,
      'sourceContext.assessment.artifactSha256',
    ),
    artifactByteLength: requirePositiveInteger(
      value.artifactByteLength,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.artifactByteLength',
    ),
    evaluateAttemptId: requireNonEmptyString(
      value.evaluateAttemptId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.evaluateAttemptId',
    ),
    resynthesisAttemptId:
      value.resynthesisAttemptId === null
        ? null
        : requireNonEmptyString(
            value.resynthesisAttemptId,
            'WORKITEM_PROJECTION_INVALID',
            'sourceContext.assessment.resynthesisAttemptId',
          ),
  };
}

function normalizeWorkItemAeo(value: unknown): AeoWorkItemReadModel['aeo'] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo 必须是对象。');
  }
  requireExactKeys(
    value,
    ['state', 'stateVersion', 'summary', 'blockers'],
    'WORKITEM_PROJECTION_INVALID',
    'aeo',
  );
  const states = new Set([
    'NOT_STARTED',
    'PARSE_READY',
    'AUTHORING',
    'CHECKPOINTED',
    'BLOCKED',
  ]);
  if (typeof value.state !== 'string' || !states.has(value.state)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo.state 不受支持。');
  }
  if (!Array.isArray(value.blockers)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo.blockers 必须是数组。');
  }
  const summary = requireNonEmptyString(
    value.summary,
    'WORKITEM_PROJECTION_INVALID',
    'aeo.summary',
  );
  if (summary.length > 2_000) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo.summary 过长。');
  }
  return {
    state: value.state as AeoWorkItemReadModel['aeo']['state'],
    stateVersion: requireNonEmptyString(
      value.stateVersion,
      'WORKITEM_PROJECTION_INVALID',
      'aeo.stateVersion',
    ),
    summary,
    blockers: value.blockers.map((item, index) => {
      const blocker = requireNonEmptyString(
        item,
        'WORKITEM_PROJECTION_INVALID',
        `aeo.blockers[${index}]`,
      );
      if (blocker.length > 2_000) {
        projectionError('WORKITEM_PROJECTION_INVALID', 'AEO blocker 过长。');
      }
      return blocker;
    }),
  };
}

function normalizeArtifactIndexEntry(
  value: unknown,
): AeoWorkItemReadModel['artifactIndex'][number] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'artifact entry 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'artifactKind',
      'storeRole',
      'artifactRef',
      'artifactSha256',
      'byteLength',
      'mediaType',
      'schemaVersion',
      'workingRevision',
      'casToken',
      'state',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'artifactIndex[]',
  );
  const kinds = new Set([
    'SOURCE_DOCUMENT',
    'PARSED_PACKAGE',
    'AUTHORING_BOOTSTRAP',
    'WORKING_COPY',
    'DRAFT_PACKAGE',
    'WORD_EXPORT',
    'RELEASE_PACKAGE',
    'XML_EXPORT',
  ]);
  const states = new Set(['AVAILABLE', 'CANDIDATE', 'BLOCKED']);
  if (
    typeof value.artifactKind !== 'string' ||
    !kinds.has(value.artifactKind)
  ) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'artifactKind 不受支持。');
  }
  if (value.storeRole !== 'CanonicalArtifactStore') {
    projectionError('WORKITEM_PROJECTION_INVALID', 'artifact storeRole 错误。');
  }
  if (typeof value.state !== 'string' || !states.has(value.state)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'artifact state 不受支持。');
  }
  const artifactRef = requireArtifactRef(value.artifactRef, 'artifactRef');
  const sha256 = requireSha256String(value.artifactSha256, 'artifactSha256');
  if (
    value.workingRevision !== null &&
    (!Number.isInteger(value.workingRevision) ||
      Number(value.workingRevision) < 1)
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'workingRevision 必须是正整数或 null。',
    );
  }
  if (value.casToken !== null && typeof value.casToken !== 'string') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'casToken 必须是字符串或 null。',
    );
  }
  return {
    artifactKind:
      value.artifactKind as AeoWorkItemReadModel['artifactIndex'][number]['artifactKind'],
    storeRole: 'CanonicalArtifactStore',
    artifactRef,
    artifactSha256: sha256,
    byteLength: requirePositiveInteger(
      value.byteLength,
      'WORKITEM_PROJECTION_INVALID',
      'artifact.byteLength',
    ),
    mediaType: requireNonEmptyString(
      value.mediaType,
      'WORKITEM_PROJECTION_INVALID',
      'artifact.mediaType',
    ),
    schemaVersion: requireNonEmptyString(
      value.schemaVersion,
      'WORKITEM_PROJECTION_INVALID',
      'artifact.schemaVersion',
    ),
    workingRevision: value.workingRevision as number | null,
    casToken: value.casToken as string | null,
    state:
      value.state as AeoWorkItemReadModel['artifactIndex'][number]['state'],
  };
}

function normalizeTodo(value: unknown): AeoWorkItemReadModel['todos'][number] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'todo 必须是对象。');
  }
  requireExactKeys(
    value,
    ['todoId', 'label', 'state'],
    'WORKITEM_PROJECTION_INVALID',
    'todos[]',
  );
  if (!['OPEN', 'DONE', 'BLOCKED'].includes(String(value.state))) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'todo.state 不受支持。');
  }
  return {
    todoId: requireNonEmptyString(
      value.todoId,
      'WORKITEM_PROJECTION_INVALID',
      'todo.todoId',
    ),
    label: requireNonEmptyString(
      value.label,
      'WORKITEM_PROJECTION_INVALID',
      'todo.label',
    ),
    state: value.state as AeoWorkItemReadModel['todos'][number]['state'],
  };
}

export function normalizeSimilarCandidates(
  value: unknown,
): AeoSimilarCandidateSummary[] {
  if (!Array.isArray(value)) {
    projectionError(
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      '相似检索结果必须是数组。',
    );
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      projectionError('AEO_SIMILAR_SEARCH_UNAVAILABLE', '候选必须是对象。');
    }
    requireExactKeys(
      item,
      [
        'candidateId',
        'sourceKind',
        'title',
        'reason',
        'sourceArtifactRef',
        'sourceArtifactSha256',
        'eligibility',
      ],
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      'candidate',
    );
    const sourceKinds = new Set([
      'HISTORICAL_AEO',
      'CATEGORY_PATTERN',
      'SB_SOURCE',
      'OEM_REFERENCE',
      'AI_SUGGESTION',
    ]);
    if (
      typeof item.sourceKind !== 'string' ||
      !sourceKinds.has(item.sourceKind)
    ) {
      projectionError(
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        '候选 sourceKind 错误。',
      );
    }
    if (item.eligibility !== 'CANDIDATE_REQUIRES_REVIEW') {
      projectionError(
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        '候选不能自动获得知识资格。',
      );
    }
    return {
      candidateId: requireNonEmptyString(
        item.candidateId,
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        'candidateId',
      ),
      sourceKind: item.sourceKind as AeoSimilarCandidateSummary['sourceKind'],
      title: requireNonEmptyString(
        item.title,
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        'title',
      ),
      reason: requireNonEmptyString(
        item.reason,
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        'reason',
      ),
      sourceArtifactRef: requireArtifactRef(
        item.sourceArtifactRef,
        'sourceArtifactRef',
      ),
      sourceArtifactSha256: requireSha256String(
        item.sourceArtifactSha256,
        'sourceArtifactSha256',
      ),
      eligibility: 'CANDIDATE_REQUIRES_REVIEW' as const,
    };
  });
}

function requireArtifactRef(value: unknown, field: string): string {
  const ref = requireNonEmptyString(
    value,
    'WORKITEM_PROJECTION_INVALID',
    field,
  );
  if (
    !/^(artifact|drive|miaoda-file):\/\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/u.test(
      ref,
    )
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须是受控 artifact ref，不能是本机路径或任意 URL。`,
    );
  }
  return ref;
}

function requireSha256String(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须是 lowercase SHA-256。`,
    );
  }
  return value;
}

function requireSha256Fingerprint(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须是 sha256:<64-hex>。`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    projectionError('WORKITEM_PROJECTION_INVALID', `${field} 必须是 boolean。`);
  }
  return value;
}
