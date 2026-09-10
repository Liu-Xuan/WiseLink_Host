import type { ComponentProps } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { safeOauthReturnPath } from '@client/src/pages/OAuthCallbackPage/oauth-return-location';

export function OfficialOauthLink(
  props: Omit<ComponentProps<typeof Link>, 'to'>,
) {
  const location = useLocation();
  const returnTo = safeOauthReturnPath(
    `${location.pathname}${location.search}${location.hash}`,
  );
  const to = `/client/oauth/callback${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  return <Link {...props} to={to} />;
}
