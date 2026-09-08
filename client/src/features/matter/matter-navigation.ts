import type { CurrentObjectContextView } from '@client/src/app/providers/CurrentObjectContextProvider';
import type { EngineeringMatterReadModel } from '@shared/api.interface';
import type { EngineeringMatterWorkingReadModel } from '@shared/matter-working.interface';

import type { DocumentAssessmentEvidence } from './assessment-reading';

export function matterOverviewRoute(matterId: string): string {
  return `/matters/${encodeURIComponent(matterId)}`;
}

export function matterDocumentRoute(
  matterId: string,
  evidence: Pick<
    DocumentAssessmentEvidence,
    'workItemId' | 'documentVersionId'
  > & { sourceRefId?: string },
  returnPanel: 'brief' | 'review' | 'materials' = 'brief',
): string {
  const params: URLSearchParams = new URLSearchParams({
    node: 'reader',
    tab: 'reader',
    readerMode: 'structured',
    documentVersionId: evidence.documentVersionId,
    returnMatterId: matterId,
  });
  if (evidence.sourceRefId) params.set('sourceRef', evidence.sourceRefId);
  if (returnPanel !== 'brief') params.set('returnMatterPanel', returnPanel);
  return `/work-items/${encodeURIComponent(evidence.workItemId)}/documents?${params.toString()}`;
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
    title: working.current?.state.focus.question ?? '持续形成与修正工程认识',
    meta: `${matter.catalog.entries.length} 份关联资料`,
    statusLabel: working.current
      ? `工作修订 ${working.currentWorkingRevision} · 候选认识`
      : '尚无事项综合认识',
    routes: {
      overview,
      workspace: overview,
      process: overview,
      jobAid: overview,
      review: `${overview}?panel=review`,
      history: overview,
      family: `${overview}?panel=materials`,
    },
  };
}
