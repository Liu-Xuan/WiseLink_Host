import type { Request } from 'express';

import { miaodaHostedFinalUserActor } from '../work-item/production-miaoda-browser-ingress';
import type { CanonicalHostActor } from './canonical-host.types';

export function hostActor(request: Request): CanonicalHostActor {
  const identity = miaodaHostedFinalUserActor(request.userContext);
  return {
    userId: identity.canonicalSubject.id,
    tenantId: identity.tenantId,
    appId: identity.applicationScopeId,
    roles: [...identity.platformRoles],
    env: identity.env,
    objectAccessActor: identity,
  };
}
