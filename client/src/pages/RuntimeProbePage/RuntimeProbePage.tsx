import { useEffect, useState } from 'react';

import {
  getReadOnlyRuntimeProbe,
  runFirstFtdVertical,
  type FirstFtdVerticalResult,
  type ReadOnlyProbeResult,
} from '@client/src/api/runtime-probe';

export default function RuntimeProbePage() {
  const [results, setResults] = useState<ReadOnlyProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<FirstFtdVerticalResult | null>(null);
  const [validationRunning, setValidationRunning] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);

  useEffect(() => {
    getReadOnlyRuntimeProbe()
      .then(setResults)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'RUNTIME_PROBE_FAILED');
      });
  }, []);

  async function runValidationOnce() {
    if (validationAttempted || validationRunning) return;
    setValidationAttempted(true);
    setValidationRunning(true);
    try {
      setValidation(await runFirstFtdVertical());
    } finally {
      setValidationRunning(false);
    }
  }

  return (
    <main className="parse-shell">
      <header className="parse-masthead">
        <div>
          <p className="parse-eyebrow">WISELINK 3.1 · READ-ONLY DEV PROBE</p>
          <h1>托管运行时只读探针</h1>
          <p className="parse-lede">
            仅使用妙搭官方登录与 CSRF 客户端读取运行时、Unified Reader 和 Registrar
            readiness。下方独立按钮只在人工点击时创建或复用一条真实 FTD WorkItem；
            不写 Base，也不创建工程结论。
          </p>
        </div>
      </header>
      {error ? (
        <section className="parse-panel">
          <h2>PROBE_FAILED</h2>
          <pre>{error}</pre>
        </section>
      ) : results.length === 0 ? (
        <section className="parse-panel">RUNNING</section>
      ) : (
        results.map((result) => (
          <section className="parse-panel" key={result.path}>
            <h2>{result.path}</h2>
            <p>HTTP {result.status}</p>
            <pre>{JSON.stringify(result.body, null, 2)}</pre>
          </section>
        ))
      )}
      <section className="parse-panel" data-testid="first-ftd-vertical-panel">
        <h2>First real FTD WorkItem vertical</h2>
        <p>
          固定消费已授权的 exact FTD DocumentVersion。页面不接受路径、WorkItem ID 或权限
          输入；登录、CSRF、WorkItem 身份和幂等复用均由服务端处理。
        </p>
        <button
          data-testid="first-ftd-vertical-trigger"
          disabled={validationAttempted || validationRunning}
          onClick={runValidationOnce}
          type="button"
        >
          {validationRunning
            ? 'RUNNING'
            : validationAttempted
              ? 'ATTEMPTED'
              : 'RUN FIRST FTD VERTICAL ONCE'}
        </button>
        {validation ? (
          <div data-testid="first-ftd-vertical-result">
            <p>
              HTTP {validation.status} · {validation.code ?? (validation.ok ? 'PASS' : 'NO_CODE')}
            </p>
            <pre>{JSON.stringify(validation, null, 2)}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
