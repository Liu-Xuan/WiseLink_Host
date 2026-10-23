import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { projectTdmsProcessingCohortContext, tdmsOpinionOwnApprovalMode } from '../canonical-host/tdms-approved-opinion-context';
import { assertTdmsSourceActor, type TdmsSourceActor } from './tdms-runtime-delegation';
import { TdmsRuntimeReceiverRepository } from './tdms-runtime-receiver.repository';
import type { TdmsReceiverIdentityProfile } from './tdms-receiver-identity-profile';
import { assertReceiverMembers, receiverAuthority } from './tdms-receiver-authorization.validation';
import { tdmsRuntimeDocumentBindings, tdmsRuntimeDocumentRoots } from './tdms-runtime-document-roots';
import { TdmsRetainedRuntimeFacts } from './tdms-retained-runtime-facts';
import { SqlTdmsProcessingSetTransaction } from './tdms-processing-set.repository';
import { processingSet } from './tdms-processing-set.validation';
import { processingSetFacts } from './tdms-processing-set.references';
import { tdmsRuntimeMetadataRecord } from './tdms-runtime-record-metadata';
import { sameScope } from './tdms-source.authorization';
import { canonical } from './tdms-source.validation';
import { tdmsError, type TdmsSourceScope } from './tdms-source.types';
import type { TdmsReceiverAuthority } from './tdms-receiver.types';
import type { TdmsReviewBinding } from './tdms-review-delegation';

/** Before an operationRef exists, verify only real finite document/Source facts.
 * This is not discover: no runtime context, body, READ receipt or attempt is made.
 * The caller owns this handed transaction and its already-authenticated identity.
 */
