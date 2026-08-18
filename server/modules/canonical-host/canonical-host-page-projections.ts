import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalEngineerReviewPageContext,
  CanonicalLibraryIndexNode,
  CanonicalLibraryIndexProjection,
  CanonicalRelatedDocumentProjection,
  CanonicalRelatedDocumentRelation,
  CanonicalTimelineEvent,
  CanonicalTimelineProjection,
  CanonicalWorkbenchAuditProjection,
  CanonicalWorkItemProjection,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

export interface CanonicalPageProjectionInput {
  workItem: CanonicalWorkItemProjection;
  queryResults: UnifiedReaderQueryResult[];
  engineerReviewContext: CanonicalEngineerReviewPageContext | null;
}

export type CanonicalPageProjectionBundle = Pick<
  CanonicalDocumentParsingPageResponse,
  'libraryIndex' | 'relatedDocuments' | 'workbenchAudit' | 'timeline'
>;

export function buildCanonicalPageProjections(
  input: CanonicalPageProjectionInput,
): CanonicalPageProjectionBundle {
  const nodes: CanonicalLibraryIndexNode[] = buildLibraryNodes(input);
  const nodeIds: Set<string> = new Set<string>(
    nodes.map((node: CanonicalLibraryIndexNode): string => node.id),
  );
  const relatedDocuments: CanonicalRelatedDocumentProjection =
    buildRelatedDocuments(input.workItem, nodeIds);
  const workbenchAudit: CanonicalWorkbenchAuditProjection =
    buildWorkbenchAudit(input);
  const timeline: CanonicalTimelineProjection = buildTimeline(input);
  return {
    libraryIndex: {
      schemaVersion: 'wiselink.3_1.library_index_projection.v0.candidate',
      scope: 'CURRENT_WORKITEM_ONLY',
      workItemId: input.workItem.workItemId,
      rootLabel: rootLabel(input.workItem),
      nodes,
      completeness: {
        crossWorkItemLibraryAvailable: false,
        relatedDocumentIndexAvailable: false,
        note:
          'This first productized projection is scoped to the current ' +
          'WorkItem. It does not claim tenant-wide library coverage.',
      },
    },
    relatedDocuments,
    workbenchAudit,
    timeline,
  };
}

