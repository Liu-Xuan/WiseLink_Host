// Core pure DTO basis: TDMS final 0.2.54/runtime 174f1d555502880a.
// Optional related-status source-view v1 is independent of producer version.
// Producer admission/runtime/completion orchestration is not copied into Host.
import {
  classifyOwnFieldReference,
  OWN_OUT_OF_SCOPE_NATIVE_CLASSES,
} from './tdms-own-reference-models';
import { isNativeReloadProvenance } from './tdms-native-reload-provenance';
import { assertCompleteOriginalNativeArtifacts } from './tdms-complete-original.validation';
import { isAssessmentOpinionLabel } from './tdms-assessment-body-policy';
import {
  parseReviewedAeoOwnBusinessNumber,
  validateReviewedAeoBusinessNumberEvidence,
} from './tdms-reviewed-aeo-business-version';
import { validateRelatedStatusFixedRowSlotEvidence } from './tdms-related-status-fixed-row-slots';
import {
  validateReviewedAdHandlingOwner,
  validateReviewedAdHandlingRead,
  validateReviewedAdHandlingRawTextField,
} from './tdms-reviewed-ad-handling-native-model';
import {
  validateReviewedAdHandlingTreeTable,
  reviewedAdHandlingTreeOccurrence,
} from './tdms-reviewed-ad-handling-native-tree';
import {
  validateReviewedAnonymousOwnRawRead,
  validateReviewedAnonymousOwnRawField,
} from './tdms-reviewed-anonymous-own-raw-slots';
import {
  REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL,
  validateReviewedAeoImplicitStatusSourceView,
} from './tdms-reviewed-aeo-related-status-native-view';
import {
  classifyReviewedAdItemOwnReference,
  validateReviewedAdItemRead,
  reviewedAdItemEfrBodySemanticProjection,
  reviewedAdItemEfrRequiredTargetPurpose,
} from './tdms-reviewed-ad-item-native-model';
import {
  isReviewedEfRequestOwner,
  isReviewedEfRequestUnknownFieldCaption,
  validateReviewedCompleteTabRoster,
  validateReviewedEfRequestModifiedMirrors,
  validateReviewedAdModifiedMirrors,
  validateReviewedCompleteTabPurposes,
  validateReviewedEfRequestGridRosters,
  validateReviewedEfRequestQueryEvidence,
  validateReviewedEfRequestRelatedSurfaceEvidence,
  validateReviewedEfRequestRelatedQueryEvidence,
  reviewedEfRequestRequiredTargetPurpose,
} from './tdms-reviewed-complete-source-types';
import {
  isReviewedEfStructureTab,
  isReviewedEfStructureTable,
  REVIEWED_EFREQUEST_STRUCTURE_MODEL,
  reviewedEfStructureSemanticProjection,
  validateReviewedEfStructureUsesEvidence,
} from './tdms-reviewed-efrequest-structure-native-model';
import { createHash } from 'node:crypto';
import { tdmsError } from './tdms-source.types';
export const COMPLETE_OWN_OBSERVATION_MAX_BYTES = 1536 * 1024;
export const COMPLETE_OWN_MAX_NODES = 100000;
export const COMPLETE_OWN_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
export const COMPLETE_OWN_REQUEST_MAX_BYTES =
  COMPLETE_OWN_PACKAGE_MAX_BYTES + 128;
const stable = (value) =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? '[' + value.map(stable).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
          .join(',') +
        '}';
const sha256 = (value) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : stable(value),
    )
    .digest('hex');
const fail = (code) => {
  throw tdmsError(code);
};
const assertKeys = (value, keys, required = keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    fail('TDMS_COMPLETE_OWN_FIELDS_INVALID');
};
const text = (v, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    fail('TDMS_COMPLETE_OWN_STRING_INVALID');
  return v;
};
const iso = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('TDMS_COMPLETE_OWN_TIME_INVALID');
  const normalized =
    value.slice(0, 19) +
    '.' +
    (value.match(/\.(\d{1,3})Z$/u)?.[1] || '0').padEnd(3, '0') +
    'Z';
  if (new Date(value).toISOString() !== normalized)
    fail('TDMS_COMPLETE_OWN_TIME_INVALID');
  return value;
};
const version = (v, { business = false } = {}) => {
  assertKeys(v, ['rawRevision', 'rawIteration', 'confirmation']);
  if (!['SOURCE_DECLARED', 'VERSION_UNCONFIRMED'].includes(v.confirmation))
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  for (const x of [v.rawRevision, v.rawIteration]) if (x !== null) text(x, 80);
  if (
    (v.confirmation === 'VERSION_UNCONFIRMED' &&
      (v.rawRevision !== null || v.rawIteration !== null)) ||
    (v.confirmation === 'SOURCE_DECLARED' &&
      (v.rawRevision === null || (!business && v.rawIteration === null)))
  )
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
};
function plainData(
  raw,
  { maxBytes = COMPLETE_OWN_PACKAGE_MAX_BYTES, maxNodes = 50000 } = {},
) {
  let visits = 0;
  const walk = (v, depth = 0) => {
    if (++visits > maxNodes || depth > 25) fail('TDMS_COMPLETE_OWN_LIMIT');
    if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return v;
    if (typeof v === 'string') {
      if (v.length > 100000) fail('TDMS_COMPLETE_OWN_LIMIT');
      return v;
    }
    // structuredClone may return a plain object from the host realm. Admit only
    // null/object-root prototypes; class/custom prototype chains remain invalid.
    const prototype =
      v && typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
    const plainPrototype =
      prototype === null ||
      (prototype &&
        Object.getPrototypeOf(prototype) === null &&
        Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
          ?.name === 'Object');
    if (!v || typeof v !== 'object' || (!Array.isArray(v) && !plainPrototype))
      fail('TDMS_COMPLETE_OWN_DATA_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length)
      fail('TDMS_COMPLETE_OWN_DATA_INVALID');
    if (Array.isArray(v)) {
      if (
        v.length > 10000 ||
        Object.keys(descriptors).some(
          (k) => k !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(k),
        )
      )
        fail('TDMS_COMPLETE_OWN_LIMIT');
      return Array.from({ length: v.length }, (_, i) => {
        const d = descriptors[i];
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable)
          fail('TDMS_COMPLETE_OWN_DATA_INVALID');
        return walk(d.value, depth + 1);
      });
    }
    const result = {};
    for (const [key, d] of Object.entries(descriptors)) {
      if (
        !Object.hasOwn(d, 'value') ||
        !d.enumerable ||
        ['__proto__', 'prototype', 'constructor'].includes(key)
      )
        fail('TDMS_COMPLETE_OWN_DATA_INVALID');
      result[key] = walk(d.value, depth + 1);
    }
    return result;
  };
  const value = walk(raw);
  if (Buffer.byteLength(stable(value)) > maxBytes)
    fail('TDMS_COMPLETE_OWN_LIMIT');
  return value;
}
const EVIDENCE_STATES = [
  'VALUE',
  'BLANK',
  'ABSENT',
  'NOT_APPLICABLE',
  'NOT_LOADED',
  'NOT_READ',
  'TRUNCATED',
  'ACCESS_DENIED',
];
const withoutTimes = (value) =>
  Array.isArray(value)
    ? value.map(withoutTimes)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(
              ([k]) =>
                !['observedAt', 'itemId', 'snapshotId', 'lastSeenAt'].includes(
                  k,
                ),
            )
            .map(([k, x]) => [k, withoutTimes(x)]),
        )
      : value;
const snapshotIdentity = (r) =>
  'TDMSSNAP-' + sha256(completeContentIdentityProjection(r));
