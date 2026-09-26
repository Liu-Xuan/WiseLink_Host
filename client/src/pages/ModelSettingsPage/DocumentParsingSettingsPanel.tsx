import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentParsingSettingsReadModel } from '@shared/document-parsing-settings.interface';
import {
  getDocumentParsingSettings,
  updateDocumentParsingSettings,
} from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { Switch } from '@client/src/components/ui/switch';

export function DocumentParsingSettingsPanel() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  return (
    <DocumentParsingSettingsEditor
      key={sessionGeneration}
      authenticationRequired={authenticationRequired}
    />
  );
}

function DocumentParsingSettingsEditor({
  authenticationRequired,
}: {
  authenticationRequired: boolean;
}) {
  const [saved, setSaved] = useState<DocumentParsingSettingsReadModel | null>(
    null,
  );
  const [localEnabled, setLocalEnabled] = useState(false);
  const [titleEnabled, setTitleEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0);
  const apply = (value: DocumentParsingSettingsReadModel) => {
    setSaved(value);
    setLocalEnabled(value.localMineruFallbackEnabled);
    setTitleEnabled(value.titleEnhancementEnabled);
  };
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    if (authenticationRequired) {
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const value = await getDocumentParsingSettings();
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
  const dirty =
    !!saved &&
    (saved.localMineruFallbackEnabled !== localEnabled ||
      saved.titleEnhancementEnabled !== titleEnabled);
  const disabled = authenticationRequired || pending || !saved?.canManage;
  async function save() {
    if (!saved || disabled || !dirty) return;
    const current = ++epoch.current;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const value = await updateDocumentParsingSettings({
        expectedRevision: saved.revision,
        localMineruFallbackEnabled: localEnabled,
        titleEnhancementEnabled: titleEnabled,
      });
      if (epoch.current === current) {
        apply(value);
        setNotice('已保存，后续新受理的本地解析使用此设置。');
      }
    } catch (reason) {
      if (epoch.current === current) setError(settingsMessage(reason));
    } finally {
      if (epoch.current === current) setPending(false);
    }
  }
  return (
    <section
      className="wl-document-parsing-settings"
      aria-labelledby="document-parsing-settings-title"
    >
      <h2 id="document-parsing-settings-title">文档解析</h2>
      <p>保存后用于新受理的本地解析；已有解析沿用受理时的设置。</p>
      <div className="wl-document-parsing-setting">
        <div>
          <label htmlFor="local-mineru-enabled">默认使用本机 MinerU 解析</label>
          <p>
            新文档默认交给本机解析。需要本机工作进程在线；未连接时保留待处理状态，不自动改用其他解析器。
          </p>
          <small>
            {saved
              ? `${saved.revision === 0 ? '默认' : '已保存'}：${saved.localMineruFallbackEnabled ? '开启' : '关闭'}`
              : '尚未读取已保存状态'}
          </small>
        </div>
        <Switch
          id="local-mineru-enabled"
          checked={localEnabled}
          onCheckedChange={setLocalEnabled}
          disabled={disabled}
        />
      </div>
      <div className="wl-document-parsing-setting">
        <div>
          <label htmlFor="mineru-title-enhancement">
            采用外部 LLM 标题层级建议
          </label>
          <p>
            控制导入时是否采用候选包中的标题建议，不改写原文。当前尚未控制本机助手的外部模型调用，关闭此项不会停止助手外发。
          </p>
          <small>
            {saved
              ? `已保存：${saved.titleEnhancementEnabled ? '开启' : '关闭'}`
              : '尚未读取已保存状态'}
          </small>
        </div>
        <Switch
          id="mineru-title-enhancement"
          checked={titleEnabled}
          onCheckedChange={setTitleEnabled}
          disabled={disabled}
        />
      </div>
      {saved?.managementStatus === 'ROLE_NOT_CONFIGURED' ? (
        <p role="status">管理角色尚未配置，当前不能修改设置。</p>
      ) : saved && !saved.canManage ? (
        <p role="status">当前账户没有设置管理权限。</p>
      ) : null}
      {dirty ? (
        <p role="status">有未保存更改；当前生效状态以上方“已保存”为准。</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="wl-document-parsing-settings-actions">
        <Button onClick={() => void save()} disabled={disabled || !dirty}>
          保存解析设置
        </Button>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={pending || authenticationRequired}
        >
          重新读取
        </Button>
        {pending ? <span role="status">正在处理…</span> : null}
      </div>
    </section>
  );
}
function settingsMessage(reason: unknown): string {
  const code =
    reason && typeof reason === 'object' && 'code' in reason
      ? String(reason.code)
      : '';
  if (code === 'DOCUMENT_PARSING_SETTINGS_REVISION_CONFLICT')
    return '设置已被其他操作更新，请重新读取后保存。';
  if (code === 'DOCUMENT_PARSING_SETTINGS_ROLE_NOT_CONFIGURED')
    return '管理角色尚未配置，设置未保存。';
  if (code === 'DOCUMENT_PARSING_SETTINGS_MANAGER_REQUIRED')
    return '当前账户没有管理权限，设置未保存。';
  return reason instanceof Error
    ? reason.message
    : '设置读取或保存失败，请重试。';
}