function buildLibraryNodes(
  input: CanonicalPageProjectionInput,
): CanonicalLibraryIndexNode[] {
  const workItem: CanonicalWorkItemProjection = input.workItem;
  const integrated = workItem.integratedAssessment ?? null;
  const nodes: CanonicalLibraryIndexNode[] = [
    node({
      id: 'work-item',
      parentId: null,
      kind: 'WORK_ITEM',
      label: workItem.workItemId,
      detail: `revision ${workItem.revision}`,
      state: workItem.phase,
      targetNode: 'document',
      authority: 'HOST_WORKITEM_PROJECTION',
    }),
    node({
      id: 'document',
      parentId: 'work-item',
      kind: 'DOCUMENT',
      label: documentLabel(workItem),
      detail: workItem.classification.normalizedFamily,
      state: workItem.classification.status,
      targetNode: 'document',
      authority: 'HOST_WORKITEM_PROJECTION',
    }),
    node({
      id: 'document-version',
      parentId: 'document',
      kind: 'DOCUMENT_VERSION',
      label: workItem.source.documentVersionId,
      detail: `${workItem.source.sourceByteLength.toLocaleString()} bytes`,
      state: workItem.source.driveSourceVersion,
      targetNode: 'document',
      authority: 'HOST_WORKITEM_PROJECTION',
    }),
  ];
  if (workItem.package) {
    nodes.push(
      node({
        id: 'parsed-package',
        parentId: 'document-version',
        kind: 'PARSED_PACKAGE',
        label: workItem.package.packageId,
        detail:
          `${workItem.package.contractRevision} · ` +
          `${workItem.package.contentUnitCount} units`,
        state: workItem.package.resultStatus,
        targetNode: 'package',
        authority: 'HOST_WORKITEM_PROJECTION',
      }),
      node({
        id: 'reader-query',
        parentId: 'parsed-package',
        kind: 'READER_QUERY',
        label: 'Reader source-bound hits',
        detail:
          `${input.queryResults.length} hits · ` +
          `${uniqueSourceRefCount(input.queryResults)} sourceRefs`,
        state: sourceBoundState(input.queryResults),
        targetNode: 'reader',
        authority: 'HOST_READER_PROJECTION',
      }),
    );
  }
  if (integrated?.baseRules) {
    nodes.push(
      node({
        id: 'dynamic-evaluation',
        parentId: 'parsed-package',
        kind: 'DYNAMIC_EVALUATION',
        label: 'OpenClaw dynamic-N evaluation',
        detail:
          `${integrated.baseRules.evaluationItemCount}/` +
          `${integrated.baseRules.criterionCount} criteria`,
        state: integrated.baseRules.status,
        targetNode: 'assessment',
        authority: 'HOST_WORKITEM_PROJECTION',
      }),
    );
  }
  if (input.engineerReviewContext?.ledger) {
    nodes.push(
      node({
        id: 'engineer-review',
        parentId: 'dynamic-evaluation',
        kind: 'ENGINEER_REVIEW',
        label: 'Engineer review ledger',
        detail:
          `${input.engineerReviewContext.ledger.reviewCount} reviews · ` +
          `revision ${input.engineerReviewContext.ledger.revision}`,
        state: input.engineerReviewContext.ledger.status,
        targetNode: 'assessment',
        authority: 'HOST_ENGINEER_REVIEW_CONTEXT',
      }),
    );
  }
  if (integrated?.overallSynthesis) {
    nodes.push(
      node({
        id: 'overall-synthesis',
        parentId: input.engineerReviewContext?.ledger
          ? 'engineer-review'
          : 'dynamic-evaluation',
        kind: 'OVERALL_SYNTHESIS',
        label: 'OpenClaw overall candidate',
        detail:
          `${integrated.overallSynthesis.findingCount} findings · ` +
          `${integrated.overallSynthesis.discoveryStatus}`,
        state: integrated.overallSynthesis.status,
        targetNode: 'overall',
        authority: 'HOST_WORKITEM_PROJECTION',
      }),
    );
  }
  if (workItem.aeo) {
    nodes.push(
      node({
        id: 'aeo-candidate',
        parentId: 'overall-synthesis',
        kind: 'AEO_CANDIDATE',
        label: 'AEO candidate',
        detail: `${workItem.aeo.artifacts.length} artifacts`,
        state: workItem.aeo.status,
        targetNode: 'aeo',
        authority: 'HOST_WORKITEM_PROJECTION',
      }),
    );
  }
  return nodes;
}