export async function assertTdmsReviewDocumentMetadata(input: {
  database: PostgresJsDatabase;
  binding: Readonly<TdmsReviewBinding>;
  actor: TdmsSourceActor;
  validUntil: number;
  identityProfile: Pick<TdmsReceiverIdentityProfile, 'current'>;
  reauthenticate: () => Promise<{ actor: TdmsSourceActor; validUntil: number }>;
}): Promise<void> {
  assertTdmsSourceActor(input.actor);
  const { database, binding } = input;
  if (input.actor.tenantId !== binding.tenantId ||
      input.actor.canonicalSubject.id !== binding.actorUserId)
    fail('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID', 403);
  const document = { tenantId: binding.tenantId, documentVersionId: binding.documentVersionId };
  const lineage = await tdmsRuntimeDocumentBindings(database, document);
  if (!lineage.length) fail('TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE', 403);
  const receivers = new TdmsRuntimeReceiverRepository(database, input.identityProfile);
  const authorities = new Map<string, TdmsReceiverAuthority>();
  let expiresAt = input.validUntil;
  const current = async (scope: TdmsSourceScope): Promise<TdmsReceiverAuthority> => {
    const decisions = (await receivers.authorities(input.actor, scope)).flatMap(row => {
      const decision = receiverAuthority(row, input.actor, 'READ_RECORD');
      return decision ? [decision] : [];
    });
    if (decisions.length !== 1) fail('TDMS_RECEIVER_ACTION_DENIED', 403);
    const value = decisions[0]!;
    const previous = authorities.get(canonical(scope));
    if (previous && previous.permissionRevision !== value.permissionRevision)
      fail('TDMS_SOURCE_PERMISSION_CHANGED');
    expiresAt = Math.min(expiresAt, Date.parse(value.row.validUntil),
      Date.parse(value.row.grantValidUntil), Date.parse(value.decision.validUntil));
    authorities.set(canonical(scope), value);
    return value;
  };
  const groups = new Map<string, { scope: TdmsSourceScope; roots: string[] }>();
  for (const source of lineage) {
    const authority = await current(source.scope);
    const owner = { recordKind: 'MANUFACTURER_FILE', sourceRecordId: source.sourceRecordId };
    assertReceiverMembers({ records: [owner], artifacts: [{ memberId: source.bindingId,
      sourceAttachmentId: source.sourceAttachmentId, sourceAttachmentVersion: null,
      owners: [owner] }], relationIds: [], relatedDocumentVersionIds: [] },
    authority.decision.permittedMembers);
    const root = await tdmsRuntimeDocumentRoots(database, source);
    const key = canonical(source.scope), group = groups.get(key) ?? { scope: source.scope, roots: [] };
    if (!group.roots.includes(root)) group.roots.push(root);
    groups.set(key, group);
  }
  const facts = new TdmsRetainedRuntimeFacts();
  const transaction = new SqlTdmsProcessingSetTransaction(database);
  let hasSelectedMembers=false,hasOwnApprovedAssessment=false;
  let allSelectedRostersComplete=true;
  for (const group of groups.values()) {
    const selections = await facts.resolveSelections({ binding: document, scope: group.scope,
      rootSourceRevisionRefs: group.roots, database });
    if (!selections.length) fail('TDMS_RUNTIME_PROCESSING_SET_UNAVAILABLE');
    for (const selection of selections) {
      const authority = await current(selection.scope);
      const head = await transaction.processingSetHead(selection.scope, selection.processingFamilyRef);
      if (!head || head.selectedSetRevisionRef !== selection.setRevisionRef ||
          head.generation !== selection.generation) fail('TDMS_PROCESSING_SET_SELECTION_CHANGED');
      const stored = await transaction.processingSet(selection.scope, selection.setRevisionRef);
      if (!stored) fail('TDMS_RUNTIME_PROCESSING_SET_UNAVAILABLE');
      const set = processingSet(stored);
      if (!sameScope(set.scope, group.scope) || set.processingFamilyRef !== selection.processingFamilyRef)
        fail('TDMS_RUNTIME_MEMBER_BINDING_MISMATCH');
      const retained = await processingSetFacts(transaction, set);
      assertReceiverMembers({ records: retained.revisions.map(value => ({
        recordKind: value.record.recordKind, sourceRecordId: value.record.sourceRecordId })),
        artifacts: [], relationIds: retained.assertions.map(value => value.assertion.sourceRelationId),
        relatedDocumentVersionIds: [] }, authority.decision.permittedMembers);
      const records = retained.revisions.map(tdmsRuntimeMetadataRecord);
      if (records.some(value => value.record.relatedDocumentVersionIds.some(
        id => id !== binding.documentVersionId))) fail('TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE', 403);
      const projectionFacts=await facts.readProjectionFacts({set,records,assertions:retained.assertions,database});
      const selectedAssessments=new Set(set.members.flatMap(member=>member.assessmentObservationRef?[member.assessmentObservationRef]:[]));
      hasSelectedMembers ||= set.members.length>0;
      allSelectedRostersComplete &&= set.membershipCoverage==='COMPLETE';
      hasOwnApprovedAssessment ||= projectionFacts.assessments.some(assessment=>
        sameScope(assessment.scope,set.scope) && selectedAssessments.has(assessment.sourceRevisionRef) &&
        tdmsOpinionOwnApprovalMode(assessment)!==null);
      const projection = projectTdmsProcessingCohortContext({
        ...projectionFacts,
        sets: [set], selectedSetRevisionRefs: [set.setRevisionRef],
      });
      // The ordinary projector applies each object's own approval gate. Draft
      // siblings stay metadata, and a valid selected set may expose no readable
      // opinions. Missing Source/set authority has already failed above; it is
      // never converted into an empty directory. Actual READ retains its stricter
      // selected-ref/member/approval checks in the existing runtime reader.
      const refs = projection.selectedSetApprovedRefs;
      if (refs.some(ref => !projection.opinions.some(opinion => opinion.evidenceRef === ref)))
        fail('TDMS_RUNTIME_OPINION_NOT_APPROVED');
    }
  }
  // Aggregate the actual selected members, not directory cardinality or later
  // mapping/validity status. A proved empty roster is legal; only-unapproved
  // members are not. Approved and draft siblings can coexist as metadata.
  if(hasSelectedMembers && !hasOwnApprovedAssessment) fail('TDMS_RUNTIME_OPINION_NOT_APPROVED');
  if(!hasSelectedMembers && !allSelectedRostersComplete) fail('TDMS_RUNTIME_PROCESSING_SET_UNAVAILABLE');
  for (const authority of authorities.values()) await current(authority.scope);
  const final = await input.reauthenticate();
  if (!Number.isFinite(expiresAt) || Math.min(expiresAt, final.validUntil) <= Date.now())
    fail('TDMS_NATIVE_AUTHORITY_EXPIRED', 403);
}
function fail(code: string, status = 409): never { throw tdmsError(code, status); }
