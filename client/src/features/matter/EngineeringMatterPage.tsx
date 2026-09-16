import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { getEngineeringMatterWorkingRevision } from '@client/src/api/engineering-matter';

import AssessmentReadingBrief from './AssessmentReadingBrief';
import ClaimEvidenceDialog from './ClaimEvidenceDialog';
import MatterMembers from './MatterMembers';
import MatterMaterials from './MatterMaterials';
import MatterWorkingDetails from './MatterWorkingDetails';
import MatterProblemWork from './MatterProblemWork';
import OverviewSourceWork from './OverviewSourceWork';
import EngineeringIssueSearch from './EngineeringIssueSearch';
import MatterDocumentSourceDialog from './MatterDocumentSourceDialog';
import {
  readSavedAssessmentClaim,
  type AssessmentClaimSelection,
  type DocumentAssessmentEvidence,
} from './assessment-reading';
import {
  buildMatterObjectContext,
  matterDocumentRoute,
} from './matter-navigation';
import { readReadingLocation, clearReadingLocation, matterReadingScope, type ReadingLocation } from './reading-location';
import { matterReadingReturnParams } from './reading-return';
import useEngineeringMatter from './useEngineeringMatter';
import useReadingLocation from './useReadingLocation';
import { selectMatterWorkRevision } from './matter-work-selection';

import '@client/src/features/workitem/workitem-overview.css';
import './matter-wiki.css';

