import {
  HostTdmsRuntimeReader,
  type TdmsRuntimeAuthority,
} from '@server/modules/tdms-source/tdms-runtime-reader.adapter';
import { TdmsProcessingSetService } from '@server/modules/tdms-source/tdms-processing-set.service';
import { createSharedFoundationTdmsSourceAuthorization } from '@server/modules/tdms-source/tdms-shared-foundation.authorization';
import type {
  TdmsRuntimePrincipal,
  TdmsRuntimeTaskBinding,
} from '@server/modules/tdms-source/tdms-runtime-reader.port';
import type {
  TdmsProcessingSetRepository,
  TdmsProcessingSetTransaction,
  TdmsProcessingSetAuthority,
} from '@server/modules/tdms-source/tdms-processing-set.types';
import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsStoredRevision,
  TdmsStoredAssertion,
  TdmsStoredReceipt,
  TdmsPublicActor,
} from '@server/modules/tdms-source/tdms-source.types';
import type {
  TdmsRecordRevision,
  TdmsSourceContent,
} from '@shared/tdms-source.interface';
import type {
  TdmsOpinionAssessmentFact,
  TdmsOpinionSourceFact,
  TdmsProcessingCohortContextInput,
} from '@server/modules/canonical-host/tdms-approved-opinion-context';
import { canonical } from '@server/modules/tdms-source/tdms-source.validation';
import { projectTdmsProcessingCohortContext } from '@server/modules/canonical-host/tdms-approved-opinion-context';

const copy = <T>(v: T): T => structuredClone(v);
const coverage = () => ({
  status: 'COMPLETE' as const,
  readback: 'CONSISTENT' as const,
  gaps: [],
});
const version = () => ({
  rawRevision: 'A',
  rawIteration: '1',
  confirmation: 'SOURCE_DECLARED' as const,
});
const state = () => ({ rawCode: 'Estimated', rawName: 'Estimated' });
const endpoint = (ref: string) => ({
  kind: 'NATIVE_RECORD_REVISION' as const,
  sourceRevisionRef: ref,
});
const observation = (id: string, observedAt: string) => ({
  sourceRecordId: id,
  recordKind: 'ENGINEER_ASSESSMENT' as const,
  sourceVersion: version(),
  state: state(),
  sourceModifiedAt: '2026-10-01T00:00:00Z',
  observedAt,
  objectBinding: 'EXACT_CURRENT_DETAIL' as const,
  identitySelector: '#infoPageIdentityObjectIdentifier',
  stateSelector:
    '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
  versionSelector:
    '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value',
});

