import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Fingerprint,
  LocateFixed,
  LockKeyhole,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import type {
  CanonicalEngineerReviewDecision,
  CanonicalDocumentParsingPageResponse,
  CanonicalStructuredContentSourceLocator,
  ConfirmReviewActionDraftResponse,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@client/src/components/ui/native-select';
import { Textarea } from '@client/src/components/ui/textarea';
import { rememberRecentWorkItem } from '@client/src/utils/recent-work-items';
import { forgetRecentWorkItem } from '@client/src/utils/recent-work-items';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';

import {
  getWorkbenchNode,
  structuredSourceDeepLink,
  type WorkbenchNode,
  WORKBENCH_TAB_DEFINITIONS,
} from './document-parsing-navigation';
import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import { AeoAuthoringWorkspace } from './AeoAuthoringWorkspace';
import ApplicabilitySelectionPanel from './ApplicabilitySelectionPanel';
import AssessmentRuleWorkspace from './AssessmentRuleWorkspace';
import { assessmentRuleName } from './assessment-rule-presentation';
import { AssessmentSemanticsOverview } from './AssessmentSemanticsOverview';
import { DocumentReaderWorkspace } from './DocumentReaderWorkspace';
import PdfSourcePane from './PdfSourcePane';
import { StructuredContentBrowser } from './StructuredContentBrowser';
import { parsePdfTargetPage } from './pdf-viewer-state';
import ReviewImpactPreview from '@client/src/features/review/ReviewImpactPreview';
import ContinuousReviewPanel from '@client/src/features/review/ContinuousReviewPanel';
import RevisionTimeline from '@client/src/features/review/RevisionTimeline';
import TaskPills from '@client/src/features/review/TaskPills';
import WorkbenchShell from '@client/src/features/workbench/WorkbenchShell';
import type { QuickOpenItem } from '@client/src/features/workbench/QuickOpen';
import OverallAssessmentHero from '@client/src/features/workitem/OverallAssessmentHero';
import { useOverallRegeneration } from '@client/src/features/workitem/useOverallRegeneration';
import AuthorityStrip from '@client/src/features/workitem/AuthorityStrip';
import {
  staleReasonLabel,
  toWorkItemView,
} from '@client/src/services/viewModelMappers';
import EvidencePanel from '@client/src/features/workbench/EvidencePanel';
import { summarizeWorkbenchEvidence } from '@client/src/features/workbench/evidence-summary';
import { resolveWorkbenchEvidenceActive } from '@client/src/features/workbench/workbench-layout';
import NavigatorTree from '@client/src/features/navigation/NavigatorTree';
import {
  buildDocumentTree,
  humanState,
  type NavigationNodeView,
  type NavigatorMode,
} from '@client/src/features/navigation/treeMappers';
import {
  buildAssessmentBusinessContent,
  getReaderViewMode,
  type ReaderViewMode,
} from './workbench-projection';
import {
  createCanonicalDocumentParsingProjectionReader,
  resolveCanonicalDocumentParsingRouteHandoff,
  runCanonicalDocumentParsingLoad,
} from './document-parsing-load';
import './document-parsing.css';
import './pdf-source-pane.css';
import '@client/src/features/workbench/workbench-shell.css';
import '@client/src/features/review/review-loop.css';
import '@client/src/features/workbench/evidence-panel.css';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

function actionErrorLabel(reason: unknown): string {
  const message =
    reason instanceof Error ? reason.message : String(reason ?? '');
  if (/CRITERION_AND_COMMENT_REQUIRED/iu.test(message)) {
    return '请选择评估项并填写说明。';
  }
  if (/FORBIDDEN|UNAUTHORIZED|ACCESS_DENIED|401|403/iu.test(message)) {
    return '当前账户没有执行此操作的权限。';
  }
  if (/NOT_FOUND|404/iu.test(message)) {
    return '当前事项或评估内容已不可用，请返回资料库重新进入。';
  }
  if (/REVISION|CONFLICT|STALE|409|VERSION/iu.test(message)) {
    return '当前事项已产生新版本，请刷新后基于最新结果继续。';
  }
  return '操作未完成，请刷新当前事项后重试。';
}

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

/** Spec R01 §4.2：顶部工作台标签顺序为
 *  综合评估、结构化内容、PDF 原文、分析过程、复核意见；
 *  AEO 候选作为后续扩展入口追加在末尾（需先确认整体综合）。 */
const WORKBENCH_TAB_ICONS: Partial<Record<WorkbenchNode, ReactNode>> = {
  assessment: <Sparkles aria-hidden="true" />,
  package: <Waypoints aria-hidden="true" />,
  reader: <FileText aria-hidden="true" />,
  overall: <Activity aria-hidden="true" />,
  review: <ClipboardCheck aria-hidden="true" />,
  aeo: <FileText aria-hidden="true" />,
};

const WORKBENCH_TABS = WORKBENCH_TAB_DEFINITIONS.map((tab) => ({
  ...tab,
  icon: WORKBENCH_TAB_ICONS[tab.key],
}));

const documentParsingProjectionReader =
  createCanonicalDocumentParsingProjectionReader();

function flattenNavigationTree(
  nodes: NavigationNodeView[],
): NavigationNodeView[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenNavigationTree(node.children ?? []),
  ]);
}

