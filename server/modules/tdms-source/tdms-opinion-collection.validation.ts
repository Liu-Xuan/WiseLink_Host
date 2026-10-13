import {
  hasCompleteOwnedSource,
  assertCompleteOwnedNativePackage,
} from './tdms-complete-owned-source.validation';
import type {
  TdmsCoverage,
  TdmsPackageRecord,
  TdmsPackageRelation,
} from '@shared/tdms-source.interface';
import { tdmsError } from './tdms-source.types';

/** Reuse the package validator's primitives without a circular module import. */
interface ValidationPrimitives {
  ownedVisibleContent(
    record: TdmsPackageRecord,
    packageObservedAt: string,
  ): void;
  boundedOwnedBody(record: TdmsPackageRecord, packageObservedAt: string): void;
  canonical(value: unknown): string;
  identifier(value: unknown): string;
  object(value: unknown): Record<string, unknown>;
  strict(value: Record<string, unknown>, keys: string[]): void;
  date(value: unknown): void;
  rawCode(value: unknown): void;
  version(value: unknown): void;
}
export function createOpinionCollectionIngress({
  canonical,
  identifier,
  object,
  strict,
  date,
  rawCode,
  version,
  ownedVisibleContent,
  boundedOwnedBody,
}: ValidationPrimitives) {
  /** New-ingress checks only. Captured observations never replace Host authorization. */
  const OPINION_COLLECTION_SCHEMA = 'wiselink.tdms-opinion-collection.v1';
  const METADATA_REASONS = [
    'STATE_NOT_ESTIMATED',
    'CURRENT_STATE_UNVERIFIED',
    'VERSION_UNCONFIRMED',
    'IDENTITY_UNVERIFIED',
    'OBSERVATION_CHANGED',
    'OPINION_FIELD_UNAVAILABLE',
    'CONTENT_LIMIT_EXCEEDED',
    'CONTENT_REJECTED',
    'READ_INTERRUPTED',
    'COMMENT_OWNER_UNVERIFIED',
  ];
  function exactAssessmentIdentity(value: unknown): void {
    if (
      typeof value !== 'string' ||
      !/^OR:wt\.change2\.WTChangeOrder2:\d+$/u.test(value)
    )
      throw tdmsError('TDMS_OPINION_IDENTITY_UNVERIFIED');
  }
  function exactAssessmentVersion(value: unknown): void {
    version(value);
    const v = object(value);
    if (v.confirmation !== 'SOURCE_DECLARED')
      throw tdmsError('TDMS_OPINION_VERSION_UNCONFIRMED');
    identifier(v.rawRevision);
    identifier(v.rawIteration);
  }
  function estimated(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const s = value as Record<string, unknown>;
    return (
      s.rawName === 'Estimated' &&
      (s.rawCode === null || s.rawCode === 'Estimated')
    );
  }
  function opinionTimestamp(value: unknown): void {
    date(value);
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(
        value,
      )
    )
      throw tdmsError('TDMS_OPINION_OBSERVATION_TIME_INVALID');
  }
  function unexposedTechnicalVersion(value: unknown): void {
    version(value);
    const v = object(value);
    if (
      v.confirmation !== 'VERSION_UNCONFIRMED' ||
      v.rawRevision !== null ||
      v.rawIteration !== null
    )
      throw tdmsError('TDMS_OPINION_VERSION_UNCONFIRMED');
  }
  function observedBusinessVersion(value: unknown): void {
    version(value);
    const v = object(value);
    if (v.confirmation !== 'SOURCE_DECLARED' || v.rawIteration !== null)
      throw tdmsError('TDMS_OPINION_BUSINESS_VERSION_INVALID');
    identifier(v.rawRevision);
  }
  function hasObjectObservationFields(value: Record<string, unknown>): boolean {
    return (
      Object.hasOwn(value, 'businessVersion') ||
      Object.hasOwn(value, 'sourceModifiedRaw')
    );
  }
  function approvalObservation(value: unknown): Record<string, unknown> {
    const o = object(value);
    const observedObject = hasObjectObservationFields(o);
    strict(o, [
      'sourceRecordId',
      'recordKind',
      'sourceVersion',
      'state',
      'sourceModifiedAt',
      'observedAt',
      'identitySelector',
      'stateSelector',
      'versionSelector',
      'objectBinding',
      ...(observedObject
        ? [
            'businessVersion',
            'sourceModifiedRaw',
            'detailType',
            'detailTypeSelector',
            'detailsTabSelector',
            'businessVersionSelector',
            'modifiedSelector',
          ]
        : []),
    ]);
    exactAssessmentIdentity(o.sourceRecordId);
    if (observedObject) {
      unexposedTechnicalVersion(o.sourceVersion);
      observedBusinessVersion(o.businessVersion);
      identifier(o.sourceModifiedRaw);
      if (o.sourceModifiedAt !== null || o.detailType !== 'SB评估单')
        throw tdmsError('TDMS_OPINION_OBSERVATION_INVALID');
    } else exactAssessmentVersion(o.sourceVersion);
    rawCode(o.state);
    if (
      o.recordKind !== 'ENGINEER_ASSESSMENT' ||
      o.objectBinding !== 'EXACT_CURRENT_DETAIL'
    )
      throw tdmsError('TDMS_OPINION_OBSERVATION_INVALID');
    const selectors = observedObject
      ? {
          identitySelector: '#infoPageIdentityObjectIdentifier',
          stateSelector: '#infoPageinfoPageTitleBarLifeCycleState',
          versionSelector: null,
          detailTypeSelector: '#infoPageIdentityDisplayType',
          detailsTabSelector:
            '#infoPageinfoPanelID__infoPage_myTab_object_changeNoticeDetailsTab',
          businessVersionSelector:
            'fieldset#General td.attributePanel-label[SB评估单版本] + td.attributePanel-value',
          modifiedSelector:
            'fieldset#System td.attributePanel-label[Last Modified] + td.attributePanel-value',
        }
      : {
          identitySelector: '#infoPageIdentityObjectIdentifier',
          stateSelector:
            '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
          versionSelector:
            '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value',
        };
    for (const [key, selector] of Object.entries(selectors))
      if (o[key] !== selector) throw tdmsError('TDMS_OPINION_SELECTOR_INVALID');
    opinionTimestamp(o.observedAt);
    if (o.sourceModifiedAt !== null) date(o.sourceModifiedAt);
    return o;
  }
  function opinionCollection(
    r: TdmsPackageRecord,
    packageObservedAt: string,
    packageCoverage: TdmsCoverage,
  ): 'EXACT_VERSION' | 'OBJECT_OBSERVATION' | null {
    const value = r.rawFields.opinionCollection;
    if (value === undefined && r.recordKind !== 'ENGINEER_ASSESSMENT')
      return null;
    opinionTimestamp(r.observedAt);
    opinionTimestamp(packageObservedAt);
    const e = object(value);
    strict(e, [
      'schemaVersion',
      'mode',
      'reason',
      'approvalSubject',
      'before',
      'after',
    ]);
    if (
      e.schemaVersion !== OPINION_COLLECTION_SCHEMA ||
      !['METADATA_ONLY', 'ESTIMATED_OPINION'].includes(String(e.mode))
    )
      throw tdmsError('TDMS_OPINION_COLLECTION_INVALID');
    const approved = e.mode === 'ESTIMATED_OPINION';
    const observedObject = e.reason === 'APPROVED_CURRENT_OBJECT_OBSERVATION';
    if (
      approved
        ? ![
            'APPROVED_CURRENT_EXACT_VERSION',
            'APPROVED_CURRENT_OBJECT_OBSERVATION',
          ].includes(String(e.reason))
        : !METADATA_REASONS.includes(String(e.reason))
    )
      throw tdmsError('TDMS_OPINION_COLLECTION_REASON_INVALID');
    if (e.approvalSubject !== null) {
      const s = object(e.approvalSubject);
      const objectSubject = hasObjectObservationFields(s);
      strict(s, [
        'sourceRecordId',
        'sourceVersion',
        ...(objectSubject ? ['businessVersion'] : []),
      ]);
      exactAssessmentIdentity(s.sourceRecordId);
      if (objectSubject) {
        unexposedTechnicalVersion(s.sourceVersion);
        observedBusinessVersion(s.businessVersion);
        if (canonical(s.businessVersion) !== canonical(r.businessVersion))
          throw tdmsError('TDMS_OPINION_SUBJECT_MISMATCH');
      } else exactAssessmentVersion(s.sourceVersion);
      if (
        (approved && objectSubject !== observedObject) ||
        r.recordKind !== 'ENGINEER_ASSESSMENT' ||
        s.sourceRecordId !== r.sourceRecordId ||
        canonical(s.sourceVersion) !== canonical(r.sourceVersion)
      )
        throw tdmsError('TDMS_OPINION_SUBJECT_MISMATCH');
    }
    const before = e.before === null ? null : approvalObservation(e.before);
    const after = e.after === null ? null : approvalObservation(e.after);
    for (const o of [before, after]) {
      if (
        o &&
        (o.sourceRecordId !== r.sourceRecordId ||
          Date.parse(String(o.observedAt)) > Date.parse(r.observedAt))
      )
        throw tdmsError('TDMS_OPINION_OBSERVATION_MISMATCH');
    }
    if (
      Date.parse(r.observedAt) > Date.parse(packageObservedAt) ||
      (before &&
        after &&
        Date.parse(String(before.observedAt)) >
          Date.parse(String(after.observedAt)))
    )
      throw tdmsError('TDMS_OPINION_OBSERVATION_TIME_INVALID');
    if (!approved) {
      if (
        e.reason === 'STATE_NOT_ESTIMATED' &&
        (r.state === null || estimated(r.state))
      )
        throw tdmsError('TDMS_OPINION_COLLECTION_REASON_INVALID');
      return null;
    }
    if (
      r.recordKind !== 'ENGINEER_ASSESSMENT' ||
      !e.approvalSubject ||
      !before ||
      !after ||
      !estimated(r.state)
    )
      throw tdmsError('TDMS_OPINION_NOT_APPROVED');
    exactAssessmentIdentity(r.sourceRecordId);
    if (
      r.fileType?.rawName !== 'SB评估单' ||
      ![null, 'SB评估单'].includes(r.fileType.rawCode) ||
      canonical(r.rawFields.storageType) !== canonical(r.fileType)
    )
      throw tdmsError('TDMS_OPINION_DETAIL_TYPE_MISMATCH');
    if (observedObject) {
      unexposedTechnicalVersion(r.sourceVersion);
      observedBusinessVersion(r.businessVersion);
      identifier(r.rawFields.sourceModifiedRaw);
      if (r.sourceModifiedAt !== null)
        throw tdmsError('TDMS_OPINION_OBSERVATION_MISMATCH');
      for (const c of [r.coverage, packageCoverage])
        if (
          c.status !== 'PARTIAL' ||
          c.readback !== 'NON_ATOMIC' ||
          !c.gaps.includes('TECHNICAL_VERSION_UNEXPOSED')
        )
          throw tdmsError('TDMS_OPINION_OBSERVATION_LIMITS_REQUIRED');
    } else exactAssessmentVersion(r.sourceVersion);
    if (r.observedAt !== after.observedAt)
      throw tdmsError('TDMS_OPINION_OBSERVATION_TIME_INVALID');
    for (const o of [before, after]) {
      if (
        hasObjectObservationFields(o) !== observedObject ||
        canonical(o.sourceVersion) !== canonical(r.sourceVersion) ||
        canonical(o.state) !== canonical(r.state) ||
        o.sourceModifiedAt !== r.sourceModifiedAt ||
        (observedObject &&
          (canonical(o.businessVersion) !== canonical(r.businessVersion) ||
            o.sourceModifiedRaw !== r.rawFields.sourceModifiedRaw))
      )
        throw tdmsError('TDMS_OPINION_OBSERVATION_MISMATCH');
    }
    return observedObject ? 'OBJECT_OBSERVATION' : 'EXACT_VERSION';
  }
  function person(value: unknown): void {
    const p = object(value);
    strict(p, ['sourcePersonId', 'name', 'role']);
    if (
      ![p.sourcePersonId, p.name, p.role].every(
        (v) => v === null || typeof v === 'string',
      )
    )
      throw tdmsError('TDMS_PERSON_INVALID');
  }
  function opinions(
    value: unknown,
    state: unknown,
    observedObject: boolean,
  ): void {
    if (!Array.isArray(value)) throw tdmsError('TDMS_OPINIONS_INVALID');
    for (const item of value) {
      const o = object(item);
      strict(o, [
        'text',
        'author',
        'state',
        'conditions',
        'requiredActions',
        'sourceSelector',
      ]);
      if (
        typeof o.text !== 'string' ||
        !o.text.trim() ||
        o.text.length > 100000
      )
        throw tdmsError('TDMS_OPINIONS_INVALID');
      if (o.author !== null) person(o.author);
      rawCode(o.state);
      if (canonical(o.state) !== canonical(state))
        throw tdmsError('TDMS_OPINION_STATE_MISMATCH');
      if (
        o.sourceSelector !==
        (observedObject
          ? 'fieldset td.attributePanel-label[评估意见] + td.attributePanel-value'
          : '.attributePanel[oid] .attributePanel-label[评估意见] => .attributePanel-value')
      )
        throw tdmsError('TDMS_OPINION_SELECTOR_INVALID');
      for (const key of ['conditions', 'requiredActions'])
        if (
          !Array.isArray(o[key]) ||
          (o[key] as unknown[]).some((v) => typeof v !== 'string')
        )
          throw tdmsError('TDMS_OPINIONS_INVALID');
    }
  }
  /** Recognized structured payloads must be separate approval-checked records.
   * This is not an opaque-text classifier; collectors must use finite field projections. */
  function rejectEmbeddedOpinions(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(rejectEmbeddedOpinions);
      return;
    }
    const o = value as Record<string, unknown>;
    if (['ENGINEER_ASSESSMENT', 'COMMENT'].includes(String(o.recordKind)))
      throw tdmsError('TDMS_EMBEDDED_OPINION_FORBIDDEN');
    for (const [key, child] of Object.entries(o)) {
      if (
        /^(?:opinions?|opiniontext|opinionbody|assessment(?:s|details?|opinions?|content|body)?|engineerassessments?|comments?|commentbody|commenttext|评估意见|工程师意见)$/iu.test(
          key.replace(/[\s_-]/gu, ''),
        )
      )
        throw tdmsError('TDMS_EMBEDDED_OPINION_FORBIDDEN');
      rejectEmbeddedOpinions(child);
    }
  }
  function assessmentMetadata(r: TdmsPackageRecord): void {
    strict(r.rawFields, [
      'number',
      'storageType',
      'businessType',
      'opinionCollection',
      'unresolvedRelations',
      'sourceModifiedRaw',
    ]);
    identifier(r.rawFields.number);
    if (r.rawFields.sourceModifiedRaw !== undefined)
      identifier(r.rawFields.sourceModifiedRaw);
    if (r.title !== r.rawFields.number)
      throw tdmsError('TDMS_OPINION_METADATA_INVALID');
    for (const key of ['storageType', 'businessType'])
      if (r.rawFields[key] !== undefined) rawCode(r.rawFields[key]);
    if (r.rawFields.unresolvedRelations !== undefined) {
      if (!Array.isArray(r.rawFields.unresolvedRelations))
        throw tdmsError('TDMS_OPINION_METADATA_INVALID');
      for (const value of r.rawFields.unresolvedRelations) {
        const relation = object(value);
        strict(relation, [
          'rawKind',
          'fromSourceRecordId',
          'toSourceRecordId',
          'selector',
          'versionGap',
        ]);
        for (const key of [
          'rawKind',
          'fromSourceRecordId',
          'toSourceRecordId',
          'selector',
          'versionGap',
        ])
          identifier(relation[key]);
      }
    }
  }
  /** Re-run after FileService selections have become effective record ownership. */
  return function assertOpinionCollectionIngress(p: {
    records: TdmsPackageRecord[];
    relations: TdmsPackageRelation[];
    artifacts: Array<{ memberId: string }>;
    observedAt: string;
    coverage: TdmsCoverage;
  }): void {
    assertCompleteOwnedNativePackage(p);
    const bounded = p.records.some(
      (r) =>
        r.rawFields.profileOwnedBody !== undefined ||
        r.content.boundedOwnedBody !== undefined,
    );
    if (
      bounded &&
      (p.records.length !== 1 ||
        p.relations.length ||
        p.artifacts.length ||
        p.coverage.status !== 'PARTIAL' ||
        p.coverage.readback !== 'NON_ATOMIC' ||
        ![
          'OWN_BODY_BOUNDED',
          'REQUIRED_CONTENT_COMPLETENESS_UNPROVEN',
          'RELATIONS_UNREAD',
          'RELATION_TARGETS_UNVERIFIED',
        ].every((g) => p.coverage.gaps.includes(g)))
    )
      throw tdmsError('TDMS_BOUNDED_BODY_LIMITS_REQUIRED');
    if (
      p.records.some((r) => r.rawFields.ownedBusinessContent !== undefined) &&
      (p.records.length !== 1 ||
        p.artifacts.length ||
        p.coverage.status !== 'PARTIAL' ||
        p.coverage.readback !== 'NON_ATOMIC' ||
        !p.coverage.gaps.includes('PROBE_ONLY') ||
        p.relations.some(
          (r) =>
            r.authority !== 'CANDIDATE_ONLY' ||
            r.controlledKind !== null ||
            r.from.kind !== 'UNRESOLVED' ||
            r.to.kind !== 'UNRESOLVED' ||
            r.completionEffect !== 'UNSPECIFIED' ||
            r.changeClass !== 'UNSPECIFIED',
        ))
    )
      throw tdmsError('TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID');
    const owned = new Set<string>();
    for (const r of p.records) {
      if (hasCompleteOwnedSource(r)) continue;
      if (
        r.rawFields.profileOwnedBody !== undefined ||
        r.content.boundedOwnedBody !== undefined
      ) {
        boundedOwnedBody(r, p.observedAt);
        continue;
      }
      if (r.rawFields.ownedBusinessContent !== undefined) {
        ownedVisibleContent(r, p.observedAt);
        continue;
      }
      if (r.content.ownedVisibleBusinessContent !== undefined)
        throw tdmsError('TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID');
      const approved = opinionCollection(r, p.observedAt, p.coverage);
      if (
        r.recordKind === 'ENGINEER_ASSESSMENT' ||
        r.recordKind === 'COMMENT'
      ) {
        assessmentMetadata(r);
        strict(object(r.content), approved ? ['opinions'] : []);
        if (
          (!approved || approved === 'OBJECT_OBSERVATION') &&
          (r.artifactMemberIds.length || r.unreadAttachments?.length)
        )
          throw tdmsError(
            approved === 'OBJECT_OBSERVATION'
              ? 'TDMS_OBJECT_OBSERVATION_ARTIFACT_FORBIDDEN'
              : 'TDMS_UNAPPROVED_OPINION_ARTIFACT_FORBIDDEN',
          );
        if (r.content.opinions !== undefined)
          opinions(
            r.content.opinions,
            r.state,
            approved === 'OBJECT_OBSERVATION',
          );
      } else {
        if (
          r.rawFields.opinionCollection !== undefined ||
          r.content.opinions !== undefined
        )
          throw tdmsError('TDMS_EMBEDDED_OPINION_FORBIDDEN');
        rejectEmbeddedOpinions(r.rawFields);
        rejectEmbeddedOpinions(r.content);
      }
      for (const member of r.artifactMemberIds) owned.add(member);
    }
    for (const relation of p.relations) {
      rejectEmbeddedOpinions(relation.rawFields);
      rejectEmbeddedOpinions(relation.scope);
    }
    if (p.artifacts.some((a) => !owned.has(a.memberId)))
      throw tdmsError('TDMS_ARTIFACT_OWNER_INVALID');
  };
}