/** Constructed OFFLINE authorities and source facts. No production identity/IO/acceptance. */
export function tdmsRuntimeFixture(
  options: Partial<TdmsRuntimeTaskBinding> = {},
) {
  const binding: TdmsRuntimeTaskBinding = {
    tenantId: 'tenant-a',
    actorUserId: 'user-a',
    workItemId: 'work-a',
    documentVersionId: 'document-a',
    taskContextRef: 'task-a',
    ...options,
  };
  const scope = {
    tenantId: binding.tenantId,
    sourceKey: 'TDMS',
    sourceInstanceId: 'instance',
    scopeId: 'shared-source',
  };
  const principal: TdmsRuntimePrincipal = {
    actorUserId: binding.actorUserId,
    scope: {
      principalId: 'fixture-service',
      appId: 'fixture-app',
      tenantId: binding.tenantId,
      workItemId: binding.workItemId,
      authorizationFingerprint: 'fixture-verified-scope',
      automaticWorkItemLease: {
        requestId: 'fixture-request',
        actorUserId: binding.actorUserId,
        documentId: 'fixture-doc',
        documentVersionId: binding.documentVersionId,
        sourceArtifactId: 'fixture-artifact',
        sourceFileSha256: 'a'.repeat(64),
        sourceByteLength: 42,
        leaseGeneration: 1,
        leaseExpiresAt: '2027-01-01T00:00:00Z',
      },
    },
  };
  const actor: TdmsPublicActor = {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: binding.actorUserId },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: principal.scope.appId,
      tenantId: scope.tenantId,
      version: 'fixture-only',
      decidedAt: '2026-10-07T00:00:00Z',
    },
    tenantId: scope.tenantId,
    applicationScopeId: principal.scope.appId,
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'preview',
    platformRoles: [],
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
  const control = {
    authenticated: true,
    applicationAllowed: true,
    sourceAllowed: true,
    objectAllowed: true,
    documentAllowed: true,
    allowedDocumentIds: new Set([binding.documentVersionId]),
    permissionRevision: '1',
    bodyReads: 0,
    authorityCalls: 0,
    projectionReads: 0,
    onRevision: undefined as
      | undefined
      | ((ref: string) => void | Promise<void>),
    onReceipt: undefined as undefined | (() => void | Promise<void>),
    onProjection: undefined as undefined | (() => void | Promise<void>),
    onContextDecision: undefined as undefined | (() => void | Promise<void>),
    onDocumentRead: undefined as undefined | (() => void | Promise<void>),
  };
  const revisions = new Map<string, TdmsStoredRevision>(),
    assertions = new Map<string, TdmsStoredAssertion>(),
    bodies = new Map<string, TdmsSourceContent>(),
    receipts: TdmsStoredReceipt[] = [];
  const makeRecord = (
    ref: string,
    kind: TdmsRecordRevision['recordKind'],
  ): TdmsRecordRevision => ({
    recordRef: `record-${ref}`,
    sourceRevisionRef: ref,
    recordKind: kind,
    sourceRecordId:
      ref === 'a'
        ? 'OR:wt.change2.WTChangeOrder2:1'
        : ref === 'b'
          ? 'OR:wt.change2.WTChangeOrder2:2'
          : ref,
    sourceKey: scope.sourceKey,
    sourceInstanceId: scope.sourceInstanceId,
    title: `Retained ${ref}`,
    fileType: null,
    sourceVersion: version(),
    businessVersion: null,
    state: state(),
    authors: [],
    observedAt: '2026-10-06T09:00:00Z',
    capturedAt: '2026-10-06T09:01:00Z',
    coverage: coverage(),
    relatedDocumentVersionIds: [],
    fieldSelectors: [],
    sourceVerification: 'DECLARED_ONLY',
    currentness: 'SELECTED_HOST_OBSERVATION',
    captureRef: `capture-${ref}`,
    sourceModifiedAt: '2026-10-01T00:00:00Z',
    rawFields: {},
    content: {},
    fieldProvenance: [],
    artifacts: [],
    unreadAttachments: [],
    selectedHead: true,
  });
  for (const [ref, kind] of [
    ['source', 'MANUFACTURER_FILE'],
    ['processing', 'PROCESSING_SHEET'],
    ['a', 'ENGINEER_ASSESSMENT'],
    ['b', 'ENGINEER_ASSESSMENT'],
  ] as const) {
    const record = makeRecord(ref, kind);
    if (kind === 'ENGINEER_ASSESSMENT') {
      const selector = `#opinion-${ref}`;
      record.fieldSelectors = [{ fieldPath: 'content.opinions[0]', selector }];
      record.fieldProvenance = [
        {
          fieldPath: 'content.opinions[0]',
          selector,
          sourceModifiedAt: record.sourceModifiedAt,
          observationRef: `source-observation-${ref}`,
        },
      ];
      record.rawFields.opinionCollection = {
        schemaVersion: 'wiselink.tdms-opinion-collection.v1',
        mode: 'ESTIMATED_OPINION',
        reason: 'APPROVED_CURRENT_EXACT_VERSION',
        approvalSubject: {
          sourceRecordId: record.sourceRecordId,
          sourceVersion: version(),
        },
        before: observation(record.sourceRecordId, '2026-10-06T08:59:00Z'),
        after: observation(record.sourceRecordId, record.observedAt),
      };
      bodies.set(ref, {
        opinions: [
          {
            text: `Unique complete opinion ${ref}`,
            author: null,
            state: state(),
            conditions: [`Only if installed ${ref}`],
            requiredActions: [`Verify configuration ${ref}`],
            sourceSelector: selector,
          },
        ],
      });
      Object.defineProperty(record, 'content', {
        enumerable: true,
        configurable: true,
        get() {
          control.bodyReads++;
          return bodies.get(ref)!;
        },
      });
    }
    revisions.set(ref, { scope: copy(scope), record });
  }
  const source: TdmsOpinionSourceFact = {
    scope,
    recordRef: 'record-source',
    versions: [
      {
        recordRef: 'record-source',
        sourceRevisionRef: 'source',
        sourceRecordId: 'source',
        sourceVersion: version(),
        businessVersion: null,
      },
    ],
    latestness: [
      {
        assertionRef: 'latest-source',
        basis: 'SOURCE_VERSION_DIRECTORY',
        recordRef: 'record-source',
        sourceRevisionRef: 'source',
        coverage: coverage(),
      },
    ],
    assessmentCoverage: [],
  };
  const assessments: TdmsOpinionAssessmentFact[] = ['a', 'b'].map((ref) => {
    const record = revisions.get(ref)!.record;
    const raw = record.rawFields.opinionCollection as Record<string, unknown>;
    const approval = copy(raw) as unknown as NonNullable<
      TdmsOpinionAssessmentFact['approval']
    >;
    // Pure selector accepts normalized approval facts; exact stored proof remains separate.
    delete (approval as unknown as Record<string, unknown>).schemaVersion;
    return {
      scope,
      recordRef: record.recordRef,
      sourceRevisionRef: ref,
      sourceRecordId: record.sourceRecordId,
      sourceVersion: version(),
      businessVersion: null,
      recordKind: 'ENGINEER_ASSESSMENT',
      state: state(),
      captureRef: record.captureRef,
      observedAt: record.observedAt,
      sourceModifiedAt: record.sourceModifiedAt,
      coverage: coverage(),
      approval,
      validity: { status: 'ACTIVE', assertionRef: `valid-${ref}` },
      lane: {
        seriesRef: 'same-lane',
        professionalScope: 'ATA 27',
        assertionRef: `lane-${ref}`,
      },
      opinionFields: [
        { index: 0, sourceSelector: `#opinion-${ref}`, author: null },
      ],
    };
  });
  const mappings: TdmsProcessingCohortContextInput['mappings'] = ['a', 'b'].map(
    (ref) => {
      const exactScope = {
        kind: 'EXACT_SOURCE_VERSION_ASSESSMENT',
        sourceRevisionRef: 'source',
        assessmentRevisionRef: ref,
      };
      const relations = (
        [
          ['FILE_PROCESSING', `fp-${ref}`, 'source', 'processing'],
          ['PROCESSING_ASSESSMENT', `pa-${ref}`, 'processing', ref],
        ] as const
      ).map(([kind, id, from, to]) => {
        const assertion: TdmsStoredAssertion = {
          scope,
          assertion: {
            sourceRelationId: id,
            rawKind: kind,
            controlledKind: kind,
            selector: `#${id}`,
            observedAt: '2026-10-06T09:00:00Z',
            coverage: coverage(),
            scope: exactScope,
            completionEffect: 'UNSPECIFIED',
            changeClass: 'UNSPECIFIED',
            rawFields: {},
            relationRef: `relation-${id}`,
            assertionRef: id,
            captureRef: 'capture',
            from: endpoint(from),
            to: endpoint(to),
            authority: 'SOURCE_EXPLICIT',
            sourceVerification: 'DECLARED_ONLY',
          },
        };
        assertions.set(id, assertion);
        return {
          assertionRef: id,
          controlledKind: kind,
          from: endpoint(from),
          to: endpoint(to),
          authority: 'SOURCE_EXPLICIT' as const,
          coverage: coverage(),
          scope: exactScope,
          nativeScope: scope,
        };
      });
      return {
        scope,
        sourceRevisionRef: 'source',
        assessmentRevisionRef: ref,
        path: relations,
      };
    },
  );
  const set: TdmsProcessingRevisionSet = {
    schemaVersion: 'wiselink.tdms-processing-set.v1',
    scope,
    setRevisionRef: 'set-c1',
    processingFamilyRef: 'family',
    cohortRef: 'cohort-1',
    processingObservationRef: 'processing',
    familyIdentityEvidenceRefs: ['family-proof'],
    cohortIdentityEvidenceRefs: ['cohort-proof'],
    predecessorCohortRef: null,
    successionEvidenceRefs: [],
    supersedesSetRevisionRef: null,
    rootBindings: [
      {
        endpoint: endpoint('source'),
        fileProcessingAssertionRefs: ['fp-a', 'fp-b'],
        applicabilityEvidenceRefs: ['task-source-proof'],
      },
    ],
    rosterEvidenceRefs: ['roster-proof'],
    sourceRosterRevision: 'roster-1',
    captureRefs: ['capture'],
    observationWindow: {
      before: '2026-10-06T08:59:00Z',
      after: '2026-10-06T09:00:00Z',
    },
    membershipCoverage: 'COMPLETE',
    versionMappingCoverage: 'COMPLETE',
    approvedBodyCaptureCoverage: 'COMPLETE',
    approvalReadiness: 'ALL_APPROVED',
    sourceConsistency: 'ATOMIC',
    sourceTransactionRef: 'source-tx',
    currentness: 'CURRENT',
    currentnessEvidenceRefs: ['current-proof'],
    members: ['a', 'b'].map((ref) => ({
      memberRef: `member-${ref}`,
      assessmentFamilyRef: `family-${ref}`,
      assessmentBusinessRevisionKey: 'business-A',
      assessmentObservationRef: ref,
      membershipResolution: 'CONFIRMED',
      processingAssessmentAssertionRefs: [`pa-${ref}`],
      cohortMembershipEvidenceRefs: [`member-proof-${ref}`],
      assessmentSuccessionEvidenceRefs: [],
      expectedSourceRecordId: revisions.get(ref)!.record.sourceRecordId,
      gaps: [],
    })),
    gaps: [],
  };
  const head: TdmsProcessingSetHead = {
    scope,
    processingFamilyRef: 'family',
    selectedSetRevisionRef: set.setRevisionRef,
    generation: 1,
  };
  const retainedSets = new Map([[set.setRevisionRef, set]]);
  const facts: Omit<
    TdmsProcessingCohortContextInput,
    'sets' | 'selectedSetRevisionRefs'
  > = {
    sources: [source],
    assessments,
    mappings,
    contributions: [
      {
        scope,
        assessmentObservationRef: 'a',
        opinionIndex: 0,
        contributorRefs: ['engineer-1', 'engineer-2'],
        responsibilityRefs: ['responsible-27', 'responsible-31'],
        ataScopes: ['ATA 27', 'ATA 31'],
        assertionRefs: ['contribution-proof-a'],
      },
    ],
  };
  const tx: TdmsProcessingSetTransaction = {
    capture: async () => null,
    capturesBySourceRef: async () => [],
    recordHead: async () => null,
    revision: async (tenant, ref) => {
      await control.onRevision?.(ref);
      const value = revisions.get(ref);
      return value?.scope.tenantId === tenant ? value : null;
    },
    catalogue: async () => [],
    history: async () => [],
    relationHead: async () => null,
    relations: async () => [],
    saveRevision: async () => {
      throw new Error('unused');
    },
    saveAssertion: async () => {
      throw new Error('unused');
    },
    saveCapture: async () => {
      throw new Error('unused');
    },
    saveReceipt: async (receipt) => {
      receipts.push(copy(receipt));
      await control.onReceipt?.();
    },
    processingSet: async (s, ref) =>
      canonical(s) === canonical(scope)
        ? (retainedSets.get(ref) ?? null)
        : null,
    processingSetHead: async (s, family) =>
      canonical(s) === canonical(scope) && family === head.processingFamilyRef
        ? copy(head)
        : null,
    processingSetHistory: async () => [],
    processingAssertion: async (s, ref) =>
      canonical(s) === canonical(scope) ? (assertions.get(ref) ?? null) : null,
    insertProcessingSet: async (value) => {
      retainedSets.set(value.setRevisionRef, value);
    },
    selectProcessingSet: async () => {
      throw new Error('unused');
    },
  };
  const repository: TdmsProcessingSetRepository = {
    transaction: async (operation) => {
      const count = receipts.length;
      try {
        return await operation(tx);
      } catch (error) {
        receipts.splice(count);
        throw error;
      }
    },
  };
  const requireAccess = () => {
    if (
      !control.applicationAllowed ||
      !control.sourceAllowed ||
      !control.objectAllowed ||
      !control.authenticated
    )
      throw new Error('FIXTURE_ACCESS_REVOKED');
  };
  const setAuthority: TdmsProcessingSetAuthority = {
    available: true,
    assertScopeAccess: async () => requireAccess(),
    assertAccess: async () => requireAccess(),
    compare: async () => ({
      cohort: 'UNKNOWN',
      roster: 'UNKNOWN',
      evidenceRefs: [],
    }),
  };
  const sets = new TdmsProcessingSetService(repository, setAuthority);
  const permission = (allowed: boolean, authorityRef: string) => ({
    status: allowed ? ('ALLOWED' as const) : ('DENIED' as const),
    authorityRef,
    permissionRevision: control.permissionRevision,
  });
  const authorization = createSharedFoundationTdmsSourceAuthorization({
    readCurrentDecision: async (identity) => ({
      identity,
      applicationAdmission: permission(
        control.applicationAllowed,
        'application-authority',
      ),
      scopes: [
        {
          scope,
          sharedRead: permission(
            control.sourceAllowed,
            'shared-source-authority',
          ),
          importCapability: permission(false, 'import-authority'),
        },
      ],
    }),
    readCurrentContextDecision: async ({ identity, context }) => {
      await control.onContextDecision?.();
      return {
        identity,
        context,
        permission: permission(
          control.objectAllowed,
          'selected-object-authority',
        ),
      };
    },
  });
  const documents = {
    assertRead: async (_actor: TdmsPublicActor, documentVersionId: string) => {
      await control.onDocumentRead?.();
      if (
        !control.documentAllowed ||
        !control.allowedDocumentIds.has(documentVersionId)
      )
        throw new Error('FIXTURE_DOCUMENT_REVOKED');
    },
  };
  const authority: TdmsRuntimeAuthority = {
    assertCurrentSnapshot: async (actual, input) => {
      // Constructed fixture authority models one coordinated release snapshot.
      // Actual providers must supply equivalent authoritative consistency; not installed here.
      for (const context of input.contexts) {
        await authority.authenticate(actual, context.binding);
        await documents.assertRead(actor, context.binding.documentVersionId);
        for (const selected of context.selections) {
          const grant = await authorization.authorize(
            actor,
            selected.scope,
            'READ_RECORD',
            { workItemId: context.binding.workItemId },
          );
          if (
            !input.grants.some(
              (expected) => canonical(expected) === canonical(grant),
            )
          )
            throw new Error('TDMS_SOURCE_PERMISSION_CHANGED');
        }
      }
      const relatedDocuments = [
        ...new Set(
          [...revisions.values()].flatMap(
            (value) => value.record.relatedDocumentVersionIds,
          ),
        ),
      ];
      for (const id of relatedDocuments) await documents.assertRead(actor, id);
      // No awaits after the final synchronous snapshot comparison.
      requireAccess();
      if (
        !control.documentAllowed ||
        [binding.documentVersionId, ...relatedDocuments].some(
          (id) => !control.allowedDocumentIds.has(id),
        )
      )
        throw new Error('FIXTURE_DOCUMENT_REVOKED');
      const projection = projectTdmsProcessingCohortContext({
        ...facts,
        sets: [set],
        selectedSetRevisionRefs: [head.selectedSetRevisionRef],
      });
      for (const context of input.contexts) {
        if (canonical(context.projection) !== canonical(projection))
          throw new Error('TDMS_RUNTIME_CONTEXT_CHANGED');
        if (
          context.selections.some(
            (selected) =>
              selected.setRevisionRef !== head.selectedSetRevisionRef ||
              selected.generation !== head.generation,
          )
        )
          throw new Error('TDMS_PROCESSING_SET_SELECTION_CHANGED');
      }
      for (const evidence of input.evidence ?? []) {
        const proof = receipts.find(
          (value) =>
            value.receipt.receiptRef === evidence.nativeReadReceipt.receiptRef,
        );
        if (
          !proof ||
          canonical(proof.receipt) !== canonical(evidence.nativeReadReceipt) ||
          proof.actorId !== actual.actorUserId
        )
          throw new Error('FIXTURE_RECEIPT_NOT_FOUND');
        const ref = evidence.nativeSource.sourceRevisionRef;
        const field = evidence.nativeScope!.fieldSelectors[0]!.fieldPath;
        const index = Number(/^content\.opinions\[(\d+)\]$/u.exec(field)?.[1]);
        if (canonical(bodies.get(ref)?.opinions?.[index]) !== evidence.excerpt)
          throw new Error('TDMS_RUNTIME_BODY_SUBSTITUTED');
      }
    },
    authenticate: async (actual, task) => {
      control.authorityCalls++;
      if (
        !control.authenticated ||
        canonical(actual) !== canonical(principal) ||
        canonical(task) !== canonical(binding) ||
        !actual.scope.automaticWorkItemLease
      )
        throw new Error('FIXTURE_AUTHENTICATION_REQUIRED');
      return actor;
    },
    resolveSelections: async () => [
      { scope, processingFamilyRef: 'family', sourceRevisionRefs: ['source'] },
    ],
    readProjectionFacts: async () => {
      control.projectionReads++;
      await control.onProjection?.();
      return facts;
    },
    resolveSavedBinding: async (_principal, ref) => {
      if (ref !== binding.taskContextRef)
        throw new Error('FIXTURE_TASK_NOT_FOUND');
      return binding;
    },
    assertSavedReadReceipt: async (_principal, task, evidence) => {
      const actual = receipts.find(
        (value) =>
          value.receipt.receiptRef === evidence.nativeReadReceipt.receiptRef,
      );
      if (
        !actual ||
        actual.actorId !== task.actorUserId ||
        canonical(actual.receipt) !== canonical(evidence.nativeReadReceipt)
      )
        throw new Error('FIXTURE_RECEIPT_NOT_FOUND');
    },
  };
  const adapter = new HostTdmsRuntimeReader(
    sets,
    repository,
    authorization,
    documents,
    authority,
  );
  return {
    adapter,
    sets,
    repository,
    authorization,
    documents,
    authority,
    principal,
    actor,
    binding,
    scope,
    set,
    head,
    retainedSets,
    revisions,
    assertions,
    bodies,
    receipts,
    facts,
    control,
  };
}
