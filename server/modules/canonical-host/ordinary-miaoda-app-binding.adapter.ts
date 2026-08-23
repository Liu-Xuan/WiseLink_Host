import type { CanonicalMiaodaAppBindingPort } from './canonical-host.types';
import { CANONICAL_MIAODA_APP_ID } from './canonical-host.constants';

const ORIGIN = `https://hv5zjf4j8yb.feishuapp.com/app/${CANONICAL_MIAODA_APP_ID}`;

export class OrdinaryMiaodaAppBindingAdapter implements CanonicalMiaodaAppBindingPort {
  deepLinkForWorkItem(workItemId: string) {
    return {
      bindingStatus: 'VERIFIED_CANONICAL' as const,
      appId: CANONICAL_MIAODA_APP_ID,
      origin: ORIGIN,
      deepLink: `${ORIGIN}/work-items/${encodeURIComponent(workItemId)}/documents`,
    };
  }
}
