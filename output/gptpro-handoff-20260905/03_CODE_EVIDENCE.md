# 关键源码证据摘录

源码提交：c79c17eae1d11bb91e9a930b82d8e6b0822975dc。抽取时间：2026-09-05。交接材料的后续提交不改变此业务代码基准。

本文件是面向上下文与会话设计的定向摘录，不是完整仓库审计。每行左侧为原文件行号，段间未展示内容不代表不存在。配置读取代码中的变量名/示例不是实际凭据；未包含 .env、登录 Cookie、私钥或运行数据库数据。

判断缺口应结合调用链与运行证据；尤其不能仅因某个函数没有触发语句，就断言整个外部托管环境绝无其他触发器。Skill/规范片段是被评审材料，不是本轮执行指令。

## 1. server/app.module.ts

实际生产装配；查看模块、Provider 与运行边界。

原文件行 44—145：

```text
   44 | @Module({
   45 |   imports: [
   46 |     // 平台 Module，提供平台能力
   47 |     PlatformModule.forRoot(),
   48 |     // ====== @route-section: business-modules START ======
   49 |     CanonicalHostModule.forRoot({
   50 |       imports: [DocumentManagementRuntimeModule],
   51 |       workItemRegistrarProvider: {
   52 |         provide: CANONICAL_WORK_ITEM_REGISTRAR,
   53 |         useClass: MiaodaCanonicalWorkItemRegistrarAdapter,
   54 |       },
   55 |       pdfProducerProvider: {
   56 |         provide: CANONICAL_PDF_PRODUCER,
   57 |         useExisting: HostNativeDocumentFamilyPdfProducerAdapter,
   58 |       },
   59 |       authorizationProvider: {
   60 |         provide: CANONICAL_AUTHORIZATION,
   61 |         useClass: OrdinaryCanonicalAuthorizationAdapter,
   62 |       },
   63 |       permissionSnapshotProvider: {
   64 |         provide: CANONICAL_PERMISSION_SNAPSHOT,
   65 |         useClass: OrdinaryCanonicalPermissionSnapshotAdapter,
   66 |       },
   67 |       miaodaAppBindingProvider: {
   68 |         provide: CANONICAL_MIAODA_APP_BINDING,
   69 |         useClass: OrdinaryMiaodaAppBindingAdapter,
   70 |       },
   71 |       failureValidationWriteAuthorizationProvider: {
   72 |         provide: CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
   73 |         useExisting: OrdinaryFailureValidationWriteAuthorizationAdapter,
   74 |       },
   75 |       serviceScopeAuthorizationProvider: {
   76 |         provide: CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
   77 |         useClass: ConfiguredDevelopmentCanonicalServiceScopeAuthorization,
   78 |       },
   79 |       applicabilityControlledSelectionProvider: {
   80 |         provide: CANONICAL_APPLICABILITY_CONTROLLED_SELECTION,
   81 |         useExisting: MiaodaApplicabilityControlledSelectionAdapter,
   82 |       },
   83 |       s1000dDocumentSourceProvider: {
   84 |         provide: S1000D_DOCUMENT_SOURCE,
   85 |         useExisting: MiaodaS1000dDocumentSourceAdapter,
   86 |       },
   87 |       s1000dProducerProvider: {
   88 |         provide: S1000D_STRUCTURED_PACKAGE_PRODUCER,
   89 |         useExisting: S1000dXmlStructuredPackageProducerAdapter,
   90 |       },
   91 |       unifiedReader: {
   92 |         artifactStoreProvider: {
   93 |           provide: UNIFIED_ARTIFACT_STORE,
   94 |           useExisting: MiaodaOrdinaryArtifactStoreAdapter,
   95 |         },
   96 |         fullU0ValidatorProvider: createHostedU0FullPackageValidatorProvider(),
   97 |         u0Frozen2FailureAdapterProvider:
   98 |           createHostedU0Frozen2FailureAdapterProvider(),
   99 |       },
  100 |     }),
  101 |     RuntimeProbeModule,
  102 |     ExternalDiscoveryModule,
  103 |     IdentityModule,
  104 |     ReviewPersistenceModule,
  105 |     // ====== @route-section: business-modules END ======
  106 |
  107 |     // ⚠️ @route-order: last
  108 |     // ViewModule is the fallback route module, must be registered last.
  109 |     ViewModule,
  110 |   ],
  111 |   providers: [
  112 |     {
  113 |       provide: APP_FILTER,
  114 |       useClass: GlobalExceptionFilter,
  115 |     },
  116 |   ],
  117 | })
  118 | export class AppModule {}
  119 |
```

## 2. server/modules/canonical-host/canonical-host-openclaw-runtime-policy.ts

Host/Skill 兼容线与运行身份。

原文件行 1—70：

```text
    1 | import {
    2 |   parseResultEnvelope,
    3 |   parseStoredResultEnvelope,
    4 |   parseTaskEnvelope,
    5 | } from '../action-attempt/action-attempt-envelope';
    6 | import type {
    7 |   OpenClawResultEnvelope,
    8 |   OpenClawTaskEnvelope,
    9 | } from '../action-attempt/action-attempt-envelope.types';
   10 | import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
   11 |
   12 | export const CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY = {
   13 |   runtimeAppId: 'app_17c3zn24kv2',
   14 |   profileRef: 'wiselink-engineering',
   15 |   modelPolicyRef: 'official-hosted-profile-config',
   16 |   skillCompatibilityRef: 'wiselink-research-and-synthesize@r09',
   17 |   minimumCompatibleSkillVersion: 'wiselink-research-and-synthesize@r09.c10',
   18 |   mcpServerName: 'wiselink-openclaw-engineering-assessment',
   19 |   mcpServerVersion: '1.2.0',
   20 | } as const;
   21 |
   22 | export const CANONICAL_HOST_OPENCLAW_APPLICABILITY_PROMPT_VERSION =
   23 |   'wiselink-applicability-extraction@r09.c4' as const;
   24 |
   25 | export interface CanonicalHostOpenClawResultPreflight {
   26 |   task: OpenClawTaskEnvelope;
   27 |   result: OpenClawResultEnvelope;
   28 | }
   29 |
   30 | export function preflightCanonicalHostOpenClawResult(input: {
   31 |   row: ActionAttemptRow;
   32 |   result: unknown;
   33 | }): CanonicalHostOpenClawResultPreflight {
   34 |   const task = parseCanonicalHostOpenClawAttemptTask(input.row);
   35 |   const result = parseResultEnvelope({ value: input.result, task });
   36 |   assertCanonicalHostOpenClawRuntimePolicy(result, task);
   37 |   return { task, result };
   38 | }
   39 |
   40 | export function parseCanonicalHostOpenClawStoredResult(input: {
   41 |   row: ActionAttemptRow;
   42 |   task: OpenClawTaskEnvelope;
   43 | }): OpenClawResultEnvelope {
   44 |   if (!input.row.resultEnvelopeJson) {
   45 |     throw policyError('OPENCLAW_RESULT_ENVELOPE_MISSING');
   46 |   }
   47 |   const result = parseStoredResultEnvelope({
   48 |     value: input.row.resultEnvelopeJson,
   49 |     task: input.task,
   50 |   });
   51 |   assertCanonicalHostOpenClawRuntimePolicy(result, input.task);
   52 |   if (input.row.resultContentHash !== result.contentHash) {
   53 |     throw policyError('OPENCLAW_RESULT_CONTENT_HASH_BINDING_MISMATCH');
   54 |   }
   55 |   return result;
   56 | }
   57 |
   58 | export function parseCanonicalHostOpenClawAttemptTask(
   59 |   row: ActionAttemptRow,
   60 | ): OpenClawTaskEnvelope {
   61 |   if (!row.taskEnvelopeJson) {
   62 |     throw policyError('OPENCLAW_TASK_ENVELOPE_MISSING');
   63 |   }
   64 |   const task = parseTaskEnvelope(row.taskEnvelopeJson);
   65 |   if (
   66 |     task.actionAttemptId !== row.attemptId ||
   67 |     task.operationRef !== row.operationRef ||
   68 |     task.taskType !== row.actionType ||
   69 |     task.tenantId !== row.tenantId ||
   70 |     task.workItemId !== row.workItemId ||
```

## 3. shared/api.interface.ts

关联文档多轴语义、Snapshot 与预览标记。

原文件行 448—628：