function buildRelatedDocuments(
  workItem: CanonicalWorkItemProjection,
  nodeIds: Set<string>,
): CanonicalRelatedDocumentProjection {
  const relations: CanonicalRelatedDocumentRelation[] = [];
  addRelation(relations, nodeIds, {
    id: 'rel-work-item-document-version',
    fromNodeId: 'work-item',
    toNodeId: 'document-version',
    relationRole: 'SELECTED_DOCUMENT_VERSION',
    label: 'WorkItem binds the exact selected DocumentVersion',
    sourceLocator: workItem.source.documentVersionId,
    resolution: 'RESOLVED',
    authority: 'EXPLICIT_WORKITEM_BINDING',
  });
  addRelation(relations, nodeIds, {
    id: 'rel-document-version-package',
    fromNodeId: 'document-version',
    toNodeId: 'parsed-package',
    relationRole: 'PRODUCED_PARSED_PACKAGE',
    label: 'DocumentVersion produced the parsed package currently visible',
    sourceLocator: workItem.package?.artifact.ref ?? 'NO_PACKAGE',
    resolution: 'RESOLVED',
    authority: 'EXPLICIT_WORKITEM_BINDING',
  });
  addRelation(relations, nodeIds, {
    id: 'rel-package-reader',
    fromNodeId: 'parsed-package',
    toNodeId: 'reader-query',
    relationRole: 'HAS_READER_RESULTS',
    label: 'Reader results are bounded to the current parsed package',
    sourceLocator: workItem.package?.readerReceiptId ?? 'NO_READER_RECEIPT',
    resolution: 'RESOLVED',
    authority: 'DERIVED_FROM_CURRENT_PROJECTION',
  });
  addRelation(relations, nodeIds, {
    id: 'rel-package-dynamic',
    fromNodeId: 'parsed-package',
    toNodeId: 'dynamic-evaluation',
    relationRole: 'HAS_DYNAMIC_EVALUATION',
    label: 'Dynamic evaluation consumed this package as candidate input',
    sourceLocator:
      workItem.integratedAssessment?.baseRules.actionAttemptId ??
      'NO_DYNAMIC_ATTEMPT',
    resolution: 'RESOLVED',
    authority: 'DERIVED_FROM_CURRENT_PROJECTION',
  });
  addRelation(relations, nodeIds, {
    id: 'rel-dynamic-review',
    fromNodeId: 'dynamic-evaluation',
    toNodeId: 'engineer-review',
    relationRole: 'HAS_ENGINEER_REVIEW',
    label: 'Engineer review ledger is bound to the dynamic criterion set',
    sourceLocator:
      workItem.integratedAssessment?.engineerReviews?.actionAttemptId ??
      'NO_REVIEW_ATTEMPT',
    resolution: 'RESOLVED',
    authority: 'DERIVED_FROM_CURRENT_PROJECTION',
  });
  addRelation(relations, nodeIds, {
    id: 'rel-dynamic-overall',
    fromNodeId: nodeIds.has('engineer-review')
      ? 'engineer-review'
      : 'dynamic-evaluation',
    toNodeId: 'overall-synthesis',
    relationRole: 'HAS_OVERALL_SYNTHESIS',
    label: 'Overall candidate is based on dynamic results and reviews',
    sourceLocator:
      workItem.integratedAssessment?.overallSynthesis?.actionAttemptId ??
      'NO_OVERALL_ATTEMPT',
    resolution: 'RESOLVED',
    authority: 'DERIVED_FROM_CURRENT_PROJECTION',
  });
  addRelation(relations, nodeIds, {
    id: 'rel-overall-aeo',
    fromNodeId: 'overall-synthesis',
    toNodeId: 'aeo-candidate',
    relationRole: 'HAS_AEO_CANDIDATE',
    label: 'AEO candidate is downstream and non-blocking for this loop',
    sourceLocator: workItem.aeo?.actionAttemptId ?? 'NO_AEO_ATTEMPT',
    resolution: 'RESOLVED',
    authority: 'DERIVED_FROM_CURRENT_PROJECTION',
  });
  return {
    schemaVersion: 'wiselink.3_1.related_document_projection.v0.candidate',
    scope: 'CURRENT_WORKITEM_ONLY',
    workItemId: workItem.workItemId,
    relations,
    boundary: {
      externalRelatedDocumentsInferred: false,
      note:
        'Relations are only those explicitly present in the current Host ' +
        'projection. Missing external library links remain absent.',
    },
  };
}

