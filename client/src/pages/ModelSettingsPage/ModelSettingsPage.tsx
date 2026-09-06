import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { RefreshCw } from 'lucide-react';
import type { CanonicalModelSettingsReadModel } from '@shared/api.interface';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalModelSettings,
  updateCanonicalModelSettings,
} from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { Button } from '@client/src/components/ui/button';
import './model-settings.css';

export default function ModelSettingsPage() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const [data, setData] = useState<CanonicalModelSettingsReadModel | null>(
    null,
  );
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const epoch = useRef(0);
  const dataGeneration = useRef<number | null>(null);
  useEffect(() => publishCurrentObject(null), [publishCurrentObject]);

  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    const current = () =>
      request === epoch.current &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await getCanonicalModelSettings();
      if (!current()) return;
      dataGeneration.current = sessionGeneration;
      setData(next);
      setChoice(next.selectedModelRef ?? '');
      setMustRefresh(false);
    } catch (cause) {
      if (current()) {
        setError(modelSettingsError(cause, false));
        setMustRefresh(true);
      }
    } finally {
      if (current()) setBusy(false);
    }
  }, [sessionGeneration]);

  useEffect(() => {
    ++epoch.current;
    dataGeneration.current = null;
    setData(null);
    setChoice('');
    setSaved(false);
    setError(null);
    setMustRefresh(false);
    setBusy(false);
    if (!authenticationRequired) void refresh();
    return () => {
      ++epoch.current;
    };
  }, [authenticationRequired, refresh, sessionGeneration]);

  const visible =
    !authenticationRequired && dataGeneration.current === sessionGeneration
      ? data
      : null;
  const selectedOption = visible?.options.find(
    (option) => option.modelRef === visible.selectedModelRef,
  );
  const nextOption = visible?.options.find(
    (option) => option.modelRef === choice && option.available,
  );
  const canSave =
    !!visible?.canManage &&
    !!nextOption &&
    choice !== visible.selectedModelRef &&
    !busy &&
    !mustRefresh;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!visible || !canSave) return;
    const request = ++epoch.current;
    const current = () =>
      request === epoch.current &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateCanonicalModelSettings({
        expectedRevision: visible.revision,
        modelRef: choice,
      });
      if (!current()) return;
      dataGeneration.current = sessionGeneration;
      setData(next);
      setChoice(next.selectedModelRef ?? '');
      setSaved(true);
    } catch (cause) {
      if (current()) {
        setError(modelSettingsError(cause, true));
        setMustRefresh(true);
      }
    } finally {
      if (current()) setBusy(false);
    }
  };

  return (
    <main className="wl-model-settings" aria-labelledby="model-settings-title">
      <header className="wl-model-settings-heading">
        <div>
          <p className="wl-model-settings-eyebrow">系统设置</p>
          <h1 id="model-settings-title">分析模型</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={busy || authenticationRequired}
        >
          <RefreshCw aria-hidden="true" />
          刷新
        </Button>
      </header>
      <p>
        全局默认仅影响之后新启动的分析任务。已排队、正在运行和恢复中的任务保留启动时的模型。
      </p>
      {authenticationRequired ? (
        <p role="alert">请通过右上角账户入口重新登录。</p>
      ) : null}
      {busy && !visible ? <p role="status">正在读取模型设置…</p> : null}
      {error ? (
        <p role="alert" className="wl-model-settings-message">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="wl-model-settings-message">
          已保存全局默认；正在执行的任务不受影响。
        </p>
      ) : null}
      {visible ? (
        <form onSubmit={(event) => void save(event)}>
          <section
            className="wl-model-settings-current wl-glass-panel"
            aria-label="当前全局默认"
          >
            <span>当前全局默认</span>
            <strong>
              {selectedOption
                ? `${selectedOption.displayName} · ${selectedOption.providerLabel}`
                : '已选模型不在可用配置中'}
            </strong>
            <small>
              设置版本 {visible.revision}
              {visible.updatedAt
                ? ` · ${new Date(visible.updatedAt).toLocaleString()}`
                : ' · 当前部署的初始选择'}
            </small>
          </section>
          {(['BUILT_IN', 'CUSTOM'] as const).map((kind) => (
            <fieldset
              key={kind}
              disabled={!visible.canManage || busy || mustRefresh}
            >
              <legend>
                {kind === 'BUILT_IN' ? 'OpenClaw 内置模型' : '自定义模型'}
              </legend>
              <div className="wl-model-settings-options">
                {visible.options
                  .filter((option) => option.providerKind === kind)
                  .map((option) => (
                    <label
                      key={option.modelRef}
                      className={
                        choice === option.modelRef ? 'is-selected' : ''
                      }
                    >
                      <input
                        type="radio"
                        name="modelRef"
                        value={option.modelRef}
                        checked={choice === option.modelRef}
                        disabled={!option.available}
                        onChange={() => {
                          setChoice(option.modelRef);
                          setSaved(false);
                        }}
                      />
                      <span>
                        <strong>{option.displayName}</strong>
                        <small>
                          {option.providerLabel}
                          {!option.available ? ' · 未配置' : ''}
                        </small>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
          <p className="wl-model-settings-help">
            自定义模型使用对应服务商的配额，并会接收分析所需的获准资料。密钥只保存在妙搭官方模型设置中，本页面不读取或保存密钥。列表表示已登记配置，不代表实时生成健康状态；调用失败会明确报告，不会自动改用另一模型。
          </p>
          {!visible.canManage ? (
            <p role="note">
              {visible.managementStatus === 'ROLE_NOT_CONFIGURED'
                ? '模型管理角色尚未配置；当前可查看，不可修改。'
                : '仅模型管理角色可修改全局默认。'}
            </p>
          ) : null}
          <Button type="submit" disabled={!canSave}>
            {busy ? '处理中…' : '保存全局默认'}
          </Button>
        </form>
      ) : null}
    </main>
  );
}

export function modelSettingsError(cause: unknown, writing: boolean): string {
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String(cause.code)
      : '';
  if (code === 'MODEL_SETTINGS_REVISION_CONFLICT')
    return '其他人已更新全局默认，请刷新后重新选择。';
  if (code === 'MODEL_SETTINGS_MANAGER_REQUIRED')
    return '当前账户没有修改全局模型的权限，请刷新确认。';
  if (code === 'MODEL_SETTINGS_ROLE_NOT_CONFIGURED')
    return '模型管理角色尚未配置，未保存修改。';
  if (code === 'MODEL_SETTINGS_MODEL_UNAVAILABLE')
    return '所选模型已不可用，请刷新模型设置。';
  return writing
    ? '保存结果未确认，请刷新核对当前默认后再操作。'
    : '模型设置读取失败，请刷新重试；未更改模型。';
}
