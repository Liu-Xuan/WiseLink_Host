import { useEffect, useState } from 'react';

import {
  getReadOnlyRuntimeProbe,
  type ReadOnlyProbeResult,
} from '@client/src/api/runtime-probe';

export default function RuntimeProbePage() {
  const [results, setResults] = useState<ReadOnlyProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReadOnlyRuntimeProbe()
      .then((res) => {
        setResults(res);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        const detail: string =
          cause instanceof Error ? cause.message : 'RUNTIME_PROBE_FAILED';
        setError(`UNAVAILABLE · 当前无法读取连接状态：${detail}`);
        setLoading(false);
      });
  }, []);

  return (
    <main className="parse-shell" aria-busy={loading}>
      <header className="parse-masthead">
        <div>
          <p className="parse-eyebrow">WISELINK 3.1 · 只读连接状态</p>
          <h1>资料与原文阅读连接状态</h1>
          <p className="parse-lede">
            仅使用当前登录身份读取连接与原文阅读就绪状态。此页面不触发资料入库、
            工程事项、解析、评估或工程结论写入。
          </p>
        </div>
      </header>
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
          <p>UNAVAILABLE · 当前没有可展示的连接信息。</p>
        </section>
      ) : (
        results.map((result) => (
          <section className="parse-panel" key={result.path}>
            <h2>连接检查</h2>
            <p>
              {result.status >= 200 && result.status < 300
                ? '当前连接可用。'
                : 'UNAVAILABLE · 当前连接未就绪。'}
            </p>
          </section>
        ))
      )}
    </main>
  );
}
