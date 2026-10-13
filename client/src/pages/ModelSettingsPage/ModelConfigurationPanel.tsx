import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanonicalModelSettingsReadModel } from '@shared/api.interface';
import {
  getCanonicalModelSettings,
  updateCanonicalModelSettings,
} from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';

export function ModelConfigurationPanel() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  return (
    <ModelConfigurationEditor
      key={sessionGeneration}
      authenticationRequired={authenticationRequired}
    />
  );
}
function ModelConfigurationEditor({
  authenticationRequired,
}: {
  authenticationRequired: boolean;
}) {
  const [saved, setSaved] = useState<CanonicalModelSettingsReadModel | null>(
    null,
  );
  const [modelRef, setModelRef] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const saveInFlight = useRef(false);
  const apply = (value: CanonicalModelSettingsReadModel) => {
    setSaved(value);
    setModelRef(value.selectedModelRef ?? '');
  };
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    if (authenticationRequired) {
      setSaved(null);
      return;
    }
    setPending(true);
    setError('');
    setNotice('');
    try {
      const value = await getCanonicalModelSettings();
      if (epoch.current === current) apply(value);
    } catch (reason) {
      if (epoch.current === current) {
        setSaved(null);
        setError(settingsMessage(reason));
      }
    } finally {
      if (epoch.current === current) setPending(false);
    }
  }, [authenticationRequired]);
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current += 1;
    };
  }, [refresh]);
  const disabled = authenticationRequired || pending || !saved?.canManage;
  const dirty = !!saved && modelRef !== saved.selectedModelRef;
  const available = saved?.options.some(
    (option) => option.available && option.modelRef === modelRef,
  );
  async function save() {
    if (!saved || disabled || !dirty || !available || saveInFlight.current) return;
    saveInFlight.current = true;
    const current = ++epoch.current;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const value = await updateCanonicalModelSettings({
        expectedRevision: saved.revision,
        modelRef,
      });
      if (epoch.current === current) {
        apply(value);
        setNotice('模型设置已保存，尚未冻结的新任务将使用此选择。');
      }
    } catch (reason) {
      if (epoch.current === current) setError(settingsMessage(reason));
    } finally {
      saveInFlight.current = false;
      if (epoch.current === current) setPending(false);
    }
  }
  const selected = saved?.options.find(
    (option) => option.modelRef === saved.selectedModelRef,
  );
  return (
    <section aria-labelledby="configured-model-title">
      <h2 id="configured-model-title">统一模型配置</h2>
      <p>
        初始评估、原文解读与翻译在首次模型执行前读取此配置并冻结；明确选择的单任务模型优先。已冻结或已执行的任务沿用其原模型，历史结果不改变。
      </p>
      {saved ? (
        <>
          <p className="wl-model-settings-current wl-glass-panel">
            <strong>已保存：{selected?.displayName ?? '不可用'}</strong>
            <small>
              设置修订 {saved.revision} · {selected?.providerLabel ?? '未登记'}
            </small>
          </p>
          <label htmlFor="configured-model">后续任务默认模型</label>
          <select
            id="configured-model"
            value={modelRef}
            disabled={disabled}
            onChange={(event) => setModelRef(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-foreground"
          >
            {saved.options.map((option) => (
              <option
                key={option.modelRef}
                value={option.modelRef}
                disabled={!option.available}
              >
                {option.displayName} · {option.providerLabel}
                {option.available ? '' : '（不可用）'}
              </option>
            ))}
          </select>
          {saved.managementStatus === 'ROLE_NOT_CONFIGURED' ? (
            <p role="status">模型管理角色尚未配置，当前不能修改模型设置。</p>
          ) : !saved.canManage ? (
            <p role="status">当前账户没有模型设置管理权限。</p>
          ) : null}
        </>
      ) : null}
      {dirty ? (
        <p role="status">有未保存更改；当前生效模型以上方“已保存”为准。</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="wl-document-parsing-settings-actions">
        <Button
          onClick={() => void save()}
          disabled={disabled || !dirty || !available}
        >
          保存模型设置
        </Button>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={pending || authenticationRequired}
        >
          重新读取模型设置
        </Button>
        {pending ? <span role="status">正在读取或保存模型设置…</span> : null}
      </div>
    </section>
  );
}
function settingsMessage(reason: unknown): string {
  const code =
    reason && typeof reason === 'object' && 'code' in reason
      ? String(reason.code)
      : '';
  if (code === 'MODEL_SETTINGS_REVISION_CONFLICT')
    return '设置已被其他操作更新，请重新读取后保存。';
  if (code === 'MODEL_SETTINGS_ROLE_NOT_CONFIGURED')
    return '模型管理角色尚未配置，设置未保存。';
  if (code === 'MODEL_SETTINGS_MANAGER_REQUIRED')
    return '当前账户没有模型设置管理权限，设置未保存。';
  return '模型设置读取或保存失败，请重新读取。';
}
