import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { TdmsProcessingRevisionSet } from '@shared/tdms-processing-set.interface';
import type { TdmsRecordSummary } from '@shared/tdms-source.interface';
import type {
  TdmsOpinionAssessmentFact,
  TdmsOpinionMappingFact,
  TdmsOpinionSourceFact,
  TdmsProcessingCohortContextInput,
} from '../canonical-host/tdms-approved-opinion-context';
import { isEstimatedState } from './tdms-assessment-body-policy';
import { sameScope } from './tdms-source.authorization';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import { processingSet } from './tdms-processing-set.validation';
import { processingSetFacts } from './tdms-processing-set.references';
import { SqlTdmsProcessingSetTransaction } from './tdms-processing-set.repository';
import type { TdmsStoredRevisionMetadata } from './tdms-processing-set.types';
import type { TdmsRuntimeRecordMetadata } from './tdms-runtime-reader.adapter';
import type {
  TdmsRuntimeSelection,
  TdmsRuntimeTaskBinding,
} from './tdms-runtime-reader.port';
import {
  tdmsError,
  type TdmsSourceScope,
  type TdmsStoredAssertion,
} from './tdms-source.types';

type Database = Pick<PostgresJsDatabase, 'execute'>;
type ProjectionFacts = Omit<
  TdmsProcessingCohortContextInput,
  'sets' | 'selectedSetRevisionRefs'
>;

/** Reads only retained Host facts under the caller's existing authorized transaction.
 * The runtime authority must first establish the real delegate, current Source
 * member grants and exact DM provenance for every root. This class grants no access
 * and creates no processing family, cohort, roster, relation or approval authority. */
export class TdmsRetainedRuntimeFacts {
  async resolveSelections(input: {
    binding: Pick<TdmsRuntimeTaskBinding,'tenantId'|'documentVersionId'>;
    scope: TdmsSourceScope;
    /** Exact native revision pins resolved from the task's verified DM acquisition. */
    rootSourceRevisionRefs: readonly string[];
    database: Database;
  }): Promise<TdmsRuntimeSelection[]> {
    const { binding, scope, rootSourceRevisionRefs: roots, database } = input;
    requireDatabase(database);
    Object.values(binding).forEach(identifier);
    Object.values(scope).forEach(identifier);
    if (
      binding.tenantId !== scope.tenantId ||
      !Array.isArray(roots) ||
      roots.length > 16
    )
      throw tdmsError('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH', 409);
    roots.forEach(identifier);
    if (new Set(roots).size !== roots.length)
      throw tdmsError('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH', 409);
    // Ordinary tasks without an exact TDMS acquisition never touch TDMS storage.
    if (!roots.length) return [];
    try {
      const rows = await database.execute<{ head: unknown; data: unknown }>(sql`
        SELECT h.data AS head,s.data AS data FROM tdms_processing_set_head h
        JOIN tdms_processing_revision_set s ON s.tenant_id=h.tenant_id
          AND s.source_key=h.source_key AND s.source_instance_id=h.source_instance_id
          AND s.scope_id=h.scope_id AND s.processing_family_ref=h.processing_family_ref
          AND s.set_revision_ref=h.selected_set_revision_ref
        WHERE h.tenant_id=${scope.tenantId} AND h.source_key=${scope.sourceKey}
          AND h.source_instance_id=${scope.sourceInstanceId} AND h.scope_id=${scope.scopeId}
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
            WHEN jsonb_typeof(s.data->'rootBindings')='array' THEN s.data->'rootBindings'
            ELSE '[]'::jsonb END) AS root
            WHERE root#>>'{endpoint,kind}'='NATIVE_RECORD_REVISION'
              AND root#>>'{endpoint,sourceRevisionRef}' IN (${sql.join(
                roots.map((ref) => sql`${ref}`),
                sql`, `,
              )}))
        ORDER BY h.processing_family_ref LIMIT 17`);
      if (rows.length > 16)
        throw tdmsError('TDMS_RUNTIME_SELECTION_LIMIT', 409);
      const output: TdmsRuntimeSelection[] = [];
      for (const row of rows) {
        const set = processingSet(decode(row.data));
        const head = object(decode(row.head));
        strict(head, [
          'scope',
          'processingFamilyRef',
          'selectedSetRevisionRef',
          'generation',
        ]);
        if (
          !sameScope(scope, set.scope) ||
          canonical(head.scope) !== canonical(scope) ||
          head.processingFamilyRef !== set.processingFamilyRef ||
          head.selectedSetRevisionRef !== set.setRevisionRef ||
          !Number.isSafeInteger(head.generation) ||
          Number(head.generation) < 1
        )
          throw tdmsError('TDMS_SET_HEAD_INVALID', 409);
        const nativeRoots = set.rootBindings.flatMap((root) =>
          root.endpoint.kind === 'NATIVE_RECORD_REVISION'
            ? [root.endpoint.sourceRevisionRef]
            : [],
        );
        if (
          !nativeRoots.length ||
          new Set(nativeRoots).size !== nativeRoots.length
        )
          throw tdmsError('TDMS_RUNTIME_SOURCE_BINDING_MISMATCH', 409);
        // A matching root never grants access to another root or another document.
        if (
          nativeRoots.some((ref) => !roots.includes(ref)) ||
          set.rootBindings.some(
            (root) =>
              root.endpoint.kind === 'DOCUMENT_VERSION' &&
              root.endpoint.documentVersionId !== binding.documentVersionId,
          )
        )
          continue;
        output.push({
          scope: structuredClone(scope),
          processingFamilyRef: set.processingFamilyRef,
          setRevisionRef: set.setRevisionRef,
          generation: Number(head.generation),
          sourceRevisionRefs: nativeRoots,
        });
      }
      return output;
    } catch (error) {
      throw storageError(error);
    }
  }