export default function DocumentParsingPage() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionGenerationRef = useRef<number>(sessionGeneration);
  sessionGenerationRef.current = sessionGeneration;
  const loadEpochRef = useRef<number>(0);
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeNode: WorkbenchNode = getWorkbenchNode(searchParams.get('node'));
  const activeQuery: string = searchParams.get('q')?.trim() ?? '';
  const routeHandoff = resolveCanonicalDocumentParsingRouteHandoff(
    (location.state as { documentParsingHandoff?: unknown } | null)
      ?.documentParsingHandoff,
    { sessionGeneration, workItemId, query: activeQuery },
  );
  const requestedReaderUnit: string = searchParams.get('unit')?.trim() ?? '';
  const requestedSourceRef: string =
    searchParams.get('sourceRef')?.trim() ?? '';
  const evidenceContextActive: boolean = resolveWorkbenchEvidenceActive(
    activeNode,
    requestedSourceRef,
  );
  const readerMode: ReaderViewMode = getReaderViewMode(
    searchParams.get('readerMode'),
  );
  const [query, setQuery] = useState<string>(activeQuery);
  const [pageData, setPageData] =
    useState<CanonicalDocumentParsingPageResponse | null>(routeHandoff);
  const [pageSessionGeneration, setPageSessionGeneration] = useState<
    number | null
  >(routeHandoff ? sessionGeneration : null);
  const [loading, setLoading] = useState<boolean>(routeHandoff === null);
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
  const [continuousReviewReceipt, setContinuousReviewReceipt] = useState<
    ConfirmReviewActionDraftResponse['reviewAction'] | null
  >(null);
  /** 版本冲突反馈（§4.3 冲突不自动覆盖，提供刷新） */
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [treeMode, setTreeMode] = useState<NavigatorMode>('document');
  const [treeSelection, setTreeSelection] = useState<string | undefined>(
    undefined,
  );
  /** 点击主内容中的来源引用时递增，驱动右侧证据栏自动展开（§4.2） */
  const [evidenceSignal, setEvidenceSignal] = useState(0);
  /** 结构化内容定位只驱动同屏 PDF，不改变右侧证据栏分配。 */
  const [pdfLocateSignal, setPdfLocateSignal] = useState(0);
  const [structuredSourceLocator, setStructuredSourceLocator] =
    useState<CanonicalStructuredContentSourceLocator | null>(null);
  const overallRegeneration = useOverallRegeneration({
    workItemId,
    sessionGeneration,
    onSucceeded: async () => load(activeQuery),
  });

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
    const startedSessionGeneration: number = sessionGeneration;
    if (!workItemId) {
      setError('WORKITEM_ID_REQUIRED');
      setLoading(false);
      return;
    }
    setLoading(true);
    setPageData(null);
    setPageSessionGeneration(null);
    setError(null);
    const isCurrent = (): boolean =>
      loadEpochRef.current === epoch &&
      sessionGenerationRef.current === startedSessionGeneration &&
      canonicalHost.getCanonicalHostClientSessionGeneration() ===
        startedSessionGeneration;
    await runCanonicalDocumentParsingLoad({
      isCurrent,
      readIdentity: canonicalHost.getCanonicalHostIdentityContext,
      readPage: (identity) =>
        documentParsingProjectionReader.read(
          {
            identity,
            sessionGeneration: startedSessionGeneration,
            workItemId,
            query: nextQuery,
          },
          () => canonicalHost.getDocumentParsingPage(workItemId, nextQuery),
        ),
      onFresh: (identity, fresh) => {
        setPageData(fresh);
        setPageSessionGeneration(startedSessionGeneration);
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
        setPageSessionGeneration(null);
        if (canonicalHost.isCanonicalObjectNotFound(cause)) {
          forgetRecentWorkItem(identity, workItemId);
        }
        setError(cause instanceof Error ? cause.message : 'FRESH_READ_FAILED');
      },
      onIdentityError: (cause) => {
        setPageData(null);
        setPageSessionGeneration(null);
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
    if (authenticationRequired) {
      loadEpochRef.current += 1;
      setPageData(null);
      setPageSessionGeneration(null);
      setError('CANONICAL_HOST_IDENTITY_REQUIRED');
      setLoading(false);
      return () => {
        loadEpochRef.current += 1;
      };
    }
    if (routeHandoff) {
      loadEpochRef.current += 1;
      setPageData(routeHandoff);
      setPageSessionGeneration(sessionGeneration);
      setError(null);
      setLoading(false);
      return () => {
        loadEpochRef.current += 1;
      };
    }
    void load(activeQuery);
    return () => {
      loadEpochRef.current += 1;
    };
  }, [
    workItemId,
    activeQuery,
    authenticationRequired,
    sessionGeneration,
    routeHandoff,
  ]);

  useEffect(() => {
    setContinuousReviewReceipt(null);
    setStructuredSourceLocator(null);
  }, [workItemId]);

  const data: CanonicalDocumentParsingPageResponse | null =
    pageSessionGeneration === sessionGeneration ? pageData : null;
  const evidenceSummary = useMemo(
    () =>
      summarizeWorkbenchEvidence(
        data?.readerProjection?.units ?? [],
        evidenceContextActive ? structuredSourceLocator : null,
      ),
    [
      data?.readerProjection?.units,
      evidenceContextActive,
      structuredSourceLocator,
    ],
  );

  useEffect(() => {
    if (loading || data === null) return;
    if (activeNode === 'package' || activeNode === 'reader') return;
    const targetId: string =
      activeNode === 'aeo' && !data.workItem.aeo
        ? 'workspace-assessment'
        : NODE_TARGETS[activeNode];
    const target: HTMLElement | null = document.getElementById(targetId);
    if (!target) return;
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      target.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }, [activeNode, data, loading]);

  if (loading) {
    return (
      <LockedState
        title="正在读取当前工程事项…"
        role="status"
        ariaLive="polite"
      />
    );
  }
  if (error || data === null) {
    return (
      <LockedState
        title="暂时无法打开当前工程事项"
        role="alert"
        onRetry={() => void load(activeQuery)}
        onBack={() => navigate('/library')}
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
  const requestedPdfTargetPage: number | null = parsePdfTargetPage(
    searchParams.get('page'),
  );
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
  const reviewCriterionLabel = (criterionId: string): string => {
    const index =
      reviewContext?.items.findIndex(
        (item) => item.criterionId === criterionId,
      ) ?? -1;
    return index >= 0 && reviewContext
      ? assessmentRuleName(reviewContext.items[index], index)
      : '当前判断规则';
  };
  const { overall: overallCandidate, selectedReviewItem } =
    buildAssessmentBusinessContent(
      integratedAssessment,
      reviewContext,
      selectedReviewCriterion,
    );
  const overallEngineeringSummary =
    overallCandidate?.engineeringSummary ?? null;
  const overallEngineeringStatements = overallEngineeringSummary
    ? [
        ...overallEngineeringSummary.whyItMatters,
        ...overallEngineeringSummary.implementationImpact,
        ...overallEngineeringSummary.dispositionPriority,
        ...overallEngineeringSummary.nextActions,
      ]
    : [];
  const fileLabel: string = `${data.workItem.classification.normalizedFamily} 工程资料`;
  /* §4.1 来源约束的工程摘要：结论/重要性/适用性/实施影响/优先级/下一步。 */
  const workItemView = toWorkItemView(data);

  function submitReaderQuery(): void {
    const nextQuery: string = query.trim();
    if (nextQuery.length < 2) return;
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
      setAssessmentError(actionErrorLabel(cause));
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
      setAssessmentError(actionErrorLabel(cause));
    } finally {
      setAssessmentAction(null);
    }
  }

  async function recordEngineerReview(): Promise<void> {
    if (!selectedReviewCriterion || !reviewComment.trim()) {
      setAssessmentError('请选择评估项并填写说明。');
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
        setAssessmentError(actionErrorLabel(cause));
      }
    } finally {
      setReviewSubmitting(false);
    }
  }

  function handleTabChange(key: string): void {
    const node = getWorkbenchNode(key);
    updateDeepLink({
      node,
      tab: NODE_TABS[node],
      ...(node === 'reader' ? { readerMode: 'source' } : {}),
    });
  }

  function handleNavigatorSelect(node: NavigationNodeView): void {
    setTreeSelection(node.id);
    const target = getWorkbenchNode(node.targetNode ?? null);
    updateDeepLink({ node: target, tab: NODE_TABS[target] });
  }

  function locateSourceRef(
    unitId: string | null,
    sourceRef: string,
    intent: ReaderViewMode = 'source',
  ): void {
    setStructuredSourceLocator(null);
    setEvidenceSignal((v) => v + 1);
    updateDeepLink({
      node: 'reader',
      tab: 'reader',
      unit: unitId,
      sourceRef,
      readerMode: intent,
      page: null,
    });
  }

  function locatePdfQuerySourceRef(unitId: string, sourceRef: string): void {
    locateSourceRef(unitId, sourceRef, 'structured');
  }

  function returnToStructuredReader(): void {
    updateDeepLink({
      node: 'reader',
      tab: 'reader',
      readerMode: 'structured',
    });
  }

  function locateStructuredSourceRef(
    sourceRef: string,
    locator: CanonicalStructuredContentSourceLocator | undefined,
  ): void {
    setStructuredSourceLocator(locator ?? null);
    setPdfLocateSignal((value) => value + 1);
    updateDeepLink(structuredSourceDeepLink(sourceRef, locator?.pageStart));
  }

  const quickOpenItems: QuickOpenItem[] = [
    ...WORKBENCH_TABS.filter((tab) => tab.key !== 'aeo' || Boolean(aeo)).map(
      (tab) => ({
        id: `view:${tab.key}`,
        label: tab.label,
        description: '切换当前工程分析工作台视图',
        keywords: tab.mobileLabel,
        group: '工作台视图',
        icon: tab.icon,
        onSelect: () => handleTabChange(tab.key),
      }),
    ),
    ...flattenNavigationTree(buildDocumentTree(data.libraryIndex.nodes))
      .filter((node) => node.selectable && Boolean(node.targetNode))
      .map((node) => ({
        id: `source:${node.id}`,
        label: node.label,
        description: node.subtitle ?? '当前资料',
        keywords: node.badge,
        group: '当前资料',
        icon: <FileText aria-hidden="true" />,
        onSelect: () => handleNavigatorSelect(node),
      })),
  ];

  return (
    <main className="parse-shell parse-shell--workbench wl-workbench-enter">
      <WorkbenchShell
        contextLabel={`${pkg?.documentIdentity?.documentCode ?? fileLabel} · ${WORKBENCH_TABS.find((tab) => tab.key === activeNode)?.label ?? '综合评估'}`}
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
            activeStructuredLocator={structuredSourceLocator}
            summary={evidenceSummary}
            onLocate={locateSourceRef}
            onClear={() => {
              setStructuredSourceLocator(null);
              updateDeepLink({ unit: null, sourceRef: null, page: null });
            }}
          />
        }
        evidenceContentCount={evidenceSummary.contentCount}
        evidenceActive={evidenceContextActive}
        evidenceSignal={evidenceSignal}
        quickOpenItems={quickOpenItems}
        tabs={WORKBENCH_TABS}
        activeTab={activeNode}
        contentMode={
          activeNode === 'package' || activeNode === 'reader'
            ? 'workspace'
            : 'flow'
        }
        mobileActiveTab={
          activeNode === 'document' || activeNode === 'package'
            ? 'reader'
            : activeNode === 'aeo'
              ? 'review'
              : activeNode
        }
        onTabChange={handleTabChange}
      >
        {activeNode === 'document' ? null : (
          <h1 className="wl-visually-hidden">
            {WORKBENCH_TABS.find((tab) => tab.key === activeNode)?.label ??
              '工程分析工作台'}
          </h1>
        )}
        {activeNode === 'document' ? (
          <header className="parse-masthead">
            <div>
              <p className="parse-eyebrow">当前工程事项 · 文档与解析</p>
              <h1>文档与解析结果</h1>
              <p className="parse-lede">
                当前页面读取同一工程事项的最新结果，并始终把综合意见标记为待复核候选。
              </p>
            </div>
            <div className="parse-state-seal">
              <Shield aria-hidden="true" />
              <span>当前状态</span>
              <strong>
                {humanState(data.workItem.phase) ?? '候选结果待复核'}
              </strong>
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
              <span>工程摘要</span>
              <strong>
                {overallCandidate?.status === 'STALE' ||
                integratedAssessment.overallSynthesis?.staleReason
                  ? '结论需更新'
                  : overallEngineeringSummary
                    ? '已绑定原文依据'
                    : '等待重新生成'}
              </strong>
              <small title={overallEngineeringSummary?.conclusion.text ?? ''}>
                {overallEngineeringSummary?.conclusion.text ??
                  '当前候选缺少逐结论原文绑定，需重新生成工程摘要'}
              </small>
              <ChevronDown aria-hidden="true" />
            </summary>
            {overallEngineeringStatements.length > 0 ? (
              <ul className="parse-overall-bar-findings">
                {overallEngineeringStatements.map((statement, index) => (
                  <li key={`${statement.text}-${index}`}>
                    <strong>{statement.text}</strong>
                    <span>
                      {statement.basis === 'SOURCE_FACT'
                        ? '来源事实'
                        : '条件性推断'}
                    </span>
                    {statement.sourceRefIds.length ? (
                      <button
                        type="button"
                        onClick={() =>
                          locateSourceRef(null, statement.sourceRefIds[0])
                        }
                      >
                        <LocateFixed aria-hidden="true" />
                        {statement.sourceRefIds.length} 条依据
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="parse-overall-bar-empty">
                当前候选没有逐结论绑定当前文件版本的原文依据，不能作为工程摘要展示。
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
                    <dt>文件编号</dt>
                    <dd>{pkg.documentIdentity.documentCode}</dd>
                  </div>
                ) : null}
                {pkg?.documentIdentity?.businessRevision ? (
                  <div>
                    <dt>文件版本</dt>
                    <dd>{pkg.documentIdentity.businessRevision}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>文件大小</dt>
                  <dd>{formatBytes(data.workItem.source.sourceByteLength)}</dd>
                </div>
              </dl>
            </article>

            <article className="parse-panel parse-metric-card">
              <div className="parse-panel-label">
                <Waypoints /> 文件分类
              </div>
              <div className="parse-family">{data.entry.normalizedFamily}</div>
              <span className="parse-tag">
                {data.workItem.classification.status === 'CONFIRMED'
                  ? '分类已确认'
                  : '分类待确认'}
              </span>
              {referenceOnly ? (
                <span className="parse-tag parse-reference-tag">仅供参考</span>
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
                {usagePolicy?.qualityStatus === 'NEEDS_REVIEW'
                  ? '存在质量阻断，需人工处理'
                  : pkg?.resultStatus === 'partial'
                    ? '部分完成，需人工处理'
                    : pkg?.resultStatus === 'complete'
                      ? '解析结果完整'
                      : (humanState(data.workItem.phase) ?? '待确认')}
              </p>
            </article>
          </section>
        ) : null}

        {activeNode === 'package' ? (
          pkg ? (
            <div className="parse-structured-split" id="workspace-package">
              <div className="parse-structured-primary">
                <div
                  className="parse-mobile-source-switch"
                  role="tablist"
                  aria-label="原文视图"
                >
                  <button type="button" role="tab" aria-selected="true">
                    <Waypoints aria-hidden="true" /> 结构化内容
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected="false"
                    onClick={() => handleTabChange('reader')}
                  >
                    <FileText aria-hidden="true" /> PDF 原文
                  </button>
                </div>
                <StructuredContentBrowser
                  workItemId={workItemId}
                  workItemRevision={data.workItem.revision}
                  query={query}
                  requestedSourceRef={requestedSourceRef}
                  onQueryChange={setQuery}
                  onQuerySubmit={submitReaderQuery}
                  onLocateSourceRef={locateStructuredSourceRef}
                  onRefresh={() => void load(activeQuery)}
                />
              </div>
              <div className="parse-structured-pdf" aria-label="PDF 与原文定位">
                <PdfSourcePane
                  data={data}
                  requestedSourceRef={requestedSourceRef}
                  structuredLocator={structuredSourceLocator}
                  explicitTargetPage={requestedPdfTargetPage}
                  locateSignal={pdfLocateSignal}
                  onLocate={locatePdfQuerySourceRef}
                  onReturnStructured={() =>
                    updateDeepLink({ node: 'package', tab: 'package' })
                  }
                />
              </div>
            </div>
          ) : (
            <article
              className="parse-panel parse-package-card"
              id="workspace-package"
            >
              <div className="parse-panel-label">
                <Fingerprint /> 结构化内容
              </div>
              <h3>结构化内容尚未形成</h3>
              <p className="parse-empty">
                {data.workItem.failure || data.workItem.recordingFailure
                  ? '解析未完成，请刷新或联系支持人员。'
                  : '文件正在等待解析。'}
              </p>
            </article>
          )
        ) : null}

        {activeNode === 'reader' ? (
          <div
            className={`parse-reader-split${
              readerMode === 'source' ? ' is-pdf-active' : ''
            }`}
          >
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
              onSourceRefSelect={locateSourceRef}
              onClearSourceRef={() =>
                updateDeepLink({ unit: null, sourceRef: null, page: null })
              }
            />
            <PdfSourcePane
              data={data}
              requestedSourceRef={requestedSourceRef}
              structuredLocator={structuredSourceLocator}
              explicitTargetPage={requestedPdfTargetPage}
              locateSignal={evidenceSignal}
              onLocate={locatePdfQuerySourceRef}
              onReturnStructured={returnToStructuredReader}
            />
          </div>
        ) : null}

        {activeNode === 'assessment' ? (
          <ApplicabilitySelectionPanel
            key={workItemId}
            workItemId={workItemId}
            onOpenInteractiveReview={() =>
              updateDeepLink({ node: 'review', tab: 'review' })
            }
          />
        ) : null}

        {activeNode === 'assessment' ? (
          assessmentEligible ? (
            <section
              className="parse-assessment-panel parse-assessment-workspace"
              id="workspace-assessment-results"
              aria-label="工程评估工作台"
            >
              <div className="parse-panel-label">
                <ClipboardCheck aria-hidden="true" /> 工程评估工作台 ·
                判断、依据与复核
              </div>
              <OverallAssessmentHero
                view={workItemView}
                regeneration={overallRegeneration}
                onOpenWorkbench={() =>
                  updateDeepLink({ node: 'review', tab: 'review' })
                }
                onViewEvidence={(sourceRefId) =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                    unit: null,
                    sourceRef: sourceRefId ?? null,
                  })
                }
              />
              {integratedAssessment ? (
                <>
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
                            <dt>当前状态</dt>
                            <dd>
                              {humanState(
                                integratedAssessment.baseRules.status,
                              ) ?? '待评估'}
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
                        </dl>
                        <small>所有数量均来自当前事项的最新受控投影。</small>
                      </article>

                      <article>
                        <span>综合评估意见 · 待工程师确认</span>
                        <h3>证据比较与整体候选</h3>
                        {integratedAssessment.overallSynthesis ? (
                          <>
                            <dl>
                              <div>
                                <dt>形成依据</dt>
                                <dd>当前逐项评估结果</dd>
                              </div>
                              <div>
                                <dt>判断 / 来源依据</dt>
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
                                  {integratedAssessment.overallSynthesis.gap
                                    ? '仍有待补信息'
                                    : '当前无明确缺口'}
                                </dd>
                              </div>
                              <div>
                                <dt>资料调查</dt>
                                <dd>
                                  {humanState(
                                    integratedAssessment.overallSynthesis
                                      .discoveryStatus,
                                  ) ?? '状态待确认'}
                                  {' · '}
                                  {integratedAssessment.overallSynthesis
                                    .externalDiscoveryIsEvidence
                                    ? '已采纳资料可作为依据'
                                    : '外部资料尚未作为判断依据'}
                                </dd>
                              </div>
                            </dl>
                            <small>
                              {integratedAssessment.overallSynthesis.staleReason
                                ? `当前意见需更新（${staleReasonLabel(
                                    integratedAssessment.overallSynthesis
                                      .staleReason as
                                      | 'BASE_RULE_RESULT_CHANGED'
                                      | 'ENGINEER_REVIEW_CHANGED',
                                  )}）`
                                : '当前意见仍是候选，需工程师确认。'}
                            </small>
                          </>
                        ) : (
                          <p>
                            尚无整体候选。分析任务需要先读取完整逐项评估输入，
                            再根据明确缺口选择相关资料来源。
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
                          工程师确认已记录，可用于形成后续编写候选。该确认不等于工程批准或发布。
                        </p>
                        {!aeo ? (
                          <Button
                            type="button"
                            disabled={assessmentAction !== null}
                            onClick={() => void generateAeoCandidate()}
                          >
                            {assessmentAction === 'GENERATE_AEO_CANDIDATE'
                              ? '正在生成 AEO 候选…'
                              : '生成 AEO 候选'}
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
                    逐项评估尚未形成。完成当前规则要求的评估后，这里会显示最新结果。
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
                    {humanState(assessment.status) ?? '状态待确认'} ·{' '}
                    {assessment.criterionCount} 项 ·{' '}
                    {humanState(assessment.applicabilityOverall) ??
                      '适用性待确认'}{' '}
                    · {assessment.staleReason ? '结论需更新' : '历史候选'}
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
              id="workspace-assessment-results"
              aria-label="工程评估工作台"
            >
              <div className="parse-panel-label">
                <ClipboardCheck aria-hidden="true" /> 工程评估工作台 ·
                判断、依据与复核
              </div>
              <OverallAssessmentHero
                view={workItemView}
                regeneration={overallRegeneration}
                primaryActionLabel="核对原文依据"
                onOpenWorkbench={() =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                  })
                }
                onViewEvidence={(sourceRefId) =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                    unit: null,
                    sourceRef: sourceRefId ?? null,
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
              <AssessmentRuleWorkspace
                key={`${workItemId}:${data.workItem.revision}:${requestedReviewCriterion}`}
                items={reviewContext.items}
                selectedCriterionId={selectedReviewCriterion}
                preferSelectedOnLoad={requestedReviewCriterion !== ''}
                onSelectCriterion={(criterionId: string) =>
                  updateDeepLink({
                    criterion: criterionId,
                    node: 'review',
                    tab: 'review',
                  })
                }
                onLocateSourceRef={(sourceRef: string) =>
                  updateDeepLink({
                    node: 'reader',
                    tab: 'reader',
                    readerMode: 'structured',
                    unit: null,
                    sourceRef,
                  })
                }
              />
              <details
                className="parse-engineer-review"
                aria-label="记录必要的工程师修订"
              >
                <summary className="parse-engineer-review-summary">
                  <div>
                    <span>可选 · 仅在需要修正时使用</span>
                    <strong>记录必要的工程师修订</strong>
                  </div>
                  <small>
                    {reviewContext.ledger?.reviewCount ?? 0} 条历史意见
                  </small>
                </summary>
                <div className="parse-engineer-review-body">
                  <p>
                    保存只记录工程师判断，不运行模型，也不会直接改写逐项评估结果。
                    只有发现判断方向、依据或输入需要修正时才记录，无需逐项确认。
                  </p>
                  <p className="parse-review-mobile-hint" role="note">
                    复杂修订建议使用桌面端全屏工作台。
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
                        {reviewContext.items.map((item, index) => (
                          <NativeSelectOption
                            key={item.criterionId}
                            value={item.criterionId}
                          >
                            {assessmentRuleName(item, index)} ·{' '}
                            {humanState(item.dynamicResult) ?? '状态待确认'}
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
                            event.target
                              .value as CanonicalEngineerReviewDecision,
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
                        onChange={(event) =>
                          setReviewComment(event.target.value)
                        }
                        placeholder="说明依据、异议或仍需补齐的输入"
                        maxLength={4000}
                      />
                    </label>
                    <Button
                      type="button"
                      disabled={reviewSubmitting}
                      onClick={() => {
                        if (!selectedReviewCriterion || !reviewComment.trim()) {
                          setAssessmentError('请选择评估项并填写说明。');
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
                        <strong>
                          {reviewCriterionLabel(item.criterionId)}
                        </strong>{' '}
                        · {REVIEW_DECISION_LABELS[item.latestReview!.decision]}{' '}
                        · {item.latestReview!.comment}
                      </p>
                    ))}
                </div>
              </details>
            </>
          ) : (
            <div className="parse-assessment-empty" id="workspace-review">
              <p>当前资料尚未提供可复核的逐项内容。</p>
            </div>
          )
        ) : null}

        {activeNode === 'review' ? (
          <ContinuousReviewPanel
            key={workItemId}
            workItemId={workItemId}
            workItemRevision={data.workItem.revision}
            confirmationReceipt={continuousReviewReceipt}
            onConfirmationReceipt={setContinuousReviewReceipt}
            onLocateSourceRef={(sourceRef) => locateSourceRef(null, sourceRef)}
            onWorkItemRefresh={() => load(activeQuery)}
          />
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
          criterionLabel={reviewCriterionLabel(selectedReviewCriterion)}
          criterionConclusion={
            selectedReviewItem?.candidateConclusion ??
            reviewContext?.items.find(
              (item) => item.criterionId === selectedReviewCriterion,
            )?.candidateConclusion ??
            '—'
          }
          decision={REVIEW_DECISION_LABELS[reviewDecision]}
          comment={reviewComment.trim()}
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
  role?: 'status' | 'alert';
  ariaLive?: 'polite' | 'assertive';
  onRetry?: () => void;
  onBack?: () => void;
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
            : '请确认工作链接和访问权限后重试。'}
        </p>
        {props.role === 'alert' ? (
          <div className="parse-locked-actions">
            {props.onRetry ? (
              <Button type="button" onClick={props.onRetry}>
                <RefreshCw aria-hidden="true" /> 重试读取
              </Button>
            ) : null}
            {props.onBack ? (
              <Button type="button" variant="outline" onClick={props.onBack}>
                返回资料库
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
