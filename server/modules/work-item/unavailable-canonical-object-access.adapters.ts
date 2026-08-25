import { Injectable } from '@nestjs/common';

import type {
  CanonicalObjectAccessDenied,
  CanonicalObjectAccessInput,
  CanonicalObjectAccessPort,
} from './canonical-object-access.port';

/**
 * Explicit closed composition used when no platform-hosted native-user ingress
 * has constructed an eligible actor.
 */
// Retained as an explicit closed adapter for negative-path composition tests;
// the hosted runtime uses MiaodaHostedCanonicalObjectAccessAdapter instead.
export class UnavailableMiaodaBrowserObjectAccessAdapter implements CanonicalObjectAccessPort {
  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessDenied> {
    return unavailable(
      input,
      'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
    );
  }
}

/** No signed Aily/team-partner final-user handoff is available in this runtime. */
@Injectable()
export class UnavailableAilyObjectAccessAdapter implements CanonicalObjectAccessPort {
  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessDenied> {
    return unavailable(
      input,
      'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      'AILY_UNAVAILABLE_ADAPTER',
    );
  }
}

/** The current OpenAPI/MCP composition has no exact service scope or final user. */
@Injectable()
export class UnavailableServiceObjectAccessAdapter implements CanonicalObjectAccessPort {
  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessDenied> {
    return unavailable(
      input,
      'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      'SERVICE_UNAVAILABLE_ADAPTER',
    );
  }
}

/** Cross-request attachment intake cannot proceed without session revision/revoke. */
@Injectable()
export class UnavailableSessionObjectAccessAdapter implements CanonicalObjectAccessPort {
  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessDenied> {
    return unavailable(
      input,
      'CANONICAL_SESSION_PROVENANCE_UNAVAILABLE',
      'SESSION_UNAVAILABLE_ADAPTER',
    );
  }
}

function unavailable(
  input: CanonicalObjectAccessInput,
  code:
    | 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'
    | 'CANONICAL_SESSION_PROVENANCE_UNAVAILABLE',
  denialSource: CanonicalObjectAccessDenied['denialSource'],
): CanonicalObjectAccessDenied {
  return {
    allowed: false,
    action: input.action,
    accessRoot: input.accessRoot,
    code,
    statusCode: 503,
    denialSource,
  };
}
