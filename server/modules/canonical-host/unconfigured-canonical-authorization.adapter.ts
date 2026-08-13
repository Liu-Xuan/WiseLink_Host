import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
} from './canonical-host.types';

export class UnconfiguredCanonicalAuthorizationAdapter implements CanonicalAuthorizationPort {
  async authorize(_input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalAuthorizationDecision> {
    throw new Error('CANONICAL_AUTHORIZATION_NOT_CONFIGURED');
  }
}