  async readProjectionFacts(input: {
    set: TdmsProcessingRevisionSet;
    records: TdmsRuntimeRecordMetadata[];
    assertions: TdmsStoredAssertion[];
    database: Database;
  }): Promise<ProjectionFacts> {
    requireDatabase(input.database);
    const set = processingSet(input.set);
    try {
      const tx = new SqlTdmsProcessingSetTransaction(input.database);
      const stored = await tx.processingSet(set.scope, set.setRevisionRef);
      if (!stored || canonical(processingSet(stored)) !== canonical(set))
        throw tdmsError('TDMS_RUNTIME_CONTEXT_CHANGED', 409);
      // Re-read using the supplied transaction. Metadata received before this
      // transaction cannot substitute for the currently retained exact revisions.
      const retained = await processingSetFacts(tx, set);
      const records = retained.revisions.map(runtimeMetadata);
      if (
        canonical(orderedRecords(records)) !==
          canonical(orderedRecords(input.records)) ||
        canonical(orderedAssertions(retained.assertions)) !==
          canonical(orderedAssertions(input.assertions))
      )
        throw tdmsError('TDMS_RUNTIME_STORED_METADATA_CHANGED', 409);
      return projectionFacts(set, records, retained.assertions);
    } catch (error) {
      throw storageError(error);
    }
  }
}

