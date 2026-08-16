import { useEffect, useState } from 'react';

import {
  getReadOnlyRuntimeProbe,
  type ReadOnlyProbeResult,
} from '@client/src/api/runtime-probe';

export default function RuntimeProbePage() {
  const [results, setResults] = useState<ReadOnlyProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReadOnlyRuntimeProbe()
      .then(setResults)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'RUNTIME_PROBE_FAILED');
      });
  }, []);

  return (
    <main className="parse-shell">
      <header className="parse-masthead">
        <div>
          <p className="parse-eyebrow">WISELINK 3.1 · READ-ONLY RUNTIME</p>
          <h1>托管运行时只读就绪度</h1>
          <p className="parse-lede">
            仅使用妙搭官方登录读取运行时与 Unified Reader readiness。此页面不触发
            FileService、文档入库、WorkItem、解析、评估或工程结论写入。
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
    </main>
  );
}
