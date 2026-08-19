import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import type {
  CanonicalEngineerReviewDecision,
  CanonicalDocumentParsingPageResponse,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@client/src/components/ui/native-select';
import { Textarea } from '@client/src/components/ui/textarea';
import { rememberRecentWorkItem } from '@client/src/utils/recent-work-items';

import { WorkItemContextDock } from './WorkItemContextDock';
import {
  WorkItemContextTree,
  type WorkbenchNode,
} from './WorkItemContextTree';
import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import { AeoAuthoringWorkspace } from './AeoAuthoringWorkspace';
import { AssessmentSemanticsOverview } from './AssessmentSemanticsOverview';
import { DocumentReaderWorkspace } from './DocumentReaderWorkspace';
import {
  getReaderViewMode,
  type ReaderViewMode,
} from './workbench-projection';
import './document-parsing.css';

function short(value: string, front = 18, back = 10): string {
  return value.length <= front + back + 1
    ? value
    : `${value.slice(0, front)}…${value.slice(-back)}`;
}

const DEFAULT_READER_QUERY = 'applicability';

const NODE_TARGETS: Record<WorkbenchNode, string> = {
  document: 'workspace-document',
  package: 'workspace-package',
  reader: 'workspace-reader',
  assessment: 'workspace-assessment',
  overall: 'workspace-reasoning',
  aeo: 'workspace-aeo',
};

const NODE_TABS: Record<WorkbenchNode, string> = {
  document: 'source',
  package: 'source',
  reader: 'reader',
  assessment: 'assessment',
  overall: 'overall',
  aeo: 'aeo',
};

function getWorkbenchNode(value: string | null): WorkbenchNode {
  if (
    value === 'package' ||
    value === 'reader' ||
    value === 'assessment' ||
    value === 'overall' ||
    value === 'aeo'
  ) {
    return value;
  }
  return 'document';
}

export default function DocumentParsingPage() {
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeNode: WorkbenchNode = getWorkbenchNode(searchParams.get('node'));
  const activeQuery: string =
    searchParams.get('q')?.trim() || DEFAULT_READER_QUERY;
  const readerMode: ReaderViewMode = getReaderViewMode(
    searchParams.get('readerMode'),
  );
  const [query, setQuery] = useState<string>(activeQuery);
  const [data, setData] = useState<CanonicalDocumentParsingPageResponse | null>(
    null,
  );
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
    if (!workItemId) {
      setError('WORKITEM_ID_REQUIRED');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fresh: CanonicalDocumentParsingPageResponse =
        await canonicalHost.getDocumentParsingPage(workItemId, nextQuery);
      setData(fresh);
      rememberRecentWorkItem({
        workItemId: fresh.workItem.workItemId,
        family: fresh.workItem.classification.normalizedFamily,
        documentLabel:
          fresh.workItem.package?.documentIdentity?.documentCode ??
          fresh.workItem.package?.title ??
          fresh.workItem.source.documentId,
        documentVersionId: fresh.workItem.source.documentVersionId,
      });
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'FRESH_READ_FAILED');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setQuery(activeQuery);
    void load(activeQuery);
  }, [workItemId, activeQuery]);

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
    return <LockedState title="正在读取同一 WorkItem…" detail="FRESH_READ" />;
  }
  if (error || data === null) {
    return (
      <LockedState
        title="文档与解析视图已锁定"
        detail={error ?? 'CANONICAL_HOST_UNCONFIGURED'}
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
  const results: UnifiedReaderQueryResult[] = data.queryResults;
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
  const selectedReviewCriterion =
    reviewContext?.items.some(
      (item) => item.criterionId === requestedReviewCriterion,
    )
      ? requestedReviewCriterion
      : reviewContext?.items[0]?.criterionId || '';
  const fileLabel: string = `${data.workItem.classification.normalizedFamily} · ${short(data.workItem.source.sourceArtifactId, 20, 8)}`;

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
    try {
      await canonicalHost.recordEngineerReview(workItemId, {
        expectedRevision: data.workItem.revision,
        criterionId: selectedReviewCriterion,
        decision: reviewDecision,
        comment: reviewComment.trim(),
      });
      setReviewComment('');
      await load(activeQuery);
    } catch (cause) {
      setAssessmentError(
        cause instanceof Error ? cause.message : 'ENGINEER_REVIEW_FAILED',
      );
    } finally {
      setReviewSubmitting(false);
    }
  }

  return (
    <main className="parse-shell">
      <header className="parse-masthead">
        <div>
          <p className="parse-eyebrow">WISELINK 3.1 · WORKITEM / 文档与解析</p>
          <h1>一份文档，一条可追溯的解析链。</h1>
          <p className="parse-lede">
            当前页面来自服务端同一 WorkItem 的 fresh-read；没有本地
            SAMPLE、没有切换 current，也没有生成工程结论。
          </p>
        </div>
        <div className="parse-state-seal">
          <CheckCircle2 aria-hidden="true" />
          <span>{data.status}</span>
          <strong>{data.workItem.phase}</strong>
        </div>
      </header>

      <section className="parse-rail" aria-label="工作台视图">
        {([
          ['文档', 'document', 'workspace-document'],
          ['解析包', 'package', 'workspace-package'],
          ['Reader', 'reader', 'workspace-reader'],
          ['动态评估', 'assessment', 'workspace-assessment'],
          ['综合记录', 'overall', 'workspace-reasoning'],
          ['AEO 候选', 'aeo', 'workspace-aeo'],
        ] as const).map(
          ([label, node, target]: readonly [
            string,
            WorkbenchNode,
            string,
          ], index: number) => (
            <button
              type="button"
              className={`parse-rail-step${
                activeNode === node ? ' is-active' : ''
              }`}
              key={node}
              aria-current={activeNode === node ? 'page' : undefined}
              onClick={() => {
                updateDeepLink({ node, tab: NODE_TABS[node] });
                const targetId: string =
                  node === 'aeo' && !aeo ? 'workspace-assessment' : target;
                window.requestAnimationFrame(() =>
                  document.getElementById(targetId)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  }),
                );
              }}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
            </button>
          ),
        )}
      </section>

      <div className="workitem-workbench-layout">
        <WorkItemContextTree
          data={data}
          activeNode={activeNode}
          onNodeSelect={(node: WorkbenchNode, target: string) => {
            updateDeepLink({ node, tab: NODE_TABS[node] });
            window.requestAnimationFrame(() =>
              document.getElementById(target)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              }),
            );
          }}
        />
        <div className="workitem-workbench-main">
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
                  <dt>DocumentVersion</dt>
                  <dd>
                    {short(data.workItem.source.documentVersionId, 24, 8)}
                  </dd>
                </div>
                <div>
                  <dt>Source artifact</dt>
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

          <section className="parse-lower-grid">
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
                    {usagePolicy.applicability.normalizedCandidateCount}{' '}
                    candidate / {usagePolicy.applicability.assignmentCount}{' '}
                    assignment
                  </p>
                  <small>Assessment 自动采纳：禁止 · AEO 自动采纳：禁止</small>
                </div>
              ) : null}
            </article>

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
          </section>

          {assessmentEligible ? (
            <section
              className="parse-assessment-panel"
              id="workspace-assessment"
              aria-label="OpenClaw 动态规则与整体候选"
            >
              <div className="parse-panel-label">
                <ClipboardCheck /> OpenClaw 动态 N + 整体综合 · 同一 WorkItem
              </div>
              <AssessmentSemanticsOverview data={data} />
              {integratedAssessment ? (
                <>
                  <div className="parse-assessment-grid">
                    <div>
                      <strong>
                        {integratedAssessment.baseRules.criterionCount}
                      </strong>
                      <span>动态规则项 · N 由当前规则集决定</span>
                    </div>
                    <div>
                      <strong>{integratedAssessment.baseRules.status}</strong>
                      <span>
                        {integratedAssessment.baseRules.unresolvedCount}{' '}
                        项未闭合 · result revision{' '}
                        {integratedAssessment.baseRules.revision}
                      </span>
                    </div>
                    <div>
                      <strong>
                        {integratedAssessment.overallSynthesis?.status ??
                          'WAITING_OVERALL_CANDIDATE'}
                      </strong>
                      <span>
                        {integratedAssessment.overallSynthesis
                          ? `${integratedAssessment.overallSynthesis.findingCount} findings · ${integratedAssessment.overallSynthesis.candidateRefCount} candidate refs · revision ${integratedAssessment.overallSynthesis.revision}`
                          : '等待托管 OpenClaw 在同一受控 attempt 中提交整体候选'}
                      </span>
                    </div>
                  </div>
                  {integratedAssessment.overallSynthesis ? (
                    <p>
                      调查状态：
                      {integratedAssessment.overallSynthesis.discoveryStatus}；
                      gap：{integratedAssessment.overallSynthesis.gap ?? 'NONE'}
                      ；未采纳的外部发现 Evidence=
                      {String(
                        integratedAssessment.overallSynthesis
                          .externalDiscoveryIsEvidence,
                      )}
                      。
                    </p>
                  ) : (
                    <p>
                      页面不直接运行模型。OpenClaw 通过窄域 MCP 申请
                      attempt，Host 校验实际字节后 CAS 写回；Base
                      只维护规则与复核投影。
                    </p>
                  )}
                  <div
                    className="parse-assessment-audit"
                    aria-label="动态规则与整体候选审计信息"
                  >
                    <article>
                      <span>OPENCLAW DYNAMIC EVALUATION</span>
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
                            {integratedAssessment.baseRules.evaluationItemCount}
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
                            title={integratedAssessment.baseRules.artifact.ref}
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
                      <span>OPENCLAW OVERALL CANDIDATE</span>
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
                                  integratedAssessment.overallSynthesis.artifact
                                    .ref
                                }
                              >
                                {short(
                                  integratedAssessment.overallSynthesis.artifact
                                    .sha256,
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
                            attempt ·{' '}
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
                          尚无整体候选。OpenClaw 应先读取完整 N/N
                          实际字节，再按明确缺口选择资料源
                          Skill；页面不会自行补造调查结果。
                        </p>
                      )}
                    </article>
                  </div>
                  {reviewContext ? (
                    <section
                      className="parse-criterion-list"
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
                          const selected = item.criterionId === selectedReviewCriterion;
                          const reviewState = item.latestReview?.status ?? 'NEEDS_REVIEW';
                          return (
                            <button
                              type="button"
                              className={`parse-criterion-card${selected ? ' is-selected' : ''}`}
                              key={item.criterionId}
                              aria-current={selected ? 'true' : undefined}
                              onClick={() =>
                                updateDeepLink({
                                  criterion: item.criterionId,
                                  node: 'assessment',
                                  tab: 'assessment',
                                })
                              }
                            >
                              <span className="parse-criterion-card-id">
                                {item.criterionId}
                              </span>
                              <strong>{item.dynamicResult}</strong>
                              <p>{item.candidateConclusion}</p>
                              <small>
                                {item.humanReviewRequired ? '需人工复核' : '当前无人工复核标记'} · {reviewState}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                  {reviewContext ? (
                    <section
                      className="parse-engineer-review"
                      aria-label="工程师逐项复核"
                    >
                      <header>
                        <div>
                          <span>ENGINEER REVIEW · APPEND ONLY</span>
                          <h3>记录逐项意见</h3>
                        </div>
                        <strong>
                          {reviewContext.ledger?.reviewCount ?? 0} 条历史意见
                        </strong>
                      </header>
                      <p>
                        保存只记录人的判断，不运行模型，也不改写动态 N/N。
                        保存后当前整体候选会标记为过期，须由 OpenClaw
                        显式重综合。
                      </p>
                      <div className="parse-engineer-review-form">
                        <label>
                          规则项
                          <NativeSelect
                            value={selectedReviewCriterion}
                            onChange={(event) =>
                              updateDeepLink({
                                criterion: event.target.value,
                                node: 'assessment',
                                tab: 'assessment',
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
                          onClick={() => void recordEngineerReview()}
                        >
                          {reviewSubmitting ? '正在保存…' : '保存工程师意见'}
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
                  ) : null}
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
                          · WorkItem revision{' '}
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
                    WAITING_OPENCLAW_DYNAMIC_EVALUATION：尚未收到当前规则集对应的完整
                    N/N 候选。页面不调用 Base AI，也不以本地样本或固定 150
                    代替。
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
                    查看历史 Job Aid 候选投影（只读）
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
          ) : null}

          <EngineeringReasoningTrail data={data} />

          {aeo ? (
            <AeoAuthoringWorkspace
              workItemId={workItemId}
              workItemRevision={data.workItem.revision}
              aeo={aeo}
              integratedAssessment={integratedAssessment}
            />
          ) : null}

          <footer className="parse-footer">
            <span>{data.workItem.workItemId}</span>
            <a href={data.entry.deepLinkPath}>
              Aily 深链同一任务 <ArrowUpRight />
            </a>
          </footer>
        </div>
        <WorkItemContextDock
          data={data}
          refreshing={loading}
          onRefresh={() => void load(activeQuery)}
        />
      </div>
    </main>
  );
}

function LockedState(props: { title: string; detail: string }) {
  return (
    <main className="parse-shell parse-locked-shell">
      <section className="parse-panel parse-locked-card">
        <LockKeyhole aria-hidden="true" />
        <p className="parse-eyebrow">WISELINK 3.1 · FRESH READ REQUIRED</p>
        <h1>{props.title}</h1>
        <p>{props.detail}</p>
        <small>未配置或无权限时不展示静态样本，也不回退历史解析结果。</small>
      </section>
    </main>
  );
}
