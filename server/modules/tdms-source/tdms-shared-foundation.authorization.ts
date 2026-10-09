import type {
  TdmsReadContext,
  TdmsRecordKind,
} from '@shared/tdms-source.interface';
import {
  assertPublicActor,
  HostDecisionTdmsSourceAuthorization,
  sameScope,
  UnconfiguredTdmsSourceAuthorization,
} from './tdms-source.authorization';
import {
  tdmsError,
  type TdmsAction,
  type TdmsImportMemberClaims,
  type TdmsPublicActor,
  type TdmsSourceAuthorization,
  type TdmsSourceScope,
} from './tdms-source.types';
import {
  canonical,
  identifier,
  object,
  readContext,
  strict,
} from './tdms-source.validation';

/** Current server-side facts from the real application/source authority, not actor.roles,
 * a login, a package, a roster copied at login, or a display name. No provider is installed here. */
export interface TdmsSharedIdentity {
  tenantId: string;
  applicationScopeId: string;
  namespace: 'MIAODA_USER_ID';
  subjectId: string;
}
export interface TdmsCurrentPermission {
  status: 'ALLOWED' | 'DENIED';
  authorityRef: string;
  /** An actual authority revision, never fetchedAt or a locally generated timestamp. */
  permissionRevision: string;
}
export interface TdmsSharedFoundationDecision {
  identity: TdmsSharedIdentity;
  applicationAdmission: TdmsCurrentPermission;
  scopes: Array<{
    scope: TdmsSourceScope;
    sharedRead: TdmsCurrentPermission;
    /** Separate current operation capability. READ alone never enables IMPORT/CAS update. */
    importCapability: TdmsCurrentPermission;
  }>;
}
export interface TdmsSharedFoundationMembers {
  scope: TdmsSourceScope;
  authorityRef: string;
  permissionRevision: string;
  captureRetentionAllowed: true;
  nativeProjectionAllowed: true;
  records: Array<{ recordKind: TdmsRecordKind; sourceRecordId: string }>;
}
export interface TdmsSharedContextDecision {
  identity: TdmsSharedIdentity;
  context: TdmsReadContext;
  permission: TdmsCurrentPermission;
}
export interface TdmsSharedFoundationReaders {
  /** Re-evaluate current membership and scope sharing every call. Input has no roles or claims. */
  readCurrentDecision(identity: TdmsSharedIdentity): Promise<unknown>;
  /** Optional first slice: independent, exact source-member evidence; receives no package claims. */
  readCurrentImportMembers?(input: {
    identity: TdmsSharedIdentity;
    scope: TdmsSourceScope;
  }): Promise<unknown>;
  /** Required for any nonempty selected-object context; must freshly check its existing ACL. */
  readCurrentContextDecision?(input: {
    identity: TdmsSharedIdentity;
    context: TdmsReadContext;
  }): Promise<unknown>;
}

/** INACTIVE composition seam. Missing real authority stays Unconfigured; no production fallback.
 * Shared READ does not depend on capture actor. First-slice IMPORT remains metadata/opinion only. */
