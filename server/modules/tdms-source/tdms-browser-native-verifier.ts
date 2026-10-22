import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import {
  parseAssessmentTdmsApprovalProvenance,
  parseAssessmentTdmsEvidence,
  type AssessmentTdmsNativeEvidence,
} from '@shared/assessment-tdms-evidence';
import type { TdmsRecordSummary } from '@shared/tdms-source.interface';
import type { CanonicalObjectAccessPort } from '../work-item/canonical-object-access.port';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import type { CanonicalServiceScopeAuthorizationPort } from '../canonical-host/canonical-service-scope.authorization';
import type { TdmsNativeTransactionInput } from '../canonical-host/tdms-native-evidence-verifier.port';
import {
  projectTdmsProcessingCohortContext,
  type TdmsApprovedOpinionReference,
} from '../canonical-host/tdms-approved-opinion-context';
import { TdmsRuntimeReceiverRepository } from './tdms-runtime-receiver.repository';
import { TdmsRuntimeReceiptRepository } from './tdms-runtime-receipt.repository';
import {
  TDMS_BOUND_SCHEMA,
  type TdmsReceiverIdentityProfile,
} from './tdms-receiver-identity-profile';
import {
  receiverAuthority,
  assertReceiverMembers,
} from './tdms-receiver-authorization.validation';
import type { TdmsReceiverAuthority } from './tdms-receiver.types';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import type { TdmsSourceActor } from './tdms-runtime-delegation';
import { authenticateTdmsSummaryDelegation } from './tdms-summary-delegation';
import { authenticateTdmsRecoveryDelegation } from './tdms-recovery-delegation';
import { TdmsRetainedRuntimeFacts } from './tdms-retained-runtime-facts';
import { tdmsSavedNativeContext } from './tdms-native-saved-work';
import {
  tdmsRuntimeDocumentBindings,
  tdmsRuntimeDocumentRoots,
} from './tdms-runtime-document-roots';
import { SqlTdmsProcessingSetTransaction } from './tdms-processing-set.repository';
import { processingSet } from './tdms-processing-set.validation';
import { processingSetFacts } from './tdms-processing-set.references';
import type { TdmsRuntimeRecordMetadata } from './tdms-runtime-reader.adapter';
import type { TdmsStoredRevisionMetadata } from './tdms-processing-set.types';
import type { TdmsRuntimeTaskBinding } from './tdms-runtime-reader.port';
import { canonical, identifier, object } from './tdms-source.validation';
import { tdmsError, type TdmsSourceScope } from './tdms-source.types';

type Input = Omit<TdmsNativeTransactionInput, 'evidence'> & {
  evidence: AssessmentTdmsNativeEvidence[];
};
const LIMITATIONS = [
  'SOURCE_DECLARED_ONLY',
  'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE',
  'NOT_CURRENT_HOST_FACT',
  'NO_ENGINEERING_ADOPTION',
  'EXECUTION_NOT_VERIFIED',
];

/** Authentic browser/summary saved consumers. All IO uses their handed SQL
 * transaction; this adapter never constructs a WorkItem principal or a READ. */