function normalizeCompleteCaptureLocators(value, key = '') {
  if (Array.isArray(value))
    return value.map((v) => normalizeCompleteCaptureLocators(v, key));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        normalizeCompleteCaptureLocators(v, k),
      ]),
    );
  // Only the reviewed engineering detail-panel identifier varies per native render.
  return typeof value === 'string' &&
    [
      'fieldId',
      'sectionId',
      'tabId',
      'panelLocator',
      'locator',
      'selector',
      'evidenceLocator',
      'fieldIds',
      'sectionIds',
      'tabIds',
      'fieldLocators',
      'sectionLocators',
    ].includes(key)
    ? value.replace(
        /infoPage_myTab_tab_jcaGen_\d+/gu,
        'infoPage_OWN_ENGINEERING_DETAILS',
      )
    : value;
}
export function completeContentIdentityProjection(record) {
  const value = normalizeCompleteCaptureLocators(
      withoutTimes(completeOwnedStableProjection(record)),
    ),
    proof = value.rawFields?.completeOwnedSource;
  if (proof) {
    delete proof.documentIdentity;
    if (proof.requestedCriteria) {
      delete proof.requestedCriteria.sourceProof;
      delete proof.requestedCriteria.expectedOwner;
    }
    for (const read of proof.reads) {
      if (read.sourceContext)
        read.sourceContext = {
          sourceInstanceOrigin: read.sourceContext.sourceInstanceOrigin,
        };
      const type = read.owner?.nativeTypeEvidence;
      if (
        read.owner?.scopeEvidence?.nativeTypeOrigin === 'CURRENT_DIRECTORY' &&
        type?.actualLabel === 'Bound directory nativeTypeId' &&
        /^CURRENT_DIRECTORY:TDMSOP-[A-F0-9-]{36}$/u.test(type.locator || '')
      )
        type.locator = 'CURRENT_DIRECTORY:CURRENT_CAPTURE';
    }
    for (const occurrence of proof.targetOccurrences || [])
      if (occurrence.origin === 'OWN_FIELD') {
        occurrence.tableId =
          'OWN_FIELD:' + sha256(occurrence.fieldId).slice(0, 32);
        occurrence.occurrenceId =
          'OWN_FIELD:' +
          sha256([
            occurrence.fieldId,
            occurrence.linkIndex,
            occurrence.targetRef,
          ]);
      }
  }
  return value;
}
export const COMPLETE_OWN_PROFILE_REVISION = 'tdms-complete-owned-profiles@1';
const form = (
  objectType,
  nativeClass,
  nativeTypeId,
  kind,
  businessVersionLabel,
  extra = {},
) => ({
  objectType,
  nativeClass,
  nativeTypeId,
  kind,
  businessVersionLabel,
  detailLabel: 'Details',
  ...extra,
});
const related = (
  tableTitle,
  panelLocator,
  gridId,
  tabLabel,
  relationshipRole = 'CURRENT_CONTENT',
) => ({ tableTitle, panelLocator, gridId, tabLabel, relationshipRole });
const sbRelations = [
  related(
    'SB RelationShip',
    '#infoPage_myTab_object_sbRelatedTab',
    'mytreetable',
    'SB Relate Tab',
  ),
  related(
    'History Table',
    '#infoPage_myTab_object_sbRelatedTab',
    'sb.adhistory.list',
    'SB Relate Tab',
    'HISTORICAL_REFERENCE',
  ),
];
const engineeringRelations = [
  related(
    'Equivalent/Subs List',
    '#infoPage_myTab_object_eoRelatedTab',
    'document.equByDoc.list',
    'EO Related Tab',
  ),
  related(
    'EO Delay Request',
    '#infoPage_myTab_object_eoRelatedTab',
    'document.equDoc.list',
    'EO Related Tab',
  ),
  related(
    'EO SubBy List',
    '#infoPage_myTab_object_eoRelatedTab',
    'document.eoFeedbackRecordLink.list',
    'EO Related Tab',
  ),
  related(
    'EO Related Files',
    '#infoPage_myTab_object_eoRelatedTab',
    'document.relatedfile.list',
    'EO Related Tab',
  ),
  related(
    'EO Source Form',
    '#infoPage_myTab_object_eoRelatedTab',
    'document.eoSource.list',
    'EO Related Tab',
  ),
  related(
    'Related StatusLink',
    '#infoPage_myTab_object_latestStatusLink',
    'relatedStatusLinkTable',
    'Related StatusLink',
  ),
];
const doc = {
  nativeClass: 'wt.doc.WTDocument',
  kind: 'MANUFACTURER_FILE',
  detailLabel: 'Details',
  detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
  relationTables: sbRelations,
  ownDocumentHeaderVersionSlot: true,
};
const engineering = {
  objectType: 'EO整体',
  rawHeaderType: 'Publication Source',
  nativeClass: 'wt.epm.EPMDocument',
  nativeTypeId:
    'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
  kind: 'ENGINEERING_FILE',
  businessVersionLabel: 'EO版次:',
  detailLabel: '所有属性',
  dynamicDetailPanel: true,
  relationTables: engineeringRelations,
  subtypeLabel: '指令类别:',
  subtypeLabels: ['指令类别:', '指令类别', '指令类别：'],
  requireSubtype: true,
  ownHeaderVersionSlot: true,
};
export const COMPLETE_OWN_PROFILES = Object.freeze({
  ...Object.fromEntries(
    ['SB', 'SIL', 'SB-IN', 'SL', 'MT'].map((scopeId) => [
      scopeId,
      Object.freeze({
        ...doc,
        scopeId,
        profileId: 'SB_DOCUMENT',
        objectType: 'SB文档',
        nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
        businessVersionLabel: 'SB/SL版本:',
        businessTypeLabel: '类型:',
        businessType: scopeId,
      }),
    ]),
  ),
  AD: Object.freeze({
    ...doc,
    scopeId: 'AD',
    profileId: 'AD_DOCUMENT',
    objectType: 'AD文档',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.ADDocument',
    businessVersionLabel: null,
    relationTables: [],
    layoutEvidencePending: true,
  }),
  AD_HANDLING_FORM: Object.freeze({
    scopeId: 'AD_HANDLING_FORM',
    profileId: 'AD_HANDLING_FORM',
    nativeClass: 'wt.change2.WTChangeRequest2',
    nativeTypeId: null,
    objectType: 'AD处理单',
    kind: 'PROCESSING_SHEET',
    businessVersionLabel: 'AD处理单版本:',
    detailLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_changeRequestDetailsTab',
    relatedOnly: true,
    relationTables: [
      related(
        'AD RelationShip',
        '#infoPage_myTab_ad_adTreeReport',
        'mytreetable',
        'AD RelationShip',
      ),
    ],
    layoutEvidencePending: true,
  }),
  AD_PROCESSING_FORM: Object.freeze(
    form(
      'AD分处理单',
      'wt.change2.WTChangeOrder2',
      'WCTYPE|wt.change2.WTChangeOrder2|com.airchina.ADForm',
      'PROCESSING_SHEET',
      'AD分处理单版本:',
      {
        scopeId: 'AD_PROCESSING_FORM',
        profileId: 'AD_PROCESSING_FORM',
        detailPanel: '#infoPage_myTab_object_changeNoticeDetailsTab',
        relationTables: [
          related(
            'AD Form Table',
            '#infoPage_myTab_ad_adItemTable',
            'ad.item.list',
            'AD Form Table',
          ),
        ],
      },
    ),
  ),
  SB_PROCESSING_FORM: Object.freeze(
    form(
      'SB处理单',
      'wt.change2.WTChangeRequest2',
      'WCTYPE|wt.change2.WTChangeRequest2|com.airchina.SBMainForm',
      'PROCESSING_SHEET',
      'SB处理单版本:',
      {
        scopeId: 'SB_PROCESSING_FORM',
        profileId: 'SB_PROCESSING_FORM',
        detailPanel: '#infoPage_myTab_object_changeRequestDetailsTab',
        relationTables: sbRelations,
      },
    ),
  ),
  SB_ASSESSMENT_FORM: Object.freeze(
    form(
      'SB评估单',
      'wt.change2.WTChangeOrder2',
      'WCTYPE|wt.change2.WTChangeOrder2|com.airchina.SBForm',
      'ENGINEER_ASSESSMENT',
      'SB评估单版本:',
      {
        scopeId: 'SB_ASSESSMENT_FORM',
        profileId: 'SB_ASSESSMENT_FORM',
        detailPanel: '#infoPage_myTab_object_changeNoticeDetailsTab',
        relationTables: sbRelations,
      },
    ),
  ),
  ENGINEERING_ASSESSMENT: Object.freeze(
    form(
      '工程文件编写评估单',
      'wt.doc.WTDocument',
      'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest',
      'ENGINEER_ASSESSMENT',
      null,
      {
        scopeId: 'ENGINEERING_ASSESSMENT',
        profileId: 'ENGINEERING_ASSESSMENT',
        discoverDetailPanel: true,
        relationTables: [],
        layoutEvidencePending: true,
      },
    ),
  ),
  ...Object.fromEntries(
    ['EO', 'EF', 'AEO'].map((scopeId) => [
      scopeId,
      Object.freeze({
        ...engineering,
        scopeId,
        profileId: 'ENGINEERING_INDEPENDENT',
        engineeringSubtype: scopeId,
        layoutEvidencePending: scopeId === 'EF',
      }),
    ]),
  ),
  // Related-only classes/leafs are pinned by original parent observations. Until
  // native representative inputs are reviewed, their roster remains explicitly pending.
  AIRCRAFT_FEEDBACK: Object.freeze({
    scopeId: 'AIRCRAFT_FEEDBACK',
    profileId: 'RELATED_FEEDBACK',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: null,
    objectType: null,
    kind: 'EXECUTION_FEEDBACK',
    businessVersionLabel: null,
    discoverDetailPanel: true,
    relatedOnly: true,
    relationTables: [],
    layoutEvidencePending: true,
    headerNativeTypes: {
      EO反馈单: 'WCTYPE|wt.doc.WTDocument|com.airchina.EORecordLink',
      AD反馈单: 'WCTYPE|wt.doc.WTDocument|com.airchina.ADRecordLink',
      AirCraftRecord: 'WCTYPE|wt.doc.WTDocument|com.airchina.AirCraftRecord',
    },
  }),
  AIRCRAFT_STATUS: Object.freeze({
    scopeId: 'AIRCRAFT_STATUS',
    profileId: 'RELATED_SINGLE_AIRCRAFT_STATUS',
    nativeClass: 'com.airchina.tdms.statuslink.TDMSStatusLink',
    nativeTypeId: null,
    nativeBindingKind: 'CONCRETE_NATIVE_CLASS',
    objectType: null,
    kind: 'EXECUTION_STATUS',
    businessVersionLabel: null,
    discoverDetailPanel: true,
    relatedOnly: true,
    relationTables: [],
    layoutEvidencePending: true,
  }),
  AD_ITEM: Object.freeze({
    scopeId: 'AD_ITEM',
    profileId: 'AD_PROCESSING_FORM',
    nativeClass: 'wt.change2.WTChangeActivity2',
    nativeTypeId: null,
    objectType: null,
    kind: 'PROCESSING_ITEM',
    businessVersionLabel: null,
    discoverDetailPanel: true,
    relatedOnly: true,
    relationTables: [],
    layoutEvidencePending: true,
  }),
});
export function completeOwnProfile(scopeId) {
  const p = COMPLETE_OWN_PROFILES[scopeId];
  if (!p)
    throw Object.assign(new Error('TDMS_COMPLETE_OWN_SCOPE_UNSUPPORTED'), {
      code: 'TDMS_COMPLETE_OWN_SCOPE_UNSUPPORTED',
    });
  return p;
}
export function validateCompleteSourceContext(raw) {
  const v = plainData(raw);
  assertKeys(v, [
    'sourceInstanceOrigin',
    'principalDisplayName',
    'principalId',
    'principalLocator',
    'observedAt',
  ]);
  iso(v.observedAt);
  text(v.principalLocator, 700);
  let url;
  try {
    url = new URL(v.sourceInstanceOrigin);
  } catch {
    fail('TDMS_COMPLETE_SOURCE_CONTEXT_INVALID');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== 'tdms.airchina.com' ||
    url.origin !== v.sourceInstanceOrigin
  )
    fail('TDMS_COMPLETE_SOURCE_CONTEXT_INVALID');
  if (v.principalDisplayName === null) {
    if (
      v.principalId !== null ||
      v.principalLocator !== 'NOT_READ:NATIVE_ACCOUNT_MENU_UNREVIEWED'
    )
      fail('TDMS_COMPLETE_SOURCE_PRINCIPAL_UNVERIFIED');
  } else {
    text(v.principalDisplayName, 120);
    if (!v.principalLocator.startsWith('#'))
      fail('TDMS_COMPLETE_SOURCE_PRINCIPAL_UNVERIFIED');
    if (v.principalId !== null) text(v.principalId, 250);
  }
  return v;
}
export const CURRENT_COMPLETE_ACTION = 'collect-independent-owner-content';
export const COMPLETE_OWN_MODE = 'COMPLETE_OWN_SOURCE@1';
export const COMPLETE_OWN_SCHEMA =
  'wiselink.tdms-owned-complete-source-observation.v1';