function buildWorkbenchAudit(
  input: CanonicalPageProjectionInput,
): CanonicalWorkbenchAuditProjection {
  const workItem: CanonicalWorkItemProjection = input.workItem;
  const usagePolicy = workItem.package?.usagePolicy ?? null;
  const integrated = workItem.integratedAssessment ?? null;
  const sourceBoundResultCount: number = input.queryResults.filter(
    (result: UnifiedReaderQueryResult): boolean =>
      result.sourceRefIds.length > 0,
  ).length;
  const dynamic = integrated?.baseRules ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const ledger = input.engineerReviewContext?.ledger ?? null;
  return {
    schemaVersion: 'wiselink.3_1.workbench_audit_projection.v0.candidate',
    workItemId: workItem.workItemId,
    packageReadback: {
      packageId: workItem.package?.packageId ?? null,
      contractRevision: workItem.package?.contractRevision ?? null,
      resultStatus: workItem.package?.resultStatus ?? null,
      contentUnitCount: workItem.package?.contentUnitCount ?? 0,
      sourceRefCount: workItem.package?.sourceRefCount ?? 0,
      artifactRef: workItem.package?.artifact.ref ?? null,
      artifactSha256: workItem.package?.artifact.sha256 ?? null,
    },
    reader: {
      queryResultCount: input.queryResults.length,
      sourceBoundResultCount,
      uniqueSourceRefCount: uniqueSourceRefCount(input.queryResults),
      allReturnedResultsSourceBound:
        input.queryResults.length > 0 &&
        sourceBoundResultCount === input.queryResults.length,
      applicabilityConclusionAllowed: false,
      note:
        'Reader hits prove source-bound text retrieval only; they do not ' +
        'prove aircraft or fleet applicability by document presence.',
    },
    applicabilityAuthority: {
      sourceExpressionCount:
        usagePolicy?.applicability.sourceExpressionCount ?? null,
      normalizedCandidateCount:
        usagePolicy?.applicability.normalizedCandidateCount ?? null,
      assignmentCount: usagePolicy?.applicability.assignmentCount ?? null,
      inferredFromDocumentPresence: false,
    },
    dynamicEvaluation: dynamic
      ? {
          status: dynamic.status,
          criterionSetId: dynamic.criterionSetId,
          criterionCount: dynamic.criterionCount,
          evaluationItemCount: dynamic.evaluationItemCount,
          unresolvedCount: dynamic.unresolvedCount,
          sourceBoundCandidateCount: dynamic.sourceBoundCandidateCount,
          artifactSha256: dynamic.artifact.sha256,
          actionAttemptId: dynamic.actionAttemptId,
        }
      : null,
    engineerReview: ledger
      ? {
          revision: ledger.revision,
          reviewCount: ledger.reviewCount,
          effectiveReviewedCount: effectiveReviewedCount(
            input.engineerReviewContext,
          ),
          actionAttemptId: ledger.actionAttemptId,
        }
      : null,
    overallSynthesis: overall
      ? {
          status: overall.status,
          revision: overall.revision,
          discoveryStatus: overall.discoveryStatus,
          gap: overall.gap,
          findingCount: overall.findingCount,
          candidateRefCount: overall.candidateRefCount,
          unresolvedCount: overall.unresolvedCount,
          staleReason: overall.staleReason,
          artifactSha256: overall.artifact.sha256,
          actionAttemptId: overall.actionAttemptId,
        }
      : null,
    candidateFormationSteps: candidateFormationSteps(
      workItem,
      input.queryResults,
      input.engineerReviewContext,
    ),
  };
}

