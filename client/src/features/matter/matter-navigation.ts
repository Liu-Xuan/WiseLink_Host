import type { CurrentObjectContextView } from '@client/src/app/providers/CurrentObjectContextProvider';
import type { EngineeringMatterReadModel } from '@shared/api.interface';
import type { EngineeringMatterWorkingReadModel } from '@shared/matter-working.interface';

import type { DocumentAssessmentEvidence } from './assessment-reading';
import type { AssessmentSourceWork } from '@shared/assessment-reading.interface';
import { matterReadingReturnParams } from './reading-return';

export function matterReferencedWorkRoute(source: AssessmentSourceWork): string {
  return `${matterOverviewRoute(source.subjectId)}?${new URLSearchParams({ panel: 'materials',
    sourceWorkRef: source.workRef, sourceIssueKey: source.issueKey })}`;
}

export function matterOverviewRoute(matterId: string): string {
  return `/matters/${encodeURIComponent(matterId)}`;
}

export function matterWorkRoute(matterId: string, workRef: string): string {
  return `${matterOverviewRoute(matterId)}?${new URLSearchParams({
    panel: 'brief',
    workRef,
  })}`;
}

export function matterDocumentRoute(
  matterId: string,
  evidence: Pick<
    DocumentAssessmentEvidence,
    'workItemId' | 'documentVersionId'
  > & { sourceRefId?: string; locator?: string },
  returnPanel: 'brief' | 'review' | 'materials' = 'brief',
  returnWorkRef = '',
  directoryContext?: URLSearchParams,
): string {
  const returnParams = matterReadingReturnParams(matterId, evidence.documentVersionId, returnPanel, returnWorkRef, directoryContext);
  const exactRoute = exactDocumentSourceRoute(evidence);
  if (exactRoute) return `${exactRoute}&${returnParams}`;
  if (!evidence.workItemId) {
    const params = new URLSearchParams({ sourceDocument: evidence.documentVersionId });
    if (evidence.sourceRefId) params.set('sourceRef', evidence.sourceRefId);
    if (returnPanel !== 'brief') params.set('panel', returnPanel);
    if (returnWorkRef) params.set('workRef', returnWorkRef);
    const directoryQuery = returnParams.get('returnMatterLibraryQuery');
    if (directoryQuery) {
      params.set('returnLibraryMatterId', matterId);
      params.set('returnLibraryQuery', directoryQuery);
    }
    return `${matterOverviewRoute(matterId)}?${params.toString()}`;
  }
  const params: URLSearchParams = new URLSearchParams({
    panel: 'reader', readerMode: 'structured',
    documentVersionId: evidence.documentVersionId,
  });
  if (evidence.sourceRefId) params.set('sourceRef', evidence.sourceRefId);
  returnParams.forEach((value, key) => params.set(key, value));
  return `/work-items/${encodeURIComponent(evidence.workItemId)}/analysis?${params.toString()}`;
}

export function exactDocumentSourceRoute(
  evidence: { documentVersionId: string; sourceRefId?: string; locator?: string },
): string | null {
  if (evidence.locator && evidence.sourceRefId) {
    let locator: unknown;
    try { locator = JSON.parse(evidence.locator); } catch { /* Legacy page locator. */ }
    if (locator && typeof locator === 'object' && 'parseRunId' in locator &&
      typeof locator.parseRunId === 'string' && locator.parseRunId.trim() &&
      'sourceRefId' in locator && locator.sourceRefId === evidence.sourceRefId) {
      const params = new URLSearchParams();
      params.set('parseRunId', locator.parseRunId);
      params.set('sourceRef', evidence.sourceRefId);
      return `/document-versions/${encodeURIComponent(evidence.documentVersionId)}?${params.toString()}`;
    }
  }
  return null;
}

export function buildMatterObjectContext(
  matter: EngineeringMatterReadModel,
  working: EngineeringMatterWorkingReadModel,
): CurrentObjectContextView {
  const overview: string = matterOverviewRoute(matter.matterId);
  return {
    kind: 'MATTER',
    routeMatterId: matter.matterId,
    routeWorkItemId: '',
    displayCode: matter.title,
    title: working.current?.state.problemWork?.headline ?? working.current?.state.focus.question ?? '持续形成与修正工程认识',
    meta: `${matter.catalog.entries.length + (matter.materials?.length ?? 0)} 项材料关系`,
    statusLabel: working.current
      ? `工作修订 ${working.currentWorkingRevision} · 候选认识`
      : '尚无事项综合认识',
    routes: {
      overview,
      workspace: overview,
      process: `${overview}/process${working.current ? `?${new URLSearchParams({workRef: working.current.matterWorkRevisionId})}` : ''}`,
      jobAid: overview,
      review: `${overview}?panel=review`,
      history: overview,
      family: `${overview}?panel=materials`,
    },
  };
}
