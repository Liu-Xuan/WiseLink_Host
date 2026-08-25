import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Fingerprint,
  LocateFixed,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import type {
  CanonicalEngineerReviewDecision,
  CanonicalDocumentParsingPageResponse,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@client/src/components/ui/native-select';
import { Textarea } from '@client/src/components/ui/textarea';
import { rememberRecentWorkItem } from '@client/src/utils/recent-work-items';
import { forgetRecentWorkItem } from '@client/src/utils/recent-work-items';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';

import { type WorkbenchNode } from './WorkItemContextTree';
import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import { AeoAuthoringWorkspace } from './AeoAuthoringWorkspace';
import { AssessmentSemanticsOverview } from './AssessmentSemanticsOverview';
import { DocumentReaderWorkspace } from './DocumentReaderWorkspace';
import PdfSourcePane from './PdfSourcePane';
import ReviewImpactPreview from '@client/src/features/review/ReviewImpactPreview';
import RevisionTimeline from '@client/src/features/review/RevisionTimeline';
import TaskPills from '@client/src/features/review/TaskPills';
import WorkbenchShell from '@client/src/features/workbench/WorkbenchShell';
import OverallAssessmentHero from '@client/src/features/workitem/OverallAssessmentHero';
import AuthorityStrip from '@client/src/features/workitem/AuthorityStrip';
import {
  staleReasonLabel,
  toWorkItemView,
} from '@client/src/services/viewModelMappers';
import EvidencePanel from '@client/src/features/workbench/EvidencePanel';
import NavigatorTree from '@client/src/features/navigation/NavigatorTree';
import type {
  NavigationNodeView,
  NavigatorMode,
} from '@client/src/features/navigation/treeMappers';
import {
  buildAssessmentBusinessContent,
  getReaderViewMode,
  type ReaderViewMode,
} from './workbench-projection';
import { humanState } from '@client/src/features/navigation/treeMappers';
import { runCanonicalDocumentParsingLoad } from './document-parsing-load';
import './document-parsing.css';
import './pdf-source-pane.css';
import '@client/src/features/workbench/workbench-shell.css';
import '@client/src/features/review/review-loop.css';
import '@client/src/features/workbench/evidence-panel.css';

function short(value: string, front = 18, back = 10): string {
  return value.length <= front + back + 1
    ? value
    : `${value.slice(0, front)}…${value.slice(-back)}`;
}

const DEFAULT_READER_QUERY = 'applicability';

const REVIEW_DECISION_LABELS: Record<CanonicalEngineerReviewDecision, string> =
  {
    confirmed_pass: '确认通过',
    confirmed_fail: '确认不通过',
    returned_for_rework: '退回补充',
    deferred: '暂缓判断',
  };

const NODE_TARGETS: Record<WorkbenchNode, string> = {
  document: 'workspace-document',
  package: 'workspace-package',
  reader: 'workspace-reader',
  assessment: 'workspace-assessment',
  review: 'workspace-review',
  overall: 'workspace-reasoning',
  aeo: 'workspace-aeo',
};

const NODE_TABS: Record<WorkbenchNode, string> = {
  document: 'source',
  package: 'source',
  reader: 'reader',
  assessment: 'assessment',
  review: 'review',
  overall: 'overall',
  aeo: 'aeo',
};

/** Spec R01 §4.2：顶部工作台标签默认顺序固定为
 *  综合评估、解析结果、PDF 原文、分析过程、复核意见；
 *  AEO 候选作为后续扩展入口追加在末尾（需先确认整体综合）。 */
const WORKBENCH_TABS: Array<{
  key: WorkbenchNode;
  label: string;
  mobileLabel?: string;
}> = [
  { key: 'assessment', label: '综合评估', mobileLabel: '概述' },
  { key: 'package', label: '解析结果' },
  { key: 'reader', label: 'PDF 原文', mobileLabel: '原文' },
  { key: 'overall', label: '分析过程', mobileLabel: '活动' },
  { key: 'review', label: '复核意见', mobileLabel: '评估' },
  { key: 'aeo', label: 'AEO 候选' },
];

function getWorkbenchNode(value: string | null): WorkbenchNode {
  if (
    value === 'document' ||
    value === 'package' ||
    value === 'reader' ||
    value === 'assessment' ||
    value === 'review' ||
    value === 'overall' ||
    value === 'aeo'
  ) {
    return value;
  }
  /* §4.1/§4.2：选择文档或事项后默认先显示综合评估意见 */
  return 'assessment';
}

export default function DocumentParsingPage() {
  const currentUser = useCurrentUserProfile();
  const actorSignal: string = String(currentUser.user_id ?? '').trim();
  const actorSignalRef = useRef<string>(actorSignal);
  actorSignalRef.current = actorSignal;
  const loadEpochRef = useRef<number>(0);
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeNode: WorkbenchNode = getWorkbenchNode(searchParams.get('node'));
  const activeQuery: string =
    searchParams.get('q')?.trim() || DEFAULT_READER_QUERY;
  const readerMode: ReaderViewMode = getReaderViewMode(
    searchParams.get('readerMode'),
  );
  const [query, setQuery] = useState<string>(activeQuery);
  const [pageData, setPageData] =
    useState<CanonicalDocumentParsingPageResponse | null>(null);
  const [pageActorSignal, setPageActorSignal] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentAction, setAssessmentAction] = useState<
    'CONFIRM_OVERALL_FOR_AEO' | 'GENERATE_AEO_CANDIDATE' | null
  >(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] =
    useState<CanonicalEngineerReviewDecision>('deferred');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  /** 保存前影响预览开关（§4.3 先显示影响预览，再写入） */
  const [reviewPreviewOpen, setReviewPreviewOpen] = useState(false);
  /** 版本冲突反馈（§4.3 冲突不自动覆盖，提供刷新） */
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [treeMode, setTreeMode] = useState<NavigatorMode>('document');
  const [treeSelection, setTreeSelection] = useState<string | undefined>(
    undefined,
  );
  /** 点击主内容中的来源引用时递增，驱动右侧证据栏自动展开（§4.2） */
  const [evidenceSignal, setEvidenceSignal] = useState(0);

  function updateDeepLink(
    changes: Record<string, string | null>,
    replace = false,
  ): void {
    const next: URLSearchParams = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]: [string, string | null]) => {
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    });
    setSearchParams(next, { replace });
  }

  async function load(nextQuery: string): Promise<void> {
    const epoch: number = loadEpochRef.current + 1;
    loadEpochRef.current = epoch;
    const startedActorSignal: string = actorSignal;
    if (!workItemId) {
      setError('WORKITEM_ID_REQUIRED');
      setLoading(false);
      return;
    }
    setLoading(true);
    setPageData(null);
    setPageActorSignal(null);
    setError(null);
    const isCurrent = (): boolean =>
      loadEpochRef.current === epoch &&
      actorSignalRef.current === startedActorSignal;
    await runCanonicalDocumentParsingLoad({
      isCurrent,
      readIdentity: canonicalHost.getCanonicalHostIdentityContext,
      readPage: () =>
        canonicalHost.getDocumentParsingPage(workItemId, nextQuery),
      onFresh: (identity, fresh) => {
        setPageData(fresh);
        setPageActorSignal(startedActorSignal);
        rememberRecentWorkItem(identity, {
          workItemId: fresh.workItem.workItemId,
          family: fresh.workItem.classification.normalizedFamily,
          documentLabel:
            fresh.workItem.package?.documentIdentity?.documentCode ??
            fresh.workItem.package?.title ??
            fresh.workItem.source.documentId,
          documentVersionId: fresh.workItem.source.documentVersionId,
        });
      },
      onDenied: (identity, cause) => {
        setPageData(null);
        setPageActorSignal(null);
        if (canonicalHost.isCanonicalObjectNotFound(cause)) {
          forgetRecentWorkItem(identity, workItemId);
        }
        setError(cause instanceof Error ? cause.message : 'FRESH_READ_FAILED');
      },
      onIdentityError: (cause) => {
        setPageData(null);
        setPageActorSignal(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'CANONICAL_HOST_IDENTITY_REQUIRED',
        );
      },
      onSettled: () => setLoading(false),
    });
  }

  useEffect(() => {
    setQuery(activeQuery);
    void load(activeQuery);
    return () => {
      loadEpochRef.current += 1;
    };
  }, [workItemId, activeQuery, actorSignal]);

  const data: CanonicalDocumentParsingPageResponse | null =
    pageActorSignal === actorSignal ? pageData : null;

  useEffect(() => {
    if (loading || data === null) return;
    const targetId: string =
      activeNode === 'aeo' && !data.workItem.aeo
        ? 'workspace-assessment'
        : NODE_TARGETS[activeNode];
    const target: HTMLElement | null = document.getElementById(targetId);
    if (!target) return;
    window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [activeNode, data, loading]);

  if (loading) {
    return (
      <LockedState
        title="正在读取当前工程事项…"
        detail="FRESH_READ"
        role="status"
        ariaLive="polite"
      />
    );
  }
  if (error || data === null) {
    return (
      <LockedState
        title="暂时无法打开当前工程事项"
        detail={error ?? 'CANONICAL_HOST_UNCONFIGURED'}
        role="alert"
      />
    );
  }

  const pkg = data.workItem.package;
  const usagePolicy = pkg?.usagePolicy;
  const referenceOnly = usagePolicy?.presentationMode === 'REFERENCE_ONLY';
  const assessment = data.workItem.assessment ?? null;
  const integratedAssessment = data.workItem.integratedAssessment ?? null;
  const assessmentEligible =
    data.workItem.classification.status === 'CONFIRMED' &&
    data.workItem.classification.normalizedFamily === 'SB';
  const aeo = data.workItem.aeo ?? null;
  const results = data.readerProjection?.units ?? [];
  const requestedReaderUnit: string = searchParams.get('unit')?.trim() ?? '';
  const requestedSourceRef: string =
    searchParams.get('sourceRef')?.trim() ?? '';
  const selectedReaderResult = results.find(
    (result) =>
      (requestedReaderUnit === '' || result.unitId === requestedReaderUnit) &&
      (requestedSourceRef === '' ||
        result.sourceRefIds.includes(requestedSourceRef)),
  );
  const reviewContext = data.engineerReviewContext ?? null;
  const requestedReviewCriterion: string =
    searchParams.get('criterion')?.trim() ?? '';
  const selectedReviewCriterion = reviewContext?.items.some(
    (item) => item.criterionId === requestedReviewCriterion,
  )
    ? requestedReviewCriterion
    : reviewContext?.items[0]?.criterionId || '';
  const { overall: overallCandidate, selectedReviewItem } =
    buildAssessmentBusinessContent(
      integratedAssessment,
      reviewContext,
      selectedReviewCriterion,
    );
  const fileLabel: string = `${data.workItem.classification.normalizedFamily} · ${short(data.workItem.source.sourceArtifactId, 20, 8)}`;
  /* §4.1 综合评估六要素视图：当前判断/适用范围/关键依据/未决问题/风险与影响/复核建议 */
  const workItemView = toWorkItemView(data);

  function submitReaderQuery(): void {
    const nextQuery: string = query.trim() || DEFAULT_READER_QUERY;
    updateDeepLink({
      q: nextQuery,
      node: 'reader',
      tab: 'reader',
      unit: null,
      sourceRef: null,
      readerMode: 'structured',
    });
    if (nextQuery === activeQuery) {
      void load(nextQuery);
    }
  }

  async function confirmOverallForAeo(): Promise<void> {
    setAssessmentAction('CONFIRM_OVERALL_FOR_AEO');
    setAssessmentError(null);
    try {
      await canonicalHost.confirmIntegratedOverallForAeo(workItemId);
      await load(activeQuery);
    } catch (cause) {
      setAssessmentError(
        cause instanceof Error ? cause.message : 'INTEGRATED_ASSESSMENT_FAILED',
      );
    } finally {
      setAssessmentAction(null);
    }
  }

  async function generateAeoCandidate(): Promise<void> {
    setAssessmentAction('GENERATE_AEO_CANDIDATE');
    setAssessmentError(null);
    try {
      await canonicalHost.generateAeoCandidate(workItemId);
      await load(activeQuery);
    } catch (cause) {
      setAssessmentError(
        cause instanceof Error ? cause.message : 'AEO_CANDIDATE_FAILED',
      );
    } finally {
      setAssessmentAction(null);
    }
  }

  async function recordEngineerReview(): Promise<void> {
    if (!selectedReviewCriterion || !reviewComment.trim()) {
      setAssessmentError('ENGINEER_REVIEW_CRITERION_AND_COMMENT_REQUIRED');
      return;
    }
    setReviewSubmitting(true);
    setAssessmentError(null);
    setConflictMessage(null);
    try {
      await canonicalHost.recordEngineerReview(workItemId, {
        expectedRevision: data.workItem.revision,
        criterionId: selectedReviewCriterion,
        decision: reviewDecision,
        comment: reviewComment.trim(),
      });
      setReviewComment('');
      setReviewPreviewOpen(false);
      await load(activeQuery);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'ENGINEER_REVIEW_FAILED';
      if (/revision|conflict|409|version/i.test(message)) {
        setConflictMessage(message);
      } else {
        setAssessmentError(message);
      }
    } finally {
      setReviewSubmitting(false);
    }
  }

  function handleTabChange(key: string): void {
    const node = getWorkbenchNode(key);
    updateDeepLink({ node, tab: NODE_TABS[node] });
  }

  function handleNavigatorSelect(node: NavigationNodeView): void {
    setTreeSelection(node.id);
    const target = getWorkbenchNode(node.targetNode ?? null);
    updateDeepLink({ node: target, tab: NODE_TABS[target] });
  }

  function locateSourceRef(unitId: string | null, sourceRef: string): void {
    setEvidenceSignal((v) => v + 1);
    updateDeepLink({
      node: 'reader',
      tab: 'reader',
      unit: unitId,
      sourceRef,
      readerMode: 'structured',
    });
  }

  return (
    <main className="parse-shell parse-shell--workbench wl-workbench-enter">
      <WorkbenchShell
        navigator={
          <NavigatorTree
            nodes={data.libraryIndex.nodes}
            mode={treeMode}
            onModeChange={setTreeMode}
            selectedId={treeSelection}
            onSelect={handleNavigatorSelect}
            searchPlaceholder="搜索当前资料的文件、解析与判断"
          />
        }
        evidencePanel={
          <EvidencePanel
            data={data}
            activeSourceRef={requestedSourceRef}
            activeReaderUnit={requestedReaderUnit}
            onLocate={locateSourceRef}
            onClear={() => updateDeepLink({ unit: null, sourceRef: null })}
          />
        }
        evidenceSignal={evidenceSignal}
        tabs={WORKBENCH_TABS}
        activeTab={activeNode}
        onTabChange={handleTabChange}
      >
        {activeNode === 'document' ? (
          <header className="parse-masthead">
            <div>
              <p className="parse-eyebrow">
                WISELINK 3.1 · WORKITEM / 文档与解析
              </p>
              <h1>一份文档，一条可追溯的解析链。</h1>
              <p className="parse-lede">
                当前页面读取同一工程事项的最新结果；不会用示例数据替代真实内容，也不会自行形成工程结论。
              </p>
            </div>
            <div className="parse-state-seal">
              <CheckCircle2 aria-hidden="true" />
              <span>{data.status}</span>
              <strong>{data.workItem.phase}</strong>
            </div>
          </header>
        ) : null}
        {/* §7 AuthorityStrip：候选/有效性/文件版本状态，全工作台固定可见 */}
        <AuthorityStrip view={workItemView} />
        {integratedAssessment ? (
          <details
            className={`parse-overall-bar${
              /* §06 需更新传播：进入需重综合态时琥珀色光线传播一次 */
              overallCandidate?.status === 'STALE' ||
              integratedAssessment.overallSynthesis?.staleReason
                ? ' wl-stale-flash is-stale'
                : ''
            }`}
            open={searchParams.get('obar') === '1'}
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                updateDeepLink({
                  obar: searchParams.get('obar') === '1' ? null : '1',
                });
              }}
            >
              <Sparkles aria-hidden="true" />
              <span>综合评估摘要</span>
              <strong>
                {humanState(
                  overallCandidate?.applicabilityStatus ??
                    overallCandidate?.status ??
                    integratedAssessment.overallSynthesis?.status,
                ) ?? '等待综合意见'}
                {overallCandidate?.status === 'STALE' ||
                integratedAssessment.overallSynthesis?.staleReason
                  ? ' · 需更新'
                  : ''}
              </strong>
              <small title={overallCandidate?.overallCandidate ?? ''}>
                {overallCandidate?.overallCandidate ??
                  '综合意见尚未形成；完成必要评估后会在这里显示'}
              </small>
              <ChevronDown aria-hidden="true" />
            </summary>
            {overallCandidate?.findings?.length ? (
              <ul className="parse-overall-bar-findings">
                {overallCandidate.findings.map((finding, index) => (
                  <li key={`${finding.finding}-${index}`}>
                    <strong>{finding.finding}</strong>
                    <span>{finding.basis}</span>
                    {finding.sourceRefIds.length ? (
                      <button
                        type="button"
                        onClick={() =>
                          locateSourceRef(null, finding.sourceRefIds[0])
                        }
                      >
                        <LocateFixed aria-hidden="true" />
                        {finding.sourceRefIds.length} 条依据
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="parse-overall-bar-empty">
                综合意见尚未形成。完成必要评估并补齐信息后，系统会在此显示可复核的候选意见。
              </p>
            )}
          </details>
        ) : null}

        {activeNode === 'document' ? (
          <section className="parse-hero-grid" id="workspace-document">
            <article className="parse-panel parse-document-card">
              <div className="parse-panel-label">
                <FileText /> 原始文档
              </div>
              <h2>{pkg?.title ?? fileLabel}</h2>
              <dl>
                {pkg?.documentIdentity ? (
                  <div>
                    <dt>Document code</dt>
                    <dd>{pkg.documentIdentity.documentCode}</dd>
                  </div>
                ) : null}
                {pkg?.documentIdentity?.businessRevision ? (
                  <div>
                    <dt>Revision</dt>
                    <dd>{pkg.documentIdentity.businessRevision}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>文件版本</dt>
                  <dd>
                    {short(data.workItem.source.documentVersionId, 24, 8)}
                  </dd>
                </div>
                <div>
                  <dt>来源文件</dt>
                  <dd>{short(data.workItem.source.sourceArtifactId, 24, 8)}</dd>
                </div>
                <div>
                  <dt>字节</dt>
                  <dd>
                    {data.workItem.source.sourceByteLength.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{short(data.workItem.source.sourceFileSha256)}</dd>
                </div>
              </dl>
            </article>

            <article className="parse-panel parse-metric-card">
              <div className="parse-panel-label">
                <Waypoints /> 分类与路由
              </div>
              <div className="parse-family">{data.entry.normalizedFamily}</div>
              <p>{data.workItem.classification.parserProfileId}</p>
              <span className="parse-tag">
                {data.workItem.classification.status}
              </span>
              <span className="parse-tag">
                {pkg?.contractRevision ?? 'NO PACKAGE'}
              </span>
              {referenceOnly ? (
                <span className="parse-tag parse-reference-tag">
                  REFERENCE ONLY
                </span>
              ) : null}
            </article>

            <article className="parse-panel parse-metric-card parse-accent">
              <div className="parse-panel-label">
                <ShieldCheck /> 来源覆盖
              </div>
              <div className="parse-metric-row">
                <strong>{pkg?.contentUnitCount ?? 0}</strong>
                <span>内容单元</span>
              </div>
              <div className="parse-metric-row">
                <strong>{pkg?.sourceRefCount ?? 0}</strong>
                <span>来源引用</span>
              </div>
              <p>
                结果状态：
                {usagePolicy?.qualityStatus ??
                  pkg?.resultStatus.toUpperCase() ??
                  data.workItem.phase}
              </p>
            </article>
          </section>
        ) : null}

        {activeNode === 'package' ? (
          <article
            className="parse-panel parse-package-card"
            id="workspace-package"
          >
            <div className="parse-panel-label">
              <Fingerprint /> Unified Parsed Package
            </div>
            <h3>{short(pkg?.packageId ?? 'NO_PACKAGE_RECORDED', 36, 14)}</h3>
            {pkg ? (
              <div className="parse-hash-stack">
                <p>
                  <span>content</span>
                  {short(pkg.contentHash)}
                </p>
                <p>
                  <span>semantic</span>
                  {short(pkg.semanticHash)}
                </p>
                <p>
                  <span>provenance</span>
                  {short(pkg.provenanceHash)}
                </p>
                <p>
                  <span>coverage</span>
                  {short(pkg.coverageHash)}
                </p>
              </div>
            ) : (
              <p className="parse-empty">
                {data.workItem.failure?.failureCode ??
                  data.workItem.recordingFailure?.failureCode ??
                  'PACKAGE_NOT_READY'}
              </p>
            )}
            <div className="parse-candidate-warning">
              <AlertTriangle /> 当前结果是 DEV 候选解析包；未切
              production/current， 不生成适用性或工程结论。
            </div>
            {referenceOnly && usagePolicy ? (
              <div className="parse-reference-boundary">
                <strong>REFERENCE ONLY · {usagePolicy.qualityStatus}</strong>
                <p>
                  Applicability：
                  {usagePolicy.applicability.sourceExpressionCount} source
                  expression /{' '}
                  {usagePolicy.applicability.normalizedCandidateCount} candidate
                  / {usagePolicy.applicability.assignmentCount} assignment
                </p>
                <small>Assessment 自动采纳：禁止 · AEO 自动采纳：禁止</small>
              </div>
            ) : null}
          </article>
        ) : null}

        {activeNode === 'reader' ? (
          <div className="parse-reader-split">
            <DocumentReaderWorkspace
              data={data}
              query={query}
              requestedSourceRef={requestedSourceRef}
              selectedReaderResult={selectedReaderResult}
              readerMode={readerMode}
              onQueryChange={setQuery}
              onQuerySubmit={submitReaderQuery}
              onReaderModeChange={(mode: ReaderViewMode) =>
                updateDeepLink({
                  node: 'reader',
                  tab: 'reader',
                  readerMode: mode,
                })
              }
              onSourceRefSelect={(unitId: string, sourceRef: string) =>
                updateDeepLink({
                  node: 'reader',
                  tab: 'reader',
                  unit: unitId,
                  sourceRef,
                  readerMode: 'structured',
                })
              }
              onClearSourceRef={() =>
                updateDeepLink({ unit: null, sourceRef: null })
              }
            />
            <PdfSourcePane
              data={data}
              requestedSourceRef={requestedSourceRef}
              onLocate={locateSourceRef}
            />
          </div>
        ) : null}

        {activeNode === 'assessment' ? (
          assessmentEligible ? (
            <section
              className="parse-assessment-panel parse-assessment-workspace"
              id="workspace-assessment"
              aria-label="工程评估工作台"
            >
              <div className="parse-panel-label">
                <ClipboardCheck /> 工程评估工作台 · OpenClaw 动态 N + 整体综合
                · 判断、依据与复核
              </div>
              <OverallAssessmentHero
                view={workItemView}
                onOpenWorkbench={() =>
                  updateDeepLink({ node: 'review', tab: 'review' })
                }
                onViewEvidence={() =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                    unit: null,
                    sourceRef: null,
                  })
                }
              />
              <AssessmentSemanticsOverview data={data} />
              {integratedAssessment ? (
                <>
                  {overallCandidate &&
                  (overallCandidate.overallCandidate ||
                    overallCandidate.findings?.length ||
                    overallCandidate.missingInputs?.length) ? (
                    <section
                      className="parse-business-candidate"
                      aria-label="整体业务候选"
                    >
                      <header>
                        <div>
                          <span>AI 初步综合意见 · 待工程师确认</span>
                          <h3>判断、依据与待补信息</h3>
                        </div>
                        <strong>
                          {humanState(
                            overallCandidate.applicabilityStatus ??
                              overallCandidate.status,
                          ) ?? '候选意见'}
                          {overallCandidate.status === 'STALE'
                            ? ' · 需更新'
                            : ''}
                        </strong>
                      </header>
                      {overallCandidate.overallCandidate ? (
                        <p>{overallCandidate.overallCandidate}</p>
                      ) : null}
                      {overallCandidate.findings?.length ? (
                        <div className="parse-business-findings">
                          {overallCandidate.findings.map((finding, index) => (
                            <article key={`${finding.finding}-${index}`}>
                              <h4>{finding.finding}</h4>
                              <dl>
                                <div>
                                  <dt>依据</dt>
                                  <dd>{finding.basis}</dd>
                                </div>
                                <div>
                                  <dt>假设</dt>
                                  <dd>
                                    {finding.assumptions.join('；') ||
                                      '无额外假设'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>不确定性</dt>
                                  <dd>{finding.uncertainty}</dd>
                                </div>
                              </dl>
                              {finding.sourceRefIds.length ? (
                                <div className="parse-finding-sources">
                                  <span>来源定位</span>
                                  {finding.sourceRefIds.map((sourceRef) => (
                                    <button
                                      type="button"
                                      key={sourceRef}
                                      onClick={() =>
                                        updateDeepLink({
                                          node: 'reader',
                                          tab: 'reader',
                                          readerMode: 'structured',
                                          unit: null,
                                          sourceRef,
                                        })
                                      }
                                    >
                                      {sourceRef}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : null}
                      {overallCandidate.missingInputs?.length ? (
                        <div className="parse-business-next">
                          <strong>会改变结论的缺口 / 建议补证</strong>
                          <ul>
                            {overallCandidate.missingInputs.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                          <small>
                            系统只会针对明确缺口查询已授权资料；未读取、未采纳的资料不会被当作依据。
                          </small>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  <div className="parse-assessment-grid">
                    <div>
                      <strong>
                        {integratedAssessment.baseRules.criterionCount}
                      </strong>
                      <span>逐项评估 · 数量由当前评估规则决定</span>
                    </div>
                    <div>
                      <strong>
                        {humanState(integratedAssessment.baseRules.status) ??
                          '待评估'}
                      </strong>
                      <span>
                        {integratedAssessment.baseRules.unresolvedCount}{' '}
                        项未闭合 · 评估版本 r
                        {integratedAssessment.baseRules.revision}
                      </span>
                    </div>
                    <div>
                      <strong>
                        {humanState(
                          integratedAssessment.overallSynthesis?.status,
                        ) ?? '等待综合意见'}
                      </strong>
                      <span>
                        {integratedAssessment.overallSynthesis
                          ? `${integratedAssessment.overallSynthesis.findingCount} 项判断 · ${integratedAssessment.overallSynthesis.candidateRefCount} 条依据 · 版本 r${integratedAssessment.overallSynthesis.revision}`
                          : '完成逐项评估后形成综合意见'}
                      </span>
                    </div>
                  </div>
                  {integratedAssessment.overallSynthesis ? (
                    <p>
                      资料调查：
                      {humanState(
                        integratedAssessment.overallSynthesis.discoveryStatus,
                      ) ?? '状态待确认'}
                      。仅已读取并采纳的资料可作为本次判断依据。
                    </p>
                  ) : (
                    <p>
                      综合意见尚未形成。完成逐项评估与必要补充后，系统会在此显示可解释、可追溯的候选意见。
                    </p>
                  )}
                  <details className="parse-assessment-audit-details">
                    <summary>查看评估过程与版本详情</summary>
                    <div
                      className="parse-assessment-audit"
                      aria-label="评估过程与版本详情"
                    >
                      <article>
                        <span>动态评估 · 逐项判断</span>
                        <h3>逐项规则候选</h3>
                        <dl>
                          <div>
                            <dt>规则集</dt>
                            <dd>
                              {integratedAssessment.baseRules.criterionSetId}
                            </dd>
                          </div>
                          <div>
                            <dt>完整度</dt>
                            <dd>
                              {
                                integratedAssessment.baseRules
                                  .evaluationItemCount
                              }
                              /{integratedAssessment.baseRules.criterionCount}
                            </dd>
                          </div>
                          <div>
                            <dt>来源绑定候选</dt>
                            <dd>
                              {
                                integratedAssessment.baseRules
                                  .sourceBoundCandidateCount
                              }
                            </dd>
                          </div>
                          <div>
                            <dt>未闭合</dt>
                            <dd>
                              {integratedAssessment.baseRules.unresolvedCount}
                            </dd>
                          </div>
                          <div>
                            <dt>执行记录</dt>
                            <dd>
                              {short(
                                integratedAssessment.baseRules.actionAttemptId,
                                24,
                                8,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>实际字节证据</dt>
                            <dd
                              title={
                                integratedAssessment.baseRules.artifact.ref
                              }
                            >
                              {short(
                                integratedAssessment.baseRules.artifact.sha256,
                                22,
                                10,
                              )}{' '}
                              ·{' '}
                              {integratedAssessment.baseRules.artifact.byteLength.toLocaleString()}{' '}
                              bytes
                            </dd>
                          </div>
                        </dl>
                        <small
                          title={integratedAssessment.baseRules.sourceResultId}
                        >
                          source result ·{' '}
                          {short(
                            integratedAssessment.baseRules.sourceResultId,
                            28,
                            10,
                          )}
                        </small>
                      </article>

                      <article>
                        <span>综合评估意见 · 待工程师确认</span>
                        <h3>证据比较与整体候选</h3>
                        {integratedAssessment.overallSynthesis ? (
                          <>
                            <dl>
                              <div>
                                <dt>基于动态结果</dt>
                                <dd>
                                  revision{' '}
                                  {
                                    integratedAssessment.overallSynthesis
                                      .basedOnBaseRuleRevision
                                  }
                                </dd>
                              </div>
                              <div>
                                <dt>findings / refs</dt>
                                <dd>
                                  {
                                    integratedAssessment.overallSynthesis
                                      .findingCount
                                  }{' '}
                                  /{' '}
                                  {
                                    integratedAssessment.overallSynthesis
                                      .candidateRefCount
                                  }
                                </dd>
                              </div>
                              <div>
                                <dt>未闭合</dt>
                                <dd>
                                  {
                                    integratedAssessment.overallSynthesis
                                      .unresolvedCount
                                  }
                                </dd>
                              </div>
                              <div>
                                <dt>缺口</dt>
                                <dd>
                                  {integratedAssessment.overallSynthesis.gap ??
                                    'NONE'}
                                </dd>
                              </div>
                              <div>
                                <dt>调查边界</dt>
                                <dd>
                                  {
                                    integratedAssessment.overallSynthesis
                                      .discoveryStatus
                                  }{' '}
                                  · discovery is evidence={' '}
                                  {String(
                                    integratedAssessment.overallSynthesis
                                      .externalDiscoveryIsEvidence,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>实际字节证据</dt>
                                <dd
                                  title={
                                    integratedAssessment.overallSynthesis
                                      .artifact.ref
                                  }
                                >
                                  {short(
                                    integratedAssessment.overallSynthesis
                                      .artifact.sha256,
                                    22,
                                    10,
                                  )}{' '}
                                  ·{' '}
                                  {integratedAssessment.overallSynthesis.artifact.byteLength.toLocaleString()}{' '}
                                  bytes
                                </dd>
                              </div>
                            </dl>
                            <small
                              title={
                                integratedAssessment.overallSynthesis
                                  .actionAttemptId
                              }
                            >
                              分析任务 ·{' '}
                              {short(
                                integratedAssessment.overallSynthesis
                                  .actionAttemptId,
                                28,
                                10,
                              )}{' '}
                              · stale={' '}
                              {integratedAssessment.overallSynthesis
                                .staleReason ?? 'NONE'}
                            </small>
                          </>
                        ) : (
                          <p>
                            尚无整体候选。分析任务需要先读取完整逐项评估输入，
                            再根据明确缺口选择相关资料来源；页面不会自行补造调查结果。
                          </p>
                        )}
                      </article>
                    </div>
                  </details>
                  {integratedAssessment.overallSynthesis?.status ===
                    'CANDIDATE_ONLY' &&
                  integratedAssessment.overallSynthesis.staleReason === null ? (
                    integratedAssessment.overallForAeoConfirmation ? (
                      <div className="parse-aeo-ready-action">
                        <p>
                          已由工程师显式确认用于 AEO 候选输入 ·{' '}
                          {
                            integratedAssessment.overallForAeoConfirmation
                              .confirmedAt
                          }{' '}
                          · 事项版本{' '}
                          {
                            integratedAssessment.overallForAeoConfirmation
                              .workItemRevision
                          }
                          。该确认不等于工程批准或发布。
                        </p>
                        {!aeo ? (
                          <Button
                            type="button"
                            disabled={assessmentAction !== null}
                            onClick={() => void generateAeoCandidate()}
                          >
                            {assessmentAction === 'GENERATE_AEO_CANDIDATE'
                              ? '正在生成 AEO 候选…'
                              : '生成AEO候选'}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        disabled={assessmentAction !== null}
                        onClick={() => void confirmOverallForAeo()}
                      >
                        {assessmentAction === 'CONFIRM_OVERALL_FOR_AEO'
                          ? '正在确认当前整体综合…'
                          : '确认当前整体综合用于 AEO 候选'}
                      </Button>
                    )
                  ) : null}
                </>
              ) : (
                <div className="parse-assessment-empty">
                  <p>
                    WAITING_OPENCLAW_DYNAMIC_EVALUATION：逐项评估尚未形成。
                    完成当前规则要求的评估后，这里会显示真实结果；页面不会用固定数量或示例数据代替。
                  </p>
                </div>
              )}
              {assessment ? (
                <details
                  className="parse-historical-assessment"
                  open={searchParams.get('drawer') === 'history'}
                >
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      updateDeepLink({
                        drawer:
                          searchParams.get('drawer') === 'history'
                            ? null
                            : 'history',
                      });
                    }}
                  >
                    查看历史逐项评估（只读）
                  </summary>
                  <p>
                    {assessment.status} · {assessment.criterionCount} 项 ·{' '}
                    {assessment.applicabilityOverall} · stale=
                    {assessment.staleReason ?? 'NONE'}
                  </p>
                </details>
              ) : null}
              {assessmentError ? (
                <p className="parse-assessment-error" role="alert">
                  {assessmentError}
                </p>
              ) : null}
            </section>
          ) : (
            <section
              className="parse-assessment-panel parse-assessment-workspace"
              id="workspace-assessment"
              aria-label="工程评估工作台"
            >
              <div className="parse-panel-label">
                <ClipboardCheck /> 工程评估工作台 · 判断、依据与复核
              </div>
              <OverallAssessmentHero
                view={workItemView}
                primaryActionLabel="核对原文依据"
                onOpenWorkbench={() =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                  })
                }
                onViewEvidence={() =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                    unit: null,
                    sourceRef: null,
                  })
                }
              />
              <AssessmentSemanticsOverview data={data} />
              <article className="parse-assessment-scope-note">
                <AlertTriangle aria-hidden="true" />
                <div>
                  <span>逐项规则评估</span>
                  <h3>当前文件不进入 SB 逐项规则评估</h3>
                  <p>
                    当前文件类别为{' '}
                    {data.workItem.classification.normalizedFamily}
                    {data.workItem.classification.status === 'CONFIRMED'
                      ? '，分类已经确认。'
                      : '，分类尚待确认。'}
                    你仍可核对综合候选意见、原文依据与分析过程；系统不会套用不适配的规则生成数字或结论。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    updateDeepLink({
                      node: 'reader',
                      tab: 'reader',
                      readerMode: 'structured',
                    })
                  }
                >
                  查看原文与依据
                </Button>
              </article>
            </section>
          )
        ) : null}

        {/* ── §4.2 复核意见：CriterionSet 逐项投影 + 工程师逐项复核 ── */}
        {activeNode === 'review' ? (
          reviewContext ? (
            <>
              <section
                className="parse-criterion-list"
                id="workspace-review"
                aria-label="当前 CriterionSet 逐项投影"
              >
                <header>
                  <div>
                    <span>CRITERION SET · FRESH PROJECTION</span>
                    <h3>{reviewContext.criterionSetId}</h3>
                  </div>
                  <strong>{reviewContext.items.length} 项</strong>
                </header>
                <div className="parse-criterion-grid">
                  {reviewContext.items.map((item) => {
                    const selected =
                      item.criterionId === selectedReviewCriterion;
                    const reviewState =
                      item.latestReview?.status ?? 'NEEDS_REVIEW';
                    return (
                      <button
                        type="button"
                        className={`parse-criterion-card${selected ? ' is-selected' : ''}`}
                        key={item.criterionId}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() =>
                          updateDeepLink({
                            criterion: item.criterionId,
                            node: 'review',
                            tab: 'review',
                          })
                        }
                      >
                        <span className="parse-criterion-card-id">
                          {item.criterionId}
                        </span>
                        <strong>{item.dynamicResult}</strong>
                        <p>{item.candidateConclusion}</p>
                        <small>
                          {item.humanReviewRequired
                            ? '需人工复核'
                            : '当前无人工复核标记'}{' '}
                          · {reviewState}
                        </small>
                      </button>
                    );
                  })}
                </div>
                {selectedReviewItem ? (
                  <article className="parse-criterion-detail">
                    <header>
                      <div>
                        <span>当前初步判断</span>
                        <h4>{selectedReviewItem.criterionId}</h4>
                      </div>
                      <strong>{selectedReviewItem.candidateConclusion}</strong>
                    </header>
                    <dl>
                      <div>
                        <dt>已知事实</dt>
                        <dd>
                          {selectedReviewItem.factsConsidered?.join('；') ||
                            '当前尚无可引用的受控事实'}
                        </dd>
                      </div>
                      <div>
                        <dt>规则如何作用</dt>
                        <dd>
                          {selectedReviewItem.ruleApplication ||
                            '尚未形成可解释的规则应用'}
                        </dd>
                      </div>
                      <div>
                        <dt>分析与影响</dt>
                        <dd>
                          {selectedReviewItem.analysisSummary ||
                            '尚未形成可解释的业务分析'}
                        </dd>
                      </div>
                      <div>
                        <dt>仍缺什么</dt>
                        <dd>
                          {selectedReviewItem.missingInputs?.join('；') ||
                            '当前没有明确缺口'}
                        </dd>
                      </div>
                    </dl>
                    {selectedReviewItem.sourceRefs?.length ? (
                      <div className="parse-criterion-sources">
                        <span>来源定位</span>
                        {selectedReviewItem.sourceRefs.map((sourceRef) => (
                          <button
                            type="button"
                            key={sourceRef}
                            onClick={() =>
                              updateDeepLink({
                                node: 'reader',
                                tab: 'reader',
                                readerMode: 'structured',
                                unit: null,
                                sourceRef,
                              })
                            }
                          >
                            {sourceRef}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ) : null}
              </section>
              <section
                className="parse-engineer-review"
                aria-label="工程师逐项复核"
              >
                <header>
                  <div>
                    <span>工程师复核 · 仅追加记录</span>
                    <h3>记录逐项意见</h3>
                  </div>
                  <strong>
                    {reviewContext.ledger?.reviewCount ?? 0} 条历史意见
                  </strong>
                </header>
                <p>
                  保存只记录人的判断，不运行模型；保存只记录工程师判断，不会直接改写逐项评估结果。
                  保存后当前整体候选会标记为需更新，再由分析任务明确重新综合。
                </p>
                <p className="parse-review-mobile-hint" role="note">
                  复杂批量复核建议使用桌面端全屏工作台。
                </p>
                <div className="parse-engineer-review-form">
                  <label>
                    规则项
                    <NativeSelect
                      value={selectedReviewCriterion}
                      onChange={(event) =>
                        updateDeepLink({
                          criterion: event.target.value,
                          node: 'review',
                          tab: 'review',
                        })
                      }
                    >
                      {reviewContext.items.map((item) => (
                        <NativeSelectOption
                          key={item.criterionId}
                          value={item.criterionId}
                        >
                          {item.criterionId} · {item.dynamicResult}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label>
                    处理意见
                    <NativeSelect
                      value={reviewDecision}
                      onChange={(event) =>
                        setReviewDecision(
                          event.target.value as CanonicalEngineerReviewDecision,
                        )
                      }
                    >
                      <NativeSelectOption value="confirmed_pass">
                        确认通过
                      </NativeSelectOption>
                      <NativeSelectOption value="confirmed_fail">
                        确认不通过
                      </NativeSelectOption>
                      <NativeSelectOption value="returned_for_rework">
                        退回补充
                      </NativeSelectOption>
                      <NativeSelectOption value="deferred">
                        暂缓判断
                      </NativeSelectOption>
                    </NativeSelect>
                  </label>
                  <label className="parse-engineer-review-comment">
                    说明
                    <Textarea
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      placeholder="说明依据、异议或仍需补齐的输入"
                      maxLength={4000}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={reviewSubmitting}
                    onClick={() => {
                      if (!selectedReviewCriterion || !reviewComment.trim()) {
                        setAssessmentError(
                          'ENGINEER_REVIEW_CRITERION_AND_COMMENT_REQUIRED',
                        );
                        return;
                      }
                      setAssessmentError(null);
                      setReviewPreviewOpen(true);
                    }}
                  >
                    {reviewSubmitting
                      ? '正在保存…'
                      : '预览影响并保存工程师意见'}
                  </Button>
                </div>
                {reviewContext.items
                  .filter((item) => item.latestReview)
                  .map((item) => (
                    <p key={item.criterionId} className="parse-review-latest">
                      <strong>{item.criterionId}</strong> ·{' '}
                      {item.latestReview!.decision} ·{' '}
                      {item.latestReview!.comment}
                    </p>
                  ))}
              </section>
            </>
          ) : (
            <div className="parse-assessment-empty" id="workspace-review">
              <p>当前事项尚无复核上下文（需 SB 族群且分类已确认）。</p>
            </div>
          )
        ) : null}

        {activeNode === 'overall' ? (
          <>
            <EngineeringReasoningTrail data={data} />
            <RevisionTimeline timeline={data.timeline} />
          </>
        ) : null}

        {activeNode === 'aeo' ? (
          aeo ? (
            <AeoAuthoringWorkspace
              workItemId={workItemId}
              workItemRevision={data.workItem.revision}
              aeo={aeo}
              integratedAssessment={integratedAssessment}
            />
          ) : (
            <div className="parse-assessment-empty">
              <p>当前事项尚无 AEO 候选；需先在动态评估中确认整体综合。</p>
            </div>
          )
        ) : null}

        {/* ── §4.3 版本冲突：不覆盖新结果，提供刷新 ── */}
        {conflictMessage ? (
          <div
            className="wl-conflict-banner"
            role="alert"
            aria-label="版本冲突"
          >
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>版本冲突：写入未生效</strong>
              <p>
                当前事项已经产生更新版本，本次意见未写入，也不会覆盖新结果。请刷新后基于最新内容重新复核。
              </p>
              <div className="wl-conflict-actions">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setConflictMessage(null);
                    void load(activeQuery);
                  }}
                >
                  刷新最新结果
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── §4.3 任务胶囊：后台任务只暴露任务/结果/失败原因，不伪造进度 ── */}
        <div className="parse-task-strip" aria-label="分析任务状态">
          <span className="parse-task-strip-label">分析进度</span>
          <TaskPills timeline={data.timeline} />
        </div>

        {/* ── §4.3 STALE / 需更新反馈：旧综合意见在工程师复核后标记需重综合 ── */}
        {integratedAssessment?.overallSynthesis?.staleReason ? (
          <div
            className="wl-stale-banner"
            role="status"
            aria-label="整体综合需更新"
          >
            <RefreshCw aria-hidden="true" />
            <div>
              <strong>整体综合意见需更新</strong>
              <p>
                工程师复核或新依据已经改变评估基础
                {staleReasonLabel(
                  integratedAssessment.overallSynthesis.staleReason as
                    | 'BASE_RULE_RESULT_CHANGED'
                    | 'ENGINEER_REVIEW_CHANGED',
                )
                  ? `（${staleReasonLabel(
                      integratedAssessment.overallSynthesis.staleReason as
                        | 'BASE_RULE_RESULT_CHANGED'
                        | 'ENGINEER_REVIEW_CHANGED',
                    )}）`
                  : ''}
                。当前候选意见不会被页面直接改写；重新分析完成后请刷新最新结果。
              </p>
              <div className="wl-stale-actions">
                <Button
                  type="button"
                  size="sm"
                  disabled={loading}
                  onClick={() => void load(activeQuery)}
                >
                  {loading ? '正在刷新…' : '刷新最新结果'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── §4.3 复核闭环：写入前影响预览对话框 ── */}
        <ReviewImpactPreview
          open={reviewPreviewOpen}
          criterionId={selectedReviewCriterion ?? ''}
          criterionConclusion={
            selectedReviewItem?.candidateConclusion ??
            reviewContext?.items.find(
              (item) => item.criterionId === selectedReviewCriterion,
            )?.candidateConclusion ??
            '—'
          }
          decision={REVIEW_DECISION_LABELS[reviewDecision]}
          comment={reviewComment.trim()}
          expectedRevision={data.workItem.revision}
          overallStatus={
            overallCandidate?.status ??
            integratedAssessment?.overallSynthesis?.status ??
            null
          }
          submitting={reviewSubmitting}
          onCancel={() => setReviewPreviewOpen(false)}
          onConfirm={() => void recordEngineerReview()}
        />

        <footer className="parse-footer">
          <span>当前工程事项 · 候选意见需工程师确认</span>
          <a href={data.entry.deepLinkPath}>
            继续与 WiseLink 讨论 <ArrowUpRight />
          </a>
        </footer>
      </WorkbenchShell>
    </main>
  );
}

function LockedState(props: {
  title: string;
  detail: string;
  role?: 'status' | 'alert';
  ariaLive?: 'polite' | 'assertive';
}) {
  return (
    <main
      className="parse-shell parse-locked-shell"
      role={props.role}
      aria-live={props.ariaLive}
      aria-busy={props.role === 'status'}
    >
      <section className="parse-panel parse-locked-card">
        <LockKeyhole aria-hidden="true" />
        <p className="parse-eyebrow">工程评估工作台</p>
        <h1>{props.title}</h1>
        <p className="parse-locked-guidance">
          {props.role === 'status'
            ? '正在获取当前文件、评估与依据，请稍候。'
            : '请确认事项链接和访问权限后重试。当前页面不会用历史或示例结果代替。'}
        </p>
        <details className="parse-locked-diagnostics">
          <summary>查看诊断信息</summary>
          <code>{props.detail}</code>
        </details>
      </section>
    </main>
  );
}