function projectionFacts(
  set: TdmsProcessingRevisionSet,
  records: TdmsRuntimeRecordMetadata[],
  assertions: TdmsStoredAssertion[],
): ProjectionFacts {
  const byRef = new Map(
    records.map((record) => [record.record.sourceRevisionRef, record]),
  );
  const exactRecord = (ref: string) => {
    const value = byRef.get(ref);
    if (!value || !sameScope(value.scope, set.scope))
      throw tdmsError('TDMS_SET_REFERENCE_INVALID', 409);
    return value;
  };
  const rootRefs = set.rootBindings.flatMap((root) =>
    root.endpoint.kind === 'NATIVE_RECORD_REVISION'
      ? [root.endpoint.sourceRevisionRef]
      : [],
  );
  const sources = new Map<string, TdmsOpinionSourceFact>();
  for (const ref of rootRefs) {
    const record = exactRecord(ref).record;
    const existing = sources.get(record.recordRef);
    const fact: TdmsOpinionSourceFact = existing ?? {
      scope: structuredClone(set.scope),
      recordRef: record.recordRef,
      versions: [],
      latestness: [],
      assessmentCoverage: [],
    };
    // A selected Host set is not an official source version directory or roster.
    fact.versions = [...fact.versions, identity(record)];
    sources.set(record.recordRef, fact);
  }
  const assessments: TdmsOpinionAssessmentFact[] = [];
  const mappings: TdmsOpinionMappingFact[] = [];
  for (const member of set.members) {
    if (!member.assessmentObservationRef) continue;
    const value = exactRecord(member.assessmentObservationRef);
    assessments.push({
      ...identity(value.record),
      scope: structuredClone(set.scope),
      recordKind: 'ENGINEER_ASSESSMENT',
      state: structuredClone(value.record.state),
      captureRef: value.captureRef,
      observedAt: value.record.observedAt,
      sourceModifiedAt: value.sourceModifiedAt,
      ...(value.sourceModifiedRaw === undefined
        ? {}
        : { sourceModifiedRaw: value.sourceModifiedRaw }),
      coverage: structuredClone(value.record.coverage),
      approval: approvalMetadata(value.opinionCollection),
      // TDMS Estimated is this assessment's native approval/validity state.
      // Keep its exact retained observation as provenance; own capture, version
      // and source applicability gates remain the projector's responsibility.
      validity:
        value.record.recordKind === 'ENGINEER_ASSESSMENT' &&
        isEstimatedState(value.record.state)
          ? { status: 'ACTIVE', assertionRef: value.record.sourceRevisionRef }
          : { status: 'UNKNOWN', assertionRef: null },
      lane: null,
      // The existing projector accesses locators only after the assessment's
      // independent own approval gate. Do not inspect pending opinion fields.
      get opinionFields() {
        return opinionFields(value);
      },
    });
    for (const root of set.rootBindings) {
      if (root.endpoint.kind !== 'NATIVE_RECORD_REVISION') continue;
      const sourceRef = root.endpoint.sourceRevisionRef;
      for (const first of assertions.filter((value) =>
        root.fileProcessingAssertionRefs.includes(value.assertion.assertionRef),
      )) {
        for (const second of assertions.filter((value) =>
          member.processingAssessmentAssertionRefs.includes(
            value.assertion.assertionRef,
          ),
        )) {
          const a = first.assertion,
            b = second.assertion;
          if (
            !sameScope(first.scope, set.scope) ||
            !sameScope(second.scope, set.scope) ||
            a.authority !== 'SOURCE_EXPLICIT' ||
            b.authority !== 'SOURCE_EXPLICIT' ||
            a.controlledKind !== 'FILE_PROCESSING' ||
            b.controlledKind !== 'PROCESSING_ASSESSMENT' ||
            a.from.kind !== 'NATIVE_RECORD_REVISION' ||
            a.from.sourceRevisionRef !== sourceRef ||
            a.to.kind !== 'NATIVE_RECORD_REVISION' ||
            a.to.sourceRevisionRef !== set.processingObservationRef ||
            b.from.kind !== 'NATIVE_RECORD_REVISION' ||
            b.from.sourceRevisionRef !== set.processingObservationRef ||
            b.to.kind !== 'NATIVE_RECORD_REVISION' ||
            b.to.sourceRevisionRef !== member.assessmentObservationRef
          )
            continue;
          mappings.push({
            scope: structuredClone(set.scope),
            sourceRevisionRef: sourceRef,
            assessmentRevisionRef: member.assessmentObservationRef,
            // Preserve the actual relation scope. The existing projector checks
            // exact applicability; adjacency never manufactures that scope.
            path: [mappingRelation(first), mappingRelation(second)],
          });
        }
      }
    }
  }
  return {
    sources: [...sources.values()],
    assessments,
    mappings,
    contributions: [],
    contradictions: [],
  };
}

