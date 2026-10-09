import type { TdmsProcessingRevisionSet } from '@shared/tdms-processing-set.interface';
import type {
  TdmsSourceVersion,
  TdmsExactEndpoint,
} from '@shared/tdms-source.interface';
import type {
  TdmsStoredRevision,
  TdmsStoredAssertion,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { sameScope } from './tdms-source.authorization';
import { canonical } from './tdms-source.validation';
import type { TdmsProcessingSetTransaction } from './tdms-processing-set.types';

/** Transaction-local exact references; never body reading or source authority. */
export async function processingSetFacts(
  tx: TdmsProcessingSetTransaction,
  set: TdmsProcessingRevisionSet,
) {
  const revisions: TdmsStoredRevision[] = [],
    assertions: TdmsStoredAssertion[] = [];
  const loaded = new Map<string, TdmsStoredRevision>();
  const revision = async (ref: string, kinds: string[]) => {
    const r = loaded.get(ref) ?? (await tx.revision(set.scope.tenantId, ref));
    if (
      !r ||
      !r.scope ||
      !r.record ||
      !sameScope(r.scope, set.scope) ||
      r.record.sourceRevisionRef !== ref ||
      !kinds.includes(r.record.recordKind)
    ) {
      throw tdmsError('TDMS_SET_REFERENCE_INVALID', 409);
    }
    if (!loaded.has(ref)) {
      loaded.set(ref, r);
      revisions.push(r);
    }
    return r;
  };
  const relation = async (
    ref: string,
    kind: string | null,
    from?: TdmsExactEndpoint,
    to?: TdmsExactEndpoint,
  ) => {
    const r = await tx.processingAssertion(set.scope, ref);
    if (
      !r ||
      !r.scope ||
      !r.assertion ||
      !sameScope(r.scope, set.scope) ||
      r.assertion.assertionRef !== ref ||
      r.assertion.authority !== 'SOURCE_EXPLICIT' ||
      (kind && r.assertion.controlledKind !== kind) ||
      (from && canonical(r.assertion.from) !== canonical(from)) ||
      (to && canonical(r.assertion.to) !== canonical(to))
    ) {
      throw tdmsError('TDMS_SET_RELATION_INVALID', 409);
    }
    assertions.push(r);
    return r;
  };
  const parent = await revision(set.processingObservationRef, [
    'PROCESSING_SHEET',
  ]);
  const parentEndpoint = {
    kind: 'NATIVE_RECORD_REVISION' as const,
    sourceRevisionRef: set.processingObservationRef,
  };
  let exact = exactVersion(parent.record.sourceVersion);
  for (const root of set.rootBindings) {
    if (root.endpoint.kind === 'NATIVE_RECORD_REVISION') {
      const r = await revision(root.endpoint.sourceRevisionRef, [
        'MANUFACTURER_FILE',
        'ENGINEERING_FILE',
      ]);
      exact = exact && exactVersion(r.record.sourceVersion);
    }
    for (const ref of root.fileProcessingAssertionRefs)
      await relation(ref, 'FILE_PROCESSING', root.endpoint, parentEndpoint);
    if (
      !root.fileProcessingAssertionRefs.length ||
      !root.applicabilityEvidenceRefs.length
    )
      exact = false;
  }
  for (const m of set.members) {
    if (!m.assessmentObservationRef) {
      exact = false;
      continue;
    }
    const a = await revision(m.assessmentObservationRef, [
      'ENGINEER_ASSESSMENT',
    ]);
    if (
      m.expectedSourceRecordId !== null &&
      a.record.sourceRecordId !== m.expectedSourceRecordId
    )
      throw tdmsError('TDMS_SET_REFERENCE_INVALID', 409);
    if (
      m.membershipResolution !== 'CONFIRMED' ||
      !exactVersion(a.record.sourceVersion)
    )
      exact = false;
    for (const ref of m.processingAssessmentAssertionRefs)
      await relation(ref, 'PROCESSING_ASSESSMENT', parentEndpoint, {
        kind: 'NATIVE_RECORD_REVISION',
        sourceRevisionRef: m.assessmentObservationRef,
      });
    if (!m.processingAssessmentAssertionRefs.length) exact = false;
  }
  for (const b of set.objectContextBindings ?? []) {
    await revision(b.ownerObservationRef, [
      'MANUFACTURER_FILE',
      'PROCESSING_SHEET',
      'ENGINEER_ASSESSMENT',
      'ENGINEERING_FILE',
    ]);
    for (const ref of b.attachmentRelationAssertionRefs) {
      const r = await relation(ref, null);
      if (
        ![r.assertion.from, r.assertion.to].some(
          (e) =>
            e.kind === 'NATIVE_RECORD_REVISION' &&
            e.sourceRevisionRef === b.ownerObservationRef,
        )
      ) {
        throw tdmsError('TDMS_SET_ATTACHMENT_OWNER_INVALID', 409);
      }
      for (const e of [r.assertion.from, r.assertion.to]) {
        if (e.kind === 'NATIVE_RECORD_REVISION')
          await revision(e.sourceRevisionRef, [
            'MANUFACTURER_FILE',
            'PROCESSING_SHEET',
            'ENGINEER_ASSESSMENT',
            'ENGINEERING_FILE',
          ]);
      }
    }
  }
  if (
    set.versionMappingCoverage === 'COMPLETE' &&
    (!exact ||
      !set.rootBindings.length ||
      set.membershipCoverage !== 'COMPLETE')
  ) {
    throw tdmsError('TDMS_SET_EXACT_MAPPING_UNCONFIRMED', 409);
  }
  if (
    set.approvedBodyCaptureCoverage === 'COMPLETE' &&
    set.membershipCoverage !== 'COMPLETE'
  ) {
    throw tdmsError('TDMS_SET_APPROVED_CAPTURE_UNCONFIRMED', 409);
  }
  if (
    set.approvalReadiness === 'ALL_APPROVED' &&
    (set.membershipCoverage !== 'COMPLETE' ||
      set.members.some(
        (m) =>
          !m.assessmentObservationRef ||
          !estimated(loaded.get(m.assessmentObservationRef)!.record.state),
      ))
  ) {
    throw tdmsError('TDMS_SET_ALL_APPROVED_UNCONFIRMED', 409);
  }
  if (set.supersedesSetRevisionRef) {
    const prior = await tx.processingSet(
      set.scope,
      set.supersedesSetRevisionRef,
    );
    if (
      !prior ||
      prior.processingFamilyRef !== set.processingFamilyRef ||
      prior.cohortRef !== set.cohortRef
    ) {
      throw tdmsError('TDMS_SET_SUPERSEDES_INVALID', 409);
    }
  }
  return { revisions, assertions };
}
function estimated(
  state: { rawName: string | null; rawCode: string | null } | null,
): boolean {
  return (
    state?.rawName === 'Estimated' &&
    (state.rawCode === null || state.rawCode === 'Estimated')
  );
}
function exactVersion(v: TdmsSourceVersion): boolean {
  return (
    v.confirmation === 'SOURCE_DECLARED' &&
    !!v.rawRevision?.trim() &&
    !!v.rawIteration?.trim()
  );
}
