import { useEffect, useState } from 'react';
import {
  Ban,
  CircleDashed,
  ExternalLink,
  Radar,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

import { externalDiscovery } from '@client/src/api';
import type { ExternalDiscoveryPageResponse } from '@shared/api.interface';

import './external-discovery.css';

export default function ExternalDiscoveryPage() {
  const [data, setData] = useState<ExternalDiscoveryPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      setData(await externalDiscovery.listSearchRuns());
    } catch {
      setError('当前无法读取补充资料候选，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function review(
    searchRunRef: string,
    candidateRef: string,
    action: 'select' | 'reject',
  ): Promise<void> {
    const key = `${searchRunRef}:${candidateRef}:${action}`;
    setBusy(key);
    setError(null);
    try {
      if (action === 'select') {
        await externalDiscovery.selectCandidate(searchRunRef, candidateRef);
      } else {
        await externalDiscovery.rejectCandidate(searchRunRef, candidateRef);
      }
      await load();
    } catch {
      setError('本次复核未提交，原候选状态已保留，请稍后重试。');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="discovery-shell">
      <header className="discovery-header">
        <div>
          <p>受控工程资料 · 人工筛选</p>
          <h1>补充资料候选</h1>
          <span>
            查看可核验的官方来源候选。人工选择只记录筛选意见，不代表资料已进入工程资料库。
          </span>
        </div>
        <Radar aria-hidden="true" />
      </header>

      <section className="discovery-boundary">
        <ShieldAlert aria-hidden="true" />
        <strong>仅可人工选择完整且来自官方来源的候选</strong>
        <span>无结果、无权限或不完整结果不会进入工程资料库。</span>
        <button type="button" onClick={() => void load()}>
          <RefreshCw aria-hidden="true" /> 重新读取
        </button>
      </section>

      {error ? (
        <p className="discovery-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !data ? (
        <p className="discovery-empty" role="status" aria-live="polite">
          正在读取候选账本…
        </p>
      ) : null}
      {!loading && data?.searchRuns.length === 0 ? (
        <p className="discovery-empty">当前环境尚无外部检索运行。</p>
      ) : null}

      <section className="discovery-runs">
        {data?.searchRuns.map((run) => (
          <article className="discovery-run" key={run.searchRunRef}>
            <div className="discovery-run-head">
              <div>
                <small>
                  {sourceSystemLabel(run.sourceSystem)} ·{' '}
                  {observedAtLabel(run.observedAt)}
                </small>
                <h2>{run.query}</h2>
              </div>
              <span
                className={`discovery-status discovery-status--${run.resultStatus.toLowerCase()}`}
              >
                {humanToken(run.resultStatus)}
              </span>
            </div>

            {run.candidates.length === 0 ? (
              <p className="discovery-empty-inline">
                该运行合法保存为 0 个候选。
              </p>
            ) : (
              <div className="discovery-candidates">
                {run.candidates.map((candidate) => {
                  const selectKey = `${run.searchRunRef}:${candidate.candidateRef}:select`;
                  const rejectKey = `${run.searchRunRef}:${candidate.candidateRef}:reject`;
                  return (
                    <section
                      className="discovery-candidate"
                      key={candidate.candidateRef}
                    >
                      <div>
                        <span className="discovery-publisher">
                          {candidate.publisher}
                        </span>
                        <h3>{candidate.title}</h3>
                        <a
                          href={candidate.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看来源 <ExternalLink aria-hidden="true" />
                        </a>
                      </div>
                      <dl>
                        <div>
                          <dt>处置状态</dt>
                          <dd>{humanToken(candidate.disposition)}</dd>
                        </div>
                        <div>
                          <dt>复核状态</dt>
                          <dd>{humanToken(candidate.reviewStatus)}</dd>
                        </div>
                        <div>
                          <dt>阻断原因</dt>
                          <dd>
                            {humanToken(
                              candidate.selectionBlockReason ?? 'NONE',
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="discovery-actions">
                        <button
                          type="button"
                          className="discovery-select"
                          disabled={
                            !candidate.eligibleForHumanSelection ||
                            busy !== null
                          }
                          onClick={() =>
                            void review(
                              run.searchRunRef,
                              candidate.candidateRef,
                              'select',
                            )
                          }
                        >
                          <CircleDashed aria-hidden="true" />
                          {busy === selectKey ? '提交中…' : '人工选择'}
                        </button>
                        <button
                          type="button"
                          className="discovery-reject"
                          disabled={
                            candidate.reviewStatus !== 'PENDING' ||
                            busy !== null
                          }
                          onClick={() =>
                            void review(
                              run.searchRunRef,
                              candidate.candidateRef,
                              'reject',
                            )
                          }
                        >
                          <Ban aria-hidden="true" />
                          {busy === rejectKey ? '提交中…' : '拒绝候选'}
                        </button>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

function humanToken(value: string): string {
  const labels: Record<string, string> = {
    DIRECT_OFFICIAL_SOURCE_MATCH: '官方来源完整匹配',
    INCOMPLETE: '资料不完整',
    NONE: '无',
    PENDING: '待复核',
    REJECTED: '已拒绝',
    SELECTED: '已标记为候选',
    UNAVAILABLE: '暂无数据',
  };
  return labels[value] ?? '状态待确认';
}

function sourceSystemLabel(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    /OPENCLAW|ACTIONATTEMPT|SHA-?256|\b[A-Z][A-Z0-9_]{3,}\b/iu.test(normalized)
  ) {
    return '官方来源';
  }
  return normalized;
}

function observedAtLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '时间未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}