export const COMPLETE_OWN_VERIFY = 'owned_complete_source_double_read_v1';
export const COMPLETE_OWN_INPUT_KEYS = Object.freeze([
  'scopeId',
  'profileRevision',
  'documentCode',
  'sourceObjectRef',
  'expectedOwner',
  'sourceProof',
  'purpose',
  'contentMode',
  'openIfMissing',
]);
const OP = /^TDMSOP-[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/u,
  HASH = /^[a-f0-9]{64}$/u;
const REF =
  /^(?:OR|VR):(?:wt\.doc\.WTDocument|wt\.change2\.WTChangeOrder2|wt\.change2\.WTChangeRequest2|wt\.change2\.WTChangeActivity2|wt\.epm\.EPMDocument|wt\.part\.WTPart|com\.airchina\.tdms\.statuslink\.TDMSStatusLink):\d{1,24}$/u;
const states = new Set(EVIDENCE_STATES),
  unknown = () => ({
    rawRevision: null,
    rawIteration: null,
    confirmation: 'VERSION_UNCONFIRMED',
  });
export const completeOwnedVerificationKind = (input) =>
  input?.contentMode === COMPLETE_OWN_MODE ? COMPLETE_OWN_VERIFY : null;
export function completeOwnedStableProjection(v) {
  v = reviewedAdItemEfrBodySemanticProjection(
    reviewedEfStructureSemanticProjection(v),
  );
  if (Array.isArray(v)) return v.map(completeOwnedStableProjection);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(
        ([k]) =>
          ![
            'observedAt',
            'settledAt',
            'windows',
            'treeExpansions',
            'nativeReloadProvenance',
          ].includes(k),
      )
      .map(([k, x]) => [k, completeOwnedStableProjection(x)]),
  );
}
const array = (v, max = 1000) => {
  if (!Array.isArray(v) || v.length > max) fail('TDMS_COMPLETE_OWN_LIMIT');
  return v;
};
const bool = (v) => {
  if (typeof v !== 'boolean') fail('TDMS_COMPLETE_OWN_EVIDENCE_INVALID');
};
const count = (v, max = 20000) => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max)
    fail('TDMS_COMPLETE_OWN_COUNT_INVALID');
};
function ref(v) {
  if (!REF.test(v || '')) fail('TDMS_COMPLETE_OWN_REF_INVALID');
  return v;
}
function sourceVersion(v) {
  version(v);
  if (
    v.confirmation === 'SOURCE_DECLARED' &&
    !/^\d{1,20}$/u.test(v.rawIteration || '')
  )
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  if (
    v.confirmation === 'VERSION_UNCONFIRMED' &&
    stable(v) !== stable(unknown())
  )
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
}
function nativeTypeMatchesProfile(value, p) {
  return p.nativeBindingKind === 'CONCRETE_NATIVE_CLASS'
    ? value === p.nativeClass
    : typeof value === 'string' &&
        value.startsWith('WCTYPE|' + p.nativeClass + '|') &&
        (!p.nativeTypeId || value === p.nativeTypeId);
}
export function validateRequiredTargetSourceProof(
  v,
  targetRef,
  { classificationRequired = false } = {},
) {
  const keys = [
    'kind',
    'parentOperationId',
    'parentPackageId',
    'parentPackageSha256',
    'parentSnapshotId',
    'parentSourceRecordId',
    'parentSourceVersion',
    'tableId',
    'occurrenceId',
    'linkIndex',
    'targetRef',
  ];
  assertKeys(
    v,
    classificationRequired ? [...keys, 'classificationOperationId'] : keys,
  );
  if (
    v.kind !== 'REQUIRED_RELATION_TARGET' ||
    !OP.test(v.parentOperationId || '') ||
    !HASH.test(v.parentPackageSha256 || '') ||
    !/^TDMSSNAP-[a-f0-9]{64}$/u.test(v.parentSnapshotId || '') ||
    v.targetRef !== targetRef ||
    (classificationRequired && !OP.test(v.classificationOperationId || ''))
  )
    fail('TDMS_COMPLETE_OWN_PARENT_REQUIRED');
  if (
    !Number.isSafeInteger(v.linkIndex) ||
    v.linkIndex < 0 ||
    v.linkIndex >= 30
  )
    fail('TDMS_COMPLETE_OWN_PARENT_REQUIRED');
  ref(v.parentSourceRecordId);
  ref(v.targetRef);
  sourceVersion(v.parentSourceVersion);
  for (const key of ['parentPackageId', 'tableId', 'occurrenceId'])
    text(v[key], 200);
  return v;
}
function sourceProof(v, p, input) {
  if (v?.kind === 'CURRENT_DIRECTORY') {
    assertKeys(
      v,
      p.engineeringSubtype
        ? [
            'kind',
            'operationId',
            'rowDigest',
            'scopeDigest',
            'classificationOperationId',
          ]
        : ['kind', 'operationId', 'rowDigest', 'scopeDigest'],
    );
    if (
      p.relatedOnly ||
      !OP.test(v.operationId || '') ||
      !HASH.test(v.rowDigest || '') ||
      !HASH.test(v.scopeDigest || '') ||
      (p.engineeringSubtype && !OP.test(v.classificationOperationId || ''))
    )
      fail('TDMS_COMPLETE_OWN_DIRECTORY_REQUIRED');
  } else if (v?.kind === 'REQUIRED_RELATION_TARGET')
    validateRequiredTargetSourceProof(v, input.sourceObjectRef, {
      classificationRequired:
        !!p.engineeringSubtype ||
        p.scopeId === 'AD_HANDLING_FORM' ||
        (p.nativeClass === 'wt.doc.WTDocument' &&
          Object.hasOwn(v, 'classificationOperationId')),
    });
  else fail('TDMS_COMPLETE_OWN_SOURCE_PROOF_REQUIRED');
}
export function validateCompleteOwnedInput(raw) {
  const v = plainData(raw),
    p = completeOwnProfile(v.scopeId);
  assertKeys(v, COMPLETE_OWN_INPUT_KEYS);
  if (
    v.profileRevision !== COMPLETE_OWN_PROFILE_REVISION ||
    v.purpose !== 'COVERAGE' ||
    v.contentMode !== COMPLETE_OWN_MODE ||
    v.openIfMissing !== false ||
    !new RegExp(
      '^(?:OR|VR):' + p.nativeClass.replaceAll('.', '\\.') + ':\\d{1,24}$',
      'u',
    ).test(v.sourceObjectRef || '')
  )
    fail('TDMS_COMPLETE_OWN_INPUT_INVALID');
  text(v.documentCode, 180);
  if (/[*?\r\n]/u.test(v.documentCode)) fail('TDMS_COMPLETE_OWN_INPUT_INVALID');
  assertKeys(v.expectedOwner, [
    'nativeTypeId',
    'sourceVersion',
    'sourceModifiedRaw',
  ]);
  if (v.expectedOwner.nativeTypeId !== null)
    text(v.expectedOwner.nativeTypeId, 250);
  else if (v.sourceProof?.kind !== 'REQUIRED_RELATION_TARGET')
    fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
  sourceVersion(v.expectedOwner.sourceVersion);
  if (
    v.expectedOwner.nativeTypeId !== null &&
    !nativeTypeMatchesProfile(v.expectedOwner.nativeTypeId, p)
  )
    fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
  if (v.expectedOwner.sourceModifiedRaw !== null)
    text(v.expectedOwner.sourceModifiedRaw, 200);
  sourceProof(v.sourceProof, p, v);
  return v;
}
function typedValue(
  v,
  { allowNull = false, allowBlankLabel = false, allowRawBlank = false } = {},
) {
  assertKeys(v, [
    'state',
    'actualLabel',
    'rawValue',
    'locator',
    'observedTotalCodepoints',
  ]);
  if (!states.has(v.state)) fail('TDMS_COMPLETE_OWN_FIELD_STATE_INVALID');
  if (!(allowBlankLabel && v.actualLabel === '')) text(v.actualLabel, 200);
  text(v.locator, 700);
  if (
    v.rawValue !== null &&
    (typeof v.rawValue !== 'string' || v.rawValue.length > 100000)
  )
    fail('TDMS_COMPLETE_OWN_FIELD_INVALID');
  count(v.observedTotalCodepoints, 1000000);
  if (
    [
      'ABSENT',
      'NOT_APPLICABLE',
      'NOT_READ',
      'NOT_LOADED',
      'ACCESS_DENIED',
    ].includes(v.state) &&
    (v.rawValue !== null || v.observedTotalCodepoints !== 0)
  )
    fail('TDMS_COMPLETE_OWN_FIELD_STATE_INVALID');
  if (
    (v.state === 'BLANK' &&
      (allowRawBlank
        ? typeof v.rawValue !== 'string' ||
          v.rawValue.trim() !== '' ||
          [...v.rawValue].length !== v.observedTotalCodepoints
        : v.rawValue !== '' || v.observedTotalCodepoints !== 0)) ||
    (v.state === 'VALUE' &&
      (typeof v.rawValue !== 'string' ||
        !v.rawValue.trim() ||
        [...v.rawValue].length !== v.observedTotalCodepoints)) ||
    (v.state === 'TRUNCATED' &&
      (typeof v.rawValue !== 'string' ||
        [...v.rawValue].length >= v.observedTotalCodepoints))
  )
    fail('TDMS_COMPLETE_OWN_FIELD_STATE_INVALID');
  if (!allowNull && v.state === 'VALUE' && v.rawValue === null)
    fail('TDMS_COMPLETE_OWN_FIELD_INVALID');
}
export function validateCompleteOwnedOwner(
  o,
  input,
  { classification = false } = {},
) {
  const p = classification
    ? { ...completeOwnProfile('EO'), engineeringSubtype: null }
    : completeOwnProfile(input.scopeId);
  assertKeys(o, [
    'sourceRecordId',
    'number',
    'nativeTypeId',
    'nativeTypeEvidence',
    'rawHeaderIdentifier',
    'rawHeaderType',
    'sourceVersion',
    'technicalVersionEvidence',
    'technicalVersionFieldEvidence',
    'businessVersion',
    'businessVersionEvidence',
    'stateRaw',
    'sourceModifiedRaw',
    'sourceCreatedRaw',
    'contextRaw',
    'scopeEvidence',
    'observedAt',
  ]);
  iso(o.observedAt);
  if (
    o.sourceRecordId !== input.sourceObjectRef ||
    o.number !== input.documentCode ||
    (input.expectedOwner.nativeTypeId !== null &&
      o.nativeTypeId !== null &&
      o.nativeTypeId !== input.expectedOwner.nativeTypeId) ||
    o.rawHeaderIdentifier?.split(',')[0].trim() !== o.number
  )
    fail('TDMS_COMPLETE_OWN_OWNER_INVALID');
  typedValue(o.nativeTypeEvidence);
  if (o.nativeTypeId !== null) {
    text(o.nativeTypeId, 250);
    if (
      !nativeTypeMatchesProfile(o.nativeTypeId, p) ||
      o.nativeTypeEvidence.state !== 'VALUE' ||
      o.nativeTypeEvidence.rawValue !== o.nativeTypeId
    )
      fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
    if (
      input.sourceProof.kind === 'REQUIRED_RELATION_TARGET' &&
      p.headerNativeTypes &&
      p.headerNativeTypes[o.rawHeaderType] !== o.nativeTypeId
    )
      fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
    if (
      p.nativeBindingKind === 'CONCRETE_NATIVE_CLASS' &&
      o.nativeTypeEvidence.actualLabel !== 'Native Class:'
    )
      fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
    if (
      o.nativeTypeEvidence.actualLabel.startsWith('Mapped own header type: ') &&
      (!(
        input.sourceProof.kind === 'REQUIRED_RELATION_TARGET' ||
        (input.sourceProof.kind === 'CURRENT_DIRECTORY' &&
          isReviewedEfRequestOwner({ scopeId: input.scopeId, owner: o }))
      ) ||
        o.nativeTypeEvidence.actualLabel !==
          'Mapped own header type: ' + o.rawHeaderType ||
        o.nativeTypeEvidence.locator !== '#infoPageIdentityDisplayType' ||
        (p.headerNativeTypes?.[o.rawHeaderType] ||
          (p.nativeTypeId &&
          o.rawHeaderType === (p.rawHeaderType || p.objectType) &&
          (!p.rawHeaderType || o.scopeEvidence.rawTypeField === p.objectType)
            ? p.nativeTypeId
            : null)) !== o.nativeTypeId)
    )
      fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
  } else if (
    input.sourceProof.kind !== 'REQUIRED_RELATION_TARGET' ||
    o.nativeTypeEvidence.state !== 'NOT_READ' ||
    o.nativeTypeEvidence.rawValue !== null
  )
    fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
  text(o.rawHeaderIdentifier, 500);
  text(o.rawHeaderType, 160);
  text(o.stateRaw, 120);
  text(o.sourceModifiedRaw, 200);
  for (const k of ['sourceCreatedRaw', 'contextRaw'])
    if (o[k] !== null) text(o[k], 200);
  if (
    (p.objectType && o.rawHeaderType !== (p.rawHeaderType || p.objectType)) ||
    (input.expectedOwner.sourceModifiedRaw !== null &&
      o.sourceModifiedRaw !== input.expectedOwner.sourceModifiedRaw)
  )
    fail('TDMS_COMPLETE_OWN_OWNER_CHANGED');
  sourceVersion(o.sourceVersion);
  typedValue(o.technicalVersionEvidence);
  typedValue(o.technicalVersionFieldEvidence);
  const field = o.technicalVersionFieldEvidence,
    evidence = o.technicalVersionEvidence,
    fieldLabels = ['Version:', 'Version'];
  if (
    !fieldLabels.includes(field.actualLabel) ||
    !['VALUE', 'ABSENT'].includes(field.state) ||
    (field.state === 'ABSENT' && field.actualLabel !== 'Version:')
  )
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  if (evidence.actualLabel === 'Publication Source') {
    const header = o.rawHeaderIdentifier
      .slice(o.number.length)
      .match(/^,\s*([^,]+)\s*$/u);
    if (
      !p.ownHeaderVersionSlot ||
      evidence.locator !== '#infoPageIdentityObjectIdentifier' ||
      evidence.state !== 'VALUE' ||
      !header ||
      header[1].trim() !== evidence.rawValue ||
      (field.state === 'VALUE' && field.rawValue !== evidence.rawValue)
    )
      fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  } else if (evidence.actualLabel === 'Document Header Version') {
    const parts = o.rawHeaderIdentifier.split(',').map((v) => v.trim());
    if (
      !(
        p.ownDocumentHeaderVersionSlot ||
        isReviewedEfRequestOwner({ scopeId: input.scopeId, owner: o })
      ) ||
      evidence.locator !== '#infoPageIdentityObjectIdentifier' ||
      evidence.state !== 'VALUE' ||
      parts.length !== 3 ||
      parts[0] !== o.number ||
      !parts[1] ||
      parts[2] !== evidence.rawValue ||
      (field.state === 'VALUE' && field.rawValue !== evidence.rawValue)
    )
      fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  } else if (stable(evidence) !== stable(field))
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  if (
    !['VALUE', 'ABSENT'].includes(evidence.state) ||
    (evidence.state === 'ABSENT' &&
      stable(o.sourceVersion) !== stable(unknown())) ||
    (evidence.state === 'VALUE' &&
      (o.sourceVersion.confirmation !== 'SOURCE_DECLARED' ||
        evidence.rawValue !==
          o.sourceVersion.rawRevision + '.' + o.sourceVersion.rawIteration))
  )
    fail('TDMS_COMPLETE_OWN_VERSION_INVALID');
  if (
    input.expectedOwner.sourceVersion.confirmation === 'SOURCE_DECLARED' &&
    stable(o.sourceVersion) !== stable(input.expectedOwner.sourceVersion)
  )
    fail('TDMS_COMPLETE_OWN_OWNER_CHANGED');
  typedValue(o.businessVersionEvidence);
  if (o.businessVersion !== null)
    version(o.businessVersion, { business: true });
  const businessScope = classification
    ? o.scopeEvidence?.engineeringSubtype
    : input.scopeId;
  const aeoBusiness =
    o.businessVersionEvidence.actualLabel === 'EO编号:'
      ? parseReviewedAeoOwnBusinessNumber({
          scopeId: businessScope,
          owner: o,
          value: o.businessVersionEvidence,
        })
      : false;
  if (
    (o.businessVersionEvidence.state === 'VALUE' &&
      ((aeoBusiness
        ? stable(o.businessVersion) !== stable(aeoBusiness)
        : o.businessVersion?.rawRevision !==
          o.businessVersionEvidence.rawValue) ||
        o.businessVersion.rawIteration !== null ||
        o.businessVersion.confirmation !== 'SOURCE_DECLARED')) ||
    (o.businessVersionEvidence.state !== 'VALUE' && o.businessVersion !== null)
  )
    fail('TDMS_COMPLETE_OWN_BUSINESS_VERSION_INVALID');
  assertKeys(o.scopeEvidence, [
    'nativeTypeOrigin',
    'businessType',
    'engineeringSubtype',
    'rawTypeField',
  ]);
  if (o.scopeEvidence.nativeTypeOrigin !== input.sourceProof.kind)
    fail('TDMS_COMPLETE_OWN_TYPE_INVALID');
  if (
    (p.businessType && o.scopeEvidence.businessType !== p.businessType) ||
    (p.engineeringSubtype &&
      o.scopeEvidence.engineeringSubtype !== p.engineeringSubtype)
  )
    fail('TDMS_COMPLETE_OWN_SUBTYPE_INVALID');
  for (const k of ['businessType', 'engineeringSubtype', 'rawTypeField'])
    if (o.scopeEvidence[k] !== null) text(o.scopeEvidence[k], 200);
  validateReviewedAdHandlingOwner({ scopeId: input.scopeId, owner: o });
}
function validateRoster(read, input) {
  const p = completeOwnProfile(input.scopeId);
  for (const key of ['tabs', 'sections', 'fields', 'attachments'])
    array(read[key], key === 'fields' ? 1000 : 200);
  const tabIds = new Set(),
    sectionIds = new Set(),
    fieldIds = new Set();
  for (const t of read.tabs) {
    assertKeys(
      t,
      [
        'tabId',
        'label',
        'panelLocator',
        'state',
        'required',
        'sourceDeclared',
        'reasonCode',
        'purposeEvidence',
      ],
      [
        'tabId',
        'label',
        'panelLocator',
        'state',
        'required',
        'sourceDeclared',
        'reasonCode',
      ],
    );
    text(t.tabId, 200);
    text(t.label, 200);
    text(t.panelLocator, 500);
    bool(t.required);
    bool(t.sourceDeclared);
    if (
      tabIds.has(t.tabId) ||
      !states.has(t.state) ||
      t.sourceDeclared !== true
    )
      fail('TDMS_COMPLETE_OWN_ROSTER_INVALID');
    tabIds.add(t.tabId);
    if (t.reasonCode !== null) text(t.reasonCode, 120);
  }
  for (const s of read.sections) {
    assertKeys(s, [
      'sectionId',
      'tabId',
      'label',
      'panelLocator',
      'state',
      'sourceDeclared',
    ]);
    text(s.sectionId, 500);
    text(s.label, 200);
    text(s.panelLocator, 500);
    if (
      !tabIds.has(s.tabId) ||
      sectionIds.has(s.sectionId) ||
      !states.has(s.state) ||
      s.sourceDeclared !== true
    )
      fail('TDMS_COMPLETE_OWN_ROSTER_INVALID');
    sectionIds.add(s.sectionId);
  }
  // New anonymous raw properties opt into the exact reviewed roster. Old
  // unqualified NOT_READ observations keep their original narrower meaning.
  const qualifiedAnonymousRead =
    input.scopeId !== 'AD_HANDLING_FORM' &&
    read.fields.some(
      (field) =>
        Object.hasOwn(field, 'rawTextQualification') ||
        Object.hasOwn(field, 'rawCaptionText'),
    );
  if (qualifiedAnonymousRead)
    validateReviewedAnonymousOwnRawRead({
      scopeId: input.scopeId,
      owner: read.owner,
      read,
    });
  for (const f of read.fields) {
    assertKeys(
      f,
      [
        'fieldId',
        'tabId',
        'sectionId',
        'labelOrigin',
        'nativeControl',
        'value',
        'links',
        'rawTextQualification',
        'rawCaptionText',
      ],
      [
        'fieldId',
        'tabId',
        'sectionId',
        'labelOrigin',
        'nativeControl',
        'value',
        'links',
      ],
    );
    text(f.fieldId, 700);
    if (
      fieldIds.has(f.fieldId) ||
      !sectionIds.has(f.sectionId) ||
      !tabIds.has(f.tabId) ||
      !['NATIVE_SOURCE_DECLARED', 'PROFILE_EXPECTED'].includes(f.labelOrigin)
    )
      fail('TDMS_COMPLETE_OWN_ROSTER_INVALID');
    fieldIds.add(f.fieldId);
    const context = {
      scopeId: input.scopeId,
      owner: read.owner,
      read,
      field: f,
    };
    const anonymousCaption =
      qualifiedAnonymousRead && validateReviewedAnonymousOwnRawField(context);
    if (input.scopeId === 'AD_HANDLING_FORM') {
      validateReviewedAdHandlingRawTextField(context);
      if (Object.hasOwn(f, 'rawCaptionText'))
        fail('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
    } else if (
      !anonymousCaption &&
      (Object.hasOwn(f, 'rawTextQualification') ||
        Object.hasOwn(f, 'rawCaptionText'))
    )
      fail('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
    const unknownCaption =
      !anonymousCaption &&
      isReviewedEfRequestUnknownFieldCaption({
        scopeId: input.scopeId,
        owner: read.owner,
        field: f,
      });
    typedValue(f.value, {
      allowBlankLabel: unknownCaption || anonymousCaption,
      allowRawBlank: anonymousCaption,
    });
    if (
      unknownCaption &&
      (read.tabs.find((t) => t.tabId === f.tabId)?.state !== 'NOT_READ' ||
        !Array.isArray(read.rosterEvidence?.unknownRequiredSurfaces) ||
        !read.rosterEvidence.unknownRequiredSurfaces.includes(f.value.locator))
    )
      fail('TDMS_COMPLETE_OWN_UNKNOWN_CAPTION_UNACKNOWLEDGED');
    array(f.links, 30);
    for (const link of f.links) validateRawLink(link);
    assertKeys(f.nativeControl, ['tag', 'readOnly', 'disabled']);
    text(f.nativeControl.tag, 30);
    for (const k of ['readOnly', 'disabled'])
      if (f.nativeControl[k] !== null) bool(f.nativeControl[k]);
    if (
      f.value.state === 'VALUE' &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(f.nativeControl.tag) &&
      f.nativeControl.readOnly !== true &&
      f.nativeControl.disabled !== true
    )
      fail('TDMS_COMPLETE_OWN_EDITABLE_FIELD_REJECTED');
    if (
      isAssessmentOpinionLabel(f.value.actualLabel) &&
      (![
        'SB_ASSESSMENT_FORM',
        'ENGINEERING_ASSESSMENT',
        'AD_PROCESSING_FORM',
        'AD_ITEM',
      ].includes(input.scopeId) ||
        read.owner.stateRaw !== 'Estimated') &&
      (f.value.state !== 'NOT_APPLICABLE' || f.value.rawValue !== null)
    )
      fail(
        read.owner.stateRaw === 'Estimating'
          ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
          : 'TDMS_OPINION_STATE_NOT_ELIGIBLE',
      );
  }
  for (const a of read.attachments) {
    assertKeys(
      a,
      [
        'ownerSourceRecordId',
        'sourceVersion',
        'sourceAttachmentId',
        'role',
        'filename',
        'rawHref',
        'locator',
        'state',
        'primaryMetadata',
      ],
      [
        'ownerSourceRecordId',
        'sourceVersion',
        'sourceAttachmentId',
        'role',
        'filename',
        'rawHref',
        'locator',
        'state',
      ],
    );
    if (
      a.ownerSourceRecordId !== input.sourceObjectRef ||
      stable(a.sourceVersion) !== stable(read.owner.sourceVersion) ||
      !states.has(a.state)
    )
      fail('TDMS_COMPLETE_OWN_ATTACHMENT_BINDING_INVALID');
    for (const k of ['role', 'locator']) text(a[k], 500);
    for (const k of ['sourceAttachmentId', 'filename', 'rawHref'])
      if (a[k] !== null) text(a[k], 2000);
    if (a.role === 'PRIMARY') {
      const evidence = a.primaryMetadata,
        keys = [
          'sourceAttachmentId',
          'role',
          'filename',
          'format',
          'sizeRaw',
          'ownerTechnicalVersion',
          'ownerBusinessVersion',
          'observedAt',
          'evidenceLocator',
          'bytesCollected',
        ],
        markerKeys = ['metadataRevision', 'metadataState', 'metadataGapCodes'];
      assertKeys(evidence, [...keys, ...markerKeys], keys);
      const marked = Object.hasOwn(evidence, 'metadataRevision');
      if (marked) {
        if (
          evidence.metadataRevision !== COMPLETE_PRIMARY_METADATA_REVISION ||
          !['VALUE', 'NOT_READ'].includes(evidence.metadataState) ||
          a.state !== evidence.metadataState
        )
          fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
        array(evidence.metadataGapCodes, 6);
        if (
          new Set(evidence.metadataGapCodes).size !==
            evidence.metadataGapCodes.length ||
          evidence.metadataGapCodes.some(
            (code) => !/^TDMS_COMPLETE_PRIMARY_[A-Z_]+$/u.test(code),
          ) ||
          (evidence.metadataState === 'VALUE' &&
            evidence.metadataGapCodes.length) ||
          (evidence.metadataState === 'NOT_READ' &&
            !evidence.metadataGapCodes.length)
        )
          fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
      } else if (
        markerKeys.some((k) => Object.hasOwn(evidence, k)) ||
        a.state !== 'VALUE'
      )
        fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
      if (
        !['SB文档', 'AD文档'].includes(read.owner.rawHeaderType) ||
        a.rawHref !== null ||
        evidence.role !== 'PRIMARY' ||
        evidence.sourceAttachmentId !== a.sourceAttachmentId ||
        evidence.filename !== a.filename ||
        evidence.evidenceLocator !== a.locator ||
        evidence.bytesCollected !== false ||
        stable(evidence.ownerTechnicalVersion) !==
          stable(read.owner.sourceVersion) ||
        stable(evidence.ownerBusinessVersion) !==
          stable(read.owner.businessVersion)
      )
        fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
      if (a.state === 'VALUE') {
        if (
          !/^OR:wt\.content\.ApplicationData:\d{1,24}$/u.test(
            a.sourceAttachmentId || '',
          )
        )
          fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
        for (const key of ['filename', 'format', 'sizeRaw'])
          text(evidence[key], 700);
      } else {
        if (
          a.sourceAttachmentId !== null &&
          !/^OR:wt\.content\.ApplicationData:\d{1,24}$/u.test(
            a.sourceAttachmentId || '',
          )
        )
          fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
        for (const key of ['filename', 'format', 'sizeRaw'])
          if (evidence[key] !== null) text(evidence[key], 700);
      }
      text(evidence.evidenceLocator, 700);
      iso(evidence.observedAt);
    } else if (a.primaryMetadata !== undefined)
      fail('TDMS_COMPLETE_OWN_PRIMARY_METADATA_UNVERIFIED');
  }
  assertKeys(
    read.rosterEvidence,
    [
      'tabRosterSource',
      'tabIds',
      'structuralRosters',
      'unreadControls',
      'unknownRequiredSurfaces',
      'layoutEvidencePending',
      'nativeTabStripIds',
      'nonContentControls',
    ],
    [
      'tabRosterSource',
      'tabIds',
      'structuralRosters',
      'unreadControls',
      'unknownRequiredSurfaces',
      'layoutEvidencePending',
    ],
  );
  validateReviewedCompleteTabRoster({
    scopeId: input.scopeId,
    owner: read.owner,
    rosterEvidence: read.rosterEvidence,
    contentTabIds: read.tabs.map((t) => t.tabId),
  });
  validateReviewedCompleteTabPurposes({
    scopeId: input.scopeId,
    owner: read.owner,
    read,
  });
  const modifiedMirrors = validateReviewedEfRequestModifiedMirrors({
    scopeId: input.scopeId,
    owner: read.owner,
    fields: read.fields,
  });
  if (
    modifiedMirrors &&
    modifiedMirrors.state === 'NOT_READ' &&
    modifiedMirrors.unreadLocators.some(
      (locator) =>
        read.tabs.find(
          (t) =>
            t.tabId ===
            read.fields.find((f) => f.value.locator === locator)?.tabId,
        )?.state !== 'NOT_READ',
    )
  )
    fail('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_UNREAD');
  if (read.rosterEvidence.tabRosterSource !== 'OWN_INFOPAGE_TAB_STRIP')
    fail('TDMS_COMPLETE_OWN_ROSTER_INVALID');
  array(read.rosterEvidence.tabIds, 200);
  if (
    stable(read.rosterEvidence.tabIds) !== stable(read.tabs.map((t) => t.tabId))
  )
    fail('TDMS_COMPLETE_OWN_ROSTER_INVALID');
  for (const k of ['unreadControls', 'unknownRequiredSurfaces']) {
    array(read.rosterEvidence[k], 200);
    for (const v of read.rosterEvidence[k]) text(v, 500);
  }
  validateCompleteStructuralRosters(read, input.scopeId, read.owner);
  validateReviewedAdModifiedMirrors({
    scopeId: input.scopeId,
    owner: read.owner,
    fields: read.fields,
    sections: read.sections,
  });
  bool(read.rosterEvidence.layoutEvidencePending);
  if (
    p.layoutEvidencePending &&
    read.rosterEvidence.layoutEvidencePending !== true
  )
    fail('TDMS_COMPLETE_OWN_LAYOUT_PENDING_REQUIRED');
}
export function completeOwnedColumnRole(gridId, label, token) {
  if (gridId !== 'relatedStatusLinkTable') return null;
  const tokens = {
    number: ['Number', 'STATUS_LINK'],
    feedbackOid: ['Feed Back Order', 'FEEDBACK_LINK'],
    docOid: ['Document Number', 'ENGINEERING_DOC_REFERENCE'],
    standaloneOid: ['AC/ENG/APU', 'LCM_AUTHORITY_REFERENCE'],
    delayRequest: [null, 'DELAY_REQUEST_REFERENCE'],
    subs: [null, 'SUBSTITUTION_REFERENCE'],
    subsBy: [null, 'SUBSTITUTED_BY_REFERENCE'],
    equiv: [null, 'EQUIVALENT_REFERENCE'],
    equivBy: [null, 'EQUIVALENT_BY_REFERENCE'],
  };
  if (token) {
    const model = tokens[token];
    return model && (!model[0] || model[0] === label)
      ? model[1]
      : 'UNREVIEWED_NATIVE_COLUMN';
  }
  const match = Object.values(tokens).find(([name]) => name === label);
  return match ? match[1] : 'UNREVIEWED_NATIVE_COLUMN';
}
function validateRawLink(l) {
  assertKeys(
    l,
    [
      'rawHref',
      'targetRef',
      'numberRaw',
      'nativeRole',
      'locator',
      'nativeColumnLabel',
      'nativeColumnToken',
    ],
    ['rawHref', 'targetRef', 'numberRaw', 'nativeRole', 'locator'],
  );
  text(l.rawHref, 2000);
  if (
    l.targetRef !== null &&
    !REF.test(l.targetRef || '') &&
    !RAW_REFERENCE.test(l.targetRef || '')
  )
    fail('TDMS_COMPLETE_OWN_REF_INVALID');
  if (typeof l.numberRaw !== 'string' || l.numberRaw.length > 500)
    fail('TDMS_COMPLETE_OWN_LINK_INVALID');
  text(l.nativeRole, 120);
  text(l.locator, 700);
  if (
    l.nativeColumnLabel !== undefined &&
    (typeof l.nativeColumnLabel !== 'string' ||
      l.nativeColumnLabel.length > 200)
  )
    fail('TDMS_COMPLETE_OWN_LINK_INVALID');
  if (l.nativeColumnToken !== undefined && l.nativeColumnToken !== null)
    text(l.nativeColumnToken, 160);
  let u;
  try {
    u = new URL(l.rawHref, 'http://tdms.airchina.com');
  } catch {
    fail('TDMS_COMPLETE_OWN_LINK_INVALID');
  }
  if (
    u.username ||
    u.password ||
    [
      ...u.searchParams.keys(),
      ...new URLSearchParams(u.hash.split('?')[1] || '').keys(),
    ].some((k) => /token|auth|sig|session|ticket/iu.test(k))
  )
    fail('TDMS_COMPLETE_OWN_LINK_INVALID');
}
// Raw native view/filter evidence only; it grants no applicability coverage or
// completion certificate. Historical relation DTOs keep this object absent.
function validateRelatedStatusSourceViewEvidence(
  v,
  { owner, tabId, panelLocator, gridId, table, read },
) {
  if (
    v?.schemaVersion ===
    REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL.schemaVersion
  ) {
    // Actual table/read are mandatory in the Host consumer. A detached native
    // toolbar proof cannot assert a different window or borrow an own subtype.
    if (!table || !read) fail('TDMS_COMPLETE_AEO_STATUS_NATIVE_VIEW_INVALID');
    return validateReviewedAeoImplicitStatusSourceView(v, {
      owner,
      tabId,
      panelLocator,
      gridId,
      table,
      read,
    });
  }
  const invalid = () => fail('TDMS_COMPLETE_RELATED_STATUS_VIEW_INVALID');
  const keys = (value, names) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== names.length ||
      Object.keys(value).some((key) => !names.includes(key))
    )
      invalid();
  };
  const valueText = (value, max = 700) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      invalid();
  };
  const control = (value) => {
    keys(value, ['locator', 'tag', 'actualLabel', 'rawValue']);
    for (const key of ['locator', 'tag', 'actualLabel', 'rawValue'])
      valueText(value[key], key === 'rawValue' ? 1000 : 700);
    if (
      !value.locator.startsWith('#') ||
      !['SELECT', 'INPUT', 'SPAN', 'DIV', 'BUTTON'].includes(value.tag)
    )
      invalid();
  };
  keys(v, [
    'schemaVersion',
    'state',
    'modelRevision',
    'evidenceLocator',
    'ownerSourceRecordId',
    'ownerTechnicalVersion',
    'ownerBusinessVersion',
    'tabId',
    'panelLocator',
    'gridId',
    'nativeView',
    'nativeFilters',
    'observedAt',
    ...(Object.hasOwn(v || {}, 'rawControlObservations')
      ? ['rawControlObservations']
      : []),
  ]);
  if (Object.hasOwn(v, 'rawControlObservations')) {
    if (
      !Array.isArray(v.rawControlObservations) ||
      v.rawControlObservations.length > 1
    )
      invalid();
    for (const c of v.rawControlObservations) {
      keys(c, ['locator', 'tag', 'actualLabel', 'rawValue', 'state']);
      if (
        c.locator !==
          '#relatedStatusLinkTable [id="relatedStatusLinkTable.searchInListTextBox"]' ||
        c.tag !== 'INPUT'
      )
        invalid();
      if (
        c.actualLabel !== null &&
        (typeof c.actualLabel !== 'string' || c.actualLabel.length > 700)
      )
        invalid();
      if (
        typeof c.rawValue !== 'string' ||
        c.rawValue.length > 1000 ||
        c.state !== (c.rawValue.trim() ? 'VALUE' : 'BLANK')
      )
        invalid();
    }
  }
  if (
    v.schemaVersion !== 'wiselink.tdms-related-status-source-view.v1' ||
    v.ownerSourceRecordId !== owner.sourceRecordId ||
    stable(v.ownerTechnicalVersion) !== stable(owner.sourceVersion) ||
    stable(v.ownerBusinessVersion) !== stable(owner.businessVersion) ||
    v.tabId !== tabId ||
    tabId !== 'infoPageinfoPanelID__infoPage_myTab_object_latestStatusLink' ||
    v.panelLocator !== panelLocator ||
    panelLocator !== '#infoPage_myTab_object_latestStatusLink' ||
    v.gridId !== gridId ||
    gridId !== 'relatedStatusLinkTable' ||
    v.evidenceLocator !== panelLocator + ' #' + gridId
  )
    invalid();
  valueText(v.observedAt, 100);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v.observedAt) ||
    !Number.isFinite(Date.parse(v.observedAt))
  )
    invalid();
  keys(v.nativeView, ['state', 'control']);
  keys(v.nativeFilters, ['state', 'controls', 'noFilterDeclaration']);
  if (v.state === 'NOT_READ') {
    if (
      v.modelRevision !== null ||
      v.nativeView.state !== 'NOT_READ' ||
      v.nativeView.control !== null ||
      v.nativeFilters.state !== 'NOT_READ' ||
      v.nativeFilters.controls !== null ||
      v.nativeFilters.noFilterDeclaration !== null
    )
      invalid();
    return;
  }
  if (v.state !== 'VALUE' || v.nativeView.state !== 'VALUE') invalid();
  valueText(v.modelRevision, 160);
  control(v.nativeView.control);
  const filters = v.nativeFilters;
  if (filters.state === 'NONE') {
    if (!Array.isArray(filters.controls) || filters.controls.length) invalid();
    control(filters.noFilterDeclaration);
  } else if (filters.state === 'VALUE') {
    if (
      !Array.isArray(filters.controls) ||
      !filters.controls.length ||
      filters.controls.length > 20 ||
      filters.noFilterDeclaration !== null
    )
      invalid();
    filters.controls.forEach(control);
    if (
      new Set(filters.controls.map((value) => value.locator)).size !==
      filters.controls.length
    )
      invalid();
  } else invalid();
}

