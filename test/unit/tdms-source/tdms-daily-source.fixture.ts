import type {
  TdmsDailyMetadataEnvelope,
  TdmsDailyMetadataRecord,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import type { TdmsBoundedOwnedBodyField } from '../../../shared/tdms-source.interface';
const detached = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export type BoundedProfile = 'AD_PROCESSING_FORM' | 'SB_PROCESSING_FORM' | 'SB_ASSESSMENT_FORM' | 'ENGINEERING_INDEPENDENT';
export function sealBounded(envelope: TdmsDailyMetadataEnvelope) {
  const locatorComparison = (v: unknown): unknown => Array.isArray(v) ? v.map(locatorComparison) :
    v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
      typeof x === 'string' && ['panelLocator', 'locator', 'selector'].includes(k)
        ? x.replace(/^#infoPage_myTab_tab_jcaGen_\d+(?=\s|$)/u, '#infoPage_myTab_tab_jcaGen_DYNAMIC') : locatorComparison(x)])) : v;
  for (const r of envelope.package.records) r.snapshotId = 'TDMSSNAP-' + hash(dailyIdentity(locatorComparison(r)));
  envelope.requestId = 'TDMSIMPORT-' + hash(envelope.package);
  return envelope;
}
/** Independently synthetic Source51 shape; no collector execution or real payload. */
export function syntheticBoundedEnvelope(profileId: BoundedProfile = 'SB_PROCESSING_FORM') {
  const engineering = profileId === 'ENGINEERING_INDEPENDENT';
  const r = syntheticOwnedRecord(901, profileId === 'SB_ASSESSMENT_FORM' ? 'ENGINEER_ASSESSMENT' : 'PROCESSING_SHEET', profileId === 'AD_PROCESSING_FORM');
  const old = r.rawFields.ownedBusinessContent as { reads: Array<{owner: Record<string, unknown>; section: Record<string, unknown>;
    fields: TdmsBoundedOwnedBodyField[]; unreadFields: string[]; unreadTabs: string[]; observedAt: string;
    relationTables: Array<{tableTitle: string; panelLocator: string; gridId: string}>}> };
  const read = detached(old.reads[0]);
  read.owner.typeEvidence = { nativeTypeIdOrigin: 'BOUND_IDENTITY_READ', rawHeaderType: engineering ? 'Publication Source' :
    profileId === 'AD_PROCESSING_FORM' ? 'AD分处理单' : profileId === 'SB_ASSESSMENT_FORM' ? 'SB评估单' : 'SB处理单', headerMatch: true };
  if (profileId === 'SB_PROCESSING_FORM') for (const f of read.fields) {
    f.locator = f.locator.replace(f.panelLocator, '#wrap_infoPage_myTab_object_changeRequestDetailsTab_objectprimaryAttributes');
    f.panelLocator = '#wrap_infoPage_myTab_object_changeRequestDetailsTab_objectprimaryAttributes';
  }
  let tableSpecs = read.relationTables.map(t => [t.tableTitle, t.panelLocator, t.gridId]);
  if (engineering) {
    r.kind = 'ENGINEERING_FILE'; r.sourceRecordId = 'OR:wt.epm.EPMDocument:901';
    r.sourceVersion = { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' };
    Object.assign(read.owner, { sourceRecordId: r.sourceRecordId, nativeTypeId: 'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
      objectType: 'EO整体', businessVersionLabel: 'EO版次:', sourceVersion: r.sourceVersion,
      technicalVersionEvidence: { actualLabel: 'Version:', rawValue: 'A.1', panelLocator: '#infoPage_myTab_tab_jcaGen_101' } });
    read.section = { label: '所有属性', panelLocator: '#infoPage_myTab_tab_jcaGen_101', active: true, hitVerified: true };
    read.fields = ['EO编号:', '工程文件标题:', '适用机型:', '客户:', '预计生效日期:', 'IssueDate:', '任务来源:', '特殊反馈要求:',
      '等效:', '取代:', 'EO状态:', '执行方式:', '处理单号:', 'AD编号:', '编写人:', 'Status:', 'Modified By:', 'File Name:', 'Document Category:']
      .map((label, i) => ({ ...detached(read.fields[i % read.fields.length]), actualLabel: label, sectionLabel: '所有属性',
        panelLocator: '#infoPage_myTab_tab_jcaGen_101', locator: '#infoPage_myTab_tab_jcaGen_101 .synthetic-field-' + i }));
    tableSpecs = [
      ['Equivalent/Subs List', '#infoPage_myTab_object_eoRelatedTab', 'document.equByDoc.list'],
      ['EO Delay Request', '#infoPage_myTab_object_eoRelatedTab', 'document.equDoc.list'],
      ['EO SubBy List', '#infoPage_myTab_object_eoRelatedTab', 'document.eoFeedbackRecordLink.list'],
      ['EO Related Files', '#infoPage_myTab_object_eoRelatedTab', 'document.relatedfile.list'],
      ['EO Source Form', '#infoPage_myTab_object_eoRelatedTab', 'document.eoSource.list'],
      ['Related StatusLink', '#infoPage_myTab_object_latestStatusLink', 'relatedStatusLinkTable'],
    ];
  }
  const lastField = read.fields.at(-1)!;
  Object.assign(lastField, { presence: 'NOT_LOADED', fieldType: 'DISPLAY_TEXT', labelOrigin: 'NATIVE_VISIBLE_LABEL', rawBoundedValue: null,
    nativeControl: { tag: 'TD', readOnly: true, disabled: false, visibleControls: [] },
    truncation: { truncated: false, limit: 8000, capturedCodepoints: 0, observedTotalCodepoints: 0 } });
  const { relationTables: _tables, ...bodyRead } = read;
  const proof = { schemaVersion: 'wiselink.tdms-profile-owned-body.v2', bodyRevision: 'tdms-owned-body-observation@2', profileId,
    profileRevision: 'tdms-independent-source-profiles@1', purpose: 'COVERAGE', sourceReady: false, requiredContentComplete: false,
    reads: [detached(bodyRead), detached(bodyRead)], relationManifest: tableSpecs.map(([tableTitle, panelLocator, gridId]) => ({
      tableTitle, panelLocator, gridId, state: 'UNREAD', reportedCount: null, capturedCount: null, targetOwnerReads: 0, provenance: 'PROFILE_EXPECTED_NOT_OBSERVED' })) };
  r.rawFields = { number: r.number, storageType: { rawCode: null, rawName: (read.owner.typeEvidence as {rawHeaderType: string}).rawHeaderType },
    sourceModifiedRaw: read.owner.sourceModifiedRaw, profileOwnedBody: proof };
  r.content = { boundedOwnedBody: detached(bodyRead.fields) };
  r.provenance = [{ fieldPath: 'content.boundedOwnedBody', selector: String(read.section.panelLocator), sourceModifiedAt: null, observationRef: r.sourceRecordId }];
  r.coverage = { status: 'PARTIAL', readback: 'NON_ATOMIC', gaps: ['OWN_BODY_BOUNDED', 'REQUIRED_CONTENT_COMPLETENESS_UNPROVEN',
    'RELATIONS_UNREAD', 'RELATION_TARGETS_UNVERIFIED', 'OTHER_TABS_NOT_COLLECTED', 'CONTENT_FIELDS_UNREAD', 'CONTENT_FIELDS_UNAVAILABLE',
    ...(engineering ? ['PARENT_MTIME_NOT_CHILD_UPDATE_PROOF', 'CHILD_COVERAGE_UNVERIFIED'] : ['VERSION_UNCONFIRMED'])] };
  const env = syntheticFullDailyEnvelope(); env.package.records = [r]; env.package.coverage = detached(r.coverage);
  env.package.query.requestedCriteria = { documentCode: r.number, sourceObjectRef: r.sourceRecordId,
    objectType: read.owner.objectType, nativeClass: engineering ? 'wt.epm.EPMDocument' : profileId === 'SB_PROCESSING_FORM' ? 'wt.change2.WTChangeRequest2' : 'wt.change2.WTChangeOrder2' };
  sealBounded(env);
  return { envelope: env, proof };
}
export const sourceTime = '2026-10-11T00:00:00.000Z';
export function dailyIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dailyIdentity);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([k]) =>
          !['observedAt', 'itemId', 'snapshotId', 'lastSeenAt'].includes(k),
      )
      .map(([k, v]) => [k, dailyIdentity(v)]),
  );
}
export function seal(envelope: TdmsDailyMetadataEnvelope) {
  for (const r of envelope.package.records)
    r.snapshotId = 'TDMSSNAP-' + hash(dailyIdentity(r));
  envelope.requestId = 'TDMSIMPORT-' + hash(envelope.package);
  return envelope;
}
export function syntheticFullDailyEnvelope(): TdmsDailyMetadataEnvelope {
  const coverage = {
    status: 'PARTIAL' as const,
    gaps: ['PROBE_ONLY', 'RELATION_TARGETS_UNVERIFIED'],
    readback: 'NON_ATOMIC' as const,
  };
  const records: TdmsDailyMetadataRecord[] = [101, 102].map((id, i) => ({
    snapshotId: '',
    sourceRecordId: 'OR:wt.doc.WTDocument:' + id,
    kind: 'MANUFACTURER_FILE',
    number: i ? 'SYNTHETIC-AD' : 'SYNTHETIC-SB',
    sourceVersion: {
      rawRevision: 'A',
      rawIteration: '1',
      confirmation: 'SOURCE_DECLARED',
    },
    businessVersion: null,
    state: { rawCode: null, rawName: null },
    observedAt: sourceTime,
    sourceModifiedAt: null,
    authors: [
      {
        sourcePersonId: null,
        name: null,
        displayName: 'observed display only',
        role: null,
      },
    ],
    rawFields: {
      number: i ? 'SYNTHETIC-AD' : 'SYNTHETIC-SB',
      storageType: { rawCode: null, rawName: 'source document' },
    },
    content: {},
    provenance: [
      {
        fieldPath: 'number',
        selector: '#synthetic-number',
        sourceModifiedAt: null,
        observationRef: 'OR:wt.doc.WTDocument:' + id,
      },
    ],
    coverage,
  }));
  const env: TdmsDailyMetadataEnvelope = {
    requestId: '',
    package: {
      schemaVersion: 'wiselink.tdms-daily-package.v1',
      packageId: 'synthetic-source-package',
      sourceSystem: 'TDMS',
      observedAt: sourceTime,
      coverage,
      query: {
        requestedCriteria: { keyword: 'synthetic' },
        actualCriteria: null,
        scopeMatch: 'UNKNOWN',
        scopeComplete: false,
      },
      records,
      edges: [],
      artifactBindings: [],
      readFailures: [],
    },
  };
  return seal(env);
}
/** Native own-visible literals are separate from the Estimated opinion contract. */
export function syntheticOwnedRecord(
  id: number,
  kind: 'PROCESSING_SHEET' | 'ENGINEER_ASSESSMENT',
  ad = false,
): TdmsDailyMetadataRecord {
  const profile = ad
    ? 'AD_PROCESSING_FORM'
    : kind === 'PROCESSING_SHEET'
      ? 'SB_PROCESSING_FORM'
      : 'SB_ASSESSMENT_FORM';
  const cls =
    ad || kind === 'ENGINEER_ASSESSMENT'
      ? 'wt.change2.WTChangeOrder2'
      : 'wt.change2.WTChangeRequest2';
  const type = ad
    ? 'AD分处理单'
    : kind === 'PROCESSING_SHEET'
      ? 'SB处理单'
      : 'SB评估单';
  const detail =
    ad || kind === 'ENGINEER_ASSESSMENT'
      ? '#infoPage_myTab_object_changeNoticeDetailsTab'
      : '#infoPage_myTab_object_changeRequestDetailsTab';
  const labels = ad
    ? [
        'Change Admin II:',
        'Description:',
        '是否需要适航替代措施:',
        '是否影响国航机群:',
        'AD适用范围:',
        '作者:',
        '提交时间:',
        '校对人:',
        '校对日期:',
        '审核人:',
        '审核日期:',
        '审批记录:',
        '任务来源:',
        '是否需要再评估:',
        '再评估日期:',
        'Need Date:',
        'Complexity:',
        'Resolution Date:',
        'Team Name:',
        'Modified By:',
      ]
    : kind === 'PROCESSING_SHEET'
      ? [
          'Category:',
          'Change Admin I:',
          'SB/SL文件编号:',
          'Description:',
          'Proposed Solution:',
          'SB处理单标题:',
          'ATA章节:',
          '受影响的机型:',
          '受影响的发动机类型:',
          '受影响的APU类型:',
          '受影响的起落架类型:',
          '受影响的附件:',
          '适用性备注:',
          '改版原因:',
          '对象类型:',
          '是否结构化SB:',
          '是否紧急:',
          '评估截止期限:',
          '任务来源:',
          '原创建者:',
        ]
      : [
          'SB评估单编号:',
          'Change Admin II:',
          'Description:',
          '是否影响国航机队:',
          '影响类型:',
          '评估结论:',
          '评估意见:',
          '受影响的机型:',
          '受影响的飞机:',
          '受影响的发动机类型:',
          '受影响的发动机:',
          '受影响的APU类型:',
          '受影响的APU:',
          '受影响的起落架类型:',
          '受影响的起落架:',
          '受影响的附件:',
          '适用性备注:',
          '是否重检:',
          '完成期限:',
          '首检时限:',
        ];
  const number = 'SYNTHETIC-FORM-' + id,
    ref = 'OR:' + cls + ':' + id;
  const owner = {
    sourceRecordId: ref,
    number,
    rawHeaderIdentifier: number + ',source',
    nativeTypeId:
      'WCTYPE|' +
      cls +
      '|com.airchina.' +
      (ad ? 'ADForm' : kind === 'PROCESSING_SHEET' ? 'SBMainForm' : 'SBForm'),
    objectType: type,
    typeEvidence: {
      nativeTypeIdOrigin: 'PROFILE_DECLARED',
      rawHeaderType: type,
      headerMatch: true,
    },
    sourceVersion: {
      rawRevision: null,
      rawIteration: null,
      confirmation: 'VERSION_UNCONFIRMED' as const,
    },
    technicalVersionEvidence: null,
    businessVersion: {
      rawRevision: '1',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED' as const,
    },
    businessVersionLabel: type + '版本:',
    stateRaw: 'Source state',
    sourceCreatedRaw: 'unknown timezone literal',
    sourceModifiedRaw: 'source modification literal',
    contextRaw: 'owned source context',
    observedAt: sourceTime,
  };
  const fields = labels.map((label, i) => {
    const panel = ad
      ? '#wrap_infoPage_myTab_object_changeNoticeDetailsTab_object' +
        (i < 15 ? 'primaryAttributes' : 'attributes')
      : detail;
    const value =
      label === 'Description:'
        ? '  planned TBD / literal 560 and 760 remain distinct\n'
        : i === 0
          ? ''
          : null;
    const captured = value === null ? 0 : [...value].length;
    return {
      actualLabel: label,
      labelOrigin:
        value === null ? 'PROFILE_EXPECTED_LABEL' : 'NATIVE_VISIBLE_LABEL',
      sectionLabel: 'Details',
      panelLocator: panel,
      locator: panel + ' .source-value-' + i,
      fieldType: value === null ? 'UNOBSERVED' : 'DISPLAY_TEXT',
      presence:
        value === null
          ? 'ABSENT'
          : value === ''
            ? 'PRESENT_BLANK'
            : 'PRESENT_VALUE',
      rawBoundedValue: value,
      nativeControl:
        value === null
          ? null
          : { tag: 'TD', readOnly: null, disabled: null, visibleControls: [] },
      truncation: {
        truncated: false,
        limit: 8000,
        capturedCodepoints: captured,
        observedTotalCodepoints: captured,
      },
      observedAt: sourceTime,
    };
  });
  const specs = ad
    ? [['AD Form Table', '#infoPage_myTab_ad_adItemTable', 'ad.item.list']]
    : [
        [
          'SB RelationShip',
          '#infoPage_myTab_object_sbRelatedTab',
          'mytreetable',
        ],
        [
          'History Table',
          '#infoPage_myTab_object_sbRelatedTab',
          'sb.adhistory.list',
        ],
      ];
  const tables = specs.map(([tableTitle, panelLocator, gridId]) => ({
    tableTitle,
    panelLocator,
    gridId,
    ownerSourceRecordId: ref,
    active: true,
    hitVerified: true,
    reportedCount: 0,
    rows: [],
    firstPageOnly: true,
    targetOwnerReads: 0,
    observedAt: sourceTime,
  }));
  const read = {
    owner,
    section: {
      label: 'Details',
      panelLocator: detail,
      active: true,
      hitVerified: true,
    },
    fields,
    relationTables: tables,
    unreadFields: fields
      .filter((f) => f.rawBoundedValue === null)
      .map((f) => f.actualLabel),
    unreadTabs: ['other source tab'],
    observedAt: sourceTime,
  };
  return {
    snapshotId: '',
    sourceRecordId: ref,
    kind,
    number,
    sourceVersion: owner.sourceVersion,
    businessVersion: owner.businessVersion,
    state: { rawCode: null, rawName: owner.stateRaw },
    observedAt: sourceTime,
    sourceModifiedAt: null,
    authors: [],
    rawFields: {
      number,
      storageType: { rawCode: null, rawName: type },
      sourceModifiedRaw: owner.sourceModifiedRaw,
      ownedBusinessContent: {
        schemaVersion: 'wiselink.tdms-owned-visible-business-content.v1',
        mode: 'OWN_VISIBLE_BUSINESS_CONTENT',
        profileId: profile,
        profileRevision: 'tdms-independent-content-profiles@1',
        purpose: 'PROBE',
        reads: [detached(read), detached(read)],
      },
    },
    content: { ownedVisibleBusinessContent: detached(fields) },
    provenance: [
      {
        fieldPath: 'content.ownedVisibleBusinessContent',
        selector: detail,
        sourceModifiedAt: null,
        observationRef: ref,
      },
    ],
    coverage: {
      status: 'PARTIAL',
      gaps: [
        'PROBE_ONLY',
        'RELATION_TARGETS_UNVERIFIED',
        'TECHNICAL_VERSION_UNCONFIRMED',
      ],
      readback: 'NON_ATOMIC',
    },
  };
}
export function syntheticOwnedEnvelope(
  id: number,
  kind: 'PROCESSING_SHEET' | 'ENGINEER_ASSESSMENT',
  ad = false,
) {
  const env = syntheticFullDailyEnvelope();
  env.package.records = [syntheticOwnedRecord(id, kind, ad)];
  env.package.coverage = detached(env.package.records[0]!.coverage);
  return seal(env);
}
