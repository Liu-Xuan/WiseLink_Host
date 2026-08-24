import { Injectable } from '@nestjs/common';

import type {
  CanonicalObjectAccessInput,
  CanonicalObjectAccessPort,
  CanonicalObjectAccessResult,
} from './canonical-object-access.port';
import {
  UnavailableAilyObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} from './unavailable-canonical-object-access.adapters';

@Injectable()
// WorkItemRuntimeModule supplies this router through an explicit factory so
// every transport adapter is an observable Nest dependency.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class CanonicalObjectAccessRouter implements CanonicalObjectAccessPort {
  constructor(
    private readonly finalUser: CanonicalObjectAccessPort,
    private readonly unavailableAily: UnavailableAilyObjectAccessAdapter,
    private readonly unavailableService: UnavailableServiceObjectAccessAdapter,
    private readonly unavailableSession: UnavailableSessionObjectAccessAdapter,
  ) {}

  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessResult> {
    if (input.actor.principalKind === 'UNAVAILABLE') {
      if (
        input.actor.unavailableReason === 'AILY_FINAL_USER_HANDOFF_UNAVAILABLE'
      ) {
        return this.unavailableAily.freshRead(input);
      }
      return this.unavailableService.freshRead(input);
    }
    if (
      input.action === 'ISSUE_ATTACHMENT_INTAKE' ||
      input.action === 'COMMIT_ATTACHMENT_INTAKE'
    ) {
      return this.unavailableSession.freshRead(input);
    }
    return this.finalUser.freshRead(input);
  }
}
