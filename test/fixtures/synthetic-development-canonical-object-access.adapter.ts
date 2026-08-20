import { createHash } from 'node:crypto';

import type {
  CanonicalGrantableObjectAccessAction,
  CanonicalMiaodaFinalUserActorContext,
  CanonicalObjectAccessDenied,
  CanonicalObjectAccessInput,
  CanonicalObjectAccessPort,
  CanonicalObjectAccessResult,
} from '../../server/modules/work-item/canonical-object-access.port';
import type {
  MiaodaWorkItemRepository,
  WorkItemAuthorizationBinding,
} from '../../server/modules/work-item/miaoda-work-item.repository';

/**
 * Test-only creator/revision fixture. It is never registered in a server
 * module and must not be used as evidence that a local Miaoda header is
 * authenticated by the hosted gateway.
 */
export class SyntheticDevelopmentCanonicalObjectAccessAdapter implements CanonicalObjectAccessPort {
  constructor(private readonly workItems: MiaodaWorkItemRepository) {}

  async freshRead(
    input: CanonicalObjectAccessInput,
  ): Promise<CanonicalObjectAccessResult> {
    if (!syntheticActor(input.actor)) {
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

export function syntheticMiaodaActorFixture(
  userId: string,
  tenantId: string,
  platformRoles: readonly string[] = [],
): CanonicalMiaodaFinalUserActorContext {
  return {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId,
      version: 'miaoda-user-context.v1',
      decidedAt: '2026-08-20T00:00:00.000Z',
    },
    tenantId,
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'synthetic-test',
    platformRoles,
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
}

function syntheticActor(
  actor: CanonicalObjectAccessInput['actor'],
): actor is CanonicalMiaodaFinalUserActorContext {
  return (
    actor.principalKind === 'FINAL_USER' &&
    actor.env === 'synthetic-test' &&
    actor.transport === 'MIAODA_AUTHENTICATED_HTTP' &&
    actor.canonicalSubject.namespace === 'MIAODA_USER_ID' &&
    actor.identityProvenance === 'MIAODA_GATEWAY_USER_CONTEXT' &&
    actor.subjectDecision.source === 'MIAODA_GATEWAY_USER_CONTEXT' &&
    actor.subjectDecision.applicationScopeId === actor.applicationScopeId &&
    actor.subjectDecision.tenantId === actor.tenantId &&
    actor.subjectDecision.version === 'miaoda-user-context.v1' &&
    actor.applicationScopeProvenance === 'MIAODA_GATEWAY_APP_CONTEXT' &&
    actor.applicationScopeId === 'app_17bzc551rsg' &&
    actor.workspaceId === null &&
    actor.workspaceProvenance === 'UNAVAILABLE'
  );
}

function grant(
  actor: CanonicalMiaodaFinalUserActorContext,
  action: CanonicalGrantableObjectAccessAction,
  binding: WorkItemAuthorizationBinding,
): CanonicalObjectAccessResult {
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
    throw new Error('SYNTHETIC_UNGRANTABLE_ACTION_REACHED');
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
