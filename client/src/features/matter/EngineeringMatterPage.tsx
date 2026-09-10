import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';

import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { Button } from '@client/src/components/ui/button';
import ContinuousReviewPanel from '@client/src/features/review/ContinuousReviewPanel';
import type { ReviewSourceBinding } from '@client/src/features/review/review-scope';
import RetainedWorkbenchPanel from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type {
  AssessmentClaimEvidenceReadModel,
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';

import AssessmentReadingBrief from './AssessmentReadingBrief';
import ClaimEvidenceDialog from './ClaimEvidenceDialog';
import MatterMembers from './MatterMembers';
import MatterMaterials from './MatterMaterials';
import MatterWorkingDetails from './MatterWorkingDetails';
import {
  readSavedAssessmentClaim,
  type AssessmentClaimSelection,
  type DocumentAssessmentEvidence,
} from './assessment-reading';
import {
  buildMatterObjectContext,
  matterDocumentRoute,
} from './matter-navigation';
import { readReadingLocation, type ReadingLocation } from './reading-location';
import useEngineeringMatter from './useEngineeringMatter';
import useReadingLocation from './useReadingLocation';

import '@client/src/features/workitem/workitem-overview.css';

export default function EngineeringMatterPage() {
  const { matterId = '' } = useParams<{ matterId: string }>();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  return (
    <MatterWorkspace
      key={`${sessionGeneration}:${matterId}`}
      matterId={matterId}
      sessionGeneration={sessionGeneration}
      authenticationRequired={authenticationRequired}
    />
  );
}

interface MatterWorkspaceProps {
  matterId: string;
  sessionGeneration: number;
  authenticationRequired: boolean;
}

const MatterWorkspace: FC<MatterWorkspaceProps> = ({
  matterId,
  sessionGeneration,
  authenticationRequired,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { publishCurrentObject } = useCurrentObjectContext();
  const { data, loading, error, refresh } = useEngineeringMatter(
    matterId,
    sessionGeneration,
    authenticationRequired,
  );
  const scopeKey: string = `matter:${matterId}`;
  const [initialLocation] = useState<ReadingLocation | null>(() =>
    readReadingLocation(scopeKey),
  );
  const [claimSelection, setClaimSelection] =
    useState<AssessmentClaimSelection | null>(initialLocation?.claim ?? null);
  const [focusClaimId, setFocusClaimId] = useState<string | null>(
    initialLocation?.focusClaimId ?? null,
  );
  const [discussionClaimId, setDiscussionClaimId] = useState<string | null>(
    initialLocation?.discussionClaimId ?? null,
  );
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const result: AssessmentReadingResult | null =
    data?.working.current?.state.substantiveResult ?? null;
  const discussionClaim: AssessmentReadingClaim | undefined =
    result?.content.claims.find(
      (claim: AssessmentReadingClaim) => claim.claimId === discussionClaimId,
    );
  const panel: 'brief' | 'review' | 'materials' =
    searchParams.get('panel') === 'review'
      ? 'review'
      : searchParams.get('panel') === 'materials'
        ? 'materials'
        : 'brief';
  const saveLocation: () => void = useReadingLocation(
    scopeKey,
    sessionGeneration,
    Boolean(data),
    { claim: claimSelection, focusClaimId, discussionClaimId },
  );
  const readClaim = useCallback(
    async (
      selection: AssessmentClaimSelection,
    ): Promise<AssessmentClaimEvidenceReadModel> => {
      if (!result) throw new Error('当前事项没有可展开的已保存结果。');
      return readSavedAssessmentClaim(result, selection);
    },
    [result],
  );

  useEffect(() => {
    publishCurrentObject(
      data ? buildMatterObjectContext(data.matter, data.working) : null,
    );
  }, [data, publishCurrentObject]);

  function setPanel(value: string): void {
    const params: URLSearchParams = new URLSearchParams(searchParams);
    if (value === 'brief') params.delete('panel');
    else params.set('panel', value);
    setSearchParams(params);
  }

  function openDocument(
    evidence: Pick<
      DocumentAssessmentEvidence,
      'workItemId' | 'documentVersionId'
    > & { sourceRefId?: string },
  ): void {
    saveLocation();
    navigate(matterDocumentRoute(matterId, evidence, panel));
  }

  function locateReviewSource(sourceRef: string): void {
    const matches: DocumentAssessmentEvidence[] = (
      result?.evidence ?? []
    ).filter(
      (evidence: AssessmentEvidence): evidence is DocumentAssessmentEvidence =>
        evidence.kind === 'DOCUMENT_PASSAGE' &&
        (evidence.sourceRefId === sourceRef ||
          evidence.evidenceRef === sourceRef),
    );
    if (matches.length !== 1) {
      setNavigationError(
        '该讨论引用尚未读回唯一的文档与版本绑定。请从简报中的具体判断核对依据，不会自动跳到主文档。',
      );
      return;
    }
    setNavigationError(null);
    openDocument(matches[0]);
  }

  if (!data)
    return (
      <main className="wl-overview-page" aria-busy={loading}>
        <div className="wl-overall-hero wl-glass-content space-y-4">
          <h1 className="text-xl font-semibold">
            {loading ? '正在读取事项工作记录…' : '暂时无法打开事项'}
          </h1>
          {error ? <p role="alert">{error}</p> : null}
          {!matterId ? <p role="alert">事项标识缺失，请重新进入。</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => navigate('/library?mode=matter')}
            >
              <ArrowLeft aria-hidden="true" />
              返回工程事项
            </Button>
            {!loading && !authenticationRequired ? (
              <Button onClick={() => void refresh().catch(() => undefined)}>
                重新读取
              </Button>
            ) : null}
          </div>
        </div>
      </main>
    );

  const primaryMembers: EngineeringMatterCatalogEntry[] =
    data.matter.catalog.entries.filter(
      (member: EngineeringMatterCatalogEntry) =>
        member.relationRole === 'PRIMARY',
    );
  const primary: EngineeringMatterCatalogEntry | undefined =
    primaryMembers.length === 1 ? primaryMembers[0] : undefined;
  return (
    <main className="wl-overview-page" aria-label="工程事项阅读与讨论">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            工程事项 ·{' '}
            {data.matter.catalog.entries.length +
              (data.matter.materials?.length ?? 0)}{' '}
            项材料关系
          </p>
          <h1 className="break-words text-2xl font-semibold">
            {data.matter.title}
          </h1>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void refresh().catch(() => undefined)}
        >
          <RefreshCw aria-hidden="true" />
          {loading ? '正在读取…' : '重新读取'}
        </Button>
      </header>
      {loading ? (
        <p className="wl-projection-refresh" role="status">
          正在核对最新工作记录；当前仍显示上次读回的保存版本。
        </p>
      ) : null}
      {error ? (
        <p className="wl-projection-refresh" role="alert">
          {error} 以下保留上次已保存认识，不代表最新状态。
        </p>
      ) : null}
      {navigationError ? (
        <p role="alert" className="wl-projection-refresh">
          {navigationError}
        </p>
      ) : null}
      <nav className="flex flex-wrap gap-2" aria-label="事项阅读层次">
        <Button
          variant={panel === 'brief' ? 'default' : 'outline'}
          aria-pressed={panel === 'brief'}
          onClick={() => setPanel('brief')}
        >
          事项简报
        </Button>
        <Button
          variant={panel === 'review' ? 'default' : 'outline'}
          aria-pressed={panel === 'review'}
          onClick={() => setPanel('review')}
        >
          继续核对与讨论
        </Button>
        <Button
          variant={panel === 'materials' ? 'default' : 'outline'}
          aria-pressed={panel === 'materials'}
          onClick={() => setPanel('materials')}
        >
          关联资料
        </Button>
      </nav>
      <RetainedWorkbenchPanel active={panel === 'brief'}>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="wl-overall-hero wl-glass-content">
            {result ? (
              <AssessmentReadingBrief
                result={result}
                onOpenClaim={(
                  selection: AssessmentClaimSelection,
                  trigger: HTMLButtonElement,
                ) => {
                  triggerRef.current = trigger;
                  setFocusClaimId(selection.claimId);
                  setClaimSelection(selection);
                }}
              />
            ) : (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">尚未形成事项综合认识</h2>
                <p className="text-sm leading-7">
                  成员文档的已有判断仍属于各自任务，不会自动充任本事项的综合结果。可围绕当前问题开始讨论。
                </p>
                <Button onClick={() => setPanel('review')}>
                  开始核对与讨论
                </Button>
              </div>
            )}
          </div>
          <aside className="wl-side-panel">
            <MatterWorkingDetails
              working={data.working}
              members={data.matter.catalog.entries}
            />
          </aside>
        </div>
      </RetainedWorkbenchPanel>
      <RetainedWorkbenchPanel active={panel === 'review'}>
        <div data-matter-review-panel tabIndex={-1}>
          {discussionClaimId && !discussionClaim ? (
            <p role="alert">
              原先选中的判断已不在当前结果中，请重新选择或
              <Button
                variant="ghost"
                onClick={() => setDiscussionClaimId(null)}
              >
                取消本轮引用
              </Button>
              后继续。未发送文字已保留。
            </p>
          ) : null}
          {primary ? (
            <ContinuousReviewPanel
              key={`${sessionGeneration}:matter:${matterId}`}
              workItemId={primary.workItemId}
              workItemRevision={primary.currentWorkItemRevision}
              workItemRefreshing={
                loading ||
                Boolean(error) ||
                Boolean(discussionClaimId && !discussionClaim)
              }
              draftScopeKey={scopeKey}
              reviewScope={{
                kind: 'ENGINEERING_MATTER',
                matterId,
                expectedWorkingRevision: data.working.currentWorkingRevision,
                ...(discussionClaim
                  ? { targetClaimId: discussionClaim.claimId }
                  : {}),
              }}
              discussionClaimText={discussionClaim?.text}
              selectedEvaluationItemId={null}
              confirmationReceipt={null}
              onConfirmationReceipt={() => undefined}
              onLocateSourceRef={locateReviewSource}
              onLocateSourceBinding={(binding: ReviewSourceBinding) =>
                openDocument({
                  workItemId: binding.workItemId,
                  documentVersionId: binding.documentVersionId,
                  sourceRefId: binding.originalSourceRefId,
                })
              }
              onWorkItemRefresh={refresh}
              onWorkingRefresh={refresh}
            />
          ) : (
            <p role="alert">
              Host 未返回唯一的主要来源，暂不能确定讨论入口。请重新读取。
            </p>
          )}
        </div>
      </RetainedWorkbenchPanel>
      <RetainedWorkbenchPanel active={panel === 'materials'}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={loading || Boolean(error)}
            onClick={() => {
              saveLocation();
              navigate(
                `/library?${new URLSearchParams({ mode: 'tasks', linkMatterId: matterId }).toString()}`,
              );
            }}
          >
            从资料库加入已有材料
          </Button>
          <span className="text-sm text-muted-foreground">
            新关联材料先进入待核查，不会自动替换已有认识。
          </span>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="wl-overall-hero wl-glass-content">
            <MatterMaterials materials={data.matter.materials ?? []} />
            <MatterMembers
              members={data.matter.catalog.entries}
              onOpenMember={(member: EngineeringMatterCatalogEntry) =>
                openDocument({
                  workItemId: member.workItemId,
                  documentVersionId: member.document.documentVersionId,
                })
              }
            />
          </div>
          <aside className="wl-side-panel">
            <MatterWorkingDetails
              working={data.working}
              members={data.matter.catalog.entries}
            />
          </aside>
        </div>
      </RetainedWorkbenchPanel>
      <ClaimEvidenceDialog
        selection={claimSelection}
        readClaim={readClaim}
        onClose={() => setClaimSelection(null)}
        returnFocus={triggerRef.current}
        returnFocusClaimId={focusClaimId}
        onLocateDocument={openDocument}
        onDiscuss={(claim: AssessmentClaimEvidenceReadModel) => {
          setDiscussionClaimId(claim.claim.claimId);
          setClaimSelection(null);
          setPanel('review');
        }}
      />
    </main>
  );
};
