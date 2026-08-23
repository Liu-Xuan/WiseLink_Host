import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { CANONICAL_MIAODA_APP_ID } from '../canonical-host/canonical-host.constants';
import type {
  CanonicalGrantableObjectAccessAction,
  CanonicalMiaodaFinalUserActorContext,
  CanonicalObjectAccessDenied,
  CanonicalObjectAccessGrant,
  CanonicalObjectAccessInput,
  CanonicalObjectAccessPort,
  CanonicalObjectAccessResult,
} from './canonical-object-access.port';
import {
  MiaodaWorkItemRepository,
  type WorkItemAuthorizationBinding,
} from './miaoda-work-item.repository';

@Injectable()
// WorkItemRuntimeModule supplies this adapter through an explicit factory so
// the repository dependency remains visible in module wiring.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaHostedCanonicalObjectAccessAdapter implements CanonicalObjectAccessPort {
  constructor(
    @Inject(MiaodaWorkItemRepository)
    private readonly workItems: MiaodaWorkItemRepository,
  ) {}

  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessResult> {
    if (!hostedNativeActor(input.actor)) {
      return denied(input, 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', 503);
    }
    if (input.accessRoot.kind === 'REVIEW_CONVERSATION') {
      return denied(
        input,
        'CANONICAL_REVIEW_CONVERSATION_SOURCE_UNAVAILABLE',
        503,
      );
    }
    if (
      input.action === 'REQUEST_RESEARCH' ||
      input.action === 'READ_SOURCE_REFS'
    ) {
      return denied(input, 'CANONICAL_SOURCE_VISIBILITY_UNAVAILABLE', 503);
    }
    if (input.action === 'READ_ATTACHMENT') {
      return denied(input, 'CANONICAL_ATTACHMENT_BINDING_UNAVAILABLE', 503);
    }
    if (
      input.action === 'ISSUE_ATTACHMENT_INTAKE' ||
      input.action === 'COMMIT_ATTACHMENT_INTAKE'
    ) {
      return denied(input, 'CANONICAL_SESSION_PROVENANCE_UNAVAILABLE', 503);
    }
    if (
      input.action === 'INGEST_ATTACHMENT_SINGLE_REQUEST' &&
      !validExpectedRevision(input)
    ) {
      return denied(input, 'CANONICAL_WORK_ITEM_REVISION_REQUIRED', 409);
    }

    const binding = await this.workItems.loadAuthorizationBinding({
      workItemId: input.accessRoot.id,
      tenantId: input.actor.tenantId,
      actorUserId: input.actor.canonicalSubject.id,
    });
    if (!ownedBindingMatches(binding, input.actor, input.accessRoot.id)) {
      return denied(input, 'CANONICAL_WORK_ITEM_NOT_FOUND', 404);
    }
    if (
      input.action === 'INGEST_ATTACHMENT_SINGLE_REQUEST' &&
      binding.revision !== input.expectedWorkItemRevision
    ) {
      return denied(input, 'CANONICAL_WORK_ITEM_REVISION_MISMATCH', 409);
    }
    return grant(input.actor, grantableAction(input.action), binding);
  }
}

function hostedNativeActor(
  actor: CanonicalObjectAccessInput['actor'],
): actor is CanonicalMiaodaFinalUserActorContext {
  return (
    actor.principalKind === 'FINAL_USER' &&
    actor.transport === 'MIAODA_AUTHENTICATED_HTTP' &&
    actor.canonicalSubject.namespace === 'MIAODA_USER_ID' &&
    actor.canonicalSubject.id.trim().length > 0 &&
    actor.identityProvenance === 'MIAODA_GATEWAY_USER_CONTEXT' &&
    actor.subjectDecision.source === 'MIAODA_GATEWAY_USER_CONTEXT' &&
    actor.subjectDecision.applicationScopeId === actor.applicationScopeId &&
    actor.subjectDecision.tenantId === actor.tenantId &&
    actor.subjectDecision.version === 'miaoda-hosted-native-sso.v1' &&
    actor.applicationScopeProvenance === 'MIAODA_GATEWAY_APP_CONTEXT' &&
    actor.applicationScopeId === CANONICAL_MIAODA_APP_ID &&
    (actor.env === 'preview' || actor.env === 'runtime') &&
    actor.workspaceId === null &&
    actor.workspaceProvenance === 'UNAVAILABLE' &&
    actor.feishuUserId === null &&
    actor.feishuOpenId === null &&
    actor.feishuIdentityProvenance === 'UNAVAILABLE' &&
    actor.sessionId === null &&
    actor.sessionRevision === null &&
    actor.sessionProvenance === 'UNAVAILABLE'
  );
}

