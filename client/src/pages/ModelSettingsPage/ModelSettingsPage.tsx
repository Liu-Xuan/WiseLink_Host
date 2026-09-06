import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { Button } from '@client/src/components/ui/button';
import { useTaskModelOptions } from '@client/src/features/review/TaskModelPicker';
import './model-settings.css';

export default function ModelSettingsPage() {
  const { authenticationRequired } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const models = useTaskModelOptions();
  useEffect(() => publishCurrentObject(null), [publishCurrentObject]);
  return (
    <main className="wl-model-settings" aria-labelledby="model-settings-title">
      <header className="wl-model-settings-heading">
        <div>
          <p className="wl-model-settings-eyebrow">模型目录</p>
          <h1 id="model-settings-title">按任务选择分析模型</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => void models.refresh()}
          disabled={models.loading || authenticationRequired}
        >
          <RefreshCw aria-hidden="true" />
          刷新
        </Button>
      </header>
      <p>
        在新建工程事项时选择一次模型，初始分析各阶段沿用该选择。Review
        默认继承，可在发送新回合前另选；不影响其他事项、历史结果或正在运行的任务。
      </p>
      <p>
        <Link to="/">前往工作台新建工程事项</Link>
      </p>
      {authenticationRequired ? (
        <p role="alert">请通过右上角账户入口重新登录。</p>
      ) : null}
      {models.loading && !models.data ? (
        <p role="status">正在读取模型目录…</p>
      ) : null}
      {models.error ? <p role="alert">{models.error}</p> : null}
      {models.data ? (
        <>
          {(['BUILT_IN', 'CUSTOM'] as const).map((kind) => (
            <section
              key={kind}
              aria-label={kind === 'BUILT_IN' ? '内置模型' : '自定义模型'}
            >
              <h2>
                {kind === 'BUILT_IN' ? 'OpenClaw 内置模型' : '自定义模型'}
              </h2>
              <div className="wl-model-settings-options">
                {models.data?.options
                  .filter((option) => option.providerKind === kind)
                  .map((option) => (
                    <div
                      key={option.modelRef}
                      className="wl-model-settings-current wl-glass-panel"
                    >
                      <strong>
                        {option.displayName} · {option.providerLabel}
                      </strong>
                      <small>
                        {option.available ? '已登记' : '不可用'}
                        {option.modelRef === models.data?.defaultModelRef
                          ? ' · 新事项初始预选'
                          : ''}
                      </small>
                    </div>
                  ))}
              </div>
            </section>
          ))}
          <p className="wl-model-settings-help">
            选择模型沿用现有事项和讨论操作权限，不需要新增全局模型管理角色。自定义模型使用对应服务商配额，并接收分析所需的获准资料；服务和密钥仍由妙搭官方
            Hosted 配置管理，本页面不读取或保存密钥。
          </p>
          <p>
            目录表示已登记配置，不代表实时生成健康状态。调用失败会明确报告，不会自动切换到另一模型。
          </p>
        </>
      ) : null}
    </main>
  );
}
