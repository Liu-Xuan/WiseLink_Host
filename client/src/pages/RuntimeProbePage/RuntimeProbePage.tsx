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
  const [validation, setValidation] =
    useState<FirstFtdVerticalResult | null>(null);
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
          <p className="parse-eyebrow">WISELINK 3.1 · CONTROLLED DEV VERTICAL</p>
          <h1>托管运行时与业务纵切</h1>
          <p className="parse-lede">
            仅使用妙搭官方登录与 CSRF 客户端读取运行时、Unified Reader 和 Registrar
            readiness。下方按钮只使用已授权的 122,102 字节 FTD PDF，并调用现有
            WorkItem 纵切一次；不接受用户路径，不自动重试，也不创建工程结论。
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
      <section className="parse-panel" data-testid="first-ftd-panel">
        <h2>First FTD WorkItem vertical</h2>
        <p>
          页面不接受路径、文件内容或权限输入；固定 FileService selection、登录和
          CSRF 均由服务端控制。按钮仅允许当前页面人工尝试一次。
        </p>
        <button
          data-testid="first-ftd-trigger"
          disabled={validationAttempted || validationRunning}
          onClick={runValidationOnce}
          type="button"
        >
          {validationRunning
            ? 'RUNNING'
            : validationAttempted
              ? 'ATTEMPTED'
              : 'RUN FIRST FTD ONCE'}
        </button>
        {validation ? (
          <div data-testid="first-ftd-result">
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
