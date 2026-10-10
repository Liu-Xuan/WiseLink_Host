import { useEffect } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { ModelConfigurationPanel } from './ModelConfigurationPanel';
import { DocumentParsingSettingsPanel } from './DocumentParsingSettingsPanel';
import './model-settings.css';
export default function ModelSettingsPage() {
  const { authenticationRequired } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  useEffect(() => publishCurrentObject(null), [publishCurrentObject]);
  return (
    <main className="wl-model-settings" aria-labelledby="model-settings-title">
      <header className="wl-model-settings-heading">
        <div>
          <p className="wl-model-settings-eyebrow">系统设置</p>
          <h1 id="model-settings-title">系统设置</h1>
        </div>
      </header>
      {authenticationRequired ? (
        <p role="alert">请通过右上角账户入口重新登录。</p>
      ) : null}
      <ModelConfigurationPanel />
      <DocumentParsingSettingsPanel />
    </main>
  );
}