```text
  448 | export type CanonicalRelatedContextRelationRole =
  449 |   | 'ISSUE_SIGNAL'
  450 |   | 'INVESTIGATION_UPDATE'
  451 |   | 'TECHNICAL_BACKGROUND'
  452 |   | 'TEMPORARY_MEASURE'
  453 |   | 'FINAL_MEASURE'
  454 |   | 'IMPLEMENTATION_INSTRUCTION'
  455 |   | 'PUBLICATION_IMPACT'
  456 |   | 'OPERATOR_ACTION'
  457 |   | 'COMPLETION_FEEDBACK'
  458 |   | 'REVISION_OR_SUPERSESSION'
  459 |   | 'SUPPORTS'
  460 |   | 'CONTRADICTS'
  461 |   | 'GENERAL_BACKGROUND';
  462 |
  463 | export type CanonicalRelatedContextSourceAuthority =
  464 |   | 'REGULATORY'
  465 |   | 'OEM_FORMAL'
  466 |   | 'OEM_TRACKING'
  467 |   | 'OPERATOR_CONTROLLED'
  468 |   | 'AUTHORIZED_REFERENCE'
  469 |   | 'REFERENCE_ONLY'
  470 |   | 'UNKNOWN';
  471 |
  472 | export type CanonicalRelatedContextEvidenceStance =
  473 |   | 'SUPPORTS'
  474 |   | 'CONTRADICTS'
  475 |   | 'NEUTRAL'
  476 |   | 'NOT_EVALUATED';
  477 |
  478 | export type CanonicalReferencePermissionState =
  479 |   | 'AUTHORIZED'
  480 |   | 'DENIED'
  481 |   | 'NOT_CHECKED';
  482 |
  483 | export type CanonicalReferenceExtractionMethod =
  484 |   | 'STRUCTURED_REFERENCE'
  485 |   | 'DETERMINISTIC_TEXT';
  486 |
  487 | export type CanonicalReferenceTargetResolution =
  488 |   | {
  489 |       status: 'RESOLVED_EXACT';
  490 |       workItemId: string;
  491 |       documentVersionId: string;
  492 |       canonicalDocumentNumber: string;
  493 |       businessRevision: string | null;
  494 |     }
  495 |   | { status: 'RESOLVED_MULTIPLE'; candidateCount: number }
  496 |   | { status: 'UNRESOLVED' }
  497 |   | { status: 'DOCUMENT_NOT_INGESTED' }
  498 |   | { status: 'UNAVAILABLE' }
  499 |   | { status: 'ACCESS_DENIED' }
  500 |   | { status: 'UNSUPPORTED_DOCUMENT' };
  501 |
  502 | export type CanonicalRelatedTargetApplicability =
  503 |   | 'APPLICABLE'
  504 |   | 'NOT_APPLICABLE'
  505 |   | 'UNKNOWN'
  506 |   | 'NOT_EVALUATED'
  507 |   | 'NOT_APPLICABILITY_BEARING';
  508 |
  509 | /**
  510 |  * One explicit reference occurrence projected from the current frozen.2 text.
  511 |  * This is a read-only preview, not a persisted relation or assessment input.
  512 |  */
  513 | export interface CanonicalReferenceMentionPreviewItem {
  514 |   /** R10 ReferenceMention artifact identity; mentionId is its UI alias. */
  515 |   mentionRef: string;
  516 |   mentionId: string;
  517 |   primaryDocumentVersionRef: string;
  518 |   mentionSourceRef: string;
  519 |   citationText: string;
  520 |   normalizedIdentity: {
  521 |     documentNumber: string | null;
  522 |     title: string | null;
  523 |     publisher: string | null;
  524 |   };
  525 |   documentTypeCandidate: CanonicalReferenceDocumentType;
  526 |   extractionMethod: CanonicalReferenceExtractionMethod;
  527 |   relationCue: string | null;
  528 |   relationRoleCandidates: CanonicalRelatedContextRelationRole[];
  529 |   resolutionState: CanonicalReferenceTargetResolution['status'];
  530 |   resolvedDocumentVersionRef: string | null;
  531 |   permissionState: CanonicalReferencePermissionState;
  532 |   sourceAuthority: CanonicalRelatedContextSourceAuthority;
  533 |   evidenceStance: CanonicalRelatedContextEvidenceStance;
  534 |   candidateOnly: true;
  535 |   unitOrdinal: number;
  536 |   matchedText: string;
  537 |   normalizedTarget: string;
  538 |   documentType: CanonicalReferenceDocumentType;
  539 |   contextRole: CanonicalReferenceContextRole;
  540 |   targetResolution: CanonicalReferenceTargetResolution;
  541 |   targetApplicability: CanonicalRelatedTargetApplicability;
  542 |   applicabilityResultRef?: string;
  543 |   sourceRefIds: string[];
  544 |   sourceLocators: CanonicalStructuredContentSourceLocator[];
  545 | }
  546 |
  547 | export interface CanonicalRelatedContextSnapshotItem {
  548 |   contextItemRef: string;
  549 |   relatedContextItemRef: string;
  550 |   primaryDocumentVersionRef: string;
  551 |   mentionRefs: string[];
  552 |   retrievalChannel: 'EXPLICIT_REFERENCE';
  553 |   normalizedTarget: string;
  554 |   mentionSourceRefs: string[];
  555 |   relatedDocumentRef: string | null;
  556 |   authorizedExternalRef: null;
  557 |   resolvedDocumentVersionRef?: string;
  558 |   resolvedWorkItemRef?: string;
  559 |   unresolvedIdentity?: string;
  560 |   documentType: CanonicalReferenceDocumentType;
  561 |   contributionRoleCandidates: CanonicalRelatedContextRelationRole[];
  562 |   acceptedContributionRoles: CanonicalRelatedContextRelationRole[];
  563 |   relationTypeCandidates: CanonicalReferenceContextRole[];
  564 |   acceptedRelationTypes: CanonicalReferenceContextRole[];
  565 |   relationRoles: CanonicalReferenceContextRole[];
  566 |   issueRelevance: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  567 |   targetApplicability: CanonicalRelatedTargetApplicability;
  568 |   applicabilityResultRef?: string;
  569 |   currentness: 'CURRENT' | 'HISTORICAL' | 'SUPERSEDED' | 'STALE' | 'UNKNOWN';
  570 |   authority: CanonicalRelatedContextSourceAuthority;
  571 |   sourceAuthority: CanonicalRelatedContextSourceAuthority;
  572 |   sourceBasis: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION';
  573 |   evidenceStance: CanonicalRelatedContextEvidenceStance;
  574 |   contextUse: 'BACKGROUND_ONLY';
  575 |   sourceRefs: string[];
  576 |   selectedSourceRefs: string[];
  577 |   assessmentAsOf: string | null;
  578 |   availability:
  579 |     | 'AVAILABLE'
  580 |     | 'AMBIGUOUS'
  581 |     | 'UNRESOLVED'
  582 |     | 'NOT_INGESTED'
  583 |     | 'UNAVAILABLE'
  584 |     | 'ACCESS_DENIED'
  585 |     | 'UNSUPPORTED';
  586 |   confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  587 |   reasonCodes: string[];
  588 |   provenance: {
  589 |     source: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION';
  590 |     mentionSourceRefs: string[];
  591 |     extractionMethods: CanonicalReferenceExtractionMethod[];
  592 |   };
  593 |   conflicts: string[];
  594 |   conflictRefs: string[];
  595 |   missingInputs: string[];
  596 |   roleExplanation: string | null;
  597 |   occurrenceCount: number;
  598 |   candidateOnly: true;
  599 | }
  600 |
  601 | export interface CanonicalRelatedContextSnapshot {
  602 |   schemaVersion: 'wiselink.3_1.related_context_snapshot.v1';
  603 |   snapshotRef: string;
  604 |   mode: 'EXPLICIT_PREVIEW';
  605 |   policyVersion: 'wiselink.related-context.explicit-preview.v1';
  606 |   workItemRef: string;
  607 |   inputRevision: number;
  608 |   primaryDocumentVersionRef: string;
  609 |   assessmentTargetContextRef: string | null;
  610 |   assessmentAsOf: string | null;
  611 |   referenceMentions: CanonicalReferenceMentionPreviewItem[];
  612 |   items: CanonicalRelatedContextSnapshotItem[];
  613 |   unresolvedMentions: CanonicalReferenceMentionPreviewItem[];
  614 |   retrievalReceipts: Array<{
  615 |     channel: 'EXPLICIT_REFERENCE';
  616 |     status: 'COMPLETE';
  617 |     mentionCount: number;
  618 |   }>;
  619 |   authorization: {
  620 |     scope: 'CURRENT_USER_TENANT_WORKITEM';
  621 |     allResolvedItemsAuthorized: boolean;
  622 |   };
  623 |   availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  624 |   downgradeReasons: string[];
  625 |   candidateOnly: true;
  626 |   readOnly: true;
  627 |   includedInAssessmentInput: false;
  628 | }
```

## 4. server/modules/canonical-host/canonical-related-context-snapshot.ts

快照构建、背景角色及空 selectedSourceRefs。

原文件行 1—205：

