import { randomUUID } from 'node:crypto';
import { isTdmsApprovedOpinionReference } from '@shared/tdms-approved-opinion-reference';
import type { TdmsProcessingRevisionSet } from '@shared/tdms-processing-set.interface';
import type {
  TdmsReadContext,
  TdmsRecordRevision,
  TdmsRecordSummary,
} from '@shared/tdms-source.interface';
import {
  parseAssessmentTdmsEvidence,
  parseAssessmentTdmsApprovalProvenance,
} from '@shared/assessment-tdms-evidence';
import {
  projectTdmsProcessingCohortContext,
  type TdmsProcessingCohortContextInput,
  type TdmsApprovedOpinionReference,
} from '../canonical-host/tdms-approved-opinion-context';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import { processingSetFacts } from './tdms-processing-set.references';
import type { TdmsProcessingSetRepository } from './tdms-processing-set.types';
import { TdmsProcessingSetService } from './tdms-processing-set.service';
import type {
  TdmsDocumentAccess,
  TdmsPublicActor,
  TdmsSourceAuthorization,
  TdmsSourceGrant,
  TdmsStoredRevision,
  TdmsStoredAssertion,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import {
  assertTdmsRuntimeTaskContext,
  type TdmsRuntimePrincipal,
  type TdmsRuntimeTaskBinding,
  type TdmsRuntimeSelection,
  type TdmsRuntimeTaskContext,
  type TdmsRuntimeReadRequest,
  type TdmsRuntimeReaderPort,
  type TdmsRuntimeNativeEvidence,
  type TdmsRuntimeSavedNativeEvidence,
  type TdmsRuntimeNativeReadReceipt,
} from './tdms-runtime-reader.port';

type ProjectionFacts = Omit<
  TdmsProcessingCohortContextInput,
  'sets' | 'selectedSetRevisionRefs'
>;
export interface TdmsRuntimeRecordMetadata {
  scope: TdmsStoredRevision['scope'];
  record: TdmsRecordSummary;
  captureRef: string;
  sourceModifiedAt: string | null;
  sourceModifiedRaw?: string;
  opinionCollection: unknown;
  fieldProvenance: TdmsRecordRevision['fieldProvenance'];
}
/** INACTIVE authority seam. It must authenticate the real service transport, current
 * execution lease (or a genuine pre-reservation admission authority) and delegated
 * owner independently. Missing both admission and execution authority must deny.
 * An authorizationFingerprint is not a
 * transport or lease. Returning a fabricated FINAL_USER is expressly forbidden.
 * All proof references and exact task/source mapping must be checked at authority,
 * including fresh approval validity and contribution provenance. No default exists. */
export interface TdmsRuntimeAuthority {
  /** Required coordinated release boundary, last awaited operation before returning.
   * Atomically verify actual principal/delegation/lease, all exact task/source mappings,
   * selected heads, approval/member/contributor facts and current permission revisions.
   * When evidence is present, also verify its genuine receipts and exact retained
   * bodies under that same snapshot (or a genuinely enforced immutable-revision lease).
   * Metadata-only calls MUST NOT read bodies. If authority cannot provide this
   * boundary, fail closed; repeating independent cached checks is not sufficient. */
  assertCurrentSnapshot(
    principal: TdmsRuntimePrincipal,
    input: {
      contexts: TdmsRuntimeTaskContext[];
      grants: TdmsSourceGrant[];
      evidence?: TdmsRuntimeNativeEvidence[];
    },
  ): Promise<void>;
  authenticate(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ): Promise<TdmsPublicActor>;
  resolveSelections(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ): Promise<
    Array<
      Pick<
        TdmsRuntimeSelection,
        'scope' | 'processingFamilyRef' | 'sourceRevisionRefs'
      >
    >
  >;
  readProjectionFacts(input: {
    principal: TdmsRuntimePrincipal;
    binding: TdmsRuntimeTaskBinding;
    actor: TdmsPublicActor;
    set: TdmsProcessingRevisionSet;
    records: TdmsRuntimeRecordMetadata[];
    assertions: TdmsStoredAssertion[];
  }): Promise<ProjectionFacts>;
  /** Resolve the existing saved task identity, never infer it from a receipt string. */
  resolveSavedBinding(
    principal: TdmsRuntimePrincipal,
    taskContextRef: string,
  ): Promise<TdmsRuntimeTaskBinding>;
  /** Match the genuine saved receipt and exact evidence to the existing task journal
   * or tdms_read_receipt audit. A shape-valid caller-supplied receipt is not proof. */
  assertSavedReadReceipt(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
    evidence: TdmsRuntimeNativeEvidence,
  ): Promise<void>;
}
interface Snapshot {
  context: TdmsRuntimeTaskContext;
  actor: TdmsPublicActor;
  grants: TdmsSourceGrant[];
  records: TdmsRuntimeRecordMetadata[];
}
const LIMITATIONS = [
  'SOURCE_DECLARED_ONLY',
  'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE',
  'NOT_CURRENT_HOST_FACT',
  'NO_ENGINEERING_ADOPTION',
  'EXECUTION_NOT_VERIFIED',
];

/** Host-only producer, deliberately not registered in any production module.
 * Roster IO uses the real processing-set service and existing repository. No
 * body store, synthetic actor, Wiki receipt reuse or permission fallback. */
export class HostTdmsRuntimeReader implements TdmsRuntimeReaderPort {
  constructor(
    private readonly sets: TdmsProcessingSetService,
    private readonly repository: TdmsProcessingSetRepository,
    private readonly authorization: TdmsSourceAuthorization,
    private readonly documents: TdmsDocumentAccess,
    private readonly authority?: TdmsRuntimeAuthority,
  ) {}
  async discover(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ): Promise<TdmsRuntimeTaskContext> {
    return (await this.snapshot(principal, binding)).context;
  }
  async assertAuthorized(
    principal: TdmsRuntimePrincipal,
    contextValue: TdmsRuntimeTaskContext,
  ): Promise<void> {
    const context = assertTdmsRuntimeTaskContext(contextValue);
    this.sameContext(
      context,
      (await this.snapshot(principal, context.binding)).context,
    );
  }
  async read(principal: TdmsRuntimePrincipal, request: TdmsRuntimeReadRequest) {
    const context = assertTdmsRuntimeTaskContext(request.context);
    if (
      request.purpose !== 'JOB_AID_NATIVE_RECORD' ||
      request.taskContextRef !== context.binding.taskContextRef ||
      !Array.isArray(request.evidenceRefs) ||
      !request.evidenceRefs.length ||
      request.evidenceRefs.length > 256
    )
      fail('TDMS_RUNTIME_READ_INVALID');
    if (!request.evidenceRefs.every(isTdmsApprovedOpinionReference))
      fail('TDMS_RUNTIME_READ_INVALID');
    const refs = [...new Set(request.evidenceRefs)];
    const snapshot = await this.snapshot(principal, context.binding);
    this.sameContext(context, snapshot.context);
    const evidence = await this.repository.transaction(async (tx) => {
      const output: TdmsRuntimeNativeEvidence[] = [];
      for (const ref of refs) {
        const locator = this.locator(context, ref);
        // Gate and current audience/object authorization precede any content accessor.
        await this.recheck(principal, snapshot);
        const stored = await tx.revision(
          context.binding.tenantId,
          locator.assessment.sourceRevisionRef,
        );
        const receipt: TdmsRuntimeNativeReadReceipt = {
          receiptRef: `TDMS_READ:${randomUUID()}`,
          sourceRevisionRef: locator.assessment.sourceRevisionRef,
          readAt: new Date().toISOString(),
          purpose: 'JOB_AID_NATIVE_RECORD',
          fieldPaths: [locator.fieldPath],
          taskContextRef: context.binding.taskContextRef,
          readPerformed: true,
          permissionRevision: this.grant(snapshot, locator.scope)
            .permissionRevision,
          engineeringAdoption: 'NOT_CREATED',
          executionVerified: false,
        };
        // The retained lookup itself awaited IO; authorization may have changed there.
        await this.recheck(principal, snapshot);
        const native = this.evidence(snapshot, locator, stored, receipt);
        await this.recheck(principal, snapshot);
        await tx.saveReceipt({
          scope: locator.scope,
          actorId: snapshot.actor.canonicalSubject.id,
          receipt,
          context: readContext(context.binding),
        });
        await this.recheck(principal, snapshot);
        output.push(native);
      }
      return output;
    });
    // A late transaction/permission/head change cannot release an obsolete body.
    await this.verifySnapshotEvidence(principal, snapshot, evidence);
    return {
      evidence,
      receipts: evidence.map((value) => value.nativeReadReceipt),
    };
  }
  /** Conservative first slice: saved evidence remains bound to the currently selected
   * exact set/generation. If selection advances, historical native bodies are denied
   * even when retained, until an explicit frozen-history release authority is wired.
   * Never rebind an old receipt to the new cohort or issue a replacement READ here. */
  async verifyEvidence(
    principal: TdmsRuntimePrincipal,
    values: TdmsRuntimeSavedNativeEvidence[],
  ): Promise<void> {
    if (!this.authority)
      fail('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED', 503);
    if (!Array.isArray(values) || values.length > 4096)
      fail('TDMS_RUNTIME_EVIDENCE_INVALID');
    const grouped = new Map<string, TdmsRuntimeNativeEvidence[]>();
    for (const value of values) {
      const evidence = parseAssessmentTdmsEvidence(value);
      const taskRef = evidence.nativeReadReceipt.taskContextRef;
      grouped.set(taskRef, [...(grouped.get(taskRef) ?? []), evidence]);
    }
    const verified: Snapshot[] = [];
    for (const [taskContextRef, evidence] of grouped) {
      const binding = await this.authority.resolveSavedBinding(
        principal,
        taskContextRef,
      );
      if (binding.taskContextRef !== taskContextRef)
        fail('TDMS_RUNTIME_TASK_BINDING_MISMATCH');
      for (const value of evidence)
        await this.authority.assertSavedReadReceipt(principal, binding, value);
      const snapshot = await this.snapshot(principal, binding);
      await this.verifySnapshotEvidence(principal, snapshot, evidence);
      for (const value of evidence)
        await this.authority.assertSavedReadReceipt(principal, binding, value);
      verified.push(snapshot);
    }
    if (verified.length)
      await this.release(principal, verified, [...grouped.values()].flat());
  }
  private async snapshot(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ): Promise<Snapshot> {
    const actor = await this.authenticate(principal, binding);
    const requests = await this.authority!.resolveSelections(
      principal,
      binding,
    );
    if (!Array.isArray(requests) || requests.length > 16)
      fail('TDMS_RUNTIME_SELECTION_INVALID');
    const selected: TdmsProcessingRevisionSet[] = [],
      selections: TdmsRuntimeSelection[] = [],
      grants: TdmsSourceGrant[] = [],
      records: TdmsRuntimeRecordMetadata[] = [];
    const facts: ProjectionFacts = {
      sources: [],
      assessments: [],
      mappings: [],
      contributions: [],
      contradictions: [],
    };
    for (const request of requests) {
      if (
        request.scope.tenantId !== binding.tenantId ||
        !Array.isArray(request.sourceRevisionRefs) ||
        !request.sourceRevisionRefs.length ||
        new Set(request.sourceRevisionRefs).size !==
          request.sourceRevisionRefs.length
      )
        fail('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH');
      request.sourceRevisionRefs.forEach(identifier);
      const grant = await this.sourceAccess(actor, request.scope, binding);
      const current = await this.sets.readSelected(
        actor,
        request.scope,
        request.processingFamilyRef,
        readContext(binding),
      );
      if (!current) fail('TDMS_RUNTIME_PROCESSING_SET_UNAVAILABLE');
      const nativeRoots = current.set.rootBindings.flatMap((root) =>
        root.endpoint.kind === 'NATIVE_RECORD_REVISION'
          ? [root.endpoint.sourceRevisionRef]
          : [],
      );
      if (
        canonical([...nativeRoots].sort()) !==
          canonical([...request.sourceRevisionRefs].sort()) ||
        current.set.rootBindings.some(
          (root) =>
            root.endpoint.kind === 'DOCUMENT_VERSION' &&
            root.endpoint.documentVersionId !== binding.documentVersionId,
        )
      )
        fail('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH');
      const retained = await this.repository.transaction((tx) =>
        processingSetFacts(tx, current.set),
      );
      const metadata = retained.revisions.map(metadataOf);
      const projected = await this.authority!.readProjectionFacts({
        principal,
        binding,
        actor,
        set: current.set,
        records: metadata,
        assertions: retained.assertions.map(assertionMetadata),
      });
      this.assertFacts(
        current.set,
        request.sourceRevisionRefs,
        metadata,
        retained.assertions,
        projected,
      );
      selected.push(current.set);
      selections.push({
        ...request,
        setRevisionRef: current.head.selectedSetRevisionRef,
        generation: current.head.generation,
      });
      grants.push(grant);
      records.push(...metadata);
      for (const key of [
        'sources',
        'assessments',
        'mappings',
        'contributions',
        'contradictions',
      ] as const) {
        (facts[key] as unknown[]).push(...(projected[key] ?? []));
      }
    }
    // Shared source/proof metadata may repeat. Assessment duplication stays fail-closed;
    // never enumerate opinionFields before the pure selector's own approval gate.
    for (const key of [
      'sources',
      'mappings',
      'contributions',
      'contradictions',
    ] as const) {
      (facts as unknown as Record<string, unknown>)[key] = [
        ...new Map<string, unknown>(
          ((facts[key] ?? []) as readonly unknown[]).map((value) => [
            canonical(value),
            value,
          ]),
        ).values(),
      ];
    }
    const projection = projectTdmsProcessingCohortContext({
      ...facts,
      sets: selected,
      selectedSetRevisionRefs: selected.map((set) => set.setRevisionRef),
    });
    // Only the pure own-approval gate may reveal opinion field locators.
    for (const opinion of projection.opinions) {
      const stored = records.find(
        (value) =>
          sameScope(value.scope, opinion.scope) &&
          value.record.sourceRevisionRef ===
            opinion.assessment.sourceRevisionRef,
      );
      if (
        !stored?.record.fieldSelectors.some(
          (selector) =>
            selector.fieldPath === opinion.fieldPath &&
            selector.selector === opinion.sourceSelector,
        )
      )
        fail('TDMS_RUNTIME_FIELD_PROVENANCE_MISMATCH');
    }
    const context = structuredClone(
      assertTdmsRuntimeTaskContext({
        schemaVersion: 'wiselink.tdms-runtime-context.v1',
        binding,
        selections,
        projection,
      }),
    );
    const snapshot = { context, actor, grants, records };
    await this.recheck(principal, snapshot);
    return snapshot;
  }
  private async authenticate(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ) {
    if (!this.authority || !this.authorization.available)
      fail('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED', 503);
    if (
      !principal?.scope ||
      !binding ||
      principal.actorUserId !== binding.actorUserId ||
      principal.scope.tenantId !== binding.tenantId ||
      principal.scope.workItemId !== binding.workItemId
    )
      fail('TDMS_RUNTIME_PRINCIPAL_BINDING_MISMATCH');
    for (const value of [
      principal.scope.principalId,
      principal.scope.appId,
      principal.scope.authorizationFingerprint,
      ...Object.values(binding),
    ])
      identifier(value);
    const actor = await this.authority.authenticate(principal, binding);
    assertPublicActor(actor);
    if (
      actor.canonicalSubject.id !== binding.actorUserId ||
      actor.tenantId !== binding.tenantId ||
      actor.applicationScopeId !== principal.scope.appId
    )
      fail('TDMS_RUNTIME_DELEGATED_ACTOR_MISMATCH');
    return actor;
  }
  private async sourceAccess(
    actor: TdmsPublicActor,
    scope: TdmsRuntimeSelection['scope'],
    binding: TdmsRuntimeTaskBinding,
  ) {
    await this.documents.assertRead(actor, binding.documentVersionId);
    const grant = await this.authorization.authorize(
      actor,
      scope,
      'READ_RECORD',
      readContext(binding),
    );
    if (
      !grant ||
      !sameScope(grant.scope, scope) ||
      !grant.permissionRevision?.trim()
    )
      fail('TDMS_SOURCE_NOT_FOUND', 404);
    return grant;
  }
  private async recheck(
    principal: TdmsRuntimePrincipal,
    snapshot: Snapshot,
  ): Promise<void> {
    const actor = await this.authenticate(principal, snapshot.context.binding);
    for (const selection of snapshot.context.selections) {
      const grant = await this.sourceAccess(
        actor,
        selection.scope,
        snapshot.context.binding,
      );
      if (
        grant.permissionRevision !==
        this.grant(snapshot, selection.scope).permissionRevision
      )
        fail('TDMS_SOURCE_PERMISSION_CHANGED');
      const current = await this.sets.readSelected(
        actor,
        selection.scope,
        selection.processingFamilyRef,
        readContext(snapshot.context.binding),
      );
      if (
        !current ||
        current.head.generation !== selection.generation ||
        current.head.selectedSetRevisionRef !== selection.setRevisionRef
      )
        fail('TDMS_PROCESSING_SET_SELECTION_CHANGED');
    }
    // Recheck linked documents and actual delegation after the awaited set reads.
    for (const documentVersionId of new Set(
      snapshot.records.flatMap(
        (value) => value.record.relatedDocumentVersionIds,
      ),
    ))
      await this.documents.assertRead(actor, documentVersionId);
    await this.authenticate(principal, snapshot.context.binding);
    // Selected-set reads may have waited after the first permission decision.
    for (const selection of snapshot.context.selections) {
      const grant = await this.sourceAccess(
        actor,
        selection.scope,
        snapshot.context.binding,
      );
      if (
        grant.permissionRevision !==
        this.grant(snapshot, selection.scope).permissionRevision
      )
        fail('TDMS_SOURCE_PERMISSION_CHANGED');
    }
    await this.release(principal, [snapshot]);
  }
  private async release(
    principal: TdmsRuntimePrincipal,
    snapshots: Snapshot[],
    evidence?: TdmsRuntimeNativeEvidence[],
  ) {
    if (!this.authority?.assertCurrentSnapshot)
      fail('TDMS_RUNTIME_RELEASE_AUTHORITY_NOT_CONNECTED', 503);
    await this.authority.assertCurrentSnapshot(principal, {
      contexts: snapshots.map((value) => value.context),
      grants: snapshots.flatMap((value) => value.grants),
      ...(evidence === undefined ? {} : { evidence }),
    });
  }
  private sameContext(
    expected: TdmsRuntimeTaskContext,
    actual: TdmsRuntimeTaskContext,
  ) {
    if (canonical(expected) !== canonical(actual))
      fail('TDMS_RUNTIME_CONTEXT_CHANGED');
  }
  private grant(snapshot: Snapshot, scope: TdmsRuntimeSelection['scope']) {
    const grant = snapshot.grants.find((grant) =>
      sameScope(grant.scope, scope),
    );
    if (!grant) fail('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH');
    return grant;
  }
  private locator(context: TdmsRuntimeTaskContext, ref: string) {
    const locator = context.projection.opinions.find(
      (opinion) => opinion.evidenceRef === ref,
    );
    if (
      !locator ||
      !context.projection.selectedSetApprovedRefs.includes(ref) ||
      locator.approval.mode !== 'EXACT_VERSION'
    )
      fail('TDMS_RUNTIME_OPINION_NOT_APPROVED');
    const memberships = context.projection.cohorts.flatMap((cohort) =>
      cohort.members.filter(
        (member) =>
          member.status === 'APPROVED' && member.opinionRefs.includes(ref),
      ),
    );
    if (memberships.length !== 1) fail('TDMS_RUNTIME_MEMBER_BINDING_AMBIGUOUS');
    return locator;
  }
  private evidence(
    snapshot: Snapshot,
    locator: TdmsApprovedOpinionReference,
    stored: TdmsStoredRevision | null,
    receipt: TdmsRuntimeNativeReadReceipt,
  ): TdmsRuntimeNativeEvidence {
    if (
      !stored ||
      !sameScope(stored.scope, locator.scope) ||
      stored.record.sourceRevisionRef !==
        locator.assessment.sourceRevisionRef ||
      stored.record.sourceKey !== locator.scope.sourceKey ||
      stored.record.sourceInstanceId !== locator.scope.sourceInstanceId
    )
      fail('TDMS_RUNTIME_STORED_IDENTITY_MISMATCH');
    const metadata = snapshot.records.find(
      (value) =>
        sameScope(value.scope, locator.scope) &&
        value.record.sourceRevisionRef === locator.assessment.sourceRevisionRef,
    );
    if (!metadata || canonical(metadata) !== canonical(metadataOf(stored)))
      fail('TDMS_RUNTIME_STORED_METADATA_CHANGED');
    const cohort = snapshot.context.projection.cohorts.find(
      (cohort) =>
        sameScope(cohort.scope, locator.scope) &&
        cohort.members.some((member) =>
          member.opinionRefs.includes(locator.evidenceRef),
        ),
    )!;
    const member = cohort.members.find((member) =>
      member.opinionRefs.includes(locator.evidenceRef),
    )!;
    const selection = snapshot.context.selections.find(
      (selection) =>
        sameScope(selection.scope, cohort.scope) &&
        selection.setRevisionRef === cohort.setRevisionRef,
    )!;
    const index = Number(
      /^content\.opinions\[(\d+)\]$/u.exec(locator.fieldPath)?.[1],
    );
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !stored.record.fieldProvenance.some(
        (field) =>
          field.fieldPath === locator.fieldPath &&
          field.selector === locator.sourceSelector &&
          !!field.observationRef.trim(),
      )
    )
      fail('TDMS_RUNTIME_FIELD_PROVENANCE_MISMATCH');
    const proof = metadata.opinionCollection as Record<string, unknown>;
    const approval = parseAssessmentTdmsApprovalProvenance(
      {
        captureRef: locator.approval.captureRef,
        evidencePath: 'rawFields.opinionCollection',
        mode: 'EXACT_VERSION',
        before: proof.before,
        after: proof.after,
        approvalSubject: proof.approvalSubject,
      },
      metadata.record,
    );
    // This is the only opinion body access. All own-approval and mapping gates precede it.
    const opinion = stored.record.content.opinions?.[index];
    if (opinion) validateOpinion(opinion);
    if (
      !opinion ||
      opinion.sourceSelector !== locator.sourceSelector ||
      canonical(opinion.author) !== canonical(locator.author) ||
      canonical(opinion.state) !== canonical(stored.record.state)
    )
      fail('TDMS_RUNTIME_BODY_SUBSTITUTED');
    const evidence = {
      kind: 'TDMS_NATIVE_RECORD',
      evidenceRef: locator.evidenceRef,
      title: stored.record.title,
      versionLabel: stored.record.sourceVersion.rawRevision,
      excerpt: canonical(opinion),
      nativeSource: {
        ...metadata.record,
        fieldSelectors: [
          { fieldPath: locator.fieldPath, selector: locator.sourceSelector },
        ],
      },
      nativeScope: {
        sourceRevisionRef: locator.assessment.sourceRevisionRef,
        fieldSelectors: [
          { fieldPath: locator.fieldPath, selector: locator.sourceSelector },
        ],
        ...(member.opinionContributions.find(
          (value) => value.opinionRef === locator.evidenceRef,
        )
          ? {
              opinionContribution: member.opinionContributions.find(
                (value) => value.opinionRef === locator.evidenceRef,
              ),
            }
          : {}),
        grouping: 'SOURCE_DECLARED_BLOCK',
        limitations: [...LIMITATIONS],
        processingSetBinding: {
          scope: cohort.scope,
          setRevisionRef: cohort.setRevisionRef,
          generation: selection.generation,
          processingFamilyRef: cohort.processingFamilyRef,
          cohortRef: cohort.cohortRef,
          processingObservationRef: cohort.processingObservationRef,
          memberRef: member.memberRef,
          assessmentObservationRef: member.assessmentObservationRef,
        },
        approval,
      },
      nativeReadReceipt: receipt,
    };
    return parseAssessmentTdmsEvidence(evidence);
  }
  private async verifySnapshotEvidence(
    principal: TdmsRuntimePrincipal,
    snapshot: Snapshot,
    values: TdmsRuntimeNativeEvidence[],
  ) {
    const current = await this.snapshot(principal, snapshot.context.binding);
    this.sameContext(snapshot.context, current.context);
    for (const evidence of values) {
      parseAssessmentTdmsEvidence(evidence);
      const locator = this.locator(current.context, evidence.evidenceRef);
      if (
        evidence.nativeReadReceipt.permissionRevision !==
          this.grant(current, locator.scope).permissionRevision ||
        evidence.nativeReadReceipt.taskContextRef !==
          current.context.binding.taskContextRef
      )
        fail('TDMS_RUNTIME_RECEIPT_BINDING_MISMATCH');
      await this.repository.transaction(async (tx) => {
        const stored = await tx.revision(
          current.context.binding.tenantId,
          locator.assessment.sourceRevisionRef,
        );
        // Saved verification has the same post-lookup, pre-content boundary as READ.
        await this.recheck(principal, current);
        if (
          canonical(
            this.evidence(current, locator, stored, evidence.nativeReadReceipt),
          ) !== canonical(evidence)
        )
          fail('TDMS_RUNTIME_BODY_SUBSTITUTED');
      });
      await this.recheck(principal, current);
    }
    await this.release(principal, [current], values);
  }
  private assertFacts(
    set: TdmsProcessingRevisionSet,
    roots: string[],
    records: TdmsRuntimeRecordMetadata[],
    assertions: TdmsStoredAssertion[],
    facts: ProjectionFacts,
  ) {
    for (const value of records)
      if (
        !sameScope(value.scope, set.scope) ||
        value.record.sourceKey !== set.scope.sourceKey ||
        value.record.sourceInstanceId !== set.scope.sourceInstanceId
      )
        fail('TDMS_RUNTIME_FACT_IDENTITY_MISMATCH');
    const record = (ref: string) => {
      const value = records.find(
        (value) =>
          value.record.sourceRevisionRef === ref &&
          sameScope(value.scope, set.scope),
      );
      if (!value) fail('TDMS_RUNTIME_FACT_IDENTITY_MISMATCH');
      return value;
    };
    const sourceRefs: string[] = [];
    for (const source of facts.sources) {
      if (!sameScope(source.scope, set.scope))
        fail('TDMS_RUNTIME_FACT_IDENTITY_MISMATCH');
      for (const version of source.versions) {
        const stored = record(version.sourceRevisionRef).record;
        if (
          !roots.includes(version.sourceRevisionRef) ||
          source.recordRef !== stored.recordRef ||
          canonical(version) !== canonical(identity(stored))
        )
          fail('TDMS_RUNTIME_FACT_IDENTITY_MISMATCH');
        sourceRefs.push(version.sourceRevisionRef);
      }
    }
    if (canonical([...sourceRefs].sort()) !== canonical([...roots].sort()))
      fail('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH');
    const memberRefs = set.members.flatMap((member) =>
      member.assessmentObservationRef ? [member.assessmentObservationRef] : [],
    );
    if (
      canonical(
        facts.assessments.map((value) => value.sourceRevisionRef).sort(),
      ) !== canonical([...memberRefs].sort())
    )
      fail('TDMS_RUNTIME_MEMBER_BINDING_MISMATCH');
    for (const assessment of facts.assessments) {
      const stored = record(assessment.sourceRevisionRef);
      if (
        !sameScope(assessment.scope, set.scope) ||
        canonical(identity(assessment)) !==
          canonical(identity(stored.record)) ||
        assessment.recordKind !== stored.record.recordKind ||
        canonical(assessment.state) !== canonical(stored.record.state) ||
        assessment.captureRef !== stored.captureRef ||
        assessment.observedAt !== stored.record.observedAt ||
        assessment.sourceModifiedAt !== stored.sourceModifiedAt ||
        canonical(assessment.coverage) !== canonical(stored.record.coverage)
      )
        fail('TDMS_RUNTIME_FACT_IDENTITY_MISMATCH');
      const raw = stored.opinionCollection as Record<string, unknown> | null;
      // The provider may normalize away ingress-only selector fields, never replace own approval.
      if (
        canonical(normalizedApproval(assessment.approval)) !==
        canonical(normalizedApproval(raw))
      )
        fail('TDMS_RUNTIME_APPROVAL_SUBSTITUTED');
    }
    for (const mapping of facts.mappings) {
      if (
        !sameScope(mapping.scope, set.scope) ||
        !roots.includes(mapping.sourceRevisionRef) ||
        !memberRefs.includes(mapping.assessmentRevisionRef)
      )
        fail('TDMS_RUNTIME_MAPPING_MISMATCH');
      for (const path of mapping.path) {
        const stored = assertions.find(
          (value) => value.assertion.assertionRef === path.assertionRef,
        );
        if (!stored || canonical(path) !== canonical(mappingRelation(stored)))
          fail('TDMS_RUNTIME_MAPPING_MISMATCH');
      }
    }
    for (const fact of facts.contributions)
      if (
        !sameScope(fact.scope, set.scope) ||
        !memberRefs.includes(fact.assessmentObservationRef)
      )
        fail('TDMS_RUNTIME_CONTRIBUTION_MISMATCH');
  }
}
function fail(code: string, status = 409): never {
  throw tdmsError(code, status);
}
function readContext(binding: TdmsRuntimeTaskBinding): TdmsReadContext {
  return { workItemId: binding.workItemId };
}
function identity(
  record: Pick<
    TdmsRecordRevision,
    'recordRef' | 'sourceRevisionRef' | 'sourceRecordId' | 'sourceVersion'
  > & { businessVersion?: TdmsRecordRevision['businessVersion'] },
) {
  return {
    recordRef: record.recordRef,
    sourceRevisionRef: record.sourceRevisionRef,
    sourceRecordId: record.sourceRecordId,
    sourceVersion: record.sourceVersion,
    businessVersion: record.businessVersion ?? null,
  };
}
function metadataOf(value: TdmsStoredRevision): TdmsRuntimeRecordMetadata {
  const r = value.record;
  // Deliberate finite copy. Object spreading/destructuring a revision reads content getters.
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
function mappingRelation(value: TdmsStoredAssertion) {
  const r = value.assertion;
  return {
    assertionRef: r.assertionRef,
    controlledKind: r.controlledKind,
    from: r.from,
    to: r.to,
    authority: r.authority,
    coverage: r.coverage,
    scope: r.scope,
    nativeScope: value.scope,
  };
}
function assertionMetadata(value: TdmsStoredAssertion): TdmsStoredAssertion {
  const r = value.assertion;
  return {
    scope: value.scope,
    assertion: {
      sourceRelationId: r.sourceRelationId,
      rawKind: r.rawKind,
      controlledKind: r.controlledKind,
      selector: r.selector,
      observedAt: r.observedAt,
      coverage: r.coverage,
      scope: r.scope,
      completionEffect: r.completionEffect,
      changeClass: r.changeClass,
      relationRef: r.relationRef,
      assertionRef: r.assertionRef,
      captureRef: r.captureRef,
      from: r.from,
      to: r.to,
      authority: r.authority,
      sourceVerification: r.sourceVerification,
      rawFields: {},
    },
  };
}
function normalizedApproval(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const observation = (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      [
        'sourceRecordId',
        'sourceVersion',
        'businessVersion',
        'recordKind',
        'objectBinding',
        'state',
        'sourceModifiedAt',
        'sourceModifiedRaw',
        'observedAt',
      ]
        .filter((key) => Object.hasOwn(o, key))
        .map((key) => [key, o[key]]),
    );
  };
  return {
    mode: p.mode,
    reason: p.reason,
    approvalSubject: p.approvalSubject,
    before: observation(p.before),
    after: observation(p.after),
  };
}

function validateOpinion(value: unknown): void {
  const opinion = object(value);
  const keys = [
    'text',
    'author',
    'state',
    'conditions',
    'requiredActions',
    'sourceSelector',
  ];
  strict(opinion, keys);
  if (
    keys.some((key) => !Object.hasOwn(opinion, key)) ||
    typeof opinion.text !== 'string' ||
    !opinion.text.trim()
  )
    fail('TDMS_RUNTIME_BODY_INVALID');
  for (const key of ['conditions', 'requiredActions'])
    if (
      !Array.isArray(opinion[key]) ||
      (opinion[key] as unknown[]).some((value) => typeof value !== 'string')
    )
      fail('TDMS_RUNTIME_BODY_INVALID');
}