export function validateCompleteRelationTable(t, input, owner, read = null) {
  assertKeys(
    t,
    [
      'tableId',
      'tabId',
      'tableTitle',
      'panelLocator',
      'gridId',
      'relationshipRole',
      'direction',
      'rawHeaders',
      'reportedTotal',
      'countEvidence',
      'scanMode',
      'rows',
      'windows',
      'treeExpansions',
      'terminal',
      'enumerationState',
      'stopReason',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'observedAt',
      'nativeStatusProof',
      'sourceViewEvidence',
      'nativeRowSlotEvidence',
      'nativeTreeEvidence',
      'efQueryEvidence',
      'relatedSurfaceEvidence',
      'relatedQueryEvidence',
    ],
    [
      'tableId',
      'tabId',
      'tableTitle',
      'panelLocator',
      'gridId',
      'relationshipRole',
      'direction',
      'rawHeaders',
      'reportedTotal',
      'countEvidence',
      'scanMode',
      'rows',
      'windows',
      'treeExpansions',
      'terminal',
      'enumerationState',
      'stopReason',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'observedAt',
    ],
  );
  for (const k of [
    'tableId',
    'tabId',
    'tableTitle',
    'panelLocator',
    'gridId',
    'relationshipRole',
    'direction',
  ])
    text(t[k], 500);
  if (
    ![
      'CURRENT_CONTENT',
      'HISTORICAL_REFERENCE',
      'LCM_AUTHORITY_REFERENCE',
      'EXTERNAL_AUTHORITY_REFERENCE',
      'UNKNOWN',
    ].includes(t.relationshipRole) ||
    !['SOURCE_TO_TARGET', 'TARGET_TO_SOURCE', 'UNKNOWN'].includes(t.direction)
  )
    fail('TDMS_COMPLETE_RELATION_ROLE_INVALID');
  if (
    t.ownerSourceRecordId !== input.sourceObjectRef ||
    stable(t.ownerSourceVersion) !== stable(owner.sourceVersion)
  )
    fail('TDMS_COMPLETE_RELATION_OWNER_CHANGED');
  iso(t.observedAt);
  if (t.reportedTotal !== null) count(t.reportedTotal);
  assertKeys(t.countEvidence, ['rawText', 'exact', 'locator']);
  bool(t.countEvidence.exact);
  text(t.countEvidence.locator, 700);
  if (
    t.countEvidence.rawText !== null &&
    typeof t.countEvidence.rawText !== 'string'
  )
    fail('TDMS_COMPLETE_RELATION_COUNT_UNVERIFIED');
  const efUsesStatus = isReviewedEfStructureTable(t)
    ? validateReviewedEfStructureUsesEvidence(t.relatedSurfaceEvidence, {
        scopeId: input.scopeId,
        owner,
        table: t,
      })
    : null;
  if (
    t.countEvidence.exact &&
    (efUsesStatus
      ? efUsesStatus.complete !== true
      : t.reportedTotal === null ||
        !/^\(\s*\d+\s+objects?\s*\)$/iu.test(t.countEvidence.rawText || '') ||
        Number(t.countEvidence.rawText.match(/\d+/u)[0]) !== t.reportedTotal)
  )
    fail('TDMS_COMPLETE_RELATION_COUNT_UNVERIFIED');
  if (
    efUsesStatus &&
    t.relatedSurfaceEvidence === undefined &&
    (t.enumerationState !== 'NOT_READ' ||
      t.stopReason !== REVIEWED_EFREQUEST_STRUCTURE_MODEL.stopReason ||
      t.scanMode !== 'DOM_ROWS' ||
      t.reportedTotal !== null ||
      t.countEvidence.rawText !== null ||
      !Array.isArray(t.rows) ||
      t.rows.length !== 0 ||
      !Array.isArray(t.treeExpansions) ||
      t.treeExpansions.length !== 0 ||
      stable(t.terminal) !==
        stable({
          kind: 'UNCONFIRMED',
          total: null,
          captured: 0,
          allGlobalIndices: false,
          allTreeNodesExpanded: false,
          nativeTerminal: false,
          trueZero: false,
          settledReads: 2,
        }) ||
      !Array.isArray(t.windows) ||
      t.windows.length !== 1 ||
      t.windows[0]?.reportedTotal !== null ||
      !Array.isArray(t.windows[0].rowOccurrenceIds) ||
      t.windows[0].rowOccurrenceIds.length !== 0 ||
      !Array.isArray(t.windows[0].globalIndices) ||
      t.windows[0].globalIndices.length !== 0 ||
      t.windows[0].pageRaw !== null ||
      t.windows[0].scroll !== null ||
      t.windows[0].treePending !== 1 ||
      stable(t.windows[0].nextControl) !==
        stable({ present: false, enabled: false, terminalDeclared: false }) ||
      ['efQueryEvidence', 'relatedQueryEvidence', 'nativeTreeEvidence'].some(
        (key) => Object.hasOwn(t, key),
      ))
  )
    fail('TDMS_COMPLETE_RELATION_ENUM_UNPROVEN');
  if (
    !['DOM_ROWS', 'NATIVE_PAGER', 'VIRTUAL_SCROLL', 'TREE'].includes(
      t.scanMode,
    ) ||
    !['VALUE', 'NOT_LOADED', 'NOT_READ', 'TRUNCATED', 'ACCESS_DENIED'].includes(
      t.enumerationState,
    )
  )
    fail('TDMS_COMPLETE_RELATION_ENUM_INVALID');
  array(t.rawHeaders, 80);
  for (const h of t.rawHeaders)
    if (typeof h !== 'string' || h.length > 200)
      fail('TDMS_COMPLETE_RELATION_HEADERS_INVALID');
  const rowIds = new Set(),
    indices = new Set();
  array(t.rows, 1000);
  for (const row of t.rows) {
    assertKeys(row, [
      'occurrenceId',
      'globalIndex',
      'nativeRowId',
      'treePath',
      'treeDepth',
      'nativeRelationId',
      'rawRole',
      'rawDirection',
      'cells',
      'sourceLinks',
      'observedVersion',
    ]);
    text(row.occurrenceId, 200);
    if (rowIds.has(row.occurrenceId))
      fail('TDMS_COMPLETE_RELATION_ROW_DUPLICATE');
    rowIds.add(row.occurrenceId);
    if (row.globalIndex !== null) {
      count(row.globalIndex);
      if (indices.has(row.globalIndex))
        fail('TDMS_COMPLETE_RELATION_ROW_DUPLICATE');
      indices.add(row.globalIndex);
    }
    if (row.nativeRowId !== null) text(row.nativeRowId, 500);
    if (row.nativeRelationId !== null) text(row.nativeRelationId, 500);
    for (const k of ['rawRole', 'rawDirection'])
      if (row[k] !== null) text(row[k], 500);
    array(row.treePath, 40);
    for (const v of row.treePath) text(v, 500);
    if (row.treeDepth !== null) count(row.treeDepth, 40);
    sourceVersion(row.observedVersion);
    array(row.cells, 80);
    if (row.cells.length !== t.rawHeaders.length)
      fail('TDMS_COMPLETE_RELATION_HEADERS_INVALID');
    for (const [i, c] of row.cells.entries()) {
      assertKeys(c, [
        'actualLabel',
        'rawValue',
        'state',
        'observedTotalCodepoints',
      ]);
      if (c.actualLabel !== t.rawHeaders[i])
        fail('TDMS_COMPLETE_RELATION_HEADERS_INVALID');
      typedValue({
        ...c,
        actualLabel: c.actualLabel || 'COLUMN_' + i,
        locator: t.panelLocator,
      });
      if (isAssessmentOpinionLabel(c.actualLabel) && c.rawValue !== null)
        fail('TDMS_RELATED_ASSESSMENT_BODY_REQUIRES_OWN_ESTIMATED_RECORD');
    }
    array(row.sourceLinks, 30);
    for (const l of row.sourceLinks) {
      validateRawLink(l);
      if (
        !t.rawHeaders.includes(l.nativeColumnLabel) ||
        (t.gridId === 'relatedStatusLinkTable' &&
          l.nativeRole !==
            completeOwnedColumnRole(
              t.gridId,
              l.nativeColumnLabel,
              l.nativeColumnToken,
            )) ||
        (t.gridId !== 'relatedStatusLinkTable' &&
          [
            'STATUS_LINK',
            'FEEDBACK_LINK',
            'ENGINEERING_DOC_REFERENCE',
            'LCM_AUTHORITY_REFERENCE',
          ].includes(l.nativeRole))
      )
        fail('TDMS_COMPLETE_RELATION_ROLE_INVALID');
    }
  }
  array(t.windows, 200);
  const captured = new Set();
  for (const [i, w] of t.windows.entries()) {
    assertKeys(w, [
      'ordinal',
      'rowOccurrenceIds',
      'globalIndices',
      'reportedTotal',
      'pageRaw',
      'scroll',
      'nextControl',
      'stableReads',
      'treePending',
      'observedAt',
    ]);
    if (w.ordinal !== i || w.stableReads !== 2)
      fail('TDMS_COMPLETE_RELATION_WINDOW_UNVERIFIED');
    array(w.rowOccurrenceIds, 1000);
    array(w.globalIndices, 1000);
    for (const id of w.rowOccurrenceIds) {
      if (!rowIds.has(id)) fail('TDMS_COMPLETE_RELATION_WINDOW_UNVERIFIED');
      captured.add(id);
    }
    for (const idx of w.globalIndices) count(idx);
    if (w.reportedTotal !== null) count(w.reportedTotal);
    if (w.pageRaw !== null) text(w.pageRaw, 200);
    count(w.treePending, 1000);
    iso(w.observedAt);
    assertKeys(w.nextControl, ['present', 'enabled', 'terminalDeclared']);
    for (const v of Object.values(w.nextControl)) bool(v);
    if (w.scroll !== null) {
      assertKeys(w.scroll, ['top', 'height', 'viewport', 'atTop', 'atBottom']);
      for (const k of ['top', 'height', 'viewport'])
        if (!Number.isFinite(w.scroll[k]) || w.scroll[k] < 0)
          fail('TDMS_COMPLETE_RELATION_WINDOW_UNVERIFIED');
      bool(w.scroll.atTop);
      bool(w.scroll.atBottom);
    }
  }
  if (captured.size !== rowIds.size)
    fail('TDMS_COMPLETE_RELATION_WINDOW_UNVERIFIED');
  array(t.treeExpansions, 1000);
  for (const e of t.treeExpansions) {
    // The reviewed tree model below validates every before/after control,
    // shape and window binding. It never promotes the terminal to complete.
    if (t.nativeTreeEvidence !== undefined) continue;
    assertKeys(e, [
      'nativeRowId',
      'path',
      'beforeExpanded',
      'afterExpanded',
      'addedOccurrenceIds',
    ]);
    text(e.nativeRowId, 500);
    array(e.path, 40);
    bool(e.beforeExpanded);
    bool(e.afterExpanded);
    if (e.beforeExpanded || !e.afterExpanded)
      fail('TDMS_COMPLETE_RELATION_TREE_UNVERIFIED');
    array(e.addedOccurrenceIds, 1000);
    for (const id of e.addedOccurrenceIds)
      if (!rowIds.has(id)) fail('TDMS_COMPLETE_RELATION_TREE_UNVERIFIED');
  }
  assertKeys(t.terminal, [
    'kind',
    'total',
    'captured',
    'allGlobalIndices',
    'allTreeNodesExpanded',
    'nativeTerminal',
    'trueZero',
    'settledReads',
  ]);
  for (const k of [
    'allGlobalIndices',
    'allTreeNodesExpanded',
    'nativeTerminal',
    'trueZero',
  ])
    bool(t.terminal[k]);
  count(t.terminal.captured, 1000);
  if (t.terminal.total !== null) count(t.terminal.total);
  if (
    !['NATIVE_END', 'UNCONFIRMED'].includes(t.terminal.kind) ||
    t.terminal.captured !== t.rows.length ||
    t.terminal.total !== t.reportedTotal ||
    t.terminal.settledReads !== 2
  )
    fail('TDMS_COMPLETE_RELATION_TERMINAL_INVALID');
  const contiguous =
    t.reportedTotal !== null &&
    t.rows.length === t.reportedTotal &&
    indices.size === t.reportedTotal &&
    Array.from({ length: t.reportedTotal }, (_, i) => i).every((i) =>
      indices.has(i),
    );
  if (
    t.terminal.allGlobalIndices !== contiguous ||
    t.terminal.trueZero !==
      (t.reportedTotal === 0 &&
        t.rows.length === 0 &&
        t.countEvidence.exact &&
        t.terminal.nativeTerminal &&
        t.terminal.allTreeNodesExpanded)
  )
    fail('TDMS_COMPLETE_RELATION_TERMINAL_INVALID');
  if (
    t.enumerationState === 'VALUE' &&
    (!contiguous ||
      !t.countEvidence.exact ||
      !t.terminal.nativeTerminal ||
      !t.terminal.allTreeNodesExpanded ||
      t.terminal.kind !== 'NATIVE_END' ||
      t.stopReason !== null)
  )
    fail('TDMS_COMPLETE_RELATION_ENUM_UNPROVEN');
  if (t.nativeStatusProof !== undefined) {
    const proof = t.nativeStatusProof;
    assertKeys(proof, [
      'schemaVersion',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'engineeringDocumentNumber',
      'statusTable',
    ]);
    if (
      t.gridId !== 'relatedStatusLinkTable' ||
      proof.schemaVersion !== 'wiselink.tdms-reused-status-enumeration.v1' ||
      proof.ownerSourceRecordId !== owner.sourceRecordId ||
      stable(proof.ownerSourceVersion) !== stable(owner.sourceVersion)
    )
      fail('TDMS_COMPLETE_ENGINEERING_REUSED_STATUS_UNVERIFIED');
    const status = validateReusedEngineeringStatusTable(proof.statusTable, {
      sourceRecordId: owner.sourceRecordId,
      engineeringDocumentNumber: proof.engineeringDocumentNumber,
    });
    if (
      status.reportedCount !== t.reportedTotal ||
      status.rows.some(
        (r) =>
          !t.rows.some((row) =>
            row.sourceLinks.some(
              (l) =>
                l.targetRef === r.sourceRecordId &&
                l.nativeColumnLabel === 'Number',
            ),
          ),
      )
    )
      fail('TDMS_COMPLETE_ENGINEERING_REUSED_STATUS_UNVERIFIED');
  }
  if (t.sourceViewEvidence !== undefined) {
    if (
      !['EO', 'EF', 'AEO'].includes(input.scopeId) ||
      t.gridId !== 'relatedStatusLinkTable'
    )
      fail('TDMS_COMPLETE_RELATED_STATUS_VIEW_INVALID');
    validateRelatedStatusSourceViewEvidence(t.sourceViewEvidence, {
      owner,
      tabId: t.tabId,
      panelLocator: t.panelLocator,
      gridId: t.gridId,
      table: t,
      read,
    });
  }
  validateRelatedStatusFixedRowSlotEvidence(t.nativeRowSlotEvidence, {
    scopeId: input.scopeId,
    owner,
    table: t,
  });
  const efQuery = validateReviewedEfRequestQueryEvidence(t.efQueryEvidence, {
    scopeId: input.scopeId,
    owner,
    table: t,
  });
  if (
    t.efQueryEvidence !== undefined &&
    t.enumerationState === 'VALUE' &&
    efQuery?.complete !== true
  )
    fail(efQuery?.reasonCode || 'TDMS_EFREQUEST_QUERY_PROOF_INVALID');
  const relatedQuery = validateReviewedEfRequestRelatedQueryEvidence(
    t.relatedQueryEvidence,
    {
      scopeId: input.scopeId,
      owner,
      table: t,
    },
  );
  if (
    t.relatedQueryEvidence !== undefined &&
    t.enumerationState === 'VALUE' &&
    relatedQuery?.complete !== true
  )
    fail(relatedQuery?.reasonCode || 'TDMS_EFREQUEST_RELATED_QUERY_INVALID');
  validateReviewedEfRequestRelatedSurfaceEvidence(t.relatedSurfaceEvidence, {
    scopeId: input.scopeId,
    owner,
    table: t,
  });
  validateReviewedAdHandlingTreeTable({
    scopeId: input.scopeId,
    owner,
    table: t,
  });
  if (t.stopReason !== null) text(t.stopReason, 120);
  return t;
}
function validateRead(r, input) {
  assertKeys(r, [
    'owner',
    'sourceContext',
    'tabs',
    'sections',
    'fields',
    'attachments',
    'relationTables',
    'rosterEvidence',
    'observedAt',
  ]);
  validateCompleteOwnedOwner(r.owner, input);
  validateCompleteSourceContext(r.sourceContext);
  iso(r.observedAt);
  validateRoster(r, input);
  validateReviewedAeoBusinessNumberEvidence({
    scopeId: input.scopeId,
    owner: r.owner,
    fields: r.fields,
  });
  array(r.relationTables, 100);
  const ids = new Set();
  for (const t of r.relationTables) {
    validateCompleteRelationTable(t, input, r.owner, r);
    if (ids.has(t.tableId) || !r.tabs.some((x) => x.tabId === t.tabId))
      fail('TDMS_COMPLETE_RELATION_TABLE_DUPLICATE');
    ids.add(t.tableId);
  }
  validateReviewedEfRequestGridRosters({
    scopeId: input.scopeId,
    owner: r.owner,
    read: r,
  });
  validateReviewedAdItemRead({
    scopeId: input.scopeId,
    owner: r.owner,
    read: r,
  });
  validateReviewedAdHandlingRead({
    scopeId: input.scopeId,
    owner: r.owner,
    read: r,
  });
  if (Date.parse(r.owner.observedAt) > Date.parse(r.observedAt))
    fail('TDMS_COMPLETE_OWN_TIME_INVALID');
}
export function validateCompleteOwnedObservation(raw, rawInput) {
  const input = validateCompleteOwnedInput(rawInput),
    v = plainData(raw, {
      maxBytes: COMPLETE_OWN_OBSERVATION_MAX_BYTES,
      maxNodes: COMPLETE_OWN_MAX_NODES,
    });
  assertKeys(v, [
    'schemaVersion',
    'requestedCriteria',
    'documentIdentity',
    'nativeReloadProvenance',
    'reads',
  ]);
  if (
    v.schemaVersion !== COMPLETE_OWN_SCHEMA ||
    stable(v.requestedCriteria) !== stable(input)
  )
    fail('TDMS_COMPLETE_OWN_QUERY_BINDING_INVALID');
  text(v.documentIdentity, 200);
  array(v.reads, 2);
  if (v.reads.length !== 2) fail('TDMS_COMPLETE_OWN_DOUBLE_READ_REQUIRED');
  for (const r of v.reads) validateRead(r, input);
  if (
    !isNativeReloadProvenance(v.nativeReloadProvenance, {
      sourceRecordId: input.sourceObjectRef,
      documentIdentity: v.documentIdentity,
      observedAt: v.reads[0].owner.observedAt,
    })
  )
    fail('TDMS_COMPLETE_OWN_FRESH_RELOAD_REQUIRED');
  if (
    Date.parse(v.reads[0].observedAt) >
      Date.parse(v.reads[1].owner.observedAt) ||
    stable(completeOwnedStableProjection(v.reads[0])) !==
      stable(completeOwnedStableProjection(v.reads[1]))
  )
    fail('TDMS_COMPLETE_OWN_OBSERVATION_CHANGED');
  return v;
}
export function completeOwnedTargetOccurrences(observation) {
  const read = observation.reads[1],
    out = [];
  for (const t of read.relationTables)
    for (const row of t.rows)
      for (const [index, link] of row.sourceLinks.entries()) {
        if (!link.targetRef) continue;
        const treeRole = reviewedAdHandlingTreeOccurrence({
          scopeId: observation.requestedCriteria.scopeId,
          owner: read.owner,
          table: t,
          row,
          link,
        });
        const adPurpose = reviewedAdItemEfrRequiredTargetPurpose({
          scopeId: observation.requestedCriteria.scopeId,
          owner: read.owner,
          read,
          table: t,
          row,
          link,
        });
        const collectionPurpose =
          adPurpose ??
          reviewedEfRequestRequiredTargetPurpose({
            scopeId: observation.requestedCriteria.scopeId,
            owner: read.owner,
            table: t,
            row,
            link,
          });
        out.push({
          ...(collectionPurpose ? { collectionPurpose } : {}),
          origin: 'RELATION_TABLE',
          tableId: t.tableId,
          occurrenceId: row.occurrenceId,
          linkIndex: index,
          targetRef: link.targetRef,
          numberRaw: link.numberRaw,
          rawHref: link.rawHref,
          relationshipRole: treeRole
            ? treeRole.relationshipRole
            : t.relationshipRole === 'UNKNOWN' ||
                link.nativeRole === 'UNREVIEWED_NATIVE_COLUMN'
              ? 'UNKNOWN'
              : link.nativeRole === 'LCM_AUTHORITY_REFERENCE'
                ? 'LCM_AUTHORITY_REFERENCE'
                : t.relationshipRole,
          modelRoleOrigin: adPurpose
            ? 'REVIEWED_AD_ITEM_EFR_METADATA_OCCURRENCE'
            : collectionPurpose
              ? 'REVIEWED_EF_REQUIRED_TARGET_COLLECTION_PURPOSE'
              : treeRole
                ? treeRole.modelRoleOrigin
                : t.relationshipRole === 'UNKNOWN'
                  ? 'UNREVIEWED_TABLE'
                  : link.nativeRole === 'UNREVIEWED_NATIVE_COLUMN'
                    ? 'UNREVIEWED_NATIVE_COLUMN'
                    : t.gridId === 'relatedStatusLinkTable'
                      ? 'REVIEWED_NATIVE_COLUMN_MODEL'
                      : 'REVIEWED_TABLE_MODEL',
          rawRole: row.rawRole,
          nativeLinkRole: link.nativeRole,
          nativeColumnLabel: link.nativeColumnLabel ?? null,
          nativeColumnToken: link.nativeColumnToken ?? null,
          fieldId: null,
          fieldActualLabel: null,
          tabId: t.tabId,
          sectionId: null,
          direction: t.direction,
          rawDirection: row.rawDirection,
          treePath: row.treePath,
          nativeRelationId: row.nativeRelationId,
          sourceVersion: row.observedVersion,
          ownerSourceVersion: read.owner.sourceVersion,
          locator: link.locator,
        });
      }
  for (const f of read.fields)
    for (const [index, link] of f.links.entries()) {
      if (!link.targetRef) continue;
      const model =
        classifyReviewedAdItemOwnReference({
          scopeId: observation.requestedCriteria.scopeId,
          owner: read.owner,
          read,
          fieldActualLabel: f.value.actualLabel,
          targetRef: link.targetRef,
        }) ??
        classifyOwnFieldReference({
          scopeId: observation.requestedCriteria.scopeId,
          fieldActualLabel: f.value.actualLabel,
          targetRef: link.targetRef,
        });
      out.push({
        origin: 'OWN_FIELD',
        tableId: 'OWN_FIELD:' + sha256(f.fieldId).slice(0, 32),
        occurrenceId: 'OWN_FIELD:' + sha256([f.fieldId, index, link.targetRef]),
        linkIndex: index,
        targetRef: link.targetRef,
        numberRaw: link.numberRaw,
        rawHref: link.rawHref,
        relationshipRole: model.relationshipRole,
        modelRoleOrigin: model.modelRoleOrigin,
        rawRole: f.value.actualLabel,
        nativeLinkRole: link.nativeRole,
        nativeColumnLabel: null,
        nativeColumnToken: null,
        fieldId: f.fieldId,
        fieldActualLabel: f.value.actualLabel,
        tabId: f.tabId,
        sectionId: f.sectionId,
        direction: model.direction,
        rawDirection: null,
        treePath: [],
        nativeRelationId: null,
        sourceVersion: unknown(),
        ownerSourceVersion: read.owner.sourceVersion,
        locator: link.locator,
      });
    }
  return out;
}
export function completeOwnedRecord(raw, rawInput) {
  const input = validateCompleteOwnedInput(rawInput),
    o = validateCompleteOwnedObservation(raw, input),
    read = o.reads[1],
    owner = read.owner,
    p = completeOwnProfile(input.scopeId),
    gaps = [
      'REQUIRED_TARGET_OWN_SOURCES_PENDING',
      'COMPLETION_CERTIFICATE_NOT_ISSUED',
    ];
  if (read.sourceContext.principalDisplayName === null)
    gaps.push('SOURCE_PRINCIPAL_UNOBSERVED');
  if (owner.nativeTypeId === null) gaps.push('NATIVE_TYPE_UNOBSERVED');
  if (owner.sourceVersion.confirmation !== 'SOURCE_DECLARED')
    gaps.push('TECHNICAL_VERSION_UNCONFIRMED');
  if (read.relationTables.some((t) => t.enumerationState !== 'VALUE'))
    gaps.push('RELATION_ENUMERATION_UNVERIFIED');
  if (read.attachments.some((a) => a.role === 'PRIMARY' && a.state !== 'VALUE'))
    gaps.push('PRIMARY_METADATA_UNVERIFIED');
  if (read.rosterEvidence.layoutEvidencePending)
    gaps.push('OWN_LAYOUT_REPRESENTATIVE_PENDING');
  if (
    read.rosterEvidence.unknownRequiredSurfaces.length ||
    read.rosterEvidence.unreadControls.length ||
    read.tabs.some(
      (t) =>
        t.required &&
        ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
          t.state,
        ),
    ) ||
    read.fields.some((f) =>
      ['NOT_READ', 'NOT_LOADED', 'TRUNCATED', 'ACCESS_DENIED'].includes(
        f.value.state,
      ),
    )
  )
    gaps.push('OWN_CONTENT_UNREAD');
  const record = {
    sourceRecordId: owner.sourceRecordId,
    kind: p.kind,
    number: owner.number,
    sourceVersion: owner.sourceVersion,
    businessVersion: owner.businessVersion,
    state: { rawCode: null, rawName: owner.stateRaw },
    observedAt: read.observedAt,
    sourceModifiedAt: null,
    authors: [],
    rawFields: {
      number: owner.number,
      storageType: { rawCode: null, rawName: owner.rawHeaderType },
      sourceModifiedRaw: owner.sourceModifiedRaw,
      completeOwnedSource: {
        schemaVersion: COMPLETE_OWN_SCHEMA,
        mode: COMPLETE_OWN_MODE,
        scopeId: input.scopeId,
        profileRevision: input.profileRevision,
        requestedCriteria: input,
        documentIdentity: o.documentIdentity,
        nativeReloadProvenance: o.nativeReloadProvenance,
        reads: o.reads,
        targetOccurrences: completeOwnedTargetOccurrences(o),
      },
    },
    content: { completeOwnedFields: read.fields },
    provenance: [
      {
        fieldPath: 'content.completeOwnedFields',
        selector: 'OWN_INFOPAGE_TAB_STRIP',
        sourceModifiedAt: null,
        observationRef: owner.sourceRecordId,
      },
    ],
    coverage: { status: 'PARTIAL', gaps, readback: 'NON_ATOMIC' },
  };
  record.snapshotId = snapshotIdentity(record);
  return record;
}
export function validateCompleteOwnedRecord(record) {
  const proof = record.rawFields?.completeOwnedSource;
  assertKeys(proof, [
    'schemaVersion',
    'mode',
    'scopeId',
    'profileRevision',
    'requestedCriteria',
    'documentIdentity',
    'nativeReloadProvenance',
    'reads',
    'targetOccurrences',
  ]);
  const o = validateCompleteOwnedObservation(
    {
      schemaVersion: proof.schemaVersion,
      requestedCriteria: proof.requestedCriteria,
      documentIdentity: proof.documentIdentity,
      nativeReloadProvenance: proof.nativeReloadProvenance,
      reads: proof.reads,
    },
    proof.requestedCriteria,
  );
  if (
    proof.mode !== COMPLETE_OWN_MODE ||
    proof.scopeId !== proof.requestedCriteria.scopeId ||
    proof.profileRevision !== COMPLETE_OWN_PROFILE_REVISION ||
    stable(proof.targetOccurrences) !==
      stable(completeOwnedTargetOccurrences(o))
  )
    fail('TDMS_COMPLETE_OWN_RECORD_INVALID');
  const expected = completeOwnedRecord(o, o.requestedCriteria);
  if (stable(expected) !== stable(record))
    fail('TDMS_COMPLETE_OWN_RECORD_INVALID');
}
export function isCompleteOwnedObservedEdge(edge, owner) {
  const p = owner.rawFields?.completeOwnedSource;
  return (
    !!p &&
    edge.fromSourceRecordId === owner.sourceRecordId &&
    edge.fromSnapshotId === owner.snapshotId &&
    edge.toSnapshotId === null &&
    edge.nativeRelationId === null &&
    edge.confidence === 'observed_unresolved' &&
    p.targetOccurrences.some(
      (t) =>
        !(
          t.origin === 'OWN_FIELD' &&
          t.relationshipRole === 'OUT_OF_SCOPE_REFERENCE'
        ) &&
        t.targetRef === edge.toSourceRecordId &&
        t.tableId === edge.relationKind &&
        t.locator === edge.evidenceLocator &&
        (t.modelRoleOrigin !== 'REVIEWED_NATIVE_TREE_MODEL' ||
          (t.treePath.at(-2) === owner.sourceRecordId &&
            t.targetRef !== owner.sourceRecordId)),
    )
  );
}
function validateCompleteStructuralRosters(read, scopeId, owner) {
  array(read.rosterEvidence.structuralRosters, 200);
  const seen = new Set();
  for (const r of read.rosterEvidence.structuralRosters) {
    assertKeys(r, ['tabId', 'before', 'after', 'settledReads']);
    if (
      seen.has(r.tabId) ||
      !read.tabs.some((t) => t.tabId === r.tabId) ||
      r.settledReads !== 2
    )
      fail('TDMS_COMPLETE_OWN_STRUCTURAL_ROSTER_INVALID');
    seen.add(r.tabId);
    for (const side of [r.before, r.after]) {
      assertKeys(side, [
        'fieldIds',
        'sectionIds',
        'fieldLocators',
        'sectionLocators',
        'declaredFieldCount',
        'declaredSectionCount',
        'loadingPresent',
        'terminal',
      ]);
      for (const k of [
        'fieldIds',
        'sectionIds',
        'fieldLocators',
        'sectionLocators',
      ]) {
        array(side[k], 1000);
        for (const id of side[k]) text(id, 700);
      }
      count(side.declaredFieldCount, 1000);
      count(side.declaredSectionCount, 200);
      bool(side.loadingPresent);
      if (
        side.terminal !== 'DOM_TREE_END' ||
        new Set(side.fieldIds).size !== side.fieldIds.length ||
        new Set(side.sectionIds).size !== side.sectionIds.length ||
        side.fieldIds.length !== side.declaredFieldCount ||
        side.sectionIds.length !== side.declaredSectionCount ||
        side.fieldLocators.length !== side.fieldIds.length ||
        side.sectionLocators.length !== side.sectionIds.length
      )
        fail('TDMS_COMPLETE_OWN_STRUCTURAL_ROSTER_INVALID');
    }
    if (stable(r.before) !== stable(r.after))
      fail('TDMS_COMPLETE_OWN_STRUCTURAL_ROSTER_CHANGED');
    const nativeFields = read.fields.filter(
        (f) =>
          f.tabId === r.tabId && f.labelOrigin === 'NATIVE_SOURCE_DECLARED',
      ),
      nativeSections = read.sections.filter(
        (s) => s.tabId === r.tabId && s.sourceDeclared,
      );
    if (
      nativeFields.some((f) => !r.before.fieldIds.includes(f.fieldId)) ||
      nativeSections.some((s) => !r.before.sectionIds.includes(s.sectionId))
    )
      fail('TDMS_COMPLETE_OWN_STRUCTURAL_ROSTER_MEMBERSHIP_INVALID');
    if (
      read.tabs.find((t) => t.tabId === r.tabId).state === 'VALUE' &&
      (nativeFields.length !== r.before.declaredFieldCount ||
        nativeSections.length !== r.before.declaredSectionCount ||
        r.before.loadingPresent)
    )
      fail('TDMS_COMPLETE_OWN_STRUCTURAL_ROSTER_INCOMPLETE');
  }
  if (
    read.tabs
      .filter((t) => t.state === 'VALUE')
      .some(
        (t) =>
          !seen.has(t.tabId) &&
          !(
            isReviewedEfStructureTab({ scopeId, owner, tab: t }) &&
            t.purposeEvidence !== undefined
          ),
      )
  )
    fail('TDMS_COMPLETE_OWN_STRUCTURAL_ROSTER_MISSING');
}
export function validateReusedEngineeringStatusTable(raw, owner) {
  const t = plainData(raw);
  assertKeys(t, [
    'ownerSourceRecordId',
    'reportedCount',
    'rows',
    'observedAt',
    'complete',
  ]);
  iso(t.observedAt);
  if (
    t.ownerSourceRecordId !== owner.sourceRecordId ||
    !Number.isSafeInteger(t.reportedCount) ||
    t.reportedCount < 0 ||
    t.reportedCount > 300 ||
    !Array.isArray(t.rows) ||
    t.rows.length !== t.reportedCount ||
    t.complete !== true
  )
    fail('TDMS_ENGINEERING_REUSED_STATUS_INVALID');
  const seen = new Set();
  for (const row of t.rows) {
    assertKeys(row, [
      'sourceRecordId',
      'number',
      'stateRaw',
      'sourceModifiedRaw',
      'executionStatus',
    ]);
    if (
      !/^OR:com\.airchina\.tdms\.statuslink\.TDMSStatusLink:\d{1,24}$/u.test(
        row.sourceRecordId,
      ) ||
      seen.has(row.sourceRecordId)
    )
      fail('TDMS_ENGINEERING_STATUS_ID_INVALID');
    seen.add(row.sourceRecordId);
    for (const k of ['number', 'stateRaw', 'sourceModifiedRaw'])
      text(row[k], 180);
    const e = row.executionStatus;
    assertKeys(e, [
      'engineeringDocumentRef',
      'engineeringDocumentNumber',
      'assetRef',
      'assetNumber',
      'feedbackRef',
      'feedbackNumber',
      'executedDateRaw',
      'stateComments',
      'expiredDateRaw',
      'operatorBase',
    ]);
    if (
      !/^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(
        e.engineeringDocumentRef,
      ) ||
      !/^(?:OR|VR):wt\.part\.WTPart:\d{1,24}$/u.test(e.assetRef) ||
      e.engineeringDocumentNumber !== owner.engineeringDocumentNumber ||
      (e.feedbackRef !== null &&
        !/^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(e.feedbackRef)) ||
      (e.feedbackRef === null) !== (e.feedbackNumber === null)
    )
      fail('TDMS_ENGINEERING_STATUS_VERSION_MISMATCH');
    for (const value of Object.values(e)) if (value !== null) text(value, 1000);
  }
  return t;
}
export function hasCompleteOwnedSource(record) {
  return (
    record?.rawFields?.completeOwnedSource !== undefined ||
    record?.content?.completeOwnedFields !== undefined
  );
}
// Select a larger walk only from data descriptors. An accessor cannot acquire
// the Complete1 budget or execute before the normal plain-data rejection.
export function usesCompleteOwnedPackageLimits(raw) {
  const ownValue = (value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  };
  const records = ownValue(raw, 'records');
  const length = ownValue(records, 'length');
  if (!Array.isArray(records) || !Number.isSafeInteger(length) || length > 500)
    return false;
  for (let index = 0; index < length; index++) {
    const record = ownValue(records, String(index));
    const proof = ownValue(
      ownValue(record, 'rawFields'),
      'completeOwnedSource',
    );
    if (
      ownValue(proof, 'mode') === COMPLETE_OWN_MODE &&
      ownValue(proof, 'schemaVersion') === COMPLETE_OWN_SCHEMA &&
      ownValue(proof, 'profileRevision') === COMPLETE_OWN_PROFILE_REVISION
    )
      return true;
  }
  return false;
}
export function completeOwnedNativeKind(kind) {
  return ['EXECUTION_STATUS', 'EXECUTION_FEEDBACK', 'PROCESSING_ITEM'].includes(
    kind,
  )
    ? 'OBSERVATION'
    : kind;
}
export function validateCompleteOwnedNativeRecord(
  r,
  packageObservedAt,
  original = false,
) {
  const proof = plainData(r.rawFields.completeOwnedSource, {
    maxBytes: COMPLETE_OWN_PACKAGE_MAX_BYTES,
    maxNodes: COMPLETE_OWN_MAX_NODES,
  });
  const profile = completeOwnProfile(proof.scopeId);
  if (
    r.recordKind !== completeOwnedNativeKind(profile.kind) ||
    r.authors.length ||
    r.sourceModifiedAt !== null ||
    (original ? r.artifactMemberIds.length > 1 : r.artifactMemberIds.length) ||
    r.unreadAttachments?.length ||
    r.relatedDocumentVersionIds.length ||
    r.formalDocumentArtifactMemberId != null
  )
    fail('TDMS_COMPLETE_OWN_NATIVE_BINDING_INVALID');
  assertKeys(r.rawFields, [
    'number',
    'storageType',
    'sourceModifiedRaw',
    'completeOwnedSource',
  ]);
  assertKeys(r.content, ['completeOwnedFields']);
  const sourceRecord = {
    snapshotId: r.itemId,
    sourceRecordId: r.sourceRecordId,
    kind: profile.kind,
    number: r.title,
    sourceVersion: r.sourceVersion,
    businessVersion: r.businessVersion,
    state: r.state,
    observedAt: r.observedAt,
    sourceModifiedAt: r.sourceModifiedAt,
    authors: r.authors,
    rawFields: r.rawFields,
    content: r.content,
    provenance: r.fieldProvenance,
    coverage: r.coverage,
  };
  validateCompleteOwnedRecord(sourceRecord);
  if (
    stable(r.fileType) !== stable(r.rawFields.storageType) ||
    (original
      ? Date.parse(packageObservedAt) < Date.parse(r.observedAt)
      : packageObservedAt !== r.observedAt)
  )
    fail('TDMS_COMPLETE_OWN_NATIVE_BINDING_INVALID');
}
export function completeOwnedObservedEdges(r) {
  const edges = [],
    seen = new Set();
  for (const occurrence of r.rawFields.completeOwnedSource.targetOccurrences) {
    if (
      !REF.test(occurrence.targetRef) ||
      (occurrence.origin === 'OWN_FIELD' &&
        occurrence.relationshipRole === 'OUT_OF_SCOPE_REFERENCE') ||
      (occurrence.modelRoleOrigin === 'REVIEWED_NATIVE_TREE_MODEL' &&
        (occurrence.treePath.at(-2) !== r.sourceRecordId ||
          occurrence.targetRef === r.sourceRecordId))
    )
      continue;
    const edge = {
      fromSourceRecordId: r.sourceRecordId,
      toSourceRecordId: occurrence.targetRef,
      fromSnapshotId: r.itemId ?? r.snapshotId,
      toSnapshotId: null,
      nativeRelationId: null,
      relationKind: occurrence.tableId,
      evidenceLocator: occurrence.locator,
      observedAt: r.observedAt,
      confidence: 'observed_unresolved',
    };
    edge.edgeId = 'TDMSEDGE-' + sha256(withoutTimes(edge));
    if (!seen.has(edge.edgeId)) {
      seen.add(edge.edgeId);
      edges.push(edge);
    }
  }
  return edges;
}
export function assertCompleteOwnedNativePackage(p) {
  const own = p.records.filter(hasCompleteOwnedSource);
  if (!own.length && Object.hasOwn(p.query || {}, 'originalAcquisition'))
    fail('TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID');
  if (!own.length) return;
  const original = Object.hasOwn(p.query || {}, 'originalAcquisition');
  if (
    p.records.length !== 1 ||
    (!original && p.artifacts.length) ||
    p.coverage.status !== 'PARTIAL' ||
    p.coverage.readback !== 'NON_ATOMIC' ||
    !p.coverage.gaps.includes('COMPLETION_CERTIFICATE_NOT_ISSUED') ||
    p.query.scopeMatch !== 'UNKNOWN' ||
    p.query.actualCriteria !== null
  )
    fail('TDMS_COMPLETE_OWN_PACKAGE_LIMITS_REQUIRED');
  const r = own[0];
  validateCompleteOwnedNativeRecord(r, p.observedAt, original);
  if (original) assertCompleteOriginalNativeArtifacts(p);
  if (stable(p.coverage) !== stable(r.coverage))
    fail('TDMS_COMPLETE_OWN_PACKAGE_BINDING_INVALID');
  const wanted = completeOwnedObservedEdges(r);
  if (wanted.length !== p.relations.length)
    fail('TDMS_COMPLETE_OWN_RELATIONS_INVALID');
  for (const [index, relation] of p.relations.entries()) {
    const edge = wanted[index];
    if (
      stable(relation.rawFields) !== stable({ dailyObservedEdge: edge }) ||
      relation.sourceRelationId !== edge.edgeId ||
      relation.rawKind !== edge.relationKind ||
      relation.selector !== edge.evidenceLocator ||
      relation.observedAt !== edge.observedAt ||
      relation.controlledKind !== null ||
      relation.authority !== 'CANDIDATE_ONLY' ||
      stable(relation.coverage) !== stable(p.coverage) ||
      stable(relation.from) !==
        stable({
          kind: 'UNRESOLVED',
          rawIdentity: edge.fromSourceRecordId,
          versionGap: 'RELATION_ID_UNOBSERVED',
        }) ||
      stable(relation.to) !==
        stable({
          kind: 'UNRESOLVED',
          rawIdentity: edge.toSourceRecordId,
          versionGap: 'RELATION_ID_UNOBSERVED',
        }) ||
      stable(relation.scope) !== '{}' ||
      relation.completionEffect !== 'UNSPECIFIED' ||
      relation.changeClass !== 'UNSPECIFIED'
    )
      fail('TDMS_COMPLETE_OWN_RELATIONS_INVALID');
  }
}
export const COMPLETE_PRIMARY_METADATA_REVISION =
  'tdms-complete-owned-primary-metadata@1';
const RAW_REFERENCE = new RegExp(
  '^(?:OR|VR):(?:' +
    OWN_OUT_OF_SCOPE_NATIVE_CLASSES.map((c) => c.replaceAll('.', '\\.')).join(
      '|',
    ) +
    '):\\d{1,24}$',
  'u',
);

export {
  stable,
  sha256,
  fail,
  assertKeys,
  text,
  iso,
  version,
  plainData,
  withoutTimes,
  snapshotIdentity,
};
