import type { CanonicalMiaodaAppBindingPort } from './canonical-host.types';

export class UnconfiguredCanonicalMiaodaAppBindingAdapter implements CanonicalMiaodaAppBindingPort {
  deepLinkForWorkItem(_workItemId: string): never {
    throw new Error('CANONICAL_MIAODA_APP_BINDING_UNCONFIGURED');
  }
}
