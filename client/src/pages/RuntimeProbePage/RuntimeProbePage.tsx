import { useEffect, useState } from 'react';

import {
  getReadOnlyRuntimeProbe,
  runtimeFingerprintFrom,
  type ReadOnlyProbeResult,
} from '@client/src/api/runtime-probe';
import { runtimeBuildFingerprint } from '@client/src/config/runtime-build';

import './runtime-probe.css';

const checkLabels: Record<string, string> = {
  pythonExecutable: 'Python 运行环境',
  childProcess: '子进程执行',
  temporaryFile: '临时文件读写',
  jsonschemaDependency: 'JSON Schema 依赖',
  exactU0Manifest: '原文解析清单',
  exactU0Scripts: '原文解析脚本',
  strictReader: '原文严格读取',
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function ProbeResult({ result }: { result: ReadOnlyProbeResult }) {
  const body = record(result.body);
  const runtime = runtimeFingerprintFrom([result]);
  const isRuntime = result.path === '/api/runtime-probe';
  const title = isRuntime ? '运行环境检查' : '候选阅读就绪检查';
  let message = '暂时无法确认检查结果。';
  if (result.status < 200 || result.status >= 300) {
    message = `检查请求失败（HTTP ${result.status}）。`;
  } else if (runtime?.status === 'PASS') {
    message = '运行环境检查通过（PASS）。';
  } else if (runtime?.status === 'BLOCKED') {
    message = '运行环境检查受阻（BLOCKED）。';
  } else if (result.path === '/api/unified-reader/readiness' &&
    body?.schemaVersion === 'wiselink.3_1.unified_reader_readiness.v0.candidate' &&
    body.status === 'VERIFICATION_PENDING') {
    message = '候选阅读就绪状态：待验证（VERIFICATION_PENDING）。';
  }
  const failures = Object.entries(record(body?.checks) ?? {}).flatMap(([name, value]) => {
    const check = record(value);
    return check?.status === 'FAIL'
      ? [{ name, detail: typeof check.detail === 'string' ? check.detail : '未提供失败详情。' }]
      : [];
  });
  const blockers = Array.isArray(body?.blockers)
    ? body.blockers.filter((value): value is string => typeof value === 'string') : [];

  return (
    <section className="parse-panel">
      <h2>{title}</h2>
      <p>{message}</p>
      {failures.length > 0 && (
        <div>
          <h3>未通过的检查</h3>
          <ul>
            {failures.map(({ name, detail }) => (
              <li key={name}>
                <details>
                  <summary>{checkLabels[name] ?? name}</summary>
                  <p>{detail}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
      {blockers.length > 0 && (
        <details>
          <summary>阻塞项（{blockers.length}）</summary>
          <ul>{blockers.map((blocker, index) => <li key={`${index}:${blocker}`}>{blocker}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

export default function RuntimeProbePage() {
  const [results, setResults] = useState<ReadOnlyProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const runtime = runtimeFingerprintFrom(results);
  const fingerprint = {
    frontendSourceCommit: runtimeBuildFingerprint.sourceCommit,
    frontendBuildTime: runtimeBuildFingerprint.buildTime,
    releaseId: runtime?.releaseId ?? '未知',
    deployedCommit: runtime?.deployedCommit ?? '未知',
    apiContractVersion: runtime?.apiContractVersion ?? '未知',
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
    getReadOnlyRuntimeProbe((result) => setResults((current) => [...current, result]))
      .then((res) => {
        setResults(res);
        setLoading(false);
      })
      .catch(() => {
        setError('当前无法读取完整连接状态，请稍后重试。');
        setLoading(false);
      });
  }, []);

  return (
    <main className="parse-shell" aria-busy={loading}>
      <header className="parse-masthead">
        <div>
          <h1>资料与原文阅读连接状态</h1>
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
      {error && (
        <section className="parse-panel" role="alert">
          <h2>连接检查失败</h2>
          <p>{error}</p>
        </section>
      )}
      {loading ? (
        <section className="parse-panel" role="status" aria-live="polite">
          <h2>检查中</h2>
          <p>正在读取连接状态…</p>
        </section>
      ) : results.length === 0 ? (
        !error && (
          <section className="parse-panel">
            <h2>暂无连接结果</h2>
            <p>当前没有可展示的连接信息。</p>
          </section>
        )
      ) : (
        results.map((result) => (
          <ProbeResult result={result} key={result.path} />
        ))
      )}
    </main>
  );
}