```text
    1 | import { randomUUID } from 'node:crypto';
    2 |
    3 | import type {
    4 |   CanonicalReferenceContextRole,
    5 |   CanonicalReferenceExtractionMethod,
    6 |   CanonicalReferenceMentionPreviewItem,
    7 |   CanonicalRelatedContextRelationRole,
    8 |   CanonicalRelatedContextSnapshot,
    9 |   CanonicalRelatedContextSnapshotItem,
   10 | } from '@shared/api.interface';
   11 |
   12 | interface RelatedContextSnapshotBuildInput {
   13 |   workItemId: string;
   14 |   inputRevision: number;
   15 |   primaryDocumentVersionId: string;
   16 |   assessmentTargetContextRef?: string | null;
   17 |   assessmentAsOf?: string | null;
   18 |   mentions: CanonicalReferenceMentionPreviewItem[];
   19 | }
   20 |
   21 | export function buildCanonicalRelatedContextSnapshot(
   22 |   input: RelatedContextSnapshotBuildInput,
   23 | ): { snapshot: CanonicalRelatedContextSnapshot; bytes: Uint8Array } {
   24 |   const unresolvedMentions = input.mentions.filter(
   25 |     (mention) => mention.resolutionState !== 'RESOLVED_EXACT',
   26 |   );
   27 |   const snapshot: CanonicalRelatedContextSnapshot = {
   28 |     schemaVersion: 'wiselink.3_1.related_context_snapshot.v1' as const,
   29 |     snapshotRef: `related-context-snapshot://${encodeURIComponent(input.workItemId)}/${input.inputRevision}/${randomUUID()}`,
   30 |     mode: 'EXPLICIT_PREVIEW',
   31 |     policyVersion: 'wiselink.related-context.explicit-preview.v1',
   32 |     workItemRef: input.workItemId,
   33 |     inputRevision: input.inputRevision,
   34 |     primaryDocumentVersionRef: input.primaryDocumentVersionId,
   35 |     assessmentTargetContextRef: input.assessmentTargetContextRef ?? null,
   36 |     assessmentAsOf: input.assessmentAsOf ?? null,
   37 |     referenceMentions: input.mentions.map((mention) => ({ ...mention })),
   38 |     items: snapshotItems(
   39 |       input.mentions,
   40 |       input.primaryDocumentVersionId,
   41 |       input.assessmentAsOf ?? null,
   42 |     ),
   43 |     unresolvedMentions: unresolvedMentions.map((mention) => ({ ...mention })),
   44 |     retrievalReceipts: [
   45 |       {
   46 |         channel: 'EXPLICIT_REFERENCE' as const,
   47 |         status: 'COMPLETE' as const,
   48 |         mentionCount: input.mentions.length,
   49 |       },
   50 |     ],
   51 |     authorization: {
   52 |       scope: 'CURRENT_USER_TENANT_WORKITEM',
   53 |       allResolvedItemsAuthorized: input.mentions.every(
   54 |         (mention) =>
   55 |           mention.resolutionState !== 'RESOLVED_EXACT' ||
   56 |           mention.permissionState === 'AUTHORIZED',
   57 |       ),
   58 |     },
   59 |     availability: snapshotAvailability(input.mentions),
   60 |     downgradeReasons: [
   61 |       ...new Set(
   62 |         unresolvedMentions.map(
   63 |           (mention) => `REFERENCE_${mention.resolutionState}`,
   64 |         ),
   65 |       ),
   66 |     ],
   67 |     candidateOnly: true,
   68 |     readOnly: true,
   69 |     includedInAssessmentInput: false,
   70 |   };
   71 |   return {
   72 |     snapshot,
   73 |     bytes: new TextEncoder().encode(JSON.stringify(snapshot)),
   74 |   };
   75 | }
   76 |
   77 | function snapshotItems(
   78 |   mentions: CanonicalReferenceMentionPreviewItem[],
   79 |   primaryDocumentVersionRef: string,
   80 |   assessmentAsOf: string | null,
   81 | ): CanonicalRelatedContextSnapshotItem[] {
   82 |   const grouped = new Map<
   83 |     string,
   84 |     {
   85 |       first: CanonicalReferenceMentionPreviewItem;
   86 |       mentionRefs: Set<string>;
   87 |       sourceRefs: Set<string>;
   88 |       roles: Set<CanonicalReferenceContextRole>;
   89 |       contributionRoles: Set<CanonicalRelatedContextRelationRole>;
   90 |       extractionMethods: Set<CanonicalReferenceExtractionMethod>;
   91 |       count: number;
   92 |     }
   93 |   >();
   94 |   for (const mention of mentions) {
   95 |     const groupingKey =
   96 |       mention.normalizedTarget.trim() || `mention:${mention.mentionRef}`;
   97 |     const current = grouped.get(groupingKey);
   98 |     if (current) {
   99 |       mention.sourceRefIds.forEach((sourceRef) =>
  100 |         current.sourceRefs.add(sourceRef),
  101 |       );
  102 |       current.mentionRefs.add(mention.mentionRef);
  103 |       current.roles.add(mention.contextRole);
  104 |       mention.relationRoleCandidates.forEach((role) =>
  105 |         current.contributionRoles.add(role),
  106 |       );
  107 |       current.extractionMethods.add(mention.extractionMethod);
  108 |       current.count += 1;
  109 |       continue;
  110 |     }
  111 |     grouped.set(groupingKey, {
  112 |       first: mention,
  113 |       mentionRefs: new Set([mention.mentionRef]),
  114 |       sourceRefs: new Set(mention.sourceRefIds),
  115 |       roles: new Set([mention.contextRole]),
  116 |       contributionRoles: new Set(mention.relationRoleCandidates),
  117 |       extractionMethods: new Set([mention.extractionMethod]),
  118 |       count: 1,
  119 |     });
  120 |   }
  121 |
  122 |   return [...grouped.values()].map((group, index) => {
  123 |     const resolution = group.first.targetResolution;
  124 |     const resolved = resolution.status === 'RESOLVED_EXACT';
  125 |     const contextItemRef =
  126 |       `related-context-item://${encodeURIComponent(primaryDocumentVersionRef)}/` +
  127 |       `${index + 1}`;
  128 |     const conflictRefs =
  129 |       resolution.status === 'RESOLVED_MULTIPLE'
  130 |         ? ['MULTIPLE_CURRENT_DOCUMENTS']
  131 |         : [];
  132 |     return {
  133 |       contextItemRef,
  134 |       relatedContextItemRef: contextItemRef,
  135 |       primaryDocumentVersionRef,
  136 |       mentionRefs: [...group.mentionRefs],
  137 |       retrievalChannel: 'EXPLICIT_REFERENCE',
  138 |       normalizedTarget: group.first.normalizedTarget,
  139 |       mentionSourceRefs: [...group.sourceRefs],
  140 |       relatedDocumentRef: resolved ? resolution.workItemId : null,
  141 |       authorizedExternalRef: null,
  142 |       ...(resolved
  143 |         ? {
  144 |             resolvedDocumentVersionRef: resolution.documentVersionId,
  145 |             resolvedWorkItemRef: resolution.workItemId,
  146 |           }
  147 |         : group.first.normalizedTarget.trim()
  148 |           ? { unresolvedIdentity: group.first.normalizedTarget }
  149 |           : {}),
  150 |       documentType: group.first.documentType,
  151 |       contributionRoleCandidates: [...group.contributionRoles],
  152 |       acceptedContributionRoles: [],
  153 |       relationTypeCandidates: [...group.roles],
  154 |       acceptedRelationTypes: [],
  155 |       relationRoles: [...group.roles],
  156 |       issueRelevance: 'UNKNOWN',
  157 |       targetApplicability: group.first.targetApplicability,
  158 |       ...(group.first.applicabilityResultRef
  159 |         ? { applicabilityResultRef: group.first.applicabilityResultRef }
  160 |         : {}),
  161 |       currentness: resolved ? 'CURRENT' : 'UNKNOWN',
  162 |       authority: group.first.sourceAuthority,
  163 |       sourceAuthority: group.first.sourceAuthority,
  164 |       sourceBasis: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
  165 |       evidenceStance: 'NOT_EVALUATED',
  166 |       contextUse: 'BACKGROUND_ONLY',
  167 |       sourceRefs: [...group.sourceRefs],
  168 |       selectedSourceRefs: [],
  169 |       assessmentAsOf,
  170 |       availability: itemAvailability(resolution.status),
  171 |       confidence: group.extractionMethods.has('DETERMINISTIC_TEXT')
  172 |         ? 'MEDIUM'
  173 |         : 'HIGH',
  174 |       reasonCodes: [
  175 |         'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
  176 |         `REFERENCE_${resolution.status}`,
  177 |         'RELATION_CANDIDATE_NOT_ACCEPTED',
  178 |         'SOURCE_AUTHORITY_NOT_EVALUATED',
  179 |       ],
  180 |       provenance: {
  181 |         source: 'PRIMARY_DOCUMENT_EXPLICIT_MENTION',
  182 |         mentionSourceRefs: [...group.sourceRefs],
  183 |         extractionMethods: [...group.extractionMethods],
  184 |       },
  185 |       conflicts: conflictRefs,
  186 |       conflictRefs,
  187 |       missingInputs: [
  188 |         ...(!resolved ? ['RESOLVED_DOCUMENT_VERSION'] : []),
  189 |         ...(group.first.targetApplicability === 'NOT_EVALUATED'
  190 |           ? ['TARGET_APPLICABILITY']
  191 |           : []),
  192 |         ...(group.first.targetApplicability === 'UNKNOWN'
  193 |           ? ['TARGET_APPLICABILITY_FACTS']
  194 |           : []),
  195 |       ],
  196 |       roleExplanation: group.first.relationCue
  197 |         ? `Explicit citation cue: ${group.first.relationCue}`
  198 |         : 'Derived from an explicit citation in the primary document.',
  199 |       occurrenceCount: group.count,
  200 |       candidateOnly: true,
  201 |     };
  202 |   });
  203 | }
  204 |
  205 | function itemAvailability(
```

## 5. server/modules/canonical-host/canonical-host-assessment.service.ts

初始 Job-Aid 当前输入装配。

原文件行 228—275：

```text
  228 |   async prepareDynamicRulesCandidateWithRuleSet(
  229 |     input: {
  230 |       workItem: CanonicalWorkItemProjection;
  231 |       tenantId: string;
  232 |       permissionSnapshotVersion: string;
  233 |       assessmentAsOf: string;
  234 |       generatedAt: string;
  235 |       externalDiscovery: HostedOpenClawDiscoveryResult | null;
  236 |       reviewedExternalManifest: unknown | null;
  237 |     },
  238 |     ruleSet: CanonicalRuleSetRuntime,
  239 |   ): Promise<PreparedDynamicRulesCandidate> {
  240 |     const packageBytes = await this.readAcceptedPackage(
  241 |       input.workItem,
  242 |       input.permissionSnapshotVersion,
  243 |     );
  244 |     const assessmentOptions = {
  245 |       workItemId: input.workItem.workItemId,
  246 |       documentVersionBinding: assessmentBinding(input.workItem),
  247 |       artifactBytes: packageBytes,
  248 |       assessmentAsOf: requiredIso(input.assessmentAsOf, 'assessmentAsOf'),
  249 |       rulePack: ruleSet.rulePack,
  250 |       rulePackHash: ruleSet.rulePackHash,
  251 |       criterionSet: ruleSet.criterionSet,
  252 |       jobAidSourceIdentity: {
  253 |         status: 'SOURCE_IDENTITY_MISMATCH',
  254 |         sourceManifestHash: JOB_AID_SOURCE_MANIFEST_HASH,
  255 |         allowsCandidateOnlyAssessment: true,
  256 |         blocksEngineeringClosure: true,
  257 |         blocksRulePromotion: true,
  258 |       },
  259 |       generatedAt: requiredIso(input.generatedAt, 'generatedAt'),
  260 |     };
  261 |     const dynamicRulesInput = buildUnifiedSbJobAidAssessmentInput({
  262 |       documentVersionBinding: assessmentOptions.documentVersionBinding,
  263 |       artifactBytes: packageBytes,
  264 |       assessmentAsOf: assessmentOptions.assessmentAsOf,
  265 |     });
  266 |     return {
  267 |       ...this.assessment.runCandidate({
  268 |         assessment: assessmentOptions,
  269 |         externalDiscovery: input.externalDiscovery,
  270 |         reviewedExternalOemManifest: input.reviewedExternalManifest,
  271 |       }),
  272 |       dynamicRulesInput,
  273 |     };
  274 |   }
  275 |
```

## 6. server/modules/assessment-workbench/evaluation-context.service.ts

既有评估上下文槽位及默认缺失背景。

原文件行 40—61：

```text
   40 | export class EvaluationContextService {
   41 |   build(
   42 |     snapshot: SbJobAidShadowSnapshotResponse,
   43 |     historicalContext?: HistoricalAssessmentContext,
   44 |     knowledgeContext?: KnowledgeRetrievalContext,
   45 |     latestInvestigation?: BoundedInvestigationRunView | null,
   46 |   ): EvaluationContextPackageResponse {
   47 |     return buildEvaluationContextPackage(snapshot, {
   48 |       historicalContext,
   49 |       knowledgeContext,
   50 |       latestInvestigation,
   51 |     });
   52 |   }
   53 | }
   54 |
   55 | export function buildEvaluationContextPackage(
   56 |   snapshot: SbJobAidShadowSnapshotResponse,
   57 |   options: {
   58 |     historicalContext?: HistoricalAssessmentContext;
   59 |     knowledgeContext?: KnowledgeRetrievalContext;
   60 |     latestInvestigation?: BoundedInvestigationRunView | null;
   61 |   } = {},
```

原文件行 162—251：

```text
  162 |     applicabilityOverall: snapshot.applicabilityOverall,
  163 |     structuredSummary: snapshot.structuredSummary,
  164 |     candidateRecommendation: snapshot.candidateRecommendation,
  165 |     counts: snapshot.counts,
  166 |   };
  167 |   const parsedSourceContext = snapshot.parsedSourceContext;
  168 |   const structuredAssessmentContext =
  169 |     snapshot.structuredAssessmentContext ?? missingStructuredAssessmentContext();
  170 |   const historicalContext: HistoricalAssessmentContext =
  171 |     options.historicalContext ?? {
  172 |     status: 'MISSING' as const,
  173 |     reasonCode: 'HISTORICAL_ASSESSMENTS_NOT_BOUND' as const,
  174 |     records: [] as [],
  175 |   };
  176 |   const knowledgeContext: KnowledgeRetrievalContext =
  177 |     options.knowledgeContext ?? {
  178 |     status: 'MISSING' as const,
  179 |     reasonCode: 'KNOWLEDGE_RETRIEVAL_NOT_BOUND' as const,
  180 |     records: [] as [],
  181 |   };
  182 |   const similarCaseContext: SimilarCaseContext = buildSimilarCaseContext(
  183 |     isBoundKnowledgeContext(knowledgeContext) ? knowledgeContext : null,
  184 |   );
  185 |   const latestInvestigation = options.latestInvestigation ?? null;
  186 |   const authorityBoundary = {
  187 |     outputAuthorityLevel: 'candidate_only' as const,
  188 |     historicalOpinionIsCurrentFact: false as const,
  189 |     aiInferenceCreatesFact: false as const,
  190 |     documentApplicabilityProvesFleetApplicability: false as const,
  191 |     createsEngineerDecision: false as const,
  192 |     createsClosureDecision: false as const,
  193 |     createsAirworthinessConclusion: false as const,
  194 |   };
  195 |   const identityPayload = {
  196 |     schemaVersion: CONTEXT_SCHEMA,
  197 |     manifest,
  198 |     currentAssessment,
  199 |     ...(parsedSourceContext ? { parsedSourceContext } : {}),
  200 |     structuredAssessmentContext,
  201 |     evaluationItemSetHash,
  202 |     resourceSummary,
  203 |     resourceAssessments,
  204 |     criterionCards,
  205 |     historicalContext: historicalContextIdentity(historicalContext),
  206 |     similarCaseContext: similarCaseContextIdentity(similarCaseContext),
  207 |     knowledgeContext: knowledgeContextIdentity(knowledgeContext),
  208 |     ...(latestInvestigation
  209 |       ? { latestInvestigation: investigationIdentity(latestInvestigation) }
  210 |       : {}),
  211 |     authorityBoundary,
  212 |   };
  213 |   const contextHash = hashCanonical(identityPayload);
  214 |   const contextId = `ECP-${hashDigest(contextHash).slice(0, 24).toUpperCase()}`;
  215 |   const contextText = buildContextText({
  216 |     contextId,
  217 |     contextHash,
  218 |     evaluationItemSetHash,
  219 |     manifest,
  220 |     currentAssessment,
  221 |     parsedSourceContext,
  222 |     structuredAssessmentContext,
  223 |     resourceSummary,
  224 |     resourceAssessments,
  225 |     criterionCards,
  226 |     historicalContext,
  227 |     similarCaseContext,
  228 |     knowledgeContext,
  229 |     latestInvestigation,
  230 |   });
  231 |
  232 |   return {
  233 |     schemaVersion: CONTEXT_SCHEMA,
  234 |     contextId,
  235 |     contextHash,
  236 |     evaluationItemSetHash,
  237 |     manifest,
  238 |     currentAssessment,
  239 |     ...(parsedSourceContext ? { parsedSourceContext } : {}),
  240 |     structuredAssessmentContext,
  241 |     resourceSummary,
  242 |     resourceAssessments,
  243 |     criterionCards,
  244 |     historicalContext,
  245 |     similarCaseContext,
  246 |     knowledgeContext,
  247 |     latestInvestigation,
  248 |     authorityBoundary,
  249 |     latestOverallDraft: null,
  250 |     contextText,
  251 |   };
```

## 7. server/modules/assessment-workbench/knowledge-retrieval-context.service.ts

现有知识适配为文件回读及单记录限制，不等同通用 RAG。

原文件行 30—111：

```text
   30 | @Injectable()
   31 | export class KnowledgeRetrievalContextService {
   32 |   adaptVerifiedFeishuReadback(
   33 |     value: unknown,
   34 |     target: CurrentKnowledgeTarget,
   35 |   ): BoundKnowledgeRetrievalContext {
   36 |     return adaptVerifiedFeishuKnowledgeReadback(value, target);
   37 |   }
   38 | }
   39 |
   40 | export function adaptVerifiedFeishuKnowledgeReadback(
   41 |   value: unknown,
   42 |   target: CurrentKnowledgeTarget,
   43 | ): BoundKnowledgeRetrievalContext {
   44 |   const input = requiredRecord(value, 'KNOWLEDGE_READBACK_INVALID');
   45 |   if (requiredText(input, 'schemaVersion') !== READBACK_SCHEMA) {
   46 |     throw new ConflictException('KNOWLEDGE_READBACK_SCHEMA_UNSUPPORTED');
   47 |   }
   48 |   if (
   49 |     requiredText(input, 'retrievalChannel') !== 'FEISHU_DRIVE_SEARCH_V2' ||
   50 |     requiredText(input, 'resultStatus') !== 'FOUND' ||
   51 |     input.readbackVerified !== true
   52 |   ) {
   53 |     throw new ConflictException('KNOWLEDGE_READBACK_NOT_VERIFIED');
   54 |   }
   55 |   const query = requiredText(input, 'query');
   56 |   const requestedKnowledgeSpaceIds = requiredTextArray(
   57 |     input.requestedKnowledgeSpaceIds,
   58 |     'KNOWLEDGE_SPACE_IDS_INVALID',
   59 |   ).sort();
   60 |   const observedAt = requiredIsoDate(input, 'observedAt');
   61 |   const candidateInput = requiredRecord(
   62 |     input.candidate,
   63 |     'KNOWLEDGE_CANDIDATE_INVALID',
   64 |   );
   65 |   const candidate = buildCandidate(candidateInput);
   66 |   const versionWarnings = [
   67 |     '当前通过 Feishu Drive Search v2 读回源文件，无法证明其属于请求的 Aily 知识空间；空间归属保持 UNCONFIRMED。',
   68 |     'FTD 文件声明应回到源应用查看最新版本；本快照只能作为 REFERENCE_ONLY 候选，不能证明 current。',
   69 |   ];
   70 |   const identity = contextIdentityPayload({
   71 |     query,
   72 |     target,
   73 |     requestedKnowledgeSpaceIds,
   74 |     records: [candidate],
   75 |     versionWarnings,
   76 |   });
   77 |   const contextHash = hashCanonical(identity);
   78 |   return {
   79 |     schemaVersion: CONTEXT_SCHEMA,
   80 |     contextId: `KRC-${digest(contextHash).slice(0, 24).toUpperCase()}`,
   81 |     contextHash,
   82 |     status: 'AVAILABLE_WITH_VERSION_GAPS',
   83 |     reasonCode: 'KNOWLEDGE_SOURCE_CURRENTNESS_UNCONFIRMED',
   84 |     query,
   85 |     targetPackageId: target.packageId,
   86 |     targetDocumentId: target.documentId,
   87 |     targetDocumentVersionId: target.documentVersionId,
   88 |     requestedKnowledgeSpaceIds,
   89 |     observedAt,
   90 |     records: [candidate],
   91 |     versionWarnings,
   92 |     authorityBoundary: authorityBoundary(),
   93 |   };
   94 | }
   95 |
   96 | export function parseBoundKnowledgeRetrievalContext(
   97 |   value: unknown,
   98 |   expected?: Pick<CurrentKnowledgeTarget, 'packageId' | 'documentId' | 'documentVersionId'>,
   99 | ): BoundKnowledgeRetrievalContext {
  100 |   const input = requiredRecord(value, 'KNOWLEDGE_CONTEXT_INVALID');
  101 |   if (requiredText(input, 'schemaVersion') !== CONTEXT_SCHEMA) {
  102 |     throw new ConflictException('KNOWLEDGE_CONTEXT_SCHEMA_UNSUPPORTED');
  103 |   }
  104 |   const status = requiredText(input, 'status');
  105 |   if (status !== 'AVAILABLE_WITH_VERSION_GAPS') {
  106 |     throw new ConflictException('KNOWLEDGE_CONTEXT_STATUS_UNSUPPORTED');
  107 |   }
  108 |   const query = requiredText(input, 'query');
  109 |   const targetPackageId = requiredText(input, 'targetPackageId');
  110 |   const targetDocumentId = requiredText(input, 'targetDocumentId');
  111 |   const targetDocumentVersionId = requiredText(input, 'targetDocumentVersionId');
```

原文件行 138—156：

```text
  138 |     documentNumber: '',
  139 |     revisionLabel: null,
  140 |   };
  141 |   const contextHash = hashCanonical(contextIdentityPayload({
  142 |     query,
  143 |     target,
  144 |     requestedKnowledgeSpaceIds,
  145 |     records,
  146 |     versionWarnings,
  147 |   }));
  148 |   const contextId = `KRC-${digest(contextHash).slice(0, 24).toUpperCase()}`;
  149 |   if (
  150 |     requiredText(input, 'contextHash') !== contextHash ||
  151 |     requiredText(input, 'contextId') !== contextId ||
  152 |     requiredText(input, 'reasonCode') !==
  153 |       'KNOWLEDGE_SOURCE_CURRENTNESS_UNCONFIRMED'
  154 |   ) {
  155 |     throw new ConflictException('KNOWLEDGE_CONTEXT_IDENTITY_MISMATCH');
  156 |   }
```

## 8. server/modules/canonical-host/canonical-host-openclaw-overall.service.ts

Overall 实际输入材料与来源。

原文件行 480—547：

```text
  480 |     permissionSnapshotVersion: string,
  481 |   ): Promise<{
  482 |     selectedDiscoveryRefs: string[];
  483 |     modelInput: OpenClawOverallSynthesisInput;
  484 |   }> {
  485 |     const baseRules = workItem.integratedAssessment!.baseRules;
  486 |     const discoveries = await packetInput(
  487 |       'OPENCLAW_OVERALL_DISCOVERY_READ_FAILED',
  488 |       () =>
  489 |         this.discovery.latestSearchRunsAsOf(
  490 |           providerCodesFromOrigin(attempt.requestOrigin),
  491 |           attempt.createdAt.toISOString(),
  492 |           serverContext(serviceActor(attempt.tenantId)),
  493 |         ),
  494 |     );
  495 |     const timestamp = attempt.createdAt.toISOString();
  496 |     const [
  497 |       baseArtifactBytes,
  498 |       packageBytes,
  499 |       dynamicCandidate,
  500 |       engineerReviewContext,
  501 |     ] = await Promise.all([
  502 |       packetInput('OPENCLAW_OVERALL_BASE_ARTIFACT_READ_FAILED', () =>
  503 |         this.artifactStore.readActualBytes(baseRules.artifact),
  504 |       ),
  505 |       packetInput('OPENCLAW_OVERALL_PACKAGE_ARTIFACT_READ_FAILED', () =>
  506 |         this.artifactStore.readActualBytes(workItem.package!.artifact),
  507 |       ),
  508 |       packetInput('OPENCLAW_OVERALL_DYNAMIC_CANDIDATE_BUILD_FAILED', () =>
  509 |         this.assessment.prepareDynamicRulesCandidate({
  510 |           workItem,
  511 |           tenantId: attempt.tenantId,
  512 |           permissionSnapshotVersion,
  513 |           assessmentAsOf: timestamp,
  514 |           generatedAt: timestamp,
  515 |           externalDiscovery: null,
  516 |           reviewedExternalManifest: null,
  517 |         }),
  518 |       ),
  519 |       packetInput('OPENCLAW_OVERALL_ENGINEER_REVIEW_READ_FAILED', () =>
  520 |         this.engineerReviews.modelContext(workItem),
  521 |       ),
  522 |     ]);
  523 |     assertDynamicCandidateSummary(
  524 |       dynamicCandidate.summary,
  525 |       workItem,
  526 |       baseRules,
  527 |     );
  528 |     const sourceEvidenceCandidates =
  529 |       dynamicCandidate.overall.context.criterionCards.flatMap(
  530 |         (criterion) => criterion.sourceEvidenceCandidates,
  531 |       );
  532 |     return {
  533 |       selectedDiscoveryRefs: discoveries.map((value) => value.searchRunRef),
  534 |       modelInput: buildOpenClawOverallSynthesisInput({
  535 |         workItem,
  536 |         baseRules,
  537 |         baseArtifactBytes,
  538 |         packageBytes,
  539 |         discoveries,
  540 |         sourceEvidenceCandidates,
  541 |         engineerReviewContext,
  542 |         outputCorrelationRef: attempt.triggerRequestId,
  543 |       }),
  544 |     };
  545 |   }
  546 |
  547 |   private reservationInput(
```

## 9. server/modules/canonical-host/openclaw-overall-synthesis.processor.ts

Overall 模型输入结构、主文档来源和 discovery 摘要。

原文件行 64—96：

```text
   64 |   unifiedSourceContext: Record<string, unknown>;
   65 |   adoptedDocumentVersions: Array<Record<string, unknown>>;
   66 |   externalDiscoveryResults: Array<Record<string, unknown>>;
   67 |   engineerReviewContext: OpenClawEngineerReviewContext;
   68 |   selectiveResynthesis: SelectiveOverallResynthesisSummary;
   69 | }
   70 |
   71 | export interface OpenClawOverallApplicabilityResult {
   72 |   schemaVersion: 'wiselink.3_1.overall_applicability_result.v1';
   73 |   status: 'CANDIDATE_ONLY' | 'WAITING_INPUT';
   74 |   sourceResultId: string;
   75 |   inputRevision: number;
   76 |   documentVersionId: string;
   77 |   sourcePackageId: string;
   78 |   sourcePackageContentHash: string;
   79 |   sourceExpressionCount: number;
   80 |   sourceRefCount: number;
   81 |   decision: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';
   82 |   kleeneResult: true | false | 'unknown';
   83 |   pass: boolean;
   84 |   blockingUnknownCount: number;
   85 | }
   86 |
   87 | export function buildOpenClawOverallSynthesisInput(input: {
   88 |   workItem: CanonicalWorkItemProjection;
   89 |   baseRules: CanonicalBaseRuleCandidateProjection;
   90 |   baseArtifactBytes: Uint8Array;
   91 |   packageBytes: Uint8Array;
   92 |   discoveries: FeishuNativeOemSearchRun[];
   93 |   sourceEvidenceCandidates: unknown[];
   94 |   engineerReviewContext: OpenClawEngineerReviewContext;
   95 |   outputCorrelationRef: string;
   96 | }): OpenClawOverallSynthesisInput {
```

原文件行 209—264：

```text
  209 |   const modelInput: OpenClawOverallSynthesisInput = {
  210 |     operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
  211 |     outputCorrelationRef: input.outputCorrelationRef,
  212 |     applicabilityResult,
  213 |     baseRuleResult: {
  214 |       sourceResultId: input.baseRules.sourceResultId,
  215 |       revision: input.baseRules.revision,
  216 |       artifactSha256: `sha256:${input.baseRules.artifact.sha256}`,
  217 |       documentVersionId: input.workItem.source.documentVersionId,
  218 |       packageId: input.workItem.package?.packageId,
  219 |       packageArtifactSha256: `sha256:${input.workItem.package?.artifact.sha256}`,
  220 |       criterionSetId: input.baseRules.criterionSetId,
  221 |       criterionCount: input.baseRules.criterionCount,
  222 |       evaluationItemCount: input.baseRules.evaluationItemCount,
  223 |       unresolvedCount,
  224 |       sourceBoundCandidateCount,
  225 |       items: plan.items.map(overallModelItem),
  226 |     },
  227 |     unifiedSourceContext: {
  228 |       documentVersionId: input.workItem.source.documentVersionId,
  229 |       packageId: input.workItem.package?.packageId,
  230 |       packageArtifactSha256: `sha256:${input.workItem.package?.artifact.sha256}`,
  231 |       contractRevision: input.workItem.package?.contractRevision,
  232 |       contentUnitCount: input.workItem.package?.contentUnitCount,
  233 |       sourceRefCount: sourceRefs.length,
  234 |       currentDocumentSourceRefIds: packageSourceRefs.map(
  235 |         ({ sourceRefId }) => sourceRefId,
  236 |       ),
  237 |       sourceRefs,
  238 |     },
  239 |     adoptedDocumentVersions: [
  240 |       {
  241 |         documentVersionId: input.workItem.source.documentVersionId,
  242 |         publisher: publisher(input.workItem.classification.parserProfileId),
  243 |         documentNumber,
  244 |         revisionLabel,
  245 |         adoptionStatus: 'ADOPTED',
  246 |         currentness: 'CURRENT',
  247 |       },
  248 |     ],
  249 |     externalDiscoveryResults: input.discoveries.map(toHostedDiscovery),
  250 |     engineerReviewContext: structuredClone(input.engineerReviewContext),
  251 |     selectiveResynthesis: summarizeSelectiveOverallResynthesis(plan),
  252 |   };
  253 |   rejectPrivateAuthority(modelInput);
  254 |   return modelInput;
  255 | }
  256 |
  257 | function sourceEvidenceCandidateRefs(
  258 |   candidates: unknown[],
  259 |   knownRefs: Set<string>,
  260 | ): Map<string, string[]> {
  261 |   if (!Array.isArray(candidates)) {
  262 |     throw new Error('BASE_SOURCE_EVIDENCE_CATALOG_INVALID');
  263 |   }
  264 |   const result = new Map<string, string[]>();
```

原文件行 779—822：

```text
  779 | function toHostedDiscovery(
  780 |   run: FeishuNativeOemSearchRun,
  781 | ): Record<string, unknown> {
  782 |   const provider = providerFromRun(run);
  783 |   const resultStatus = {
  784 |     CANDIDATES_FOUND: 'COMPLETE',
  785 |     PARTIAL_RESULTS: 'PARTIAL',
  786 |     ZERO_RESULTS_FOR_TARGET_IDENTIFIER: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
  787 |     ACCESS_DENIED: 'ACCESS_DENIED',
  788 |     TRUNCATED: 'TRUNCATED',
  789 |   }[run.resultStatus];
  790 |   return {
  791 |     runtime: 'FEISHU_HOSTED_OPENCLAW',
  792 |     runtimeAppId: 'app_17c3zn24kv2',
  793 |     provider,
  794 |     query: run.query,
  795 |     resultStatus,
  796 |     observedAt: run.observedAt,
  797 |     candidates: run.candidates.map((candidate) => ({
  798 |       title: candidate.title,
  799 |       sourceUrl: candidate.url,
  800 |       documentNumber: null,
  801 |       revisionLabel: null,
  802 |       snippet: null,
  803 |       relationshipReason: candidate.disposition,
  804 |       matchLevel:
  805 |         candidate.disposition === 'DIRECT_OFFICIAL_SOURCE_MATCH'
  806 |           ? 'DIRECT'
  807 |           : 'TANGENTIAL',
  808 |     })),
  809 |     accessRestricted: run.accessRestricted,
  810 |     truncated: run.truncated,
  811 |     partialOnly: run.partialOnly,
  812 |     excludedNonOemCandidateCount: 0,
  813 |     error: run.failureCode
  814 |       ? {
  815 |           code: run.failureCode,
  816 |           message: `Discovery provider reported ${run.failureCode}.`,
  817 |         }
  818 |       : null,
  819 |   };
  820 | }
  821 |
  822 | function providerFromRun(
```

## 10. server/modules/canonical-host/canonical-host-openclaw-review.service.ts

Review 如何组装当前问题和关联原文。

原文件行 440—569：

```text
  440 |   private async buildTaskContract(
  441 |     binding: ReviewBinding,
  442 |     workItem: CanonicalWorkItemProjection,
  443 |   ): Promise<ReviewTurnTaskContract> {
  444 |     const [
  445 |       pageContext,
  446 |       adoptedContext,
  447 |       packageBytes,
  448 |       bilingual,
  449 |       attachmentContext,
  450 |       relatedContext,
  451 |     ] = await Promise.all([
  452 |       this.engineerReviews.pageContext(workItem),
  453 |       this.engineerReviews.modelContext(workItem),
  454 |       this.artifactStore.readActualBytes(workItem.package!.artifact),
  455 |       this.readBilingualContext(workItem),
  456 |       this.readAttachmentContext(binding),
  457 |       this.readRelatedContext(binding, workItem),
  458 |     ]);
  459 |     if (!pageContext)
  460 |       throw reviewConflict('REVIEW_EVALUATION_CONTEXT_REQUIRED');
  461 |     const resolvedPageContext = resolveReviewPageSourceRefs(
  462 |       pageContext,
  463 |       await this.assessment.resolveStoredBaseSourceEvidenceRefs({
  464 |         workItem,
  465 |         tenantId: binding.conversation.tenantId,
  466 |         packageBytes,
  467 |         assessmentAsOf: binding.turn.createdAt.toISOString(),
  468 |       }),
  469 |     );
  470 |     const packageResourceRefs = frozenPackageResourceRefs(
  471 |       packageBytes,
  472 |       workItem.package!.artifact.ref,
  473 |       workItem.package!.artifact.sha256,
  474 |       new Set([
  475 |         ...packageReferencedSourceRefIds(resolvedPageContext, workItem),
  476 |         ...relatedContext.mentionSourceRefIds,
  477 |       ]),
  478 |     );
  479 |     const adoptedInputs = adoptedContext.effective.map((review) => ({
  480 |       adoptedInputRef: `engineer-review:${review.sequence}`,
  481 |       criterionId: review.criterionId,
  482 |       actionType: review.actionType,
  483 |       decision: review.decision,
  484 |       status: review.status,
  485 |       comment: review.comment,
  486 |       evidence: review.evidence.map((evidence) => ({
  487 |         sourceRefId: evidence.sourceRefId,
  488 |         kind: evidence.kind,
  489 |         statement: evidence.statement,
  490 |         locator: evidence.locator,
  491 |       })),
  492 |       resolvedMissingInputs: review.resolvedMissingInputs,
  493 |       correctedAnalysisDirection: review.correctedAnalysisDirection,
  494 |     }));
  495 |     const resourceRefs = mergeResourceRefs(
  496 |       packageResourceRefs,
  497 |       adoptedEvidenceResourceRefs(workItem, adoptedInputs),
  498 |       attachmentContext.resourceRefs,
  499 |       relatedContext.resourceRefs,
  500 |     );
  501 |     const allowedEvaluationItemIds = resolvedPageContext.items.map(
  502 |       (item) => item.criterionId,
  503 |     );
  504 |     const engineerInputRef = `engineer-input:${binding.turn.engineerSuppliedInputId}`;
  505 |     const allowedAdoptedInputRefs = [
  506 |       ...adoptedInputs.map((input) => input.adoptedInputRef),
  507 |       engineerInputRef,
  508 |       ...attachmentContext.attachmentRefs,
  509 |     ];
  510 |     const context: Record<string, unknown> = {
  511 |       workItem: {
  512 |         workItemId: workItem.workItemId,
  513 |         documentVersionId: workItem.source.documentVersionId,
  514 |         packageId: workItem.package!.packageId,
  515 |         title: workItem.package!.title,
  516 |       },
  517 |       evaluation: {
  518 |         criterionSetId: resolvedPageContext.criterionSetId,
  519 |         baseRuleRevision: resolvedPageContext.baseRuleRevision,
  520 |         gapLedger: resolvedPageContext.gapLedger,
  521 |         items: resolvedPageContext.items,
  522 |       },
  523 |       bilingual,
  524 |       applicability: {
  525 |         candidateStatus:
  526 |           workItem.integratedAssessment?.overallSynthesis
  527 |             ?.applicabilityStatus ??
  528 |           workItem.assessment?.applicabilityOverall ??
  529 |           null,
  530 |         sourceExpressionCount:
  531 |           workItem.package!.usagePolicy?.applicability.sourceExpressionCount ??
  532 |           null,
  533 |         normalizedCandidateCount:
  534 |           workItem.package!.usagePolicy?.applicability
  535 |             .normalizedCandidateCount ?? null,
  536 |         assignmentCount:
  537 |           workItem.package!.usagePolicy?.applicability.assignmentCount ?? null,
  538 |         inferredFromDocumentPresence: false,
  539 |       },
  540 |       adoptedInputs,
  541 |       engineerInput: {
  542 |         inputRef: engineerInputRef,
  543 |         text: binding.turn.candidateText,
  544 |         attachmentRefs: [...attachmentContext.attachmentRefs],
  545 |       },
  546 |       relatedContext: relatedContext.context,
  547 |     };
  548 |     return parseReviewTurnTaskContract({
  549 |       schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2',
  550 |       mode: 'INTERACTIVE_REVIEW',
  551 |       reviewConversationRef: binding.conversation.reviewConversationId,
  552 |       reviewTurnRef: binding.turn.reviewTurnId,
  553 |       requestId: binding.turn.requestId,
  554 |       actorContextRef: actorContextRef(binding.conversation),
  555 |       inputRevision: binding.turn.inputRevision,
  556 |       selectedEvaluationItemId: null,
  557 |       userMessage: binding.turn.userMessage,
  558 |       allowedOperations: [...REVIEW_ALLOWED_OPERATIONS],
  559 |       resourceRefs,
  560 |       allowedEvaluationItemIds,
  561 |       allowedAdoptedInputRefs,
  562 |       attachmentRefs: [...attachmentContext.attachmentRefs],
  563 |       context,
  564 |       executionPolicy: {
  565 |         runtimeAppId: REVIEW_RUNTIME_APP_ID,
  566 |         profileRef: REVIEW_PROFILE_REF,
  567 |         modelPolicyRef: REVIEW_MODEL_POLICY_REF,
  568 |         skillPolicyRef: REVIEW_SKILL_POLICY_REF,
  569 |         toolPolicyRef: REVIEW_TOOL_POLICY_REF,
```

原文件行 644—750：

```text
  644 |   private async readRelatedContext(
  645 |     binding: ReviewBinding,
  646 |     workItem: CanonicalWorkItemProjection,
  647 |   ): Promise<ReviewRelatedContextBuild> {
  648 |     if (!this.reader || !workItem.package) {
  649 |       return unavailableReviewRelatedContext(
  650 |         'RELATED_CONTEXT_RUNTIME_NOT_CONFIGURED',
  651 |       );
  652 |     }
  653 |     try {
  654 |       const allUnits = await this.reader.readAllSourceUnits({
  655 |         artifact: workItem.package.artifact,
  656 |         packageId: workItem.package.packageId,
  657 |       });
  658 |       const browserUnits = allUnits
  659 |         .map((unit, index) =>
  660 |           projectCanonicalStructuredContentUnit(unit, index + 1),
  661 |         )
  662 |         .filter((unit) => unit !== null);
  663 |       const candidates = deriveCanonicalReferenceMentionPreview(
  664 |         browserUnits,
  665 |         workItem.package.documentIdentity?.documentCode,
  666 |         allUnits,
  667 |       );
  668 |       const assessmentTarget = relatedContextAssessmentTarget(workItem);
  669 |       const resolved = await this.resolveReviewReferenceTargets(
  670 |         candidates,
  671 |         binding,
  672 |         assessmentTarget,
  673 |       );
  674 |       const mentions = candidates.map((mention) => {
  675 |         const target = resolved.get(mention.normalizedTarget);
  676 |         return finalizeCanonicalReferenceMentionPreview({
  677 |           candidate: mention,
  678 |           primaryDocumentVersionRef: workItem.source.documentVersionId,
  679 |           targetResolution: canonicalReferenceResolutionOr(
  680 |             mention,
  681 |             target?.resolution ?? { status: 'UNAVAILABLE' },
  682 |           ),
  683 |           targetApplicability: target?.targetApplicability ?? 'NOT_EVALUATED',
  684 |           ...(target?.applicabilityResultRef
  685 |             ? { applicabilityResultRef: target.applicabilityResultRef }
  686 |             : {}),
  687 |           publisherCandidate: target?.publisherCandidate ?? null,
  688 |         });
  689 |       });
  690 |       const built = buildCanonicalRelatedContextSnapshot({
  691 |         workItemId: workItem.workItemId,
  692 |         inputRevision: workItem.revision,
  693 |         primaryDocumentVersionId: workItem.source.documentVersionId,
  694 |         assessmentTargetContextRef:
  695 |           assessmentTarget?.applicabilityContextRef ?? null,
  696 |         assessmentAsOf: assessmentTarget?.assessmentAsOf ?? null,
  697 |         mentions,
  698 |       });
  699 |       const persistedSnapshot = await this.artifactStore.persistAndReadback(
  700 |         built.bytes,
  701 |       );
  702 |       const snapshot = built.snapshot;
  703 |       const relatedResources = [...resolved.values()].flatMap(
  704 |         (entry) => entry.resourceRefs,
  705 |       );
  706 |       const availableByTarget = new Map(
  707 |         [...resolved].map(([target, entry]) => [
  708 |           target,
  709 |           entry.resourceRefs.map((resource) => resource.sourceRefId),
  710 |         ]),
  711 |       );
  712 |       return {
  713 |         mentionSourceRefIds: new Set(
  714 |           mentions.flatMap((mention) => mention.sourceRefIds),
  715 |         ),
  716 |         resourceRefs: relatedResources,
  717 |         context: {
  718 |           status: 'AVAILABLE',
  719 |           schemaVersion: snapshot.schemaVersion,
  720 |           snapshotRef: snapshot.snapshotRef,
  721 |           snapshotArtifact: persistedSnapshot.artifact,
  722 |           inputRevision: snapshot.inputRevision,
  723 |           primaryDocumentVersionRef: snapshot.primaryDocumentVersionRef,
  724 |           mode: snapshot.mode,
  725 |           policyVersion: snapshot.policyVersion,
  726 |           availability: snapshot.availability,
  727 |           downgradeReasons: snapshot.downgradeReasons,
  728 |           unresolvedMentions: snapshot.unresolvedMentions,
  729 |           retrievalReceipts: snapshot.retrievalReceipts,
  730 |           usagePolicy: {
  731 |             candidateOnly: true,
  732 |             readOnly: true,
  733 |             includedInAssessmentInput: false,
  734 |           },
  735 |           items: snapshot.items.map((item) => {
  736 |             const { sourceBasis, ...safeItem } = item;
  737 |             return {
  738 |               ...safeItem,
  739 |               sourceBasis,
  740 |               availableRelatedSourceRefIds:
  741 |                 availableByTarget.get(item.normalizedTarget) ?? [],
  742 |             };
  743 |           }),
  744 |         },
  745 |       };
  746 |     } catch (error) {
  747 |       this.logger.warn(
  748 |         `Related Context unavailable for review ${binding.turn.reviewTurnId}: ${relatedContextErrorCode(error)}`,
  749 |       );
  750 |       return unavailableReviewRelatedContext(relatedContextErrorCode(error));
```

## 11. openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs

逐 request 会话标识、模型调用、非流式返回、全量来源选择。

原文件行 54—66：

```text
   54 |   'CANDIDATE_EVIDENCE',
   55 |   'REVIEW_ACTION_DRAFT',
   56 |   'INPUT_REQUEST',
   57 |   'AFFECTED_ITEMS_PREVIEW',
   58 |   'TASK_STATUS',
   59 | ];
   60 | const REVIEW_PROMPT_VERSION = 'wiselink.3_1.review_prompt.v1.c16';
   61 | const WISELINK_HOST_MCP_CONFIG_KEYS = new Set([
   62 |   WISELINK_HOST_MCP_NAME,
   63 |   'wiselink_host_controller',
   64 | ]);
   65 | const MAX_SOURCE_REFS = 100;
   66 | const MAX_GATEWAY_BYTES = 4 * 1024 * 1024;
```

原文件行 101—156：

```text
  101 |     const value = await checkpoint.remoteStep({
  102 |       step,
  103 |       args,
  104 |       ambiguousCommit: name === 'commit_review_turn_candidate',
  105 |       perform: () => remoteCall(name, structuredClone(args)),
  106 |     });
  107 |     if (name === 'begin_review_turn') beginResult = value;
  108 |     return value;
  109 |   };
  110 |
  111 |   const result = await runInteractiveReviewTurn({
  112 |     mode: 'INTERACTIVE_REVIEW',
  113 |     reviewConversationRef: normalized.reviewConversationRef,
  114 |     requestId: normalized.requestId,
  115 |     callTool,
  116 |     respond: async ({ input, readSourceRefs }) => {
  117 |       assertModelInputHasNoControlPlane(input, normalized, beginResult);
  118 |       const selectedSourceRefIds = selectSourceRefIds(input);
  119 |       const sourceRefs =
  120 |         selectedSourceRefIds.length === 0
  121 |           ? []
  122 |           : await readSourceRefs(selectedSourceRefIds);
  123 |       const generationInput = {
  124 |         schemaVersion: MODEL_INPUT_SCHEMA,
  125 |         mode: 'INTERACTIVE_REVIEW',
  126 |         purpose: 'SUPERVISED_REVIEW_CANDIDATE',
  127 |         candidateOnly: true,
  128 |         input,
  129 |         sourceRefs,
  130 |       };
  131 |       assertModelInputHasNoControlPlane(
  132 |         generationInput,
  133 |         normalized,
  134 |         beginResult,
  135 |       );
  136 |       const modelArgsHash = canonicalSha256(generationInput);
  137 |       const execution = await checkpoint.remoteStep({
  138 |         step: 'model',
  139 |         args: generationInput,
  140 |         ambiguousCommit: false,
  141 |         perform: () =>
  142 |           invokeModel(structuredClone(generationInput), {
  143 |             sessionDiscriminator: sha256(normalized.requestId),
  144 |             observeOutputShape: async (value) =>
  145 |               checkpoint.writeOnce('model.output-shape', {
  146 |                 schemaVersion: DRIVER_SCHEMA,
  147 |                 step: 'model',
  148 |                 argsHash: modelArgsHash,
  149 |                 observedAt: new Date().toISOString(),
  150 |                 value: validateModelOutputShape(value),
  151 |               }),
  152 |           }),
  153 |       });
  154 |       const partial = validateModelExecution(
  155 |         execution,
  156 |         selectedSourceRefIds,
```

原文件行 204—267：

```text
  204 |   return report;
  205 | }
  206 |
  207 | export async function invokeHostedReviewModel(input, options = {}) {
  208 |   const gatewayUrl = requiredUrl(
  209 |     options.gatewayUrl,
  210 |     'REVIEW_GATEWAY_URL_REQUIRED',
  211 |   );
  212 |   const gatewayToken = requiredText(
  213 |     options.gatewayToken,
  214 |     'REVIEW_GATEWAY_TOKEN_REQUIRED',
  215 |   );
  216 |   const agentId = requiredText(
  217 |     options.agentId ?? WISELINK_PROFILE_REF,
  218 |     'REVIEW_AGENT_REQUIRED',
  219 |   );
  220 |   const timeoutMs = positiveInteger(options.timeoutMs, 480_000);
  221 |   const configuredModelVersion = requiredText(
  222 |     options.configuredModelVersion,
  223 |     'REVIEW_MODEL_CONFIG_UNREADABLE',
  224 |   );
  225 |   const observeOutputShape = options.observeOutputShape;
  226 |   if (
  227 |     observeOutputShape !== undefined &&
  228 |     typeof observeOutputShape !== 'function'
  229 |   ) {
  230 |     throw new Error('REVIEW_MODEL_OUTPUT_SHAPE_OBSERVER_INVALID');
  231 |   }
  232 |   const prompt = buildReviewPrompt(input);
  233 |   const sessionDiscriminator = requiredText(
  234 |     options.sessionDiscriminator ?? canonicalSha256(input),
  235 |     'REVIEW_MODEL_SESSION_DISCRIMINATOR_REQUIRED',
  236 |   );
  237 |   const startedAt = Date.now();
  238 |   const endpoint = new URL('/v1/chat/completions', gatewayUrl);
  239 |   const response = await fetch(endpoint, {
  240 |     method: 'POST',
  241 |     headers: {
  242 |       accept: 'application/json',
  243 |       authorization: `Bearer ${gatewayToken}`,
  244 |       'content-type': 'application/json',
  245 |     },
  246 |     body: JSON.stringify({
  247 |       model: `openclaw/${agentId}`,
  248 |       user: `review-driver:${sha256(sessionDiscriminator).slice(0, 24)}`,
  249 |       messages: [
  250 |         {
  251 |           role: 'system',
  252 |           content:
  253 |             `Call ${REVIEW_OUTPUT_FUNCTION_NAME} exactly once to serialize the candidate. Emit no assistant prose. This function has no implementation and is never executed.`,
  254 |         },
  255 |         { role: 'user', content: prompt },
  256 |       ],
  257 |       tools: [reviewCandidateFunctionTool()],
  258 |       tool_choice: {
  259 |         type: 'function',
  260 |         function: { name: REVIEW_OUTPUT_FUNCTION_NAME },
  261 |       },
  262 |       parallel_tool_calls: false,
  263 |       n: 1,
  264 |       stream: false,
  265 |     }),
  266 |     signal: AbortSignal.timeout(timeoutMs),
  267 |   });
```

原文件行 768—789：

```text
  768 | function selectSourceRefIds(input) {
  769 |   const available = new Set(input.availableSourceRefIds ?? []);
  770 |   const selected = input.selectedEvaluationItemId;
  771 |   const items = Array.isArray(input.context?.evaluation?.items)
  772 |     ? input.context.evaluation.items
  773 |     : [];
  774 |   const item = items.find(({ criterionId }) => criterionId === selected);
  775 |   const preferred = Array.isArray(item?.sourceRefs) ? item.sourceRefs : [];
  776 |   const attachments = Array.isArray(input.attachmentRefs)
  777 |     ? input.attachmentRefs
  778 |     : [];
  779 |   const ids = [
  780 |     ...(preferred.length > 0 ? preferred : [...available]),
  781 |     ...attachments,
  782 |   ].filter((id) => available.has(id));
  783 |   const unique = [...new Set(ids)];
  784 |   if (unique.length > MAX_SOURCE_REFS) {
  785 |     throw new Error('REVIEW_SOURCE_REF_SELECTION_TOO_LARGE');
  786 |   }
  787 |   return unique;
  788 | }
  789 |
```

## 12. server/modules/review-persistence/review-conversation.service.ts

页面输入保存与回读路径，核查执行触发责任。

原文件行 89—200：

```text
   89 |   async appendTextTurn(
   90 |     workItemId: string,
   91 |     reviewConversationId: string,
   92 |     input: AppendReviewTextTurnRequest,
   93 |     request: Request,
   94 |   ): Promise<AppendReviewTextTurnResponse> {
   95 |     const authorized: AuthorizedReviewAccess = await this.authorize(
   96 |       request,
   97 |       workItemId,
   98 |       'RECORD_ENGINEER_REVIEW',
   99 |     );
  100 |     const existing: PersistedReviewConversationAggregate =
  101 |       await this.requiredConversation(reviewConversationId);
  102 |     assertConversationBinding(existing.conversation, authorized);
  103 |     if (existing.conversation.status !== 'ACTIVE') {
  104 |       throw reviewConflict('REVIEW_CONVERSATION_CLOSED');
  105 |     }
  106 |
  107 |     const replay: PersistedReviewTurn | undefined = existing.turns.find(
  108 |       (turn: PersistedReviewTurn) => turn.requestId === input.requestId,
  109 |     );
  110 |     if (replay) {
  111 |       assertAttachmentReplay(replay, input.attachmentSelection);
  112 |       return this.appendAndReadback({
  113 |         authorized,
  114 |         conversation: existing.conversation,
  115 |         requestId: input.requestId,
  116 |         userMessage: input.userMessage,
  117 |         attachmentBindings: replay.attachmentBindings,
  118 |       });
  119 |     }
  120 |
  121 |     let attachmentBindings: ReviewAttachmentBinding[] = [];
  122 |     if (input.attachmentSelection) {
  123 |       const attachmentGrant: AuthorizedReviewAccess =
  124 |         await this.authorizeAttachment(
  125 |           authorized.session,
  126 |           workItemId,
  127 |           authorized.grant.workItemRevision,
  128 |         );
  129 |       assertSameGrant(authorized, attachmentGrant);
  130 |       const attachment: ReviewAttachmentBinding = await this.attachments.ingest(
  131 |         {
  132 |           selection: input.attachmentSelection,
  133 |           requestId: input.requestId,
  134 |           conversation: existing.conversation,
  135 |           session: authorized.session,
  136 |           grant: attachmentGrant.grant,
  137 |         },
  138 |       );
  139 |       const afterIngest: AuthorizedReviewAccess = await this.authorize(
  140 |         request,
  141 |         workItemId,
  142 |         'RECORD_ENGINEER_REVIEW',
  143 |       );
  144 |       assertSameGrant(authorized, afterIngest);
  145 |       if (
  146 |         afterIngest.grant.workItemRevision !== authorized.grant.workItemRevision
  147 |       ) {
  148 |         throw reviewConflict('REVIEW_ATTACHMENT_WORK_ITEM_STALE');
  149 |       }
  150 |       attachmentBindings = [attachment];
  151 |     }
  152 |     return this.appendAndReadback({
  153 |       authorized,
  154 |       conversation: existing.conversation,
  155 |       requestId: input.requestId,
  156 |       userMessage: input.userMessage,
  157 |       attachmentBindings,
  158 |     });
  159 |   }
  160 |
  161 |   private async appendAndReadback(input: {
  162 |     authorized: AuthorizedReviewAccess;
  163 |     conversation: PersistedReviewConversation;
  164 |     requestId: string;
  165 |     userMessage: string;
  166 |     attachmentBindings: ReviewAttachmentBinding[];
  167 |   }): Promise<AppendReviewTextTurnResponse> {
  168 |     const appended = await this.conversations.appendTextTurn({
  169 |       conversation: input.conversation,
  170 |       requestId: input.requestId,
  171 |       userMessage: input.userMessage,
  172 |       currentRevision: input.authorized.grant.workItemRevision,
  173 |       attachmentBindings: input.attachmentBindings,
  174 |     });
  175 |     const aggregate: PersistedReviewConversationAggregate =
  176 |       await this.requiredConversation(input.conversation.reviewConversationId);
  177 |     return {
  178 |       conversation: reviewConversationReadModel(
  179 |         aggregate,
  180 |         input.authorized.grant.workItemRevision,
  181 |       ),
  182 |       turn: reviewTurnReadModel(appended.turn),
  183 |       replayed: appended.replayed,
  184 |     };
  185 |   }
  186 |
  187 |   async close(
  188 |     workItemId: string,
  189 |     reviewConversationId: string,
  190 |     request: Request,
  191 |   ): Promise<CloseReviewConversationResponse> {
  192 |     const authorized: AuthorizedReviewAccess = await this.authorize(
  193 |       request,
  194 |       workItemId,
  195 |       'RECORD_ENGINEER_REVIEW',
  196 |     );
  197 |     const existing: PersistedReviewConversationAggregate =
  198 |       await this.requiredConversation(reviewConversationId);
  199 |     assertConversationBinding(existing.conversation, authorized);
  200 |     const closed = await this.conversations.close({
```

## 13. client/src/features/review/ContinuousReviewPanel.tsx

前端发送及补充材料路径。

原文件行 234—322：

```text
  234 |   async function appendTurn(): Promise<void> {
  235 |     const userMessage = message.trim();
  236 |     if (
  237 |       busy ||
  238 |       !conversation ||
  239 |       conversation.status !== 'ACTIVE' ||
  240 |       !conversation.currentRevisionSynced ||
  241 |       !userMessage
  242 |     ) {
  243 |       return;
  244 |     }
  245 |     setBusyAction('append');
  246 |     clearError();
  247 |     try {
  248 |       const requestId = requestIdRef.current ?? createRequestCorrelationId();
  249 |       requestIdRef.current = requestId;
  250 |       setActiveRequestId(requestId);
  251 |       let selection = uploadedSelection;
  252 |       if (file && !selection) {
  253 |         await canonicalHost.requireOfficialOauthSession();
  254 |         const uploaded = await uploadFile(file, {
  255 |           filePath: `wiselink/review-input/${requestId}/${safePdfName(file.name)}`,
  256 |           contentType: 'application/pdf',
  257 |           upsert: false,
  258 |         });
  259 |         selection = {
  260 |           bucketId: uploaded.bucketId,
  261 |           filePath: uploaded.filePath,
  262 |         };
  263 |         setUploadedSelection(selection);
  264 |       }
  265 |       const response = await canonicalHost.appendReviewTextTurn(
  266 |         workItemId,
  267 |         conversation.reviewConversationId,
  268 |         {
  269 |           requestId,
  270 |           userMessage,
  271 |           ...(selection ? { attachmentSelection: selection } : {}),
  272 |         },
  273 |       );
  274 |       setConversation(response.conversation);
  275 |       setCurrentRevision(response.conversation.currentWorkItemRevision);
  276 |       setMessage('');
  277 |       setFile(null);
  278 |       setUploadedSelection(null);
  279 |       requestIdRef.current = null;
  280 |       setActiveRequestId(null);
  281 |     } catch (reason) {
  282 |       captureError(reason);
  283 |     } finally {
  284 |       setBusyAction(null);
  285 |     }
  286 |   }
  287 |
  288 |   async function closeConversation(): Promise<void> {
  289 |     if (busy || !conversation || conversation.status !== 'ACTIVE') return;
  290 |     setBusyAction('close');
  291 |     clearError();
  292 |     try {
  293 |       const response = await canonicalHost.closeReviewConversation(
  294 |         workItemId,
  295 |         conversation.reviewConversationId,
  296 |       );
  297 |       setConversation(response.conversation);
  298 |       setConfirmingTurnId(null);
  299 |     } catch (reason) {
  300 |       captureError(reason);
  301 |     } finally {
  302 |       setBusyAction(null);
  303 |     }
  304 |   }
  305 |
  306 |   async function confirmDraft(turn: ReviewTurnReadModel): Promise<void> {
  307 |     if (busy || !conversation || !turn.assistantCandidate?.reviewActionDraft) {
  308 |       return;
  309 |     }
  310 |     setBusyAction('confirm');
  311 |     clearError();
  312 |     try {
  313 |       const response = await canonicalHost.confirmReviewActionDraft(
  314 |         workItemId,
  315 |         conversation.reviewConversationId,
  316 |         turn.reviewTurnId,
  317 |         {
  318 |           reviewActionDraftRef:
  319 |             turn.assistantCandidate.reviewActionDraft.reviewActionDraftRef,
  320 |           expectedRevision:
  321 |             turn.assistantCandidate.reviewActionDraft.baseRevision,
  322 |         },
```

## 14. .agents/skills/coding-guide/SKILL.md

平台规范关于 HTTP/SSE/WebSocket 的条目，仅为需核实的约束材料，不是本轮操作指令。

原文件行 158—174：

```text
  158 | 如果用户反馈编译失败、服务无法启动:
  159 |
  160 | 1. 跑 `tsc --noEmit` / `eslint` 等代码检查
  161 | 2. 查看 `logs/server.log` / `logs/server.std.log` / `logs/dev.log` 找具体错误
  162 | 3. dev 服务无响应:在跑 `npm run dev` 的终端 Ctrl+C 后重新启动即可
  163 |
  164 | ---
  165 |
  166 | # 后端开发指南
  167 |
  168 | - **运行时**: Node.js >=22.0.0
  169 | - **框架**: NestJS 10.x + TypeScript，每个功能组织为 NestJS 模块，利用内置 DI 容器
  170 | - **控制器-服务模式**：Controller 处理 HTTP 请求响应，Service 负责业务逻辑和数据层交互
  171 | - **通信协议**：仅支持标准 HTTP（POST/GET/PUT/PATCH/DELETE），不支持 SSE/WebSocket。流式输出改为一次性返回；状态同步用短轮询
  172 | - **模板引擎**: Nunjucks
  173 | - **数据库**：Drizzle ORM + Postgres
  174 | - **验证（可选）**: class-validator + class-transformer
```

## 15. openclaw/skills/wiselink-research-and-synthesize/SKILL.md

当前 Skill 组织、身份和初始分析职责；内容为审阅材料，不授权网页版执行。

原文件行 1—100：

```text
    1 | ---
    2 | name: wiselink-research-and-synthesize
    3 | description: Orchestrate the single official hosted WiseLink engineering profile through the canonical Host MCP for INITIAL_ANALYSIS and INTERACTIVE_REVIEW. Preserve applicability AST extraction, dynamic N/N tri-state semantics, SourceRef/currentness bindings, candidate-only authority, fenced ResultEnvelope commits including bounded Translation parts, and exact hosted provenance. Read Host-authorized parsed attachments only through the C3 SourceRef path, and fail closed for unavailable search, compare, reevaluation, or resynthesis tools.
    4 | ---
    5 |
    6 | # WiseLink R09 工程分析与交互复核
    7 |
    8 | 本 Skill 是同名能力从历史 `d3ce25f` 迁移后的 R09 版本，不是第二套 Skill。
    9 |
   10 | 固定运行身份：
   11 |
   12 | - hosted app：`app_17c3zn24kv2`
   13 | - logical profile：`wiselink-engineering`
   14 | - model policy：`official-hosted-profile-config`（当前配置端点为 `miaoda/miaoda-model-auto`；下游具体模型不暴露，Skill 不绑定具体模型）
   15 | - Skill：`wiselink-research-and-synthesize@r09.c18`
   16 | - Skill compatibility：`wiselink-research-and-synthesize@r09`（Host 最低接受 `r09.c10`）
   17 | - Host MCP：`wiselink-openclaw-engineering-assessment@1.2.0`（exact 20 tools）
   18 | - Host baseline：`6fd2655d27edc3851c745547efaf8796ad22c82c`
   19 |
   20 | app/profile/Skill/MCP 是执行合同，不是允许模型自报的标签。具体模型由官方托管 profile/config 选择；驱动从唯一
   21 | profile 的 `agents.list[].model` 读取 string 或 `{primary,fallbacks}`，缺少显式 agent model 时才回退
   22 | `agents.defaults.model`，且 fallbacks 必须为空。每次执行优先使用响应中可读的实际 `modelVersion`；响应未提供可读模型
   23 | 时使用上述 configured provider/model endpoint，再连同 `promptVersion`、`skillVersion` 和 `toolVersions` 由 validator 校验后写入完整
   24 | ResultEnvelope。重复 agent、不可读 primary、fallbacks 非数组或非空均停止；Skill 不维护模型版本 allowlist。
   25 |
   26 | `skillVersion` 始终记录实际安装包版本；Task 中的 `skillPolicyRef`（以及 Applicability v1 的历史字段
   27 | `runtimePolicy.skillVersion`）表示兼容线 `wiselink-research-and-synthesize@r09`。只改 references、示例或不改变
   28 | Task/Result/MCP 语义的 prompt 时可 Skill-only 发布新 c 修订；改变 schema、tool 参数、authority 或安全语义时
   29 | 必须升级兼容线并与 Host 协同发布。
   30 |
   31 | ## 不变边界
   32 |
   33 | - 妙搭是业务入口；Host 是 actor/ACL、业务对象、FileService、revision、current、CAS、实际字节和产物真源。
   34 | - OpenClaw 只生成 `candidate_only`。不得批准、发布、执行 ReviewAction、修改 WorkItem revision、切换
   35 |   current 或标记 STALE。
   36 | - 不把 actor、tenant、ACL、credential、OAuth/session cookie、FileService bucket/path/locator、原始 PDF、
   37 |   完整 Fleet 或其它 WorkItem 内容发送给模型。
   38 | - `workItemId` 只用于 INITIAL_ANALYSIS 的 Host MCP 控制面。INTERACTIVE_REVIEW 入口只接收
   39 |   `reviewConversationRef` 和 `requestId`；Host 派生其余身份和业务绑定。Host review context 中的
   40 |   `workItemId` 在送模型前移除。
   41 | - TaskEnvelope 中的 `actorContextRef` 是 Host 控制面引用，不发送给模型，也不视为凭据或 ACL 替代品。
   42 | - 不使用本地 OpenClaw/Docker、OpenAI/Codex OAuth、外部 provider、通用 shell、自造 HTTP、普通 app
   43 |   OpenAPI 伪造 invoke 或旧 0.11 runtime。
   44 | - 本目录脚本是无凭据的编排/validator 模块，不连接 Host、不调用模型、不安装 Skill。历史 ZIP 安装器和
   45 |   `archive/internal-lab/phase13-ab.mjs` 均不在本版本运行资产中。
   46 | - 官方 Hosted Agent 的真实路径是按本文件调用 MCP。Translation 的 sealed ResultEnvelope 必须先落到本轮本地
   47 |   `commit-payload.json`，再由本 Skill 的 `commitTranslationPayloadFile` 按原始字节分块读取并调用 MCP；不得让模型
   48 |   手工复刻完整 JSON。除这个无凭据的 bundled helper 外，不依赖通用 shell、自造 HTTP 或本地 decoder。
   49 |
   50 | ## Mode 1：INITIAL_ANALYSIS
   51 |
   52 | 每次只路由一个 Host 授权 operation：
   53 |
   54 | | Operation               | 当前工具路径                                                                                | 状态   |
   55 | | ----------------------- | ------------------------------------------------------------------------------------------- | ------ |
   56 | | `TRANSLATE`             | `begin_translation` → model → 同一 `commit_translation_candidate` 分块上传并 finalize       | 可执行 |
   57 | | `EXTRACT_APPLICABILITY` | `begin_applicability_evaluation` → AST model → `commit_applicability_candidate`             | 可执行 |
   58 | | `EVALUATE_JOBAID`       | `begin_dynamic_evaluation` → model → `commit_dynamic_evaluation_candidate`                  | 可执行 |
   59 | | `SYNTHESIZE_OVERALL`    | `begin_overall_synthesis` / `resume_overall_synthesis` → model → `commit_overall_candidate` | 可执行 |
   60 |
   61 | `EXTRACT_APPLICABILITY` 只能走专用 applicability begin/commit；禁止把 `EVALUATE_JOBAID`、Reader 命中或
   62 | overall 中的文字解释成适用性结果。
   63 |
   64 | Applicability model input 兼容旧 Host 缺少 `configurationEvidenceReevaluation`，也接受该字段为 `null`；
   65 | P0B 时只接受 Host 给出的精确协调绑定
   66 | `{triggerSnapshotId,triggerConfigurationRevision,adoptionWorkItemRevision,applicabilityRetryNo}`。该绑定仅用于
   67 | 校验本轮协调上下文，不进入 applicability candidate，也不授权模型改变 Host 的重算状态。
   68 |
   69 | ### 通用 begin / commit
   70 |
   71 | 1. `get_parse_status({workItemId})` fresh-read 当前状态。
   72 | 2. 调对应 `begin_*`。Translation begin 第 0 包直接返回可读的 attempt control、脱敏 taskBinding、
   73 |    `modelInputBase` 与第一批 SourceUnits；若 `partCount > 1`，官方 Hosted Agent 用同一工具按 `deliveryPart=1..N-1`
   74 |    顺序读取剩余可读 SourceUnits。每个完整 MCP tool result 按实际 JSON UTF-8 bytes 限在 14,000 内，不从托管
   75 |    日志恢复截断 JSON。
   76 | 3. 若 status 为 `COMMITTING`，只调用一次 `get_action_attempt_status`，校验 Host 已持久化
   77 |    `recoveryResult.contentHash == resultContentHash == begin.recoveryResultContentHash` 后返回；不调用模型、不再次
   78 |    commit。begin 只返回该有界 hash，完整 recoveryResult 由既有 status 工具读取。
   79 | 4. 若 status 为 `RUNNING`，只使用 `delivery.modelInputBase + delivery.sourceUnits` 组成的 authority-free translation
   80 |    输入；attempt control/taskBinding 不混入翻译输入。收齐输入后 heartbeat，生成完成、commit 前再 heartbeat；生成期间
   81 |    不要求短周期回调，Host 的长租约覆盖该段运行。
   82 | 5. 模型执行必须返回 `{output, provenance}`；provenance 必须是实际读数，实际模型非空可读，并通过固定
   83 |    Skill/MCP/prompt validator。
   84 | 6. 先验证 operation input/output pair，再构造完整
   85 |    `wiselink.3_1.openclaw_result_envelope.v1`。Applicability、Dynamic、Overall、Review 仍使用精确的单次 commit 参数：
   86 |
   87 | ```json
   88 | {
   89 |   "attemptRef": "AQ-opaque",
   90 |   "leaseToken": "host-issued-uuid",
   91 |   "leaseGeneration": 1,
   92 |   "result": { "schemaVersion": "wiselink.3_1.openclaw_result_envelope.v1" }
   93 | }
   94 | ```
   95 |
   96 | Translation 不使用上述单次大参数：将 sealed ResultEnvelope 写为本轮 `commit-payload.json`，通过下文
   97 | `UPLOAD_PART → FINALIZE` 形态提交。7. commit/finalize 后 fresh-read `get_parse_status`。Host 才负责 ResultGate、实际字节 persist/readback 和 WorkItem
   98 | CAS；Skill 不声称这些步骤由模型完成。8. commit 响应未知时只调用一次 `get_action_attempt_status`。仅当同一 attempt 的
   99 | `resultContentHash` 与本次 sealed ResultEnvelope `contentHash` 精确一致时返回只读恢复；否则 outcome unknown，
  100 | 绝不 blind retry。
```
