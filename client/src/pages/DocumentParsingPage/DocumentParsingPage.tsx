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

import './document-parsing.css';

function short(value: string, front = 18, back = 10): string {
  return value.length <= front + back + 1
    ? value
    : `${value.slice(0, front)}…${value.slice(-back)}`;
}

export default function DocumentParsingPage() {
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const [query, setQuery] = useState<string>('applicability');
  const [data, setData] =
    useState<CanonicalDocumentParsingPageResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentAction, setAssessmentAction] = useState<
    'EVALUATE' | 'RESYNTHESIZE' | null
  >(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [criterionId, setCriterionId] = useState<string>('');
  const [engineerComment, setEngineerComment] = useState<string>('');
  const [aeoRunning, setAeoRunning] = useState<boolean>(false);
  const [aeoAttempted, setAeoAttempted] = useState<boolean>(false);
  const [aeoError, setAeoError] = useState<string | null>(null);

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
  const assessmentEligible =
    data.workItem.classification.status === 'CONFIRMED' &&
    data.workItem.classification.normalizedFamily === 'SB';
  const aeo = data.workItem.aeo ?? null;
  const phase10Action = data.validationActions.phase10AeoCandidateLoop;
  const results: UnifiedReaderQueryResult[] = data.queryResults;
  const fileLabel: string = `${data.workItem.classification.normalizedFamily} · ${short(data.workItem.source.sourceArtifactId, 20, 8)}`;

  return (
    <main className="parse-shell">
      <header className="parse-masthead">
        <div>
          <p className="parse-eyebrow">WISELINK 3.1 · WORKITEM / 文档与解析</p>
          <h1>一份文档，一条可追溯的解析链。</h1>
          <p className="parse-lede">
            当前页面来自服务端同一 WorkItem 的 fresh-read；没有本地 SAMPLE、没有切换
            current，也没有生成工程结论。
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

      <section className="parse-hero-grid">
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
              <dd>{short(data.workItem.source.documentVersionId, 24, 8)}</dd>
            </div>
            <div>
              <dt>Source artifact</dt>
              <dd>{short(data.workItem.source.sourceArtifactId, 24, 8)}</dd>
            </div>
            <div>
              <dt>字节</dt>
              <dd>{data.workItem.source.sourceByteLength.toLocaleString()}</dd>
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
          <span className="parse-tag">{pkg?.contractRevision ?? 'NO PACKAGE'}</span>
          {referenceOnly ? (
            <span className="parse-tag parse-reference-tag">REFERENCE ONLY</span>
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
        <article className="parse-panel parse-package-card">
          <div className="parse-panel-label">
            <Fingerprint /> Unified Parsed Package
          </div>
          <h3>{short(pkg?.packageId ?? 'NO_PACKAGE_RECORDED', 36, 14)}</h3>
          {pkg ? (
            <div className="parse-hash-stack">
              <p><span>content</span>{short(pkg.contentHash)}</p>
              <p><span>semantic</span>{short(pkg.semanticHash)}</p>
              <p><span>provenance</span>{short(pkg.provenanceHash)}</p>
              <p><span>coverage</span>{short(pkg.coverageHash)}</p>
            </div>
          ) : (
            <p className="parse-empty">
              {data.workItem.failure?.failureCode ??
                data.workItem.recordingFailure?.failureCode ??
                'PACKAGE_NOT_READY'}
            </p>
          )}
          <div className="parse-candidate-warning">
            <AlertTriangle /> 当前结果是 DEV 候选解析包；未切 production/current，
            不生成适用性或工程结论。
          </div>
          {referenceOnly && usagePolicy ? (
            <div className="parse-reference-boundary">
              <strong>REFERENCE ONLY · {usagePolicy.qualityStatus}</strong>
              <p>
                Applicability：{usagePolicy.applicability.sourceExpressionCount} source
                expression / {usagePolicy.applicability.normalizedCandidateCount}{' '}
                candidate / {usagePolicy.applicability.assignmentCount} assignment
              </p>
              <small>
                Assessment 自动采纳：禁止 · AEO 自动采纳：禁止
              </small>
            </div>
          ) : null}
        </article>

        <article className="parse-panel parse-query-card">
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
        <section className="parse-assessment-panel" aria-label="Job Aid 候选评估">
          <div className="parse-panel-label">
            <ClipboardCheck /> Job Aid 候选评估 · 同一 WorkItem
          </div>
          {assessment ? (
            <>
              <div className="parse-assessment-grid">
                <div>
                  <strong>{assessment.criterionCount}</strong>
                  <span>受控检查项</span>
                </div>
                <div>
                  <strong>{assessment.packageStatus}</strong>
                  <span>{assessment.applicabilityOverall}</span>
                </div>
                <div>
                  <strong>{assessment.status}</strong>
                  <span>{assessment.staleReason ?? 'INITIAL_CANDIDATE'}</span>
                </div>
              </div>
              <p>
                外部发现：{assessment.externalDiscoveryStatus ?? 'NOT_RUN'}；只作候选发现，
                Evidence={String(assessment.externalDiscoveryIsEvidence)}。当前结果仍为
                candidate_only，工程关闭={assessment.blocksEngineeringClosure ? '阻断' : '未阻断'}。
              </p>
              <form
                className="parse-assessment-action"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!criterionId.trim() || !engineerComment.trim()) return;
                  setAssessmentAction('RESYNTHESIZE');
                  setAssessmentError(null);
                  void canonicalHost
                    .resynthesizeAssessment(workItemId, {
                      expectedRevision: data.workItem.revision,
                      criterionId: criterionId.trim(),
                      decision: 'deferred',
                      comment: engineerComment.trim(),
                    })
                    .then(() => load(query.trim()))
                    .catch((cause: unknown) => {
                      setAssessmentError(
                        cause instanceof Error
                          ? cause.message
                          : 'ASSESSMENT_RESYNTHESIS_FAILED',
                      );
                    })
                    .finally(() => setAssessmentAction(null));
                }}
              >
                <input
                  value={criterionId}
                  onChange={(event) => setCriterionId(event.target.value)}
                  placeholder="需复核的 Criterion ID"
                  aria-label="需复核的 Criterion ID"
                />
                <input
                  value={engineerComment}
                  onChange={(event) => setEngineerComment(event.target.value)}
                  placeholder="工程师修改说明"
                  aria-label="工程师修改说明"
                />
                <button
                  type="submit"
                  disabled={
                    assessmentAction !== null ||
                    !criterionId.trim() ||
                    !engineerComment.trim()
                  }
                >
                  {assessmentAction === 'RESYNTHESIZE'
                    ? '正在重综合…'
                    : '保存补证意见并重综合'}
                </button>
              </form>
            </>
          ) : (
            <div className="parse-assessment-empty">
              <p>
                当前 SB 已完成统一解析；可在同一 WorkItem 生成 N 项 Job Aid 候选评估。
                该动作只生成 candidate_only，不形成工程结论。
              </p>
              <button
                type="button"
                disabled={assessmentAction !== null}
                onClick={() => {
                  setAssessmentAction('EVALUATE');
                  setAssessmentError(null);
                  void canonicalHost
                    .evaluateAssessment(workItemId)
                    .then(() => load(query.trim()))
                    .catch((cause: unknown) => {
                      setAssessmentError(
                        cause instanceof Error
                          ? cause.message
                          : 'ASSESSMENT_EVALUATE_FAILED',
                      );
                    })
                    .finally(() => setAssessmentAction(null));
                }}
              >
                {assessmentAction === 'EVALUATE'
                  ? '正在生成候选评估…'
                  : '生成 Job Aid 候选评估'}
              </button>
            </div>
          )}
          {assessmentError ? (
            <p className="parse-assessment-error">{assessmentError}</p>
          ) : null}
        </section>
      ) : null}

      {aeo || phase10Action.enabled ? (
        <section className="parse-aeo-panel" aria-label="AEO 候选编写">
          <div className="parse-panel-label">
            <FileOutput /> AEO 候选编写 · 同一 WorkItem
          </div>
          <div className="parse-aeo-heading">
            <div>
              <p className="parse-aeo-kicker">SERVER-CONFIRMED TARGET</p>
              <h2>{aeo?.targetIdentity ?? phase10Action.targetIdentity}</h2>
            </div>
            <span>{aeo?.status ?? 'VALIDATION READY'}</span>
          </div>
          <p>
            处置方式：{aeo?.disposition ?? phase10Action.disposition}；权限：
            {aeo?.authorityLevel ?? phase10Action.authorityLevel}。该纵切只产生
            Working / Draft candidate / Word candidate，不形成正式 Draft、发布或工程结论。
          </p>
          {aeo ? (
            <div className="parse-aeo-artifacts">
              {aeo.artifacts.map((artifact) => (
                <div key={`${artifact.artifactKind}:${artifact.artifactSha256}`}>
                  <strong>{artifact.artifactKind}</strong>
                  <span>{artifact.byteLength.toLocaleString()} bytes</span>
                  <small>{short(artifact.artifactSha256, 18, 10)}</small>
                </div>
              ))}
            </div>
          ) : (
            <button
              data-testid="phase10-aeo-candidate-loop-trigger"
              type="button"
              disabled={aeoRunning || aeoAttempted}
              onClick={() => {
                if (aeoRunning || aeoAttempted) return;
                setAeoAttempted(true);
                setAeoRunning(true);
                setAeoError(null);
                void canonicalHost
                  .runPhase10AeoCandidateLoop()
                  .then(() => load(query.trim()))
                  .catch((cause: unknown) => {
                    setAeoError(
                      cause instanceof Error
                        ? cause.message
                        : 'AEO_PHASE10_CANDIDATE_LOOP_FAILED',
                    );
                  })
                  .finally(() => setAeoRunning(false));
              }}
            >
              {aeoRunning
                ? 'RUNNING 5 → 9'
                : aeoAttempted
                  ? 'ATTEMPTED'
                  : 'RUN PHASE 10 AEO ONCE'}
            </button>
          )}
          {aeoError ? (
            <p className="parse-assessment-error">{aeoError}</p>
          ) : null}
        </section>
      ) : null}

      <footer className="parse-footer">
        <span>{data.workItem.workItemId}</span>
        <a href={data.entry.deepLinkPath}>
          Aily 深链同一任务 <ArrowUpRight />
        </a>
      </footer>
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
