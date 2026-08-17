import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FileOutput,
  FileText,
  Fingerprint,
  LockKeyhole,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import type {
  CanonicalDocumentParsingPageResponse,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

import { WorkItemContextDock } from './WorkItemContextDock';
import { WorkItemContextTree } from './WorkItemContextTree';
import { EngineeringReasoningTrail } from './EngineeringReasoningTrail';
import './document-parsing.css';

function short(value: string, front = 18, back = 10): string {
  return value.length <= front + back + 1
    ? value
    : `${value.slice(0, front)}…${value.slice(-back)}`;
}

export default function DocumentParsingPage() {
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const [query, setQuery] = useState<string>('applicability');
  const [data, setData] = useState<CanonicalDocumentParsingPageResponse | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentAction, setAssessmentAction] = useState<
    'CONFIRM_OVERALL_FOR_AEO' | null
  >(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);

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
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'FRESH_READ_FAILED');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load('applicability');
  }, [workItemId]);

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
  const fileLabel: string = `${data.workItem.classification.normalizedFamily} · ${short(data.workItem.source.sourceArtifactId, 20, 8)}`;

  async function confirmOverallForAeo(): Promise<void> {
    setAssessmentAction('CONFIRM_OVERALL_FOR_AEO');
    setAssessmentError(null);
    try {
      await canonicalHost.confirmIntegratedOverallForAeo(workItemId);
      await load(query.trim() || 'applicability');
    } catch (cause) {
      setAssessmentError(
        cause instanceof Error ? cause.message : 'INTEGRATED_ASSESSMENT_FAILED',
      );
    } finally {
      setAssessmentAction(null);
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

      <section className="parse-rail" aria-label="解析阶段">
        {['原件', '分类', '解析', '统一包', 'Reader'].map(
          (label: string, index: number) => (
            <div className="parse-rail-step" key={label}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
            </div>
          ),
        )}
      </section>

      <div className="workitem-workbench-layout">
        <WorkItemContextTree data={data} />
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

            <article
              className="parse-panel parse-query-card"
              id="workspace-reader"
            >
              <div className="parse-panel-label">
                <Search /> 同一 Reader 查询
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void load(query.trim());
                }}
              >
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="解析单元查询"
                />
                <button type="submit">查询</button>
              </form>
              <div className="parse-results">
                {results.length > 0 ? (
                  results.map((result: UnifiedReaderQueryResult) => (
                    <div className="parse-result" key={result.unitId}>
                      <span>{result.kind}</span>
                      <p>{result.text}</p>
                      <small>
                        {result.sourceRefIds.length} 个 sourceRef ·{' '}
                        {short(result.unitId, 22, 8)}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="parse-empty">没有匹配的来源绑定单元。</p>
                )}
              </div>
            </article>
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
                  {integratedAssessment.overallSynthesis?.status ===
                    'CANDIDATE_ONLY' &&
                  integratedAssessment.overallSynthesis.staleReason === null ? (
                    integratedAssessment.overallForAeoConfirmation ? (
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
                        。 该确认不等于 ADOPT、工程批准或发布。
                      </p>
                    ) : (
                      <button
                        type="button"
                        disabled={assessmentAction !== null}
                        onClick={() => void confirmOverallForAeo()}
                      >
                        {assessmentAction === 'CONFIRM_OVERALL_FOR_AEO'
                          ? '正在确认当前整体综合…'
                          : '确认当前整体综合用于 AEO 候选'}
                      </button>
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
                <details className="parse-historical-assessment">
                  <summary>查看历史 Job Aid 候选投影（只读）</summary>
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
            <section
              className="parse-aeo-panel"
              id="workspace-aeo"
              aria-label="AEO 候选编写"
            >
              <div className="parse-panel-label">
                <FileOutput /> AEO 候选编写 · 同一 WorkItem
              </div>
              <div className="parse-aeo-heading">
                <div>
                  <p className="parse-aeo-kicker">SERVER-CONFIRMED TARGET</p>
                  <h2>{aeo.targetIdentity}</h2>
                </div>
                <span>{aeo.status}</span>
              </div>
              <p>
                处置方式：{aeo.disposition}；权限：{aeo.authorityLevel}
                。该纵切只产生 Working / Draft candidate / Word
                candidate，不形成正式 Draft、发布或工程结论。
              </p>
              <div className="parse-aeo-artifacts">
                {aeo.artifacts.map((artifact) => (
                  <div
                    key={`${artifact.artifactKind}:${artifact.artifactSha256}`}
                  >
                    <strong>{artifact.artifactKind}</strong>
                    <span>{artifact.byteLength.toLocaleString()} bytes</span>
                    <small>{short(artifact.artifactSha256, 18, 10)}</small>
                  </div>
                ))}
              </div>
            </section>
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
          onRefresh={() => void load(query.trim() || 'applicability')}
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
