import { useState, type FC } from 'react';
import { authClient } from '@lark-apaas/client-toolkit/auth';
import {
  ChevronDown,
  LoaderCircle,
  LogIn,
  LogOut,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { UserDisplay } from '@client/src/components/business-ui/user-display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/src/components/ui/dropdown-menu';

type SessionState = 'checking' | 'authenticated' | 'unauthenticated';

const CurrentUserControl: FC = () => {
  const {
    authenticationRequired,
    clearCurrentUser,
    currentUser,
    invalidateSession,
    profileSettled,
  } = useCurrentUserSession();
  const [signingOut, setSigningOut] = useState<boolean>(false);
  const userId = String(currentUser.user_id ?? '').trim();
  const sessionState: SessionState = authenticationRequired
    ? 'unauthenticated'
    : userId
      ? 'authenticated'
      : profileSettled
        ? 'unauthenticated'
        : 'checking';

  function handleLogin(): void {
    invalidateSession();
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
      clearCurrentUser();
      invalidateSession();
      const redirect = authClient.session.redirectToLogin();
      if (redirect.error) {
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

  const displayValue = {
    user_id: userId,
    name: currentUser.name,
    avatar: currentUser.avatar,
  };

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