function identity(record: TdmsRecordSummary) {
  return structuredClone({
    recordRef: record.recordRef,
    sourceRevisionRef: record.sourceRevisionRef,
    sourceRecordId: record.sourceRecordId,
    sourceVersion: record.sourceVersion,
    businessVersion: record.businessVersion ?? null,
  });
}

function approvalMetadata(
  value: unknown,
): TdmsOpinionAssessmentFact['approval'] {
  if (value === null || value === undefined) return null;
  const p = object(value);
  if (
    !['METADATA_ONLY', 'ESTIMATED_OPINION'].includes(String(p.mode)) ||
    typeof p.reason !== 'string'
  )
    throw tdmsError('TDMS_OPINION_COLLECTION_INVALID', 409);
  const observation = (value: unknown) => {
    if (value === null) return null;
    const row = object(value);
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
        .filter((key) => Object.hasOwn(row, key))
        .map((key) => [key, row[key]]),
    );
  };
  return structuredClone({
    mode: p.mode,
    reason: p.reason,
    approvalSubject: p.approvalSubject,
    before: observation(p.before),
    after: observation(p.after),
    // Ingress validates these retained metadata fields; the projector independently
    // checks this assessment's exact identity/state/version before reading locators.
  }) as unknown as TdmsOpinionAssessmentFact['approval'];
}

function opinionFields(
  value: TdmsRuntimeRecordMetadata,
): TdmsOpinionAssessmentFact['opinionFields'] {
  const fields = new Map<
    number,
    { index: number; sourceSelector: string; author: null }
  >();
  for (const selector of value.record.fieldSelectors) {
    const match = /^content\.opinions\[(0|[1-9]\d*)\]$/u.exec(
      selector.fieldPath,
    );
    if (!match) continue;
    const index = Number(match[1]);
    if (
      !Number.isSafeInteger(index) ||
      !value.fieldProvenance.some(
        (provenance) =>
          provenance.fieldPath === selector.fieldPath &&
          provenance.selector === selector.selector,
      )
    )
      throw tdmsError('TDMS_RUNTIME_FIELD_PROVENANCE_MISMATCH', 409);
    const prior = fields.get(index);
    if (prior && prior.sourceSelector !== selector.selector)
      throw tdmsError('TDMS_RUNTIME_FIELD_PROVENANCE_MISMATCH', 409);
    fields.set(index, {
      index,
      sourceSelector: identifier(selector.selector),
      author: null,
    });
  }
  return [...fields.values()].sort((a, b) => a.index - b.index);
}

function mappingRelation(value: TdmsStoredAssertion) {
  const r = value.assertion;
  return structuredClone({
    assertionRef: r.assertionRef,
    controlledKind: r.controlledKind,
    from: r.from,
    to: r.to,
    authority: r.authority,
    coverage: r.coverage,
    scope: r.scope,
    nativeScope: value.scope,
  });
}

function orderedRecords(records: TdmsRuntimeRecordMetadata[]) {
  return [...records].sort((a, b) =>
    a.record.sourceRevisionRef.localeCompare(b.record.sourceRevisionRef),
  );
}

function orderedAssertions(assertions: TdmsStoredAssertion[]) {
  return assertions
    .map(mappingRelation)
    .sort((a, b) => a.assertionRef.localeCompare(b.assertionRef));
}

function runtimeMetadata(
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

function decode(value: unknown): unknown {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw tdmsError('TDMS_SET_STORED_DATA_INVALID', 409);
  }
}

function requireDatabase(value: Database): void {
  if (!value || typeof value.execute !== 'function')
    throw tdmsError('TDMS_RUNTIME_TRANSACTION_REQUIRED', 503);
}

function storageError(error: unknown): unknown {
  let current = error;
  for (let i = 0; i < 4 && current && typeof current === 'object'; i++) {
    if ('code' in current && current.code === '42P01')
      return tdmsError('TDMS_RUNTIME_PROCESSING_STORAGE_UNCONFIGURED', 503);
    current = 'cause' in current ? current.cause : null;
  }
  return error;
}