export function createSharedFoundationTdmsSourceAuthorization(
  readers?: TdmsSharedFoundationReaders,
): TdmsSourceAuthorization {
  if (!readers) return new UnconfiguredTdmsSourceAuthorization();

  const decide = async (
    actor: TdmsPublicActor,
    scope: TdmsSourceScope | undefined,
    action: TdmsAction,
    contextValue: TdmsReadContext,
  ) => {
    assertPublicActor(actor);
    if (
      ![
        'IMPORT',
        'CATALOGUE',
        'READ_RECORD',
        'READ_RELATIONS',
        'READ_HISTORY',
      ].includes(action)
    )
      throw tdmsError('TDMS_SHARED_ACTION_UNSUPPORTED', 403);
    const identity: TdmsSharedIdentity = {
      tenantId: actor.tenantId,
      applicationScopeId: actor.applicationScopeId,
      namespace: actor.canonicalSubject.namespace,
      subjectId: actor.canonicalSubject.id,
    };
    const context = readContext(contextValue);
    const raw = await readers.readCurrentDecision({ ...identity });
    if (raw === null || raw === undefined) return [];
    const decision = parseDecision(raw);
    if (
      canonical(decision.identity) !== canonical(identity) ||
      decision.applicationAdmission.status !== 'ALLOWED'
    )
      return [];

    let contextPermission: TdmsCurrentPermission | undefined;
    if (Object.keys(context).length) {
      if (!readers.readCurrentContextDecision)
        throw tdmsError('TDMS_SHARED_CONTEXT_AUTHORIZATION_UNCONFIGURED', 503);
      const rawContext = await readers.readCurrentContextDecision({
        identity: { ...identity },
        context: { ...context },
      });
      if (rawContext === null || rawContext === undefined) return [];
      const selected = parseContextDecision(rawContext);
      if (
        canonical(selected.identity) !== canonical(identity) ||
        canonical(selected.context) !== canonical(context) ||
        selected.permission.status !== 'ALLOWED'
      )
        return [];
      contextPermission = selected.permission;
    }

    const grants = [];
    for (const source of decision.scopes) {
      if (
        source.scope.tenantId !== identity.tenantId ||
        (scope && !sameScope(source.scope, scope)) ||
        source.sharedRead.status !== 'ALLOWED'
      )
        continue;
      let members: TdmsSharedFoundationMembers | undefined;
      if (action === 'IMPORT') {
        if (source.importCapability.status !== 'ALLOWED') continue;
        if (!readers.readCurrentImportMembers)
          throw tdmsError('TDMS_IMPORT_MEMBER_ADMISSION_UNCONFIGURED', 503);
        const rawMembers = await readers.readCurrentImportMembers({
          identity: { ...identity },
          scope: { ...source.scope },
        });
        if (rawMembers === null || rawMembers === undefined) continue;
        members = parseMembers(rawMembers);
        if (!sameScope(members.scope, source.scope)) continue;
      }
      // Compose existing authoritative revisions, not a new hash/permission authority.
      // Context/import dependencies affect only operations that actually require them.
      const permissionRevision = canonical([
        'shared-foundation-v1',
        identity,
        source.scope,
        decision.applicationAdmission,
        source.sharedRead,
        contextPermission ?? null,
        action === 'IMPORT' ? source.importCapability : null,
        members ? [members.authorityRef, members.permissionRevision] : null,
      ]);
      grants.push({ scope: { ...source.scope }, permissionRevision, members });
    }
    return grants;
  };

  return new HostDecisionTdmsSourceAuthorization(
    async ({ actor, scope, action, context }) =>
      (await decide(actor, scope, action, context)).map(
        ({ scope, permissionRevision }) => ({ scope, permissionRevision }),
      ),
    async ({ actor, scope, claims, grant }) => {
      const requested = parseClaims(claims);
      const current = (await decide(actor, scope, 'IMPORT', {}))[0];
      if (!current?.members) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      if (current.permissionRevision !== grant.permissionRevision)
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
      const approved = new Set(current.members.records.map(canonical));
      if (requested.some((record) => !approved.has(canonical(record))))
        throw tdmsError('TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED', 403);
      return {
        scope: current.scope,
        permissionRevision: current.permissionRevision,
        authorityRef: current.members.authorityRef,
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: {
          records: current.members.records.map((record) => ({ ...record })),
          artifacts: [],
          relationIds: [],
          relatedDocumentVersionIds: [],
        },
      };
    },
  );
}

