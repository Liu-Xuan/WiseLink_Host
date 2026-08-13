import { useEffect, useState } from 'react';

import {
  getReadOnlyRuntimeProbe,
  runPhase2fValidation,
  type Phase2fValidationResult,
  type ReadOnlyProbeResult,
} from '@client/src/api/runtime-probe';

export default function RuntimeProbePage() {
  const [results, setResults] = useState<ReadOnlyProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Phase2fValidationResult | null>(null);
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
      setValidation(await runPhase2fValidation());
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
            readiness；不写 Base、FileService 或 WorkItem。
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
      <section className="parse-panel" data-testid="phase2f-validation-panel">
        <h2>Phase 2F hosted DM validation</h2>
        <p>
          固定读取两份已授权 FTD FileService 对象。页面不接受路径或权限输入；登录、CSRF、
          validation window、run ID 与实际字节由服务端校验。
        </p>
        <button
          data-testid="phase2f-validation-trigger"
          disabled={validationAttempted || validationRunning}
          onClick={runValidationOnce}
          type="button"
        >
          {validationRunning ? 'RUNNING' : validationAttempted ? 'ATTEMPTED' : 'RUN PHASE 2F ONCE'}
        </button>
        {validation ? (
          <div data-testid="phase2f-validation-result">
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
