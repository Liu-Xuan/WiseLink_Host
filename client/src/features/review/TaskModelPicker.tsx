import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanonicalTaskModelOptions } from '@shared/api.interface';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalTaskModelOptions,
} from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';

export function useTaskModelOptions() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const [data, setData] = useState<CanonicalTaskModelOptions | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const epoch = useRef(0);
  const dataGeneration = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    if (authenticationRequired) return;
    const request = ++epoch.current;
    const current = () =>
      request === epoch.current &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    setLoading(true);
    setError('');
    try {
      const next = await getCanonicalTaskModelOptions();
      if (!current()) return;
      dataGeneration.current = sessionGeneration;
      setData(next);
    } catch {
      if (current())
        setError('模型目录读取失败，请刷新后再选择。未更改任务模型。');
    } finally {
      if (current()) setLoading(false);
    }
  }, [authenticationRequired, sessionGeneration]);
  useEffect(() => {
    ++epoch.current;
    dataGeneration.current = null;
    setData(null);
    setError('');
    setLoading(false);
    void refresh();
    return () => {
      ++epoch.current;
    };
  }, [refresh]);
  const visible =
    !authenticationRequired && dataGeneration.current === sessionGeneration
      ? data
      : null;
  return {
    data: visible,
    error,
    loading,
    ready: !!visible && !error && !loading,
    refresh,
  };
}

export default function TaskModelPicker({
  id,
  label,
  value,
  onChange,
  catalog,
  disabled,
  inheritLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  catalog: ReturnType<typeof useTaskModelOptions>;
  disabled?: boolean;
  inheritLabel?: string;
}) {
  return (
    <div className="grid gap-2 text-sm">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled || !catalog.ready}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-foreground"
        onChange={(event) => onChange(event.target.value)}
      >
        {inheritLabel ? (
          <option value="">默认继承 · {inheritLabel}</option>
        ) : (
          <option value="" disabled>
            请选择模型
          </option>
        )}
        {catalog.data?.options.map((model) => (
          <option
            key={model.modelRef}
            value={model.modelRef}
            disabled={!model.available}
          >
            {model.displayName} · {model.providerLabel}
            {model.available ? '' : '（不可用）'}
          </option>
        ))}
      </select>
      {catalog.loading ? <small role="status">正在读取模型目录…</small> : null}
      {catalog.error ? (
        <div role="alert">
          {catalog.error}{' '}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void catalog.refresh()}
          >
            刷新模型
          </Button>
        </div>
      ) : null}
    </div>
  );
}