export class TdmsBrowserNativeVerifier {
  private readonly facts = new TdmsRetainedRuntimeFacts();
  constructor(
    private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly identityProfile: Pick<
      TdmsReceiverIdentityProfile,
      'current'
    >,
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async assertInTransaction(input: Input): Promise<void> {
    if (
      !input.database ||
      input.runtime ||
      Number(!!input.browserCaller) +
        Number(!!input.summaryCaller) +
        Number(!!input.recoveryCaller) !==
        1
    )
      fail('TDMS_NATIVE_AUTHENTIC_CALLER_REQUIRED', 403);
    const evidence = input.evidence.map(parseAssessmentTdmsEvidence);
    if (!evidence.length) return;
    const database = input.database;
    const invocation = await this.authenticate(input);
    let expiresAt = invocation.validUntil;
    const receivers = new TdmsRuntimeReceiverRepository(
      database,
      this.identityProfile,
    );
    const receipts = new TdmsRuntimeReceiptRepository(database);
    const authorities = new Map<string, TdmsReceiverAuthority>();
    const current = async (scope: TdmsSourceScope) => {
      if (scope.tenantId !== input.actor.tenantId)
        fail('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID', 403);
      const rows = await receivers.authorities(invocation.actor, scope);
      const decisions = rows.flatMap((row) => {
        const value = receiverAuthority(row, invocation.actor, 'READ_RECORD');
        return value ? [value] : [];
      });
      if (decisions.length !== 1) fail('TDMS_RECEIVER_ACTION_DENIED', 403);
      const value = decisions[0]!;
      const previous = authorities.get(canonical(scope));
      if (previous && previous.permissionRevision !== value.permissionRevision)
        fail('TDMS_SOURCE_PERMISSION_CHANGED');
      expiresAt = Math.min(
        expiresAt,
        Date.parse(value.row.validUntil),
        Date.parse(value.row.grantValidUntil),
        Date.parse(value.decision.validUntil),
      );
      authorities.set(canonical(scope), value);
      return value;
    };
    const tx = new SqlTdmsProcessingSetTransaction(database);
    for (const item of evidence) {
      const pin = item.nativeScope.processingSetBinding,
        sourceAuthority = await current(pin.scope);
      const context = await tdmsSavedNativeContext({
        database,
        evidence: item,
        actor: invocation.actor,
        caller: input,
        objectAccess: this.objectAccess,
      });
      const original = context.selections.find(
        (selection) =>
          sameScope(selection.scope, pin.scope) &&
          selection.processingFamilyRef === pin.processingFamilyRef,
      );
      if (
        !original ||
        original.setRevisionRef !== pin.setRevisionRef ||
        original.generation !== pin.generation ||
        !context.projection.selectedSetApprovedRefs.includes(item.evidenceRef)
      )
        fail('TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH');
      const head = await tx.processingSetHead(
        pin.scope,
        pin.processingFamilyRef,
      );
      if (
        !head ||
        head.selectedSetRevisionRef !== pin.setRevisionRef ||
        head.generation !== pin.generation
      )
        fail('TDMS_PROCESSING_SET_SELECTION_CHANGED');
      const stored = await tx.processingSet(pin.scope, pin.setRevisionRef);
      if (!stored) fail('TDMS_RUNTIME_PROCESSING_SET_UNAVAILABLE');
      const set = processingSet(stored);
      if (
        set.cohortRef !== pin.cohortRef ||
        set.processingObservationRef !== pin.processingObservationRef ||
        set.processingFamilyRef !== pin.processingFamilyRef ||
        !sameScope(set.scope, pin.scope)
      )
        fail('TDMS_RUNTIME_MEMBER_BINDING_MISMATCH');
      const roots = await this.roots(
        database,
        context.binding,
        pin.scope,
        sourceAuthority,
      );
      const selections = await this.facts.resolveSelections({
        binding: context.binding,
        scope: pin.scope,
        rootSourceRevisionRefs: roots,
        database,
      });
      const selected = selections.find(
        (value) =>
          value.setRevisionRef === pin.setRevisionRef &&
          value.generation === pin.generation,
      );
      if (
        !selected ||
        canonical([...selected.sourceRevisionRefs].sort()) !==
          canonical([...original.sourceRevisionRefs].sort())
      )
        fail('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH');
      const retained = await processingSetFacts(tx, set);
      assertReceiverMembers(
        {
          records: retained.revisions.map((value) => ({
            recordKind: value.record.recordKind,
            sourceRecordId: value.record.sourceRecordId,
          })),
          artifacts: [],
          relationIds: retained.assertions.map(
            (value) => value.assertion.sourceRelationId,
          ),
          relatedDocumentVersionIds: [],
        },
        sourceAuthority.decision.permittedMembers,
      );
      const records = retained.revisions.map(metadata);
      if (
        records.some((value) =>
          value.record.relatedDocumentVersionIds.some(
            (id) => id !== context.binding.documentVersionId,
          ),
        )
      )
        fail('TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE', 403);
      const projection = projectTdmsProcessingCohortContext({
        ...(await this.facts.readProjectionFacts({
          set,
          records,
          assertions: retained.assertions,
          database,
        })),
        sets: [set],
        selectedSetRevisionRefs: [set.setRevisionRef],
      });
      const locator = projection.opinions.find(
        (value) => value.evidenceRef === item.evidenceRef,
      );
      const cohort = projection.cohorts[0],
        member = cohort?.members.find(
          (value) => value.memberRef === pin.memberRef,
        );
      if (
        !locator ||
        locator.approval.mode !== 'EXACT_VERSION' ||
        !projection.selectedSetApprovedRefs.includes(item.evidenceRef) ||
        member?.status !== 'APPROVED' ||
        member.assessmentObservationRef !== pin.assessmentObservationRef ||
        !member.opinionRefs.includes(item.evidenceRef)
      )
        fail('TDMS_RUNTIME_OPINION_NOT_APPROVED');
      const record = records.find(
        (value) =>
          value.record.sourceRevisionRef === pin.assessmentObservationRef,
      );
      if (!record || !sameScope(record.scope, pin.scope))
        fail('TDMS_RUNTIME_STORED_IDENTITY_MISMATCH');
      const proof = object(record.opinionCollection);
      const approval = parseAssessmentTdmsApprovalProvenance(
        {
          captureRef: locator.approval.captureRef,
          evidencePath: 'rawFields.opinionCollection',
          mode: 'EXACT_VERSION',
          before: proof.before,
          after: proof.after,
          approvalSubject: proof.approvalSubject,
        },
        record.record,
      );
      const index = opinionIndex(locator, record);
      // Only after exact own approval/current membership can journal or source
      // body bytes cross the driver boundary. No new receipt is saved here.
      await current(pin.scope);
      await receipts.assertReceipt(context.binding, item, true);
      const rows = await database.execute<{ opinion: unknown }>(sql`SELECT
        jsonb_extract_path(data,'record','content','opinions',${String(index)}) AS opinion
        FROM tdms_record_revision WHERE tenant_id=${pin.scope.tenantId} AND source_key=${pin.scope.sourceKey}
          AND source_instance_id=${pin.scope.sourceInstanceId} AND scope_id=${pin.scope.scopeId}
          AND source_revision_ref=${pin.assessmentObservationRef}`);
      if (rows.length !== 1) fail('TDMS_RUNTIME_BODY_SUBSTITUTED');
      const opinion =
        typeof rows[0]!.opinion === 'string'
          ? JSON.parse(rows[0]!.opinion)
          : rows[0]!.opinion;
      const body = object(opinion);
      if (
        body.sourceSelector !== locator.sourceSelector ||
        canonical(body.author) !== canonical(locator.author) ||
        canonical(body.state) !== canonical(record.record.state)
      )
        fail('TDMS_RUNTIME_BODY_SUBSTITUTED');
      const contribution = member.opinionContributions.find(
        (value) => value.opinionRef === item.evidenceRef,
      );
      const reconstructed = parseAssessmentTdmsEvidence({
        kind: 'TDMS_NATIVE_RECORD',
        evidenceRef: locator.evidenceRef,
        title: record.record.title,
        versionLabel: record.record.sourceVersion.rawRevision,
        excerpt: canonical(opinion),
        nativeSource: {
          ...record.record,
          fieldSelectors: [
            { fieldPath: locator.fieldPath, selector: locator.sourceSelector },
          ],
        },
        nativeScope: {
          sourceRevisionRef: locator.assessment.sourceRevisionRef,
          fieldSelectors: [
            { fieldPath: locator.fieldPath, selector: locator.sourceSelector },
          ],
          ...(contribution ? { opinionContribution: contribution } : {}),
          grouping: 'SOURCE_DECLARED_BLOCK',
          limitations: LIMITATIONS,
          processingSetBinding: pin,
          approval,
        },
        nativeReadReceipt: item.nativeReadReceipt,
        ...(item.dialogueSource ? { dialogueSource: item.dialogueSource } : {}),
      });
      if (canonical(reconstructed) !== canonical(item))
        fail('TDMS_RUNTIME_BODY_SUBSTITUTED');
    }
    for (const authority of authorities.values())
      await current(authority.scope);
    const final = await this.authenticate(input);
    // No awaits after the final live identity/lease check. Source and selected
    // head locks remain held, and time-based grants cannot expire unnoticed.
    if (
      !Number.isFinite(expiresAt) ||
      Math.min(expiresAt, final.validUntil) <= Date.now()
    )
      fail('TDMS_NATIVE_AUTHORITY_EXPIRED', 403);
  }

  private async authenticate(
    input: Input,
  ): Promise<{ actor: TdmsSourceActor; validUntil: number }> {
    identifier(input.actor.actorUserId);
    identifier(input.actor.tenantId);
    let result: { actor: TdmsSourceActor; validUntil: number };
    if (input.recoveryCaller)
      result = await authenticateTdmsRecoveryDelegation({
        database: input.database,
        authorization: this.authorization,
        caller: input.recoveryCaller,
        actor: input.actor,
      });
    else if (input.summaryCaller?.kind === 'RUNTIME')
      result = await authenticateTdmsSummaryDelegation({
        database: input.database,
        authorization: this.authorization,
        caller: input.summaryCaller,
        actor: input.actor,
      });
    else {
      const host =
        input.summaryCaller?.kind === 'BROWSER'
          ? input.summaryCaller.actor
          : undefined;
      const actor = input.browserCaller?.actor ?? host?.objectAccessActor;
      if (!actor || !isHostedCanonicalFinalUserActor(actor))
        fail('TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED', 401);
      assertPublicActor(actor);
      if (
        host &&
        (host.userId !== actor.canonicalSubject.id ||
          host.tenantId !== actor.tenantId ||
          host.appId !== actor.applicationScopeId)
      )
        fail('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID', 403);
      result = { actor, validUntil: Number.POSITIVE_INFINITY };
    }
    const actor = result.actor,
      profile = this.identityProfile.current();
    if (
      actor.tenantId !== input.actor.tenantId ||
      actor.canonicalSubject.id !== input.actor.actorUserId ||
      actor.tenantId !== profile.tenantId ||
      actor.applicationScopeId !== 'app_17bzc551rsg'
    )
      fail('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID', 403);
    const [sqlIdentity] = await input.database.execute<{
      actorId: string | null;
      roleName: string;
      schemaName: string;
    }>(sql`
      SELECT current_setting('app.user_id',true) AS "actorId",current_user AS "roleName",current_schema() AS "schemaName"`);
    const role =
      actor.principalKind === 'FINAL_USER'
        ? 'authenticated_workspace_aadkpkjef3slu'
        : 'service_role_workspace_aadkpkjef3slu';
    if (
      sqlIdentity?.actorId !== actor.canonicalSubject.id ||
      sqlIdentity.roleName !== role ||
      sqlIdentity.schemaName !== TDMS_BOUND_SCHEMA
    )
      fail('TDMS_NATIVE_SQL_IDENTITY_MISMATCH', 401);
    const mappings = await input.database.execute<{
      id: string;
    }>(sql`SELECT id FROM identity_subject_mapping
      WHERE miaoda_user_id=${actor.canonicalSubject.id} AND miaoda_tenant_id=${actor.tenantId}
        AND expected_client_id=${profile.clientId} AND status='ACTIVE' FOR SHARE`);
    if (mappings.length !== 1)
      fail('TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH', 403);
    return result;
  }

  private async roots(
    database: PostgresJsDatabase,
    binding: TdmsRuntimeTaskBinding,
    scope: TdmsSourceScope,
    authority: TdmsReceiverAuthority,
  ) {
    const bindings = (
      await tdmsRuntimeDocumentBindings(database, binding)
    ).filter((value) => sameScope(value.scope, scope));
    const refs: string[] = [];
    for (const value of bindings) {
      const owner = {
        recordKind: 'MANUFACTURER_FILE',
        sourceRecordId: value.sourceRecordId,
      };
      assertReceiverMembers(
        {
          records: [owner],
          artifacts: [
            {
              memberId: value.bindingId,
              sourceAttachmentId: value.sourceAttachmentId,
              sourceAttachmentVersion: null,
              owners: [owner],
            },
          ],
          relationIds: [],
          relatedDocumentVersionIds: [],
        },
        authority.decision.permittedMembers,
      );
      const ref = await tdmsRuntimeDocumentRoots(database, value);
      if (!refs.includes(ref)) refs.push(ref);
    }
    if (!refs.length) fail('TDMS_RUNTIME_DOCUMENT_SOURCE_BINDING_INVALID');
    return refs;
  }
}

function opinionIndex(
  locator: TdmsApprovedOpinionReference,
  record: TdmsRuntimeRecordMetadata,
): number {
  const match = /^content\.opinions\[(0|[1-9]\d*)\]$/u.exec(locator.fieldPath),
    index = Number(match?.[1]);
  if (
    !match ||
    !Number.isSafeInteger(index) ||
    !record.fieldProvenance.some(
      (value) =>
        value.fieldPath === locator.fieldPath &&
        value.selector === locator.sourceSelector &&
        !!value.observationRef.trim(),
    )
  )
    fail('TDMS_RUNTIME_FIELD_PROVENANCE_MISMATCH');
  return index;
}
function metadata(
  value: TdmsStoredRevisionMetadata,
): TdmsRuntimeRecordMetadata {
  const r = value.record;
  const record: TdmsRecordSummary = {
    recordRef: r.recordRef,
    sourceRevisionRef: r.sourceRevisionRef,
    recordKind: r.recordKind,
    sourceRecordId: r.sourceRecordId,
    sourceKey: r.sourceKey,
    sourceInstanceId: r.sourceInstanceId,
    title: r.title,
    fileType: r.fileType,
    sourceVersion: r.sourceVersion,
    ...(r.businessVersion === undefined
      ? {}
      : { businessVersion: r.businessVersion }),
    state: r.state,
    authors: r.authors,
    observedAt: r.observedAt,
    capturedAt: r.capturedAt,
    coverage: r.coverage,
    relatedDocumentVersionIds: r.relatedDocumentVersionIds,
    fieldSelectors: r.fieldSelectors,
    sourceVerification: r.sourceVerification,
    currentness: r.currentness,
  };
  return structuredClone({
    scope: value.scope,
    record,
    captureRef: r.captureRef,
    sourceModifiedAt: r.sourceModifiedAt,
    ...(typeof r.rawFields.sourceModifiedRaw === 'string'
      ? { sourceModifiedRaw: r.rawFields.sourceModifiedRaw }
      : {}),
    opinionCollection: r.rawFields.opinionCollection ?? null,
    fieldProvenance: r.fieldProvenance,
  });
}
function fail(code: string, status = 409): never {
  throw tdmsError(code, status);
}
