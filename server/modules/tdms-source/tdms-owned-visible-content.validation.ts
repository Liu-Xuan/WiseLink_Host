import type { TdmsPackageRecord } from '@shared/tdms-source.interface';
import { tdmsError } from './tdms-source.types';

interface Primitives {
  canonical(value: unknown): string;
  object(value: unknown): Record<string, unknown>;
  strict(value: Record<string, unknown>, keys: string[]): void;
  date(value: unknown): void;
}
interface Profile {
  kind: string;
  nativeClass: string;
  nativeTypeId: string;
  objectType: string;
  businessVersionLabel: string;
  fieldLabels: string[];
  detailPanel?: string;
  fieldPanels?: string[];
  fieldPanelByLabel?: Record<string, string>;
  dynamic?: true;
  tables: Array<{
    title: string;
    panel: string;
    grid: string;
    targetClasses: string[];
  }>;
}
const adPrimaryPanel =
  '#wrap_infoPage_myTab_object_changeNoticeDetailsTab_objectprimaryAttributes';
const adObjectPanel =
  '#wrap_infoPage_myTab_object_changeNoticeDetailsTab_objectattributes';
const adPrimaryLabels = [
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
];
const adObjectLabels = [
  'Need Date:',
  'Complexity:',
  'Resolution Date:',
  'Team Name:',
  'Modified By:',
];
/** Source profiles from tdms-independent-content-profiles@1.
 * Type/panel matches validate source shape, never current source authority. */
const profiles: Record<string, Profile> = {
  AD_PROCESSING_FORM: {
    kind: 'PROCESSING_SHEET',
    nativeClass: 'wt.change2.WTChangeOrder2',
    nativeTypeId: 'WCTYPE|wt.change2.WTChangeOrder2|com.airchina.ADForm',
    objectType: 'AD分处理单',
    businessVersionLabel: 'AD分处理单版本:',
    fieldLabels: [...adPrimaryLabels, ...adObjectLabels],
    detailPanel: '#infoPage_myTab_object_changeNoticeDetailsTab',
    fieldPanels: [adPrimaryPanel, adObjectPanel],
    // Same-name fields in another legal wrapper are different source nodes.
    fieldPanelByLabel: Object.fromEntries([
      ...adPrimaryLabels.map((label) => [label, adPrimaryPanel]),
      ...adObjectLabels.map((label) => [label, adObjectPanel]),
    ]),
    tables: [
      {
        title: 'AD Form Table',
        panel: '#infoPage_myTab_ad_adItemTable',
        grid: 'ad.item.list',
        targetClasses: ['wt.change2.WTChangeActivity2'],
      },
    ],
  },
  SB_ASSESSMENT_FORM: {
    kind: 'ENGINEER_ASSESSMENT',
    nativeClass: 'wt.change2.WTChangeOrder2',
    nativeTypeId: 'WCTYPE|wt.change2.WTChangeOrder2|com.airchina.SBForm',
    objectType: 'SB评估单',
    businessVersionLabel: 'SB评估单版本:',
    fieldLabels: [
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
    ],
    detailPanel: '#infoPage_myTab_object_changeNoticeDetailsTab',
    fieldPanels: ['#infoPage_myTab_object_changeNoticeDetailsTab'],
    tables: [
      {
        title: 'SB RelationShip',
        panel: '#infoPage_myTab_object_sbRelatedTab',
        grid: 'mytreetable',
        targetClasses: ['wt.doc.WTDocument', 'wt.change2.WTChangeRequest2'],
      },
      {
        title: 'History Table',
        panel: '#infoPage_myTab_object_sbRelatedTab',
        grid: 'sb.adhistory.list',
        targetClasses: ['wt.change2.WTChangeOrder2'],
      },
    ],
  },
  SB_PROCESSING_FORM: {
    kind: 'PROCESSING_SHEET',
    nativeClass: 'wt.change2.WTChangeRequest2',
    nativeTypeId: 'WCTYPE|wt.change2.WTChangeRequest2|com.airchina.SBMainForm',
    objectType: 'SB处理单',
    businessVersionLabel: 'SB处理单版本:',
    fieldLabels: [
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
    ],
    detailPanel: '#infoPage_myTab_object_changeRequestDetailsTab',
    fieldPanels: ['#infoPage_myTab_object_changeRequestDetailsTab'],
    tables: [
      {
        title: 'SB RelationShip',
        panel: '#infoPage_myTab_object_sbRelatedTab',
        grid: 'mytreetable',
        targetClasses: ['wt.doc.WTDocument', 'wt.change2.WTChangeRequest2'],
      },
      {
        title: 'History Table',
        panel: '#infoPage_myTab_object_sbRelatedTab',
        grid: 'sb.adhistory.list',
        targetClasses: ['wt.change2.WTChangeRequest2'],
      },
    ],
  },
  ENGINEERING_INDEPENDENT: {
    kind: 'ENGINEERING_FILE',
    nativeClass: 'wt.epm.EPMDocument',
    nativeTypeId:
      'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
    objectType: 'EO整体',
    businessVersionLabel: 'EO版次:',
    dynamic: true,
    fieldLabels: [
      'EO编号:',
      '工程文件标题:',
      '适用机型:',
      '客户:',
      '预计生效日期:',
      'IssueDate:',
      '任务来源:',
      '特殊反馈要求:',
      '等效:',
      '取代:',
      'EO状态:',
      '执行方式:',
      '处理单号:',
      'AD编号:',
      '编写人:',
      'Status:',
      'Modified By:',
      'File Name:',
      'Document Category:',
    ],
    tables: [
      {
        title: 'Equivalent/Subs List',
        panel: '#infoPage_myTab_object_eoRelatedTab',
        grid: 'document.equByDoc.list',
        targetClasses: ['wt.epm.EPMDocument'],
      },
      {
        title: 'EO Delay Request',
        panel: '#infoPage_myTab_object_eoRelatedTab',
        grid: 'document.equDoc.list',
        targetClasses: ['wt.epm.EPMDocument'],
      },
      {
        title: 'EO SubBy List',
        panel: '#infoPage_myTab_object_eoRelatedTab',
        grid: 'document.eoFeedbackRecordLink.list',
        targetClasses: ['wt.epm.EPMDocument'],
      },
      {
        title: 'EO Related Files',
        panel: '#infoPage_myTab_object_eoRelatedTab',
        grid: 'document.relatedfile.list',
        targetClasses: ['wt.doc.WTDocument'],
      },
      {
        title: 'EO Source Form',
        panel: '#infoPage_myTab_object_eoRelatedTab',
        grid: 'document.eoSource.list',
        targetClasses: ['wt.change2.WTChangeRequest2'],
      },
      {
        title: 'Related StatusLink',
        panel: '#infoPage_myTab_object_latestStatusLink',
        grid: 'relatedStatusLinkTable',
        targetClasses: ['com.airchina.tdms.statuslink.TDMSStatusLink'],
      },
    ],
  },
};

