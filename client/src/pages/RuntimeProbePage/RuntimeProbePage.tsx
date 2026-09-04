import { useEffect, useState } from 'react';

import {
  getReadOnlyRuntimeProbe,
  runtimeFingerprintFrom,
  type ReadOnlyProbeResult,
} from '@client/src/api/runtime-probe';
import { runtimeBuildFingerprint } from '@client/src/config/runtime-build';

import './runtime-probe.css';

export default function RuntimeProbePage() {
  const [results, setResults] = useState<ReadOnlyProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const runtime = runtimeFingerprintFrom(results);
  const fingerprint = {
    frontendSourceCommit: runtimeBuildFingerprint.sourceCommit,
    frontendBuildTime: runtimeBuildFingerprint.buildTime,
    releaseId: runtime?.releaseId ?? 'UNAVAILABLE',
    deployedCommit: runtime?.deployedCommit ?? 'UNAVAILABLE',
    apiContractVersion: runtime?.apiContractVersion ?? 'UNAVAILABLE',
    visualVersion: runtimeBuildFingerprint.visualVersion,
  };

  async function copyFingerprint(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        Object.entries(fingerprint)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    getReadOnlyRuntimeProbe()
      .then((res) => {
        setResults(res);
        setLoading(false);
      })
      .catch(() => {
        setError('当前无法读取连接状态，请稍后重试。');
        setLoading(false);
      });
  }, []);

  return (
    <main className="parse-shell" aria-busy={loading}>
      <header className="parse-masthead">
        <div>
          <p className="parse-eyebrow">资料连接 · 只读检查</p>
          <h1>资料与原文阅读连接状态</h1>
          <p className="parse-lede">
            仅使用当前登录身份读取连接与原文阅读就绪状态。此页面不触发资料入库、
            工程评估、解析或工程结论写入。
          </p>
        </div>
      </header>
      <section className="parse-panel wl-runtime-fingerprint">
        <div>
          <p className="parse-eyebrow">运行指纹</p>
          <h2>Git、Release 与浏览器构建</h2>
        </div>
        <dl>
          <div>
            <dt>浏览器源码提交</dt>
            <dd>{fingerprint.frontendSourceCommit}</dd>
          </div>
          <div>
            <dt>浏览器构建时间</dt>
            <dd>{fingerprint.frontendBuildTime}</dd>
          </div>
          <div>
            <dt>妙搭 Release</dt>
            <dd>{fingerprint.releaseId}</dd>
          </div>
          <div>
            <dt>Host 部署提交</dt>
            <dd>{fingerprint.deployedCommit}</dd>
          </div>
          <div>
            <dt>API 合同</dt>
            <dd>{fingerprint.apiContractVersion}</dd>
          </div>
          <div>
            <dt>视觉版本</dt>
            <dd>{fingerprint.visualVersion}</dd>
          </div>
        </dl>
        <button type="button" onClick={() => void copyFingerprint()}>
          {copied ? '已复制运行指纹' : '复制运行指纹'}
        </button>
      </section>
      {error ? (
        <section className="parse-panel" role="alert">
          <h2>连接检查失败</h2>
          <p>{error}</p>
        </section>
      ) : loading ? (
        <section className="parse-panel" role="status" aria-live="polite">
          <h2>检查中</h2>
          <p>正在读取连接状态…</p>
        </section>
      ) : results.length === 0 ? (
        <section className="parse-panel">
          <h2>暂无连接结果</h2>
          <p>当前没有可展示的连接信息。</p>
        </section>
      ) : (
        results.map((result) => (
          <section className="parse-panel" key={result.path}>
            <h2>连接检查</h2>
            <p>
              {result.status >= 200 && result.status < 300
                ? '当前连接可用。'
                : '当前连接尚未就绪。'}
            </p>
          </section>
        ))
      )}
    </main>
  );
}