function grant(
  actor: CanonicalMiaodaFinalUserActorContext,
  action: CanonicalGrantableObjectAccessAction,
  binding: WorkItemAuthorizationBinding,
): CanonicalObjectAccessGrant {
  const actorFacts = {
    canonicalSubject: actor.canonicalSubject,
    tenantId: actor.tenantId,
    applicationScopeId: actor.applicationScopeId,
    applicationScopeProvenance: actor.applicationScopeProvenance,
    workspaceId: actor.workspaceId,
    workspaceProvenance: actor.workspaceProvenance,
    env: actor.env,
    identityProvenance: actor.identityProvenance,
    subjectDecision: {
      source: actor.subjectDecision.source,
      applicationScopeId: actor.subjectDecision.applicationScopeId,
      tenantId: actor.subjectDecision.tenantId,
      version: actor.subjectDecision.version,
    },
  };
  const actionPolicy = {
    action,
    objectRelation: 'OWNER' as const,
    source: 'HOST_SERVER_ACTION_POLICY' as const,
    requiredPlatformRoles: [] as readonly string[],
    platformRoleEvaluation: 'NOT_REQUIRED' as const,
    policyRevision: 'creator-only.v1' as const,
  };
  const actorFingerprint = digest(JSON.stringify(actorFacts));
  const accessRevision = `work-item:${binding.revision}:creator-only.v1`;
  const authorizationFingerprint = digest(
    JSON.stringify({
      action,
      actor: actorFacts,
      accessRoot: { kind: 'WORK_ITEM', id: binding.workItemId },
      objectAuthorization: binding,
      actionPolicy,
      accessRevision,
    }),
  );
  return {
    allowed: true,
    action,
    accessRoot: { kind: 'WORK_ITEM', id: binding.workItemId },
    workItemId: binding.workItemId,
    workItemRevision: binding.revision,
    requestId: binding.requestId,
    documentVersionId: binding.documentVersionId,
    tenantId: binding.tenantId,
    applicationScopeId: actor.applicationScopeId,
    applicationScopeProvenance: actor.applicationScopeProvenance,
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    actorUserId: actor.canonicalSubject.id,
    canonicalSubject: actor.canonicalSubject,
    actorFingerprint,
    ownerFact: {
      isOwner: true,
      ownerUserId: binding.requestedByUserId,
      source: 'HOST_WORK_ITEM_REQUESTED_BY',
    },
    memberFact: { isMember: false, source: 'UNAVAILABLE' },
    actionPolicy,
    accessRevision,
    authorizationFingerprint,
    freshReadAt: new Date().toISOString(),
    auditProvenance: {
      identity: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScope: 'MIAODA_GATEWAY_APP_CONTEXT',
      workspace: 'UNAVAILABLE',
      objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY',
      memberAuthorization: 'UNAVAILABLE',
      session: 'UNAVAILABLE',
      correlationFieldsAreAuthorizationInputs: false,
      platformRolesAreObjectGrantInputs: false,
      platformRolesMayBeActionPolicyInputs: true,
    },
  };
}

function ownedBindingMatches(
  binding: WorkItemAuthorizationBinding | null,
  actor: CanonicalMiaodaFinalUserActorContext,
  workItemId: string,
): binding is WorkItemAuthorizationBinding {
  return Boolean(
    binding &&
    binding.workItemId === workItemId &&
    binding.tenantId === actor.tenantId &&
    binding.requestedByUserId === actor.canonicalSubject.id &&
    Number.isSafeInteger(binding.revision) &&
    binding.revision >= 0,
  );
}

function validExpectedRevision(input: CanonicalObjectAccessInput): boolean {
  return (
    'expectedWorkItemRevision' in input &&
    Number.isSafeInteger(input.expectedWorkItemRevision) &&
    Number(input.expectedWorkItemRevision) >= 0
  );
}

function grantableAction(
  action: CanonicalObjectAccessInput['action'],
): CanonicalGrantableObjectAccessAction {
  if (
    action === 'REQUEST_RESEARCH' ||
    action === 'READ_SOURCE_REFS' ||
    action === 'READ_ATTACHMENT' ||
    action === 'ISSUE_ATTACHMENT_INTAKE' ||
    action === 'COMMIT_ATTACHMENT_INTAKE'
  ) {
    throw new Error('MIAODA_HOSTED_ADAPTER_UNGRANTABLE_ACTION_REACHED');
  }
  return action;
}

function denied(
  input: CanonicalObjectAccessInput,
  code: CanonicalObjectAccessDenied['code'],
  statusCode: CanonicalObjectAccessDenied['statusCode'],
): CanonicalObjectAccessDenied {
  return {
    allowed: false,
    action: input.action,
    accessRoot: input.accessRoot,
    code,
    statusCode,
    denialSource: 'MIAODA_OBJECT_ACCESS',
  };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
