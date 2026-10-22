import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { CanonicalServiceScopeAuthorizationPort } from '../canonical-host/canonical-service-scope.authorization';
import {
  HostTdmsRuntimeReader,
  type TdmsRuntimeAuthority,
} from './tdms-runtime-reader.adapter';
import type {
  TdmsRuntimePrincipal,
  TdmsRuntimeTaskBinding,
} from './tdms-runtime-reader.port';
import {
  authenticateTdmsRuntimeDelegation,
  assertTdmsRuntimeReadContext,
  type TdmsSourceActor,
} from './tdms-runtime-delegation';
import { TdmsRuntimeReceiverRepository } from './tdms-runtime-receiver.repository';
import type { TdmsReceiverIdentityProfile } from './tdms-receiver-identity-profile';
import {
  assertReceiverMembers,
  receiverAuthority,
} from './tdms-receiver-authorization.validation';
import type {
  TdmsAction,
  TdmsImportMemberClaims,
  TdmsSourceAuthorization,
  TdmsSourceScope,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { sameScope } from './tdms-source.authorization';
import { canonical } from './tdms-source.validation';
import { TdmsProcessingSetService } from './tdms-processing-set.service';
import { SqlTdmsProcessingSetTransaction } from './tdms-processing-set.repository';
import type {
  TdmsProcessingSetAuthority,
  TdmsProcessingSetRepository,
} from './tdms-processing-set.types';
import { TdmsRuntimeReceiptRepository } from './tdms-runtime-receipt.repository';
import {
  tdmsRuntimeDocumentBindings,
  tdmsRuntimeDocumentRoots,
} from './tdms-runtime-document-roots';
import { TdmsRetainedRuntimeFacts } from './tdms-retained-runtime-facts';

/** One invocation, one handed transaction. Nested reader/set calls never open a
 * second connection; all source/selection fences last through the actual commit. */
export class TdmsRuntimeSession {
  readonly reader: HostTdmsRuntimeReader;
  readonly receipts: TdmsRuntimeReceiptRepository;
  private readonly receivers: TdmsRuntimeReceiverRepository;
  private readonly facts = new TdmsRetainedRuntimeFacts();
  private releasing = false;
  private authorityExpiresAt = Number.POSITIVE_INFINITY;
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    identityProfile: Pick<TdmsReceiverIdentityProfile, 'current'>,
    private readonly principal: TdmsRuntimePrincipal,
    private readonly invocation: TdmsRuntimeTaskBinding,
    allowUnjournaledReceipts = false,
    stage: 'METADATA' | 'EXECUTION' | 'SAVED_VERIFICATION' = 'METADATA',
  ) {
    this.receivers = new TdmsRuntimeReceiverRepository(
      database,
      identityProfile,
    );
    this.receipts = new TdmsRuntimeReceiptRepository(database);
    const repository: TdmsProcessingSetRepository = {
      transaction: (operation) =>
        operation(new SqlTdmsProcessingSetTransaction(database)),
    };
    const source: TdmsSourceAuthorization<TdmsSourceActor> = {
      available: true,
      authorizeImport: async () => {
        throw tdmsError('TDMS_RUNTIME_RETENTION_FORBIDDEN', 403);
      },
      catalogue: async () => {
        throw tdmsError('TDMS_RUNTIME_CATALOGUE_FORBIDDEN', 403);
      },
      authorize: async (actor, scope, action, context) => {
        assertTdmsRuntimeReadContext(actor, context);
        const current = await this.current(actor, scope, action);
        return {
          scope: current.scope,
          permissionRevision: current.permissionRevision,
        };
      },
    };
    const setAuthority: TdmsProcessingSetAuthority<TdmsSourceActor> = {
      available: true,
      compare: async () => {
        throw tdmsError('TDMS_RUNTIME_RETENTION_FORBIDDEN', 403);
      },
      assertScopeAccess: async ({ actor, scope, action, context }) => {
        if (action !== 'READ')
          throw tdmsError('TDMS_RUNTIME_RETENTION_FORBIDDEN', 403);
        assertTdmsRuntimeReadContext(actor, context);
        await this.current(actor, scope, 'READ_RECORD');
      },
      assertAccess: async ({
        actor,
        action,
        context,
        set,
        revisions,
        assertions,
      }) => {
        if (action !== 'READ')
          throw tdmsError('TDMS_RUNTIME_RETENTION_FORBIDDEN', 403);
        assertTdmsRuntimeReadContext(actor, context);
        const authority = await this.current(actor, set.scope, 'READ_RECORD');
        assertReceiverMembers(
          {
            records: revisions.map((value) => ({
              recordKind: value.record.recordKind,
              sourceRecordId: value.record.sourceRecordId,
            })),
            artifacts: [],
            relationIds: assertions.map(
              (value) => value.assertion.sourceRelationId,
            ),
            relatedDocumentVersionIds: [],
          },
          authority.decision.permittedMembers,
        );
        for (const revision of revisions) {
          if (
            !sameScope(revision.scope, set.scope) ||
            revision.record.relatedDocumentVersionIds.some(
              (id) => id !== this.invocation.documentVersionId,
            )
          )
            throw tdmsError('TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE', 403);
        }
      },
    };
    const authority: TdmsRuntimeAuthority = {
      authenticate: async (principal, binding) => {
        this.assertInvocation(principal, binding);
        return authenticateTdmsRuntimeDelegation({
          database,
          authorization,
          principal,
          binding,
          stage,
        });
      },
      resolveSelections: async (principal, binding) => {
        this.assertInvocation(principal, binding);
        const actor = await authenticateTdmsRuntimeDelegation({
          database,
          authorization,
          principal,
          binding,
          stage,
        });
        const bindings = await tdmsRuntimeDocumentBindings(database, binding);
        const groups = new Map<
          string,
          { scope: TdmsSourceScope; refs: string[] }
        >();
        for (const sourceBinding of bindings) {
          const sourceAuthority = await this.current(
            actor,
            sourceBinding.scope,
            'READ_RECORD',
          );
          const owner = {
            recordKind: 'MANUFACTURER_FILE',
            sourceRecordId: sourceBinding.sourceRecordId,
          };
          const claims: TdmsImportMemberClaims = {
            records: [owner],
            artifacts: [
              {
                memberId: sourceBinding.bindingId,
                sourceAttachmentId: sourceBinding.sourceAttachmentId,
                sourceAttachmentVersion: null,
                owners: [owner],
              },
            ],
            relationIds: [],
            relatedDocumentVersionIds: [],
          };
          assertReceiverMembers(
            claims,
            sourceAuthority.decision.permittedMembers,
          );
          const ref = await tdmsRuntimeDocumentRoots(database, sourceBinding);
          const key = canonical(sourceBinding.scope),
            group = groups.get(key) ?? { scope: sourceBinding.scope, refs: [] };
          if (!group.refs.includes(ref)) group.refs.push(ref);
          groups.set(key, group);
        }
        const selections = [];
        for (const group of groups.values())
          selections.push(
            ...(await this.facts.resolveSelections({
              binding,
              scope: group.scope,
              rootSourceRevisionRefs: group.refs,
              database,
            })),
          );
        return selections;
      },
      readProjectionFacts: (input) =>
        this.facts.readProjectionFacts({
          set: input.set,
          records: input.records,
          assertions: input.assertions,
          database,
        }),
      resolveSavedBinding: async (principal, taskContextRef) => {
        this.assertInvocation(principal, this.invocation);
        return this.receipts.savedBinding(taskContextRef, this.invocation);
      },
      assertSavedReadReceipt: async (principal, binding, evidence) => {
        this.assertInvocation(principal, binding);
        await this.receipts.assertReceipt(binding, evidence);
      },
      assertCurrentSnapshot: async (principal, input) => {
        // Recursive reconstruction runs all metadata checks but delegates its last
        // release to this outer assertion. This flag never leaves this transaction.
        if (this.releasing) return;
        this.releasing = true;
        try {
          for (const context of input.contexts) {
            const fresh = await this.reader.discover(
              principal,
              context.binding,
            );
            if (canonical(fresh) !== canonical(context))
              throw tdmsError('TDMS_RUNTIME_CONTEXT_CHANGED', 409);
            const actor = await authenticateTdmsRuntimeDelegation({
              database,
              authorization,
              principal,
              binding: context.binding,
              stage,
            });
            for (const selection of context.selections) {
              const current = await this.current(
                actor,
                selection.scope,
                'READ_RECORD',
              );
              if (
                !input.grants.some(
                  (grant) =>
                    sameScope(grant.scope, current.scope) &&
                    grant.permissionRevision === current.permissionRevision,
                )
              )
                throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
            }
          }
          for (const evidence of input.evidence ?? []) {
            const context = input.contexts.find(
              (value) =>
                value.binding.taskContextRef ===
                evidence.nativeReadReceipt.taskContextRef,
            );
            if (!context)
              throw tdmsError('TDMS_RUNTIME_RECEIPT_BINDING_MISMATCH', 409);
            await this.receipts.assertReceipt(
              context.binding,
              evidence,
              stage === 'SAVED_VERIFICATION' && !allowUnjournaledReceipts,
            );
            const field = evidence.nativeReadReceipt.fieldPaths[0];
            const index = /^content\.opinions\[(\d+)\]$/u.exec(
              field ?? '',
            )?.[1];
            if (index === undefined)
              throw tdmsError('TDMS_RUNTIME_FIELD_PROVENANCE_MISMATCH', 409);
            const scope = evidence.nativeScope.processingSetBinding.scope;
            const [row] = await database.execute<{
              opinion: unknown;
            }>(sql`SELECT
              jsonb_extract_path(data,'record','content','opinions',${index}) AS opinion
              FROM tdms_record_revision WHERE tenant_id=${scope.tenantId} AND source_key=${scope.sourceKey}
                AND source_instance_id=${scope.sourceInstanceId} AND scope_id=${scope.scopeId}
                AND source_revision_ref=${evidence.nativeReadReceipt.sourceRevisionRef}`);
            const opinion =
              typeof row?.opinion === 'string'
                ? JSON.parse(row.opinion)
                : row?.opinion;
            if (!row || canonical(opinion) !== evidence.excerpt)
              throw tdmsError('TDMS_RUNTIME_BODY_SUBSTITUTED', 409);
          }
          // The last awaited operation checks expiry and actual caller while all
          // selection/grant locks are still held by this handed transaction.
          const actor = await authenticateTdmsRuntimeDelegation({
            database,
            authorization,
            principal,
            binding: this.invocation,
            stage,
          });
          if (
            Math.min(this.authorityExpiresAt, actor.authorityExpiresAt) <=
            Date.now()
          )
            throw tdmsError('TDMS_RUNTIME_AUTHORITY_EXPIRED', 403);
        } finally {
          this.releasing = false;
        }
      },
    };
    this.reader = new HostTdmsRuntimeReader(
      new TdmsProcessingSetService(repository, setAuthority),
      repository,
      source,
      {
        assertRead: async (actor, id) => {
          if (
            id !== this.invocation.documentVersionId ||
            actor.canonicalSubject.id !== this.invocation.actorUserId
          )
            throw tdmsError('TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE', 403);
          await authenticateTdmsRuntimeDelegation({
            database,
            authorization,
            principal,
            binding: this.invocation,
          });
        },
      },
      authority,
    );
  }
  private assertInvocation(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ) {
    if (
      canonical(principal) !== canonical(this.principal) ||
      binding.tenantId !== this.invocation.tenantId ||
      binding.workItemId !== this.invocation.workItemId ||
      binding.documentVersionId !== this.invocation.documentVersionId ||
      binding.actorUserId !== this.invocation.actorUserId
    )
      throw tdmsError('TDMS_RUNTIME_TASK_BINDING_MISMATCH', 403);
  }
  private async current(
    actor: TdmsSourceActor,
    scope: TdmsSourceScope,
    action: TdmsAction,
  ) {
    if (
      action !== 'READ_RECORD' &&
      action !== 'READ_HISTORY' &&
      action !== 'READ_RELATIONS'
    )
      throw tdmsError('TDMS_RUNTIME_SOURCE_ACTION_FORBIDDEN', 403);
    const matches = (await this.receivers.authorities(actor, scope)).flatMap(
      (row) => {
        const current = receiverAuthority(row, actor, action);
        return current ? [current] : [];
      },
    );
    if (matches.length !== 1) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    const current = matches[0]!;
    this.authorityExpiresAt = Math.min(
      this.authorityExpiresAt,
      Date.parse(current.row.validUntil),
      Date.parse(current.row.grantValidUntil),
      Date.parse(current.decision.validUntil),
    );
    return current;
  }
}