function buildTimeline(
  input: CanonicalPageProjectionInput,
): CanonicalTimelineProjection {
  const events: CanonicalTimelineEvent[] = [];
  const workItem: CanonicalWorkItemProjection = input.workItem;
  pushEvent(events, {
    kind: 'WORKITEM_REVISION',
    label: 'WorkItem fresh-read',
    status: workItem.phase,
    detail: `Current revision ${workItem.revision}`,
    occurredAt: null,
    revision: workItem.revision,
    artifactRef: null,
    actionAttemptId: null,
  });
  pushEvent(events, {
    kind: 'DOCUMENT_VERSION_BOUND',
    label: 'DocumentVersion selected',
    status: workItem.classification.status,
    detail: workItem.source.documentVersionId,
    occurredAt: null,
    revision: null,
    artifactRef: workItem.source.sourceArtifactId,
    actionAttemptId: null,
  });
  if (workItem.package) {
    pushEvent(events, {
      kind: 'PACKAGE_READBACK',
      label: 'Parsed package ready',
      status: workItem.package.resultStatus,
      detail:
        `${workItem.package.contentUnitCount} units · ` +
        `${workItem.package.sourceRefCount} sourceRefs`,
      occurredAt: null,
      revision: null,
      artifactRef: workItem.package.artifact.ref,
      actionAttemptId: null,
    });
    pushEvent(events, {
      kind: 'READER_QUERY',
      label: 'Reader query returned source-bound candidates',
      status: sourceBoundState(input.queryResults),
      detail:
        `${input.queryResults.length} hits · ` +
        `${uniqueSourceRefCount(input.queryResults)} unique sourceRefs`,
      occurredAt: null,
      revision: null,
      artifactRef: workItem.package.artifact.ref,
      actionAttemptId: null,
    });
  }
  if (workItem.integratedAssessment?.baseRules) {
    const dynamic = workItem.integratedAssessment.baseRules;
    pushEvent(events, {
      kind: 'DYNAMIC_EVALUATION',
      label: 'OpenClaw dynamic-N candidate',
      status: dynamic.status,
      detail:
        `${dynamic.evaluationItemCount}/${dynamic.criterionCount} criteria`,
      occurredAt: null,
      revision: dynamic.revision,
      artifactRef: dynamic.artifact.ref,
      actionAttemptId: dynamic.actionAttemptId,
    });
  }
  if (input.engineerReviewContext?.ledger) {
    const ledger = input.engineerReviewContext.ledger;
    pushEvent(events, {
      kind: 'ENGINEER_REVIEW',
      label: 'Engineer review ledger',
      status: ledger.status,
      detail: `${ledger.reviewCount} review records`,
      occurredAt: latestReviewTimestamp(input.engineerReviewContext),
      revision: ledger.revision,
      artifactRef: ledger.artifact.ref,
      actionAttemptId: ledger.actionAttemptId,
    });
  }
  if (workItem.integratedAssessment?.overallSynthesis) {
    const overall = workItem.integratedAssessment.overallSynthesis;
    pushEvent(events, {
      kind: 'OVERALL_SYNTHESIS',
      label: 'OpenClaw overall candidate',
      status: overall.status,
      detail:
        `${overall.findingCount} findings · gap ${overall.gap ?? 'NONE'}`,
      occurredAt: null,
      revision: overall.revision,
      artifactRef: overall.artifact.ref,
      actionAttemptId: overall.actionAttemptId,
    });
  }
  if (workItem.integratedAssessment?.overallForAeoConfirmation) {
    const confirmation = workItem.integratedAssessment.overallForAeoConfirmation;
    pushEvent(events, {
      kind: 'OVERALL_CONFIRMATION',
      label: 'Human confirmation for downstream AEO',
      status: confirmation.status,
      detail:
        `overall revision ${confirmation.overallRevision} · ` +
        `workItem revision ${confirmation.workItemRevision}`,
      occurredAt: confirmation.confirmedAt,
      revision: confirmation.overallRevision,
      artifactRef: confirmation.overallArtifactRef,
      actionAttemptId: confirmation.actionAttemptId,
    });
  }
  if (workItem.aeo) {
    pushEvent(events, {
      kind: 'AEO_CANDIDATE',
      label: 'AEO candidate produced',
      status: workItem.aeo.status,
      detail: `${workItem.aeo.artifacts.length} artifacts · non-blocking`,
      occurredAt: null,
      revision: null,
      artifactRef: workItem.aeo.artifacts[0]?.artifactRef ?? null,
      actionAttemptId: workItem.aeo.actionAttemptId,
    });
  }
  if (workItem.failure) {
    pushEvent(events, {
      kind: 'FAILURE',
      label: 'Failure report',
      status: workItem.failure.failureCode,
      detail: workItem.failure.message,
      occurredAt: null,
      revision: null,
      artifactRef: workItem.failure.artifact.ref,
      actionAttemptId: null,
    });
  }
  return {
    schemaVersion: 'wiselink.3_1.timeline_projection.v0.candidate',
    workItemId: workItem.workItemId,
    events,
    boundary: {
      onlyServerObservedEvents: true,
      note:
        'Timeline contains server-visible projection events only; absent ' +
        'timestamps are left null rather than invented.',
    },
  };
}

