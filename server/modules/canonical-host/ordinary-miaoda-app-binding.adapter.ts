import type { CanonicalMiaodaAppBindingPort } from './canonical-host.types';

const APP_ID = 'app_17bzc551rsg';
const ORIGIN = `https://hv5zjf4j8yb.feishuapp.com/app/${APP_ID}`;

export class OrdinaryMiaodaAppBindingAdapter
  implements CanonicalMiaodaAppBindingPort
{
  deepLinkForWorkItem(workItemId: string) {
    return {
      bindingStatus: 'VERIFIED_CANONICAL' as const,
      appId: APP_ID,
      origin: ORIGIN,
      deepLink: `${ORIGIN}/work-items/${encodeURIComponent(workItemId)}/documents`,
    };
  }
}
