import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';
import type { LcmSourceReadAuthorization, LcmSourceReadGrant } from './lcm-source-reading.port';
import { LcmPersonalSourceRepository } from './lcm-personal-source.repository';

/** Reads actual owner registrations and their current revision; no role or same-tenant inference. */
export class LcmHostSourceReadAuthorization implements LcmSourceReadAuthorization {
  readonly available: boolean = true;
  constructor(private readonly sources: LcmPersonalSourceRepository) {}
  authorize(actor: CanonicalMiaodaFinalUserActorContext): Promise<LcmSourceReadGrant> {
    return this.sources.authorize(actor);
  }
}