function candidateFormationSteps(
  workItem: CanonicalWorkItemProjection,
  queryResults: UnifiedReaderQueryResult[],
  engineerReviewContext: CanonicalEngineerReviewPageContext | null,
): CanonicalWorkbenchAuditProjection['candidateFormationSteps'] {
  const integrated = workItem.integratedAssessment ?? null;
  const dynamic = integrated?.baseRules ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  return [
    {
      id: 'bind-document-version',
      label: 'Bound exact DocumentVersion',
      status: workItem.classification.status,
      summary:
        `${workItem.classification.normalizedFamily} · ` +
        `${workItem.source.sourceByteLength.toLocaleString()} bytes`,
      evidenceRef: workItem.source.documentVersionId,
    },
    {
      id: 'read-package',
      label: 'Read parsed package and source refs',
      status: workItem.package ? workItem.package.resultStatus : 'WAITING',
      summary: workItem.package
        ? `${workItem.package.contentUnitCount} units · ` +
          `${workItem.package.sourceRefCount} sourceRefs`
        : 'No package projection is available yet',
      evidenceRef: workItem.package?.artifact.sha256 ?? 'NO_PACKAGE_ARTIFACT',
    },
    {
      id: 'query-reader',
      label: 'Query bounded Reader',
      status: sourceBoundState(queryResults),
      summary:
        `${queryResults.length} hits · ` +
        `${uniqueSourceRefCount(queryResults)} unique sourceRefs`,
      evidenceRef: workItem.package?.readerReceiptId ?? 'NO_READER_RECEIPT',
    },
    {
      id: 'run-dynamic-evaluation',
      label: 'Run OpenClaw dynamic-N evaluation',
      status: dynamic?.status ?? 'WAITING',
      summary: dynamic
        ? `${dynamic.evaluationItemCount}/${dynamic.criterionCount} criteria`
        : 'No dynamic candidate has been committed',
      evidenceRef: dynamic?.actionAttemptId ?? 'NO_DYNAMIC_ATTEMPT',
    },
    {
      id: 'review-and-synthesize',
      label: 'Review, compare evidence, and synthesize overall candidate',
      status: overall?.status ?? 'WAITING',
      summary: overall
        ? `${overall.findingCount} findings · ` +
          `${effectiveReviewedCount(engineerReviewContext)} reviewed criteria`
        : 'No overall candidate has been committed',
      evidenceRef: overall?.actionAttemptId ?? 'NO_OVERALL_ATTEMPT',
    },
  ];
}

function node(input: CanonicalLibraryIndexNode): CanonicalLibraryIndexNode {
  return input;
}

function addRelation(
  relations: CanonicalRelatedDocumentRelation[],
  nodeIds: Set<string>,
  relation: CanonicalRelatedDocumentRelation,
): void {
  if (!nodeIds.has(relation.fromNodeId) || !nodeIds.has(relation.toNodeId)) {
    return;
  }
  relations.push(relation);
}

function pushEvent(
  events: CanonicalTimelineEvent[],
  input: Omit<CanonicalTimelineEvent, 'id' | 'sequence'>,
): void {
  const sequence: number = events.length + 1;
  events.push({
    id: `timeline-${String(sequence).padStart(2, '0')}`,
    sequence,
    ...input,
  });
}

function rootLabel(workItem: CanonicalWorkItemProjection): string {
  return `${workItem.classification.normalizedFamily} · ${documentLabel(
    workItem,
  )}`;
}

function documentLabel(workItem: CanonicalWorkItemProjection): string {
  return (
    workItem.package?.documentIdentity?.documentCode ??
    workItem.package?.title ??
    workItem.source.documentId
  );
}

function sourceBoundState(results: UnifiedReaderQueryResult[]): string {
  if (results.length === 0) return 'NO_RESULTS';
  return results.every((result: UnifiedReaderQueryResult): boolean =>
    result.sourceRefIds.length > 0,
  )
    ? 'SOURCE_BOUND'
    : 'SOURCE_REF_MISSING';
}

function uniqueSourceRefCount(results: UnifiedReaderQueryResult[]): number {
  const refs: Set<string> = new Set<string>();
  results.forEach((result: UnifiedReaderQueryResult): void => {
    result.sourceRefIds.forEach((sourceRefId: string): void => {
      refs.add(sourceRefId);
    });
  });
  return refs.size;
}

function effectiveReviewedCount(
  context: CanonicalEngineerReviewPageContext | null,
): number {
  return (
    context?.items.filter(
      (item): boolean => item.latestReview !== null,
    ).length ?? 0
  );
}

function latestReviewTimestamp(
  context: CanonicalEngineerReviewPageContext,
): string | null {
  let latest: string | null = null;
  context.items.forEach((item): void => {
    const recordedAt: string | null = item.latestReview?.recordedAt ?? null;
    if (recordedAt === null) return;
    if (latest === null || recordedAt > latest) {
      latest = recordedAt;
    }
  });
  return latest;
}
