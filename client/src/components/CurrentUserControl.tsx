import { useEffect, useState, type FC } from 'react';
import { authClient } from '@lark-apaas/client-toolkit/auth';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import {
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { UserDisplay } from '@client/src/components/business-ui/user-display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';

type SessionState =
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'unavailable';

const CurrentUserControl: FC = () => {
  const currentUser = useCurrentUserProfile();
  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState<number>(0);
  const [signingOut, setSigningOut] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    if (currentUser.user_id) {
      setSessionUserId(currentUser.user_id);
      setSessionState('authenticated');
      return () => {
        cancelled = true;
      };
    }

    setSessionState('checking');
    void authClient.session
      .getUserInfo()
      .then((result) => {
        if (cancelled) return;
        if (result.status === 401) {
          setSessionUserId(null);
          setSessionState('unauthenticated');
          return;
        }
        if (result.error) {
          setSessionUserId(null);
          setSessionState('unavailable');
          return;
        }
        const resolvedUserId = result.data.user_info?.user_id;
        if (!resolvedUserId) {
          setSessionUserId(null);
          setSessionState('unavailable');
          return;
        }
        setSessionUserId(String(resolvedUserId));
        setSessionState('authenticated');
      })
      .catch(() => {
        if (!cancelled) {
          setSessionUserId(null);
          setSessionState('unavailable');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser.user_id, sessionRevision]);

  function handleLogin(): void {
    const result = authClient.session.redirectToLogin();
    if (result.error) {
      toast.error('登录入口暂时不可用，请稍后重试。');
    }
  }

  function handleProfile(): void {
    const result = authClient.session.navigateToUserProfile();
    if (result.error) {
      toast.error('当前无法打开个人资料，请稍后重试。');
    }
  }

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      const result = await authClient.session.signOut();
      if (result.error) {
        toast.error('退出登录未完成，请稍后重试。');
        return;
      }
      const redirect = authClient.session.redirectToLogin();
      if (redirect.error) {
        setSessionUserId(null);
        setSessionState('unauthenticated');
        toast.error('已退出登录，请重新打开登录页。');
      }
    } catch {
      toast.error('退出登录未完成，请稍后重试。');
    } finally {
      setSigningOut(false);
    }
  }

  if (sessionState === 'checking') {
    return (
      <span
        className="wiselink-account-state is-checking"
        role="status"
        aria-live="polite"
      >
        <LoaderCircle className="wl-spin" aria-hidden="true" />
        <span>正在读取用户</span>
      </span>
    );
  }

  if (sessionState === 'unauthenticated') {
    return (
      <button
        type="button"
        className="wiselink-account-state is-action"
        aria-label="登录"
        onClick={handleLogin}
      >
        <LogIn aria-hidden="true" />
        <span>登录</span>
      </button>
    );
  }

  if (sessionState === 'unavailable') {
    return (
      <button
        type="button"
        className="wiselink-account-state is-action is-warning"
        aria-label="重试读取当前用户"
        onClick={() => setSessionRevision((revision) => revision + 1)}
      >
        <CircleAlert aria-hidden="true" />
        <span>重试身份</span>
        <RefreshCw aria-hidden="true" />
      </button>
    );
  }

  const userId = currentUser.user_id ?? sessionUserId;
  if (!userId) {
    return (
      <span className="wiselink-account-state is-warning" role="status">
        <CircleAlert aria-hidden="true" />
        <span>身份信息未返回</span>
      </span>
    );
  }

  const displayValue = currentUser.user_id
    ? {
        user_id: currentUser.user_id,
        name: currentUser.name,
        avatar: currentUser.avatar,
      }
    : userId;

  return (
    <div className="wiselink-account-control">
      <UserDisplay
        value={displayValue}
        size="small"
        className="wiselink-account-display"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="wiselink-account-menu-trigger"
            aria-label="打开当前用户菜单"
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="wiselink-account-menu"
        >
          <DropdownMenuLabel>当前用户</DropdownMenuLabel>
          <DropdownMenuItem onSelect={handleProfile}>
            <UserRound aria-hidden="true" />
            查看个人资料
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onSelect={() => void handleSignOut()}
          >
            {signingOut ? (
              <LoaderCircle className="wl-spin" aria-hidden="true" />
            ) : (
              <LogOut aria-hidden="true" />
            )}
            {signingOut ? '正在退出…' : '退出登录'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default CurrentUserControl;
