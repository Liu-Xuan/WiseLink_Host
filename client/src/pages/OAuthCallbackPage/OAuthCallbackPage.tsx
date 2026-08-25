import { useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';

import {
  exchangeOfficialOauthCallback,
  startOfficialOauth,
} from '@client/src/api/identity-oauth';
import { Button } from '@client/src/components/ui/button';
import {
  toOauthFailureCode,
  type OAuthFailureCode,
} from './oauth-failure-code';

type OAuthPageStatus = 'WORKING' | 'READY' | 'FAILED';

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<OAuthPageStatus>('WORKING');
  const [failureCode, setFailureCode] = useState<OAuthFailureCode | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let active = true;
    setStatus('WORKING');
    setFailureCode(null);
    setAuthorizeUrl(null);

    const callbackParams = new URLSearchParams(window.location.search);
    const codes = callbackParams.getAll('code');
    const states = callbackParams.getAll('state');
    const providerError = callbackParams.has('error');
    const hadCallbackQuery = codes.length > 0 || states.length > 0 || providerError;
    const code = codes.length === 1 ? codes[0]?.trim() ?? '' : '';
    const state = states.length === 1 ? states[0]?.trim() ?? '' : '';

    if (hadCallbackQuery) {
      window.history.replaceState(
        window.history.state,
        '',
        resolveAppUrl('/client/oauth/callback'),
      );
    }

    void (async (): Promise<void> => {
      if (providerError || codes.length > 1 || states.length > 1) {
        throw new Error('OAUTH_CALLBACK_REJECTED');
      }
      if ((code && !state) || (!code && state)) {
        throw new Error('OAUTH_CALLBACK_INCOMPLETE');
      }
      if (code && state) {
        await exchangeOfficialOauthCallback({ code, state });
        if (active) navigate('/', { replace: true });
        return;
      }

      const nextAuthorizeUrl = await startOfficialOauth();
      if (active) {
        setAuthorizeUrl(nextAuthorizeUrl);
        setStatus('READY');
      }
    })().catch((error: unknown) => {
      if (active) {
        setFailureCode(toOauthFailureCode(error));
        setStatus('FAILED');
      }
    });

    return () => {
      active = false;
    };
  }, [attempt, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-8 text-card-foreground shadow-sm">
        {status === 'WORKING' ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold">正在连接飞书身份</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                正在通过妙搭官方同源请求完成安全验证，请勿关闭此页面。
              </p>
            </div>
          </div>
        ) : status === 'READY' && authorizeUrl ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div>
              <h1 className="text-xl font-semibold">飞书身份连接已就绪</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                使用官方飞书授权页继续。授权完成后将自动返回 WiseLink。
              </p>
            </div>
            <Button asChild data-ai-section-type="button">
              <a href={authorizeUrl}>继续前往飞书授权</a>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center" role="alert">
            <CircleAlert className="size-8 text-destructive" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold">飞书身份连接未完成</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                授权参数无效、已过期或服务暂不可用，请重新开始。
              </p>
              {failureCode ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  错误代码：{failureCode}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => setAttempt((current: number): number => current + 1)}
              data-ai-section-type="button"
            >
              重新连接
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