function exact(value: unknown, keys: string[]) {
  const parsed = object(value);
  strict(parsed, keys);
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(parsed, key)))
    throw tdmsError('TDMS_INPUT_INVALID');
  return parsed;
}
function parseIdentity(value: unknown): TdmsSharedIdentity {
  const identity = exact(value, [
    'tenantId',
    'applicationScopeId',
    'namespace',
    'subjectId',
  ]);
  Object.values(identity).forEach(identifier);
  if (
    identity.namespace !== 'MIAODA_USER_ID' ||
    identity.subjectId === '-1' ||
    String(identity.subjectId).startsWith('service:')
  )
    throw tdmsError('TDMS_INPUT_INVALID');
  return identity as unknown as TdmsSharedIdentity;
}
function parsePermission(value: unknown): TdmsCurrentPermission {
  const permission = exact(value, [
    'status',
    'authorityRef',
    'permissionRevision',
  ]);
  identifier(permission.authorityRef);
  identifier(permission.permissionRevision);
  if (permission.status !== 'ALLOWED' && permission.status !== 'DENIED')
    throw tdmsError('TDMS_INPUT_INVALID');
  return permission as unknown as TdmsCurrentPermission;
}
function parseScope(value: unknown): TdmsSourceScope {
  const scope = exact(value, [
    'tenantId',
    'sourceKey',
    'sourceInstanceId',
    'scopeId',
  ]);
  Object.values(scope).forEach(identifier);
  if (scope.sourceKey !== 'TDMS') throw tdmsError('TDMS_INPUT_INVALID');
  return scope as unknown as TdmsSourceScope;
}
function parseDecision(value: unknown): TdmsSharedFoundationDecision {
  try {
    const decision = exact(structuredClone(value), [
      'identity',
      'applicationAdmission',
      'scopes',
    ]);
    if (!Array.isArray(decision.scopes) || decision.scopes.length > 200)
      throw tdmsError('TDMS_INPUT_INVALID');
    const scopes = Array.from(decision.scopes, (value) => {
      const entry = exact(value, ['scope', 'sharedRead', 'importCapability']);
      return {
        scope: parseScope(entry.scope),
        sharedRead: parsePermission(entry.sharedRead),
        importCapability: parsePermission(entry.importCapability),
      };
    });
    if (
      new Set(scopes.map((source) => canonical(source.scope))).size !==
      scopes.length
    )
      throw tdmsError('TDMS_INPUT_INVALID');
    return {
      identity: parseIdentity(decision.identity),
      applicationAdmission: parsePermission(decision.applicationAdmission),
      scopes,
    };
  } catch {
    throw tdmsError('TDMS_SHARED_DECISION_INVALID', 503);
  }
}
function parseContextDecision(value: unknown): TdmsSharedContextDecision {
  try {
    const selected = exact(structuredClone(value), [
      'identity',
      'context',
      'permission',
    ]);
    return {
      identity: parseIdentity(selected.identity),
      context: readContext(selected.context),
      permission: parsePermission(selected.permission),
    };
  } catch {
    throw tdmsError('TDMS_SHARED_CONTEXT_DECISION_INVALID', 503);
  }
}
function parseRecords(value: unknown): TdmsSharedFoundationMembers['records'] {
  if (!Array.isArray(value) || !value.length || value.length > 200)
    throw tdmsError('TDMS_INPUT_INVALID');
  const records = Array.from(value, (value) => {
    const record = exact(value, ['recordKind', 'sourceRecordId']);
    if (
      typeof record.recordKind !== 'string' ||
      ![
        'MANUFACTURER_FILE',
        'PROCESSING_SHEET',
        'ENGINEER_ASSESSMENT',
        'COMMENT',
        'ENGINEERING_FILE',
        'SOURCE_EVENT',
        'OBSERVATION',
      ].includes(record.recordKind)
    )
      throw tdmsError('TDMS_INPUT_INVALID');
    return {
      recordKind: record.recordKind as TdmsRecordKind,
      sourceRecordId: identifier(record.sourceRecordId),
    };
  });
  if (new Set(records.map(canonical)).size !== records.length)
    throw tdmsError('TDMS_INPUT_INVALID');
  return records.sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
function parseMembers(value: unknown): TdmsSharedFoundationMembers {
  try {
    const members = exact(structuredClone(value), [
      'scope',
      'authorityRef',
      'permissionRevision',
      'captureRetentionAllowed',
      'nativeProjectionAllowed',
      'records',
    ]);
    identifier(members.authorityRef);
    identifier(members.permissionRevision);
    if (
      members.captureRetentionAllowed !== true ||
      members.nativeProjectionAllowed !== true
    )
      throw tdmsError('TDMS_INPUT_INVALID');
    return {
      ...members,
      scope: parseScope(members.scope),
      records: parseRecords(members.records),
    } as TdmsSharedFoundationMembers;
  } catch {
    throw tdmsError('TDMS_SHARED_MEMBER_DECISION_INVALID', 503);
  }
}
function parseClaims(claims: TdmsImportMemberClaims) {
  try {
    const value = exact(structuredClone(claims), [
      'records',
      'artifacts',
      'relationIds',
      'relatedDocumentVersionIds',
    ]);
    for (const key of ['artifacts', 'relationIds', 'relatedDocumentVersionIds'])
      if (!Array.isArray(value[key]) || (value[key] as unknown[]).length)
        throw tdmsError('TDMS_INPUT_INVALID');
    return parseRecords(value.records);
  } catch {
    throw tdmsError('TDMS_SHARED_FIRST_SLICE_MEMBERS_UNSUPPORTED', 403);
  }
}