export default function EngineeringMatterPage() {
  const { matterId = '' } = useParams<{ matterId: string }>();
  const [params] = useSearchParams();
  const workRef = params.get('workRef')?.trim() ?? '';
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  return (
    <MatterWorkspace
      key={JSON.stringify([sessionGeneration, matterId, workRef])}
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
  const requestedWorkRef: string = searchParams.get('workRef')?.trim() ?? '';
  const scopeKey: string = matterReadingScope(matterId, requestedWorkRef);
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
  const [requestedRevision, setRequestedRevision] =
    useState<EngineeringMatterWorkingRevisionReadModel | null>(null);
  const [requestedRevisionLoading, setRequestedRevisionLoading] =
    useState<boolean>(false);
  const [requestedRevisionError, setRequestedRevisionError] =
    useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const currentRevision: EngineeringMatterWorkingRevisionReadModel | null =
    data?.working.current ?? null;
  const displayedRevision: EngineeringMatterWorkingRevisionReadModel | null =
    selectMatterWorkRevision(
      requestedWorkRef,
      currentRevision,
      requestedRevision,
    );
  const result: AssessmentReadingResult | null =
    displayedRevision?.state.substantiveResult ?? null;
  const discussionClaim: AssessmentReadingClaim | undefined =
    result?.content.claims.find(
      (claim: AssessmentReadingClaim) => claim.claimId === discussionClaimId,
    );
  const panel: 'brief' | 'review' | 'materials' =
    requestedWorkRef
      ? 'brief'
      : searchParams.get('panel') === 'review'
        ? 'review'
        : searchParams.get('panel') === 'materials'
          ? 'materials'
          : 'brief';
  const saveLocation = useReadingLocation(
    scopeKey,
    sessionGeneration,
    Boolean(data && displayedRevision),
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
      !requestedWorkRef && data
        ? buildMatterObjectContext(data.matter, data.working)
        : null,
    );
  }, [data, publishCurrentObject, requestedWorkRef]);

  useEffect(() => {
    setRequestedRevision(null);
    setRequestedRevisionError(null);
    if (
      !requestedWorkRef ||
      !matterId ||
      authenticationRequired ||
      currentRevision?.matterWorkRevisionId === requestedWorkRef
    ) {
      setRequestedRevisionLoading(false);
      return;
    }
    const controller = new AbortController();
    setRequestedRevisionLoading(true);
    void getEngineeringMatterWorkingRevision(
      matterId,
      requestedWorkRef,
      controller.signal,
    )
      .then((revision) => {
        if (!controller.signal.aborted) setRequestedRevision(revision);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause && typeof cause === 'object' && 'statusCode' in cause && [401, 403, 404].includes(Number(cause.statusCode))) {
          clearReadingLocation(scopeKey);
          setClaimSelection(null); setFocusClaimId(null); setDiscussionClaimId(null);
        }
        setRequestedRevisionError(
          cause instanceof Error ? cause.message : '指定工作修订读取失败。',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRequestedRevisionLoading(false);
      });
    return () => controller.abort();
  }, [
    authenticationRequired,
    currentRevision?.matterWorkRevisionId,
    matterId,
    requestedWorkRef,
    scopeKey,
  ]);

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
    > & { sourceRefId?: string; locator?: string },
  ): void {
    const workRef = displayedRevision?.matterWorkRevisionId ?? requestedWorkRef;
    saveLocation(matterReadingScope(matterId, workRef));
    if (!evidence.workItemId) setClaimSelection(null);
    navigate(matterDocumentRoute(matterId, evidence, panel, workRef));
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
    <main className="wl-overview-page matter-wiki-page" aria-label="工程事项阅读与讨论">
      <header className="matter-wiki-head flex flex-wrap items-center justify-between gap-4">
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
      {requestedWorkRef ? (
        <p
          role={requestedRevisionError ? 'alert' : 'status'}
          className="wl-projection-refresh"
        >
          {requestedRevisionLoading
            ? '正在读取指定的已保存工作…'
            : requestedRevisionError
              ? requestedRevisionError
              : displayedRevision
                ? `正在阅读已保存工作修订 ${displayedRevision.workingRevision}；这是指定版本，不会替换为最新工作。`
                : '尚未取得指定工作修订。'}
        </p>
      ) : null}
      <nav className="matter-wiki-tabs flex flex-wrap gap-2" aria-label="事项阅读层次">
        {!requestedWorkRef ? <Button asChild variant="outline"><Link to={`/matters/${encodeURIComponent(matterId)}/posture`}>工程态势</Link></Button> : null}
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
          disabled={Boolean(requestedWorkRef)}
          onClick={() => setPanel('review')}
        >
          继续核对与讨论
        </Button>
        <Button
          variant={panel === 'materials' ? 'default' : 'outline'}
          aria-pressed={panel === 'materials'}
          disabled={Boolean(requestedWorkRef)}
          onClick={() => setPanel('materials')}
        >
          关联资料
        </Button>
        {requestedWorkRef ? (
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              params.delete('workRef');
              params.delete('panel');
              setSearchParams(params);
            }}
          >
            返回当前工作
          </Button>
        ) : null}
      </nav>
      <RetainedWorkbenchPanel active={panel === 'brief'}>
        <div className="matter-wiki-layout">
          <article className="wl-overall-hero wl-glass-content matter-wiki-article">
            {requestedWorkRef && !displayedRevision ? (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">指定工作尚未读回</h2>
                <p className="text-sm leading-7">
                  页面不会用当前工作替代所请求的历史版本。
                </p>
              </div>
            ) : result ? (
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
            {displayedRevision && result && !displayedRevision.state.problemWork ? <OverviewSourceWork matterId={matterId} source={displayedRevision.overviewSourceWork} /> : null}
            <MatterProblemWork
              revision={displayedRevision}
              onLocateDocument={openDocument}
            />
          </article>
          <aside className="wl-side-panel matter-wiki-inspector">
            {requestedWorkRef ? (
              <section className="space-y-3 text-sm leading-7">
                <h2 className="text-base font-semibold">指定工作版本</h2>
                {displayedRevision ? (
                  <>
                    <p>工作修订 {displayedRevision.workingRevision}</p>
                    <p>{displayedRevision.changeSummary}</p>
                    <p className="text-muted-foreground">
                      基于事项修订 {displayedRevision.basedOnMatterRevisionId}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    尚未读回指定工作，不展示当前工作状态作为替代。
                  </p>
                )}
              </section>
            ) : (
              <MatterWorkingDetails
                working={data.working}
                members={data.matter.catalog.entries}
              />
            )}
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
              discussionMaterial={{
                title: primary.document.documentCode,
                documentVersionId: primary.document.documentVersionId,
                versionLabel: primary.document.businessRevision,
              }}
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
        <EngineeringIssueSearch matterId={matterId} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={loading || Boolean(error)}
            onClick={() => {
              saveLocation();
              navigate(
                `/library?${new URLSearchParams({ mode: 'document', linkMatterId: matterId }).toString()}`,
              );
            }}
          >
            从资料库加入已有材料
          </Button>
          <span className="text-sm text-muted-foreground">
            新关联材料先进入待核查，不会自动替换已有认识。
          </span>
        </div>
        <div className="matter-wiki-layout matter-wiki-materials">
          <div className="wl-overall-hero wl-glass-content matter-wiki-article">
            <MatterMaterials
              materials={data.matter.materials ?? []}
              matterId={matterId}
              revision={data.matter.currentRevision.revisionNo}
              disabled={loading || authenticationRequired}
              onSaved={refresh}
            />
            <MatterMembers
              members={data.matter.catalog.entries}
              onOpenMember={(member: EngineeringMatterCatalogEntry) => {
                const workRef = displayedRevision?.matterWorkRevisionId ?? requestedWorkRef;
                saveLocation(matterReadingScope(matterId, workRef));
                const params = matterReadingReturnParams(matterId, member.document.documentVersionId, panel, workRef);
                navigate(`/document-versions/${encodeURIComponent(member.document.documentVersionId)}?${params}`);
              }}
            />
          </div>
          <aside className="wl-side-panel matter-wiki-inspector">
            <MatterWorkingDetails
              working={data.working}
              members={data.matter.catalog.entries}
            />
          </aside>
        </div>
      </RetainedWorkbenchPanel>
      {searchParams.get('sourceDocument') ? (
        <MatterDocumentSourceDialog
          key={`${sessionGeneration}:${searchParams.get('sourceDocument')}:${searchParams.get('sourceRef')}`}
          documentVersionId={searchParams.get('sourceDocument')!}
          sourceRef={searchParams.get('sourceRef')}
          onClose={() => {
            const params = new URLSearchParams(searchParams);
            params.delete('sourceDocument');
            params.delete('sourceRef');
            setSearchParams(params);
          }}
        />
      ) : null}
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
