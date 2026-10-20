import { Injectable } from '@nestjs/common';
import { HostDecisionTdmsSourceAuthorization } from './tdms-source.authorization';
import { TdmsReceiverRepository } from './tdms-receiver.repository';
import {
  assertReceiverMembers,
  receiverAuthority,
} from './tdms-receiver-authorization.validation';
import { tdmsError } from './tdms-source.types';
import type {
  TdmsAction,
  TdmsPublicActor,
  TdmsSourceScope,
} from './tdms-source.types';
import { readContext } from './tdms-source.validation';
import type { TdmsReceiverAuthority } from './tdms-receiver.types';

@Injectable()
export class MiaodaTdmsSourceAuthorization extends HostDecisionTdmsSourceAuthorization {
  constructor(private readonly receivers: TdmsReceiverRepository) {
    super(
      async ({ actor, scope, action, context }) => {
        const reading = readContext(context);
        // A DVI restricts the existing read query; it grants no Source rights.
        // The service independently checks its current exact document policy.
        if (reading.matterId)
          throw tdmsError('TDMS_RECEIVER_CONTEXT_AUTHORITY_UNCONFIGURED', 503);
        return (await receivers.authorities(actor, scope)).flatMap((row) => {
          const value = receiverAuthority(row, actor, action);
          return value
            ? [
                {
                  scope: value.scope,
                  permissionRevision: value.permissionRevision,
                  permittedMembers: structuredClone(
                    value.decision.permittedMembers,
                  ),
                },
              ]
            : [];
        });
      },
      async ({ actor, scope, claims, grant }) => {
        const current = await currentAuthority(
          receivers,
          actor,
          scope,
          'IMPORT',
        );
        if (current.permissionRevision !== grant.permissionRevision)
          throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
        assertReceiverMembers(claims, current.decision.permittedMembers);
        return {
          scope: current.scope,
          permissionRevision: current.permissionRevision,
          authorityRef: current.decision.authorityRef,
          captureRetentionAllowed: true,
          nativeProjectionAllowed: true,
          permittedMembers: structuredClone(current.decision.permittedMembers),
        };
      },
      async ({ actor, scope, action, claims, grant }) => {
        const current = await currentAuthority(receivers, actor, scope, action);
        if (current.permissionRevision !== grant.permissionRevision)
          throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
        assertReceiverMembers(claims, current.decision.permittedMembers);
        return {
          scope: current.scope,
          permissionRevision: current.permissionRevision,
          authorityRef: current.decision.authorityRef,
          retainedCaptureReadAllowed: true,
          permittedMembers: structuredClone(current.decision.permittedMembers),
        };
      },
    );
  }

  async bindings(actor: TdmsPublicActor): Promise<TdmsReceiverAuthority[]> {
    return (await this.receivers.authorities(actor)).flatMap((row) => {
      const authority = receiverAuthority(row, actor, 'CATALOGUE');
      return authority ? [authority] : [];
    });
  }

  current(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    action: TdmsAction,
  ): Promise<TdmsReceiverAuthority> {
    return currentAuthority(this.receivers, actor, scope, action);
  }
}

async function currentAuthority(
  receivers: TdmsReceiverRepository,
  actor: TdmsPublicActor,
  scope: TdmsSourceScope,
  action: TdmsAction,
): Promise<TdmsReceiverAuthority> {
  const matches = (await receivers.authorities(actor, scope)).flatMap((row) => {
    const value = receiverAuthority(row, actor, action);
    return value ? [value] : [];
  });
  if (matches.length !== 1) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
  return matches[0]!;
}