/** Source observations only; independent of the legacy Estimated opinion approval contract. */
export function createOwnedVisibleContentValidator({
  canonical,
  object,
  strict,
  date,
}: Primitives) {
  const fail = (): never => {
    throw tdmsError('TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID');
  };
  const shape = (v: unknown, keys: string[]) => {
    const o = object(v);
    strict(o, keys);
    if (keys.some((k) => !Object.hasOwn(o, k))) fail();
    return o;
  };
  const list = (v: unknown, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max) fail();
    return v as unknown[];
  };
  const noTimes = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(noTimes)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([k]) => k !== 'observedAt')
              .map(([k, x]) => [k, noTimes(x)]),
          )
        : v;
  const text = (v: unknown, max = 500): string => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) fail();
    return v as string;
  };
  const ordered = (a: unknown, b: unknown) => {
    for (const value of [a, b]) {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        fail();
      const iso = value as string;
      const normalized = `${iso.slice(0, 19)}.${(
        iso.match(/\.(\d{1,3})Z$/u)?.[1] || '0'
      ).padEnd(3, '0')}Z`;
      if (new Date(iso).toISOString() !== normalized) fail();
      date(value);
    }
    if (Date.parse(String(a)) > Date.parse(String(b))) fail();
  };
  const exactRef = (ref: unknown, cls: string, vr = false) =>
    typeof ref === 'string' &&
    new RegExp(
      '^' +
        (vr ? '(?:OR|VR)' : 'OR') +
        ':' +
        cls.replaceAll('.', '\\.') +
        ':[0-9]{1,24}$',
      'u',
    ).test(ref);
  const dynamicPanel = (v: unknown) =>
    typeof v === 'string' && /^#infoPage_myTab_tab_jcaGen_\d+$/u.test(v);
  return (r: TdmsPackageRecord, packageObservedAt: string) => {
    const p = shape(r.rawFields.ownedBusinessContent, [
        'schemaVersion',
        'mode',
        'profileId',
        'profileRevision',
        'purpose',
        'reads',
      ]),
      profile = profiles[String(p.profileId)];
    if (
      !profile ||
      p.schemaVersion !== 'wiselink.tdms-owned-visible-business-content.v1' ||
      p.mode !== 'OWN_VISIBLE_BUSINESS_CONTENT' ||
      p.profileRevision !== 'tdms-independent-content-profiles@1' ||
      p.purpose !== 'PROBE' ||
      r.recordKind !== profile.kind
    )
      fail();
    shape(r.rawFields, [
      'number',
      'storageType',
      'sourceModifiedRaw',
      'ownedBusinessContent',
    ]);
    shape(r.content, ['ownedVisibleBusinessContent']);
    const typeCode = shape(r.rawFields.storageType, ['rawCode', 'rawName']);
    if (
      typeCode.rawCode !== null ||
      typeCode.rawName !== profile.objectType ||
      r.artifactMemberIds.length ||
      r.unreadAttachments?.length ||
      r.relatedDocumentVersionIds.length ||
      r.formalDocumentArtifactMemberId != null ||
      r.sourceModifiedAt !== null ||
      r.authors.length ||
      r.coverage.status !== 'PARTIAL' ||
      r.coverage.readback !== 'NON_ATOMIC' ||
      !r.coverage.gaps.includes('PROBE_ONLY') ||
      !r.coverage.gaps.includes('RELATION_TARGETS_UNVERIFIED')
    )
      fail();
    if (profile.dynamic) {
      if (
        r.sourceVersion.confirmation !== 'SOURCE_DECLARED' ||
        !/^\d{1,20}$/u.test(r.sourceVersion.rawIteration ?? '')
      )
        fail();
      text(r.sourceVersion.rawRevision, 80);
    } else if (
      canonical(r.sourceVersion) !==
        canonical({
          rawRevision: null,
          rawIteration: null,
          confirmation: 'VERSION_UNCONFIRMED',
        }) ||
      !r.coverage.gaps.includes('TECHNICAL_VERSION_UNCONFIRMED')
    )
      fail();
    if (
      !r.businessVersion ||
      r.businessVersion.confirmation !== 'SOURCE_DECLARED' ||
      r.businessVersion.rawIteration !== null
    )
      fail();
    text(r.businessVersion.rawRevision, 80);
    const reads = list(p.reads, 2);
    if (
      reads.length !== 2 ||
      canonical(noTimes(reads[0])) !== canonical(noTimes(reads[1]))
    )
      fail();
    let previousEnd: unknown,
      total = 0;
    for (const value of reads) {
      const read = shape(value, [
        'owner',
        'section',
        'fields',
        'relationTables',
        'unreadFields',
        'unreadTabs',
        'observedAt',
      ]);
      const owner = shape(read.owner, [
        'sourceRecordId',
        'number',
        'rawHeaderIdentifier',
        'nativeTypeId',
        'objectType',
        'typeEvidence',
        'sourceVersion',
        'technicalVersionEvidence',
        'businessVersion',
        'businessVersionLabel',
        'stateRaw',
        'sourceCreatedRaw',
        'sourceModifiedRaw',
        'contextRaw',
        'observedAt',
      ]);
      if (
        owner.sourceRecordId !== r.sourceRecordId ||
        !exactRef(r.sourceRecordId, profile.nativeClass) ||
        owner.number !== r.title ||
        owner.number !== r.rawFields.number ||
        owner.nativeTypeId !== profile.nativeTypeId ||
        owner.objectType !== profile.objectType ||
        owner.businessVersionLabel !== profile.businessVersionLabel ||
        owner.stateRaw !== r.state?.rawName ||
        r.state?.rawCode !== null ||
        canonical(owner.sourceVersion) !== canonical(r.sourceVersion) ||
        canonical(owner.businessVersion) !== canonical(r.businessVersion) ||
        owner.sourceModifiedRaw !== r.rawFields.sourceModifiedRaw
      )
        fail();
      if (
        text(owner.rawHeaderIdentifier).split(',')[0]!.trim() !== owner.number
      )
        fail();
      for (const k of [
        'stateRaw',
        'sourceCreatedRaw',
        'sourceModifiedRaw',
        'contextRaw',
      ])
        text(owner[k], 120);
      const type = shape(owner.typeEvidence, [
        'nativeTypeIdOrigin',
        'rawHeaderType',
        'headerMatch',
      ]);
      if (
        type.headerMatch !== true ||
        type.nativeTypeIdOrigin !==
          (profile.dynamic ? 'BOUND_DIRECTORY_QUERY' : 'PROFILE_DECLARED') ||
        text(type.rawHeaderType, 120).trim() !==
          (profile.dynamic ? 'Publication Source' : profile.objectType)
      )
        fail();
      if (profile.dynamic) {
        const tech = shape(owner.technicalVersionEvidence, [
          'actualLabel',
          'rawValue',
          'panelLocator',
        ]);
        if (
          tech.actualLabel !== 'Version:' ||
          tech.rawValue !==
            r.sourceVersion.rawRevision + '.' + r.sourceVersion.rawIteration ||
          !dynamicPanel(tech.panelLocator)
        )
          fail();
      } else if (owner.technicalVersionEvidence !== null) fail();
      const section = shape(read.section, [
        'label',
        'panelLocator',
        'active',
        'hitVerified',
      ]);
      if (
        section.label !== (profile.dynamic ? '所有属性' : 'Details') ||
        !(profile.dynamic
          ? dynamicPanel(section.panelLocator)
          : section.panelLocator === profile.detailPanel) ||
        section.active !== true ||
        section.hitVerified !== true
      )
        fail();
      if (previousEnd !== undefined) ordered(previousEnd, owner.observedAt);
      ordered(owner.observedAt, read.observedAt);
      ordered(read.observedAt, packageObservedAt);
      previousEnd = read.observedAt;
      const fields = list(read.fields, profile.fieldLabels.length),
        seen = new Set<string>();
      if (fields.length !== profile.fieldLabels.length) fail();
      for (const [i, value] of fields.entries()) {
        const f = shape(value, [
            'actualLabel',
            'labelOrigin',
            'sectionLabel',
            'panelLocator',
            'locator',
            'fieldType',
            'presence',
            'rawBoundedValue',
            'nativeControl',
            'truncation',
            'observedAt',
          ]),
          key = String(f.panelLocator) + '|' + String(f.actualLabel);
        if (
          f.actualLabel !== profile.fieldLabels[i] ||
          seen.has(key) ||
          f.sectionLabel !== section.label ||
          !(profile.dynamic
            ? dynamicPanel(f.panelLocator)
            : profile.fieldPanels!.includes(String(f.panelLocator))) ||
          (profile.fieldPanelByLabel &&
            f.panelLocator !==
              profile.fieldPanelByLabel[String(f.actualLabel)]) ||
          !text(f.locator).startsWith(String(f.panelLocator) + ' ')
        )
          fail();
        seen.add(key);
        ordered(owner.observedAt, f.observedAt);
        ordered(f.observedAt, read.observedAt);
        const t = shape(f.truncation, [
            'truncated',
            'limit',
            'capturedCodepoints',
            'observedTotalCodepoints',
          ]),
          captured = Number(t.capturedCodepoints),
          observed = Number(t.observedTotalCodepoints);
        if (
          !['PRESENT_VALUE', 'PRESENT_BLANK', 'ABSENT', 'NOT_LOADED'].includes(
            String(f.presence),
          ) ||
          t.limit !== 8000 ||
          !Number.isSafeInteger(t.capturedCodepoints) ||
          !Number.isSafeInteger(t.observedTotalCodepoints) ||
          captured < 0 ||
          captured > 8000 ||
          observed < captured ||
          t.truncated !== observed > captured
        )
          fail();
        if (['ABSENT', 'NOT_LOADED'].includes(String(f.presence))) {
          if (
            f.rawBoundedValue !== null ||
            f.nativeControl !== null ||
            f.fieldType !== 'UNOBSERVED' ||
            f.labelOrigin !== 'PROFILE_EXPECTED_LABEL' ||
            captured !== 0 ||
            observed !== 0
          )
            fail();
        } else {
          if (
            typeof f.rawBoundedValue !== 'string' ||
            [...f.rawBoundedValue].length !== captured ||
            f.fieldType !== 'DISPLAY_TEXT' ||
            f.labelOrigin !== 'NATIVE_VISIBLE_LABEL' ||
            (f.presence === 'PRESENT_BLANK' && f.rawBoundedValue !== '') ||
            (f.presence === 'PRESENT_VALUE' &&
              !f.rawBoundedValue.trim() &&
              !t.truncated)
          )
            fail();
          const c = shape(f.nativeControl, [
            'tag',
            'readOnly',
            'disabled',
            'visibleControls',
          ]);
          if (
            c.tag !== 'TD' ||
            c.readOnly !== null ||
            c.disabled !== null ||
            list(c.visibleControls, 0).length
          )
            fail();
          total += captured;
        }
      }
      const tables = list(read.relationTables, profile.tables.length);
      if (tables.length !== profile.tables.length) fail();
      for (const [i, value] of tables.entries()) {
        const spec = profile.tables[i]!,
          t = shape(value, [
            'tableTitle',
            'panelLocator',
            'gridId',
            'ownerSourceRecordId',
            'active',
            'hitVerified',
            'reportedCount',
            'rows',
            'firstPageOnly',
            'targetOwnerReads',
            'observedAt',
          ]),
          rows = list(t.rows, 5);
        if (
          t.tableTitle !== spec.title ||
          t.panelLocator !== spec.panel ||
          t.gridId !== spec.grid ||
          t.ownerSourceRecordId !== r.sourceRecordId ||
          t.active !== true ||
          t.hitVerified !== true ||
          t.firstPageOnly !== true ||
          t.targetOwnerReads !== 0 ||
          (t.reportedCount !== null &&
            (!Number.isSafeInteger(t.reportedCount) ||
              Number(t.reportedCount) < rows.length))
        )
          fail();
        ordered(owner.observedAt, t.observedAt);
        ordered(t.observedAt, read.observedAt);
        for (const [index, value] of rows.entries()) {
          const row = shape(value, [
            'rowIndex',
            'cells',
            'sourceLinks',
            'nativeRelationId',
            'targetOwnerRead',
            'confidence',
          ]);
          if (
            row.rowIndex !== index ||
            row.nativeRelationId !== null ||
            row.targetOwnerRead !== false ||
            row.confidence !== 'observed_unresolved'
          )
            fail();
          for (const value of list(row.cells, 40)) {
            const c = shape(value, [
              'actualLabel',
              'rawBoundedValue',
              'truncated',
              'observedTotalCodepoints',
            ]);
            if (
              typeof c.actualLabel !== 'string' ||
              c.actualLabel.length > 120 ||
              typeof c.rawBoundedValue !== 'string'
            )
              fail();
            const size = [...(c.rawBoundedValue as string)].length;
            if (
              size > 8000 ||
              !Number.isSafeInteger(c.observedTotalCodepoints) ||
              Number(c.observedTotalCodepoints) < size ||
              c.truncated !== Number(c.observedTotalCodepoints) > size
            )
              fail();
            total += size;
          }
          const refs = new Set<string>();
          for (const value of list(row.sourceLinks, 5)) {
            const link = shape(value, [
                'targetRef',
                'evidenceLocator',
                'nativeRole',
                'numberRaw',
              ]),
              key = String(link.targetRef) + '|' + String(link.nativeRole);
            if (
              !spec.targetClasses.some((cls) =>
                exactRef(link.targetRef, cls, true),
              ) ||
              refs.has(key) ||
              !['NUMBER_LINK', 'INFO_PAGE_LINK'].includes(
                String(link.nativeRole),
              ) ||
              !text(link.evidenceLocator).startsWith(spec.panel + ' ')
            )
              fail();
            text(link.numberRaw, 180);
            refs.add(key);
          }
        }
      }
      for (const k of ['unreadFields', 'unreadTabs'])
        for (const value of list(read[k], 200)) text(value, 200);
    }
    if (total > 40000) fail();
    const last = object(reads[1]);
    if (
      r.observedAt !== last.observedAt ||
      canonical(r.content.ownedVisibleBusinessContent) !==
        canonical(last.fields)
    )
      fail();
  };
}
