import { useEffect, useRef, useState } from 'react';

interface TdmsReadState<T> {
  key: string;
  generation: number;
  value: T | null;
  loading: boolean;
  error: string | null;
}

export function tdmsReadDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'statusCode' in error ? Number(error.statusCode)
    : 'response' in error && error.response && typeof error.response === 'object' && 'status' in error.response
      ? Number(error.response.status) : 0;
  return [401, 403, 404].includes(status);
}

/** No persisted JS source cache: a new scope or read epoch hides the old value immediately. */
export function useTdmsReadResource<T>(
  key: string,
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>,
  onDenied: () => void,
) {
  const [state, setState] = useState<TdmsReadState<T>>({
    key: '', generation: -1, value: null, loading: false, error: null,
  });
  const active = useRef({ key, enabled, generation: 0 });
  if (active.current.key !== key || active.current.enabled !== enabled) {
    active.current = { key, enabled, generation: active.current.generation + 1 };
  }
  const epoch = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const requestEpoch = ++epoch.current;
    const generation = active.current.generation;
    const current = () => !controller.signal.aborted && active.current.key === key &&
      active.current.enabled && active.current.generation === generation && epoch.current === requestEpoch;
    setState({ key, generation, value: null, loading: enabled, error: null });
    if (enabled) {
      void load(controller.signal).then(value => {
        if (current()) setState({ key, generation, value, loading: false, error: null });
      }).catch(error => {
        if (!current()) return;
        if (tdmsReadDenied(error)) onDenied();
        // Do not display server error bodies or retain an earlier authorized excerpt.
        setState({ key, generation, value: null, loading: false,
          error: tdmsReadDenied(error) ? '此来源暂不可读取，请重新核对来源与权限。'
            : '来源读取未完成，请重试；未切换到其他版本。' });
      });
    }
    return () => { controller.abort(); };
  }, [key, enabled, load, onDenied]);
  const visible = enabled && state.key === key && state.generation === active.current.generation;
  return {
    value: visible ? state.value : null,
    error: visible ? state.error : null,
    loading: enabled && (!visible || state.loading),
  };
}
