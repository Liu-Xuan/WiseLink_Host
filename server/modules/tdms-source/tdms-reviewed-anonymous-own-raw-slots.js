import { SB_ANONYMOUS_STRICT_BLANK as sbBlank } from './tdms-reviewed-sb-anonymous-strict-blank';
// Pure Source model from the SHA-qualified 21/11 file handoff; no collector or authority.
import { tdmsError } from './tdms-source.types';
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const REVIEWED_ANONYMOUS_OWN_RAW_MODELS = freeze({
  SB: {
    modelRevision: 'tdms-reviewed-sb-document-anonymous-own-raw@1',
    scopeId: 'SB',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    nativeHeaderType: 'SB文档',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          'SB/SL文档编号:',
          'SB/SL版本:',
          'OEM厂商类型:',
          'OEM厂商:',
          '类型:',
          'SB/SL标题:',
          '是否紧急:',
          '颁发日期:',
          '原创建者:',
          '原创建时间:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 27,
    anonymousOccurrenceZeroBased: 16,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: {
      rowZeroBased: 0,
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      childClasses: [
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
      ],
    },
    evidenceRef:
      'current-source-reload-failure-0.2.72/SL_NATIVE_LAYOUT_DECODED.json',
    evidenceSha256:
      '29a3e311f460aceff23095b43b98b26319e68eb0e5483f6eacd3a007c77966c2',
  },
  SIL: {
    modelRevision: 'tdms-reviewed-sb-document-anonymous-own-raw@1',
    scopeId: 'SIL',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    nativeHeaderType: 'SB文档',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          'SB/SL文档编号:',
          'SB/SL版本:',
          'OEM厂商类型:',
          'OEM厂商:',
          '类型:',
          'SB/SL标题:',
          '是否紧急:',
          '颁发日期:',
          '原创建者:',
          '原创建时间:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 27,
    anonymousOccurrenceZeroBased: 16,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: {
      rowZeroBased: 0,
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      childClasses: [
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
      ],
    },
    evidenceRef:
      'current-source-reload-failure-0.2.72/SL_NATIVE_LAYOUT_DECODED.json',
    evidenceSha256:
      '29a3e311f460aceff23095b43b98b26319e68eb0e5483f6eacd3a007c77966c2',
  },
  'SB-IN': {
    modelRevision: 'tdms-reviewed-sb-document-anonymous-own-raw@1',
    scopeId: 'SB-IN',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    nativeHeaderType: 'SB文档',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          'SB/SL文档编号:',
          'SB/SL版本:',
          'OEM厂商类型:',
          'OEM厂商:',
          '类型:',
          'SB/SL标题:',
          '是否紧急:',
          '颁发日期:',
          '原创建者:',
          '原创建时间:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 27,
    anonymousOccurrenceZeroBased: 16,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: {
      rowZeroBased: 0,
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      childClasses: [
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
      ],
    },
    evidenceRef:
      'current-source-reload-failure-0.2.72/SL_NATIVE_LAYOUT_DECODED.json',
    evidenceSha256:
      '29a3e311f460aceff23095b43b98b26319e68eb0e5483f6eacd3a007c77966c2',
  },
  SL: {
    modelRevision: 'tdms-reviewed-sb-document-anonymous-own-raw@1',
    scopeId: 'SL',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    nativeHeaderType: 'SB文档',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          'SB/SL文档编号:',
          'SB/SL版本:',
          'OEM厂商类型:',
          'OEM厂商:',
          '类型:',
          'SB/SL标题:',
          '是否紧急:',
          '颁发日期:',
          '原创建者:',
          '原创建时间:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 27,
    anonymousOccurrenceZeroBased: 16,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: {
      rowZeroBased: 0,
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      childClasses: [
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
      ],
    },
    evidenceRef:
      'current-source-reload-failure-0.2.72/SL_NATIVE_LAYOUT_DECODED.json',
    evidenceSha256:
      '29a3e311f460aceff23095b43b98b26319e68eb0e5483f6eacd3a007c77966c2',
  },
  MT: {
    modelRevision: 'tdms-reviewed-sb-document-anonymous-own-raw@1',
    scopeId: 'MT',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    nativeHeaderType: 'SB文档',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          'SB/SL文档编号:',
          'SB/SL版本:',
          'OEM厂商类型:',
          'OEM厂商:',
          '类型:',
          'SB/SL标题:',
          '是否紧急:',
          '颁发日期:',
          '原创建者:',
          '原创建时间:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 27,
    anonymousOccurrenceZeroBased: 16,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: {
      rowZeroBased: 0,
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      childClasses: [
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
      ],
    },
    evidenceRef:
      'current-source-reload-failure-0.2.72/SL_NATIVE_LAYOUT_DECODED.json',
    evidenceSha256:
      '29a3e311f460aceff23095b43b98b26319e68eb0e5483f6eacd3a007c77966c2',
  },
  ENGINEERING_ASSESSMENT: {
    modelRevision: 'tdms-reviewed-ef-ad-anonymous-own-raw@1',
    scopeId: 'ENGINEERING_ASSESSMENT',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest',
    nativeHeaderType: '工程文件编写评估单',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'ATA章节:',
          '受影响的机型:',
          '受影响的APU类型:',
          '受影响的发动机类型:',
          '受影响的起落架类型:',
          '受影响的附件:',
          '用户:',
          '评估意见:',
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          '用户:',
          'ATA章节:',
          '受影响的机型:',
          '受影响的飞机:',
          '受影响的发动机:',
          '受影响的发动机类型:',
          '受影响的APU类型:',
          '受影响的APU:',
          '受影响的起落架类型:',
          '受影响的起落架:',
          '受影响的附件:',
          '适用性备注:',
          '评估意见:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 38,
    anonymousOccurrenceZeroBased: 27,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: null,
    evidenceRef:
      'work/TDMS_FULL_SCOPE_COMPLETION_DEV_20261013/evidence/full-goal-native-efrequest-minimal-model-round13-private.json',
    evidenceSha256:
      '91451c461efdcac0b67216c325849f15e8e13f461701a95b6d3cb60ec4c3c366',
  },
  AD: {
    modelRevision: 'tdms-reviewed-ef-ad-anonymous-own-raw@1',
    scopeId: 'AD',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.ADDocument',
    nativeHeaderType: 'AD文档',
    detailTabId:
      'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
    detailTabLabel: 'Details',
    detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
    sections: [
      {
        sectionId: 'General',
        sectionLabel: 'General',
        dataStoreId: 'dataStoreGeneral',
        fieldLabels: [
          'AD编号:',
          'AD文档标题:',
          'Name:',
          'Status:',
          'Primary Content:',
          'Modified By:',
          'Last Modified:',
        ],
      },
      {
        sectionId: 'BusinessAttributesGroup',
        sectionLabel: 'Business',
        dataStoreId: 'dataStoreBusinessAttributesGroup',
        fieldLabels: [
          '用户:',
          'AD编号:',
          '修正案号:',
          'AD文档标题:',
          '颁发日期:',
          '适航指令来源:',
          '生效日期:',
          '受影响的机型:',
          '受影响的发动机类型:',
          '受影响的APU类型:',
          '受影响的起落架类型:',
          '受影响的附件:',
          '适用性备注:',
          '被替代的适航指令号:',
          '相关适航指令号:',
          '是否敏感AD:',
          '原始发动机类型:',
          '适航指令类别:',
        ],
      },
      {
        sectionId: 'MoreAttributesGroup',
        sectionLabel: 'System',
        dataStoreId: 'dataStoreMoreAttributesGroup',
        fieldLabels: [
          'Description:',
          '',
          'Format Name:',
          'State:',
          'Context:',
          'Location:',
          'Life Cycle Template:',
          'Team Template:',
          'Created By:',
          'Modified By:',
          'Created On:',
          'Last Modified:',
        ],
      },
    ],
    rosterCount: 37,
    anonymousOccurrenceZeroBased: 26,
    sectionId: 'MoreAttributesGroup',
    sectionLabel: 'System',
    dataStoreId: 'dataStoreMoreAttributesGroup',
    sectionOccurrenceZeroBased: 1,
    previousLabel: 'Description:',
    nextLabel: 'Format Name:',
    captionTag: 'TD',
    captionClass: 'attributePanel-label',
    valueTag: 'TD',
    valueClass: 'attributePanel-value',
    anonymousRow: {
      rowZeroBased: 0,
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      childClasses: [
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
        'attributePanel-asterisk',
        'attributePanel-label',
        'attributePanel-value',
      ],
    },
    evidenceRef: 'work/TDMS_AD_DETAIL_PRIMARY_READONLY_DOM_20261011.json',
    evidenceSha256:
      'cea8af044626d78307908e120acaf0c76edf191b0f5a1d24fbefbc2ce732c598',
  },
});
const own = (value, key) => Object.hasOwn(value || {}, key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ref = /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u;
const reject = (code) => {
  throw tdmsError(code);
};
const eligible = (state) => ['Approved', '已批准', 'Estimated'].includes(state);
export function reviewedAnonymousOwnRawModel(scopeId) {
  return REVIEWED_ANONYMOUS_OWN_RAW_MODELS[scopeId] || null;
}
export function isReviewedAnonymousOwnRawOwner({ scopeId, owner } = {}) {
  const m = reviewedAnonymousOwnRawModel(scopeId);
  return (
    !!m &&
    ref.test(owner?.sourceRecordId || '') &&
    owner.nativeTypeId === m.nativeTypeId &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === m.nativeTypeId &&
    owner.rawHeaderType === m.nativeHeaderType &&
    owner.rawHeaderIdentifier?.split(',')[0].trim() === owner.number
  );
}
export function isReviewedAnonymousOwnRawField({
  scopeId,
  owner,
  read,
  field,
} = {}) {
  if (!read || !isReviewedAnonymousOwnRawOwner({ scopeId, owner }))
    return false;
  try {
    return slotContext({ scopeId, owner, read }).field === field;
  } catch {
    return false;
  }
}
function slotContext({ scopeId, owner, read }) {
  const m = reviewedAnonymousOwnRawModel(scopeId);
  if (!m) return null;
  if (!isReviewedAnonymousOwnRawOwner({ scopeId, owner }))
    reject('TDMS_ANONYMOUS_OWN_RAW_OWNER_UNVERIFIED');
  const fields = read.fields?.filter((f) => f.tabId === m.detailTabId),
    tabs = read.tabs?.filter((t) => t.tabId === m.detailTabId);
  if (
    !Array.isArray(fields) ||
    fields.length !== m.rosterCount ||
    tabs?.length !== 1 ||
    tabs[0].label !== m.detailTabLabel ||
    tabs[0].panelLocator !== m.detailPanel ||
    tabs[0].required !== true
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_ROSTER_INVALID');
  const expected = m.sections.flatMap((section) =>
    section.fieldLabels.map((label) => ({ section, label })),
  );
  for (const [i, f] of fields.entries()) {
    const spec = expected[i],
      locator = f.value?.locator;
    if (
      f.sectionId !== m.detailTabId + '::' + spec.section.sectionId ||
      f.value?.actualLabel !== spec.label ||
      f.labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
      f.fieldId !== locator ||
      typeof locator !== 'string' ||
      !locator.startsWith(
        m.detailPanel + ' #' + spec.section.dataStoreId + ' > ',
      )
    )
      reject('TDMS_ANONYMOUS_OWN_RAW_SLOT_INVALID');
  }
  if (
    new Set(fields.map((f) => f.fieldId)).size !== m.rosterCount ||
    fields.filter((f) => f.value.actualLabel === '').length !== 1
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_SLOT_INVALID');
  for (const section of m.sections) {
    const found = read.sections?.filter(
      (s) => s.sectionId === m.detailTabId + '::' + section.sectionId,
    );
    if (
      found?.length !== 1 ||
      found[0].tabId !== m.detailTabId ||
      found[0].label !== section.sectionLabel ||
      found[0].panelLocator !== m.detailPanel + ' #' + section.sectionId ||
      found[0].sourceDeclared !== true
    )
      reject('TDMS_ANONYMOUS_OWN_RAW_SLOT_INVALID');
  }
  const field = fields[m.anonymousOccurrenceZeroBased],
    inSection = fields.filter(
      (f) => f.sectionId === m.detailTabId + '::' + m.sectionId,
    );
  if (
    field !== inSection[m.sectionOccurrenceZeroBased] ||
    inSection[m.sectionOccurrenceZeroBased - 1].value.actualLabel !==
      m.previousLabel ||
    inSection[m.sectionOccurrenceZeroBased + 1].value.actualLabel !==
      m.nextLabel ||
    field.nativeControl?.tag !== m.valueTag ||
    field.nativeControl.readOnly !== null ||
    field.nativeControl.disabled !== null
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_SLOT_INVALID');
  if (
    m.anonymousRow &&
    !field.fieldId.endsWith(
      ' > tr:nth-child(1) > td:nth-child(' +
        m.anonymousRow.valueChildOneBased +
        ')',
    )
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_SLOT_INVALID');
  const rosters = read.rosterEvidence?.structuralRosters?.filter(
      (r) => r.tabId === m.detailTabId,
    ),
    roster = rosters?.[0];
  const fieldIds = fields.map((f) => f.fieldId),
    sections = read.sections.filter((s) => s.tabId === m.detailTabId);
  if (
    rosters?.length !== 1 ||
    roster.settledReads !== 2 ||
    !same(roster.before, roster.after) ||
    roster.before?.declaredFieldCount !== m.rosterCount ||
    roster.before.terminal !== 'DOM_TREE_END' ||
    roster.before.loadingPresent !== false ||
    !same(roster.before.fieldIds, fieldIds) ||
    !same(roster.before.fieldLocators, fieldIds) ||
    !same(
      roster.before.sectionIds,
      sections.map((s) => s.sectionId),
    ) ||
    !same(
      roster.before.sectionLocators,
      sections.map((s) => s.panelLocator),
    )
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_ROSTER_INVALID');
  return { m, field, tab: tabs[0] };
}
export function validateReviewedAnonymousOwnRawField({
  scopeId,
  owner,
  read,
  field,
} = {}) {
  const m = reviewedAnonymousOwnRawModel(scopeId);
  if (!m) return false;
  const context = slotContext({ scopeId, owner, read });
  if (field !== context.field) {
    if (
      own(field, 'rawTextQualification') ||
      own(field, 'rawCaptionText') ||
      own(field, 'strictBlankEvidence')
    )
      reject('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
    return false;
  }
  const q = field.rawTextQualification,
    keys = [
      'semanticPurpose',
      'ownerSourceRecordId',
      'ownStateRaw',
      'observedAt',
      'reasonCode',
    ];
  if (
    !q ||
    typeof q !== 'object' ||
    Array.isArray(q) ||
    !same(Object.keys(q).sort(), keys.sort()) ||
    q.semanticPurpose !== 'SEMANTIC_PURPOSE_UNKNOWN' ||
    q.ownerSourceRecordId !== owner.sourceRecordId ||
    q.ownStateRaw !== owner.stateRaw ||
    q.observedAt !== owner.observedAt ||
    !own(field, 'rawCaptionText') ||
    typeof field.rawCaptionText !== 'string' ||
    field.rawCaptionText.length > 200 ||
    field.rawCaptionText.trim() !== ''
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
  const value = field.value,
    isEligible = eligible(owner.stateRaw),
    hasBlank = own(field, 'strictBlankEvidence');
  const strictBlank =
    hasBlank &&
    sbBlank.field(field.strictBlankEvidence, { scopeId, owner, read, field });
  if (
    sbBlank.model.scopeIds.includes(scopeId) &&
    ['VALUE', 'BLANK', 'TRUNCATED'].includes(value.state) &&
    !strictBlank
  )
    reject('TDMS_COMPLETE_SB_ANONYMOUS_STRICT_BLANK_UNPROVEN');
  const reason = isEligible
    ? null
    : owner.stateRaw === 'Estimating'
      ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
      : 'TDMS_OPINION_STATE_NOT_ELIGIBLE';
  if (q.reasonCode !== reason || !Array.isArray(field.links))
    reject('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
  if (
    !isEligible &&
    !strictBlank &&
    (value.state !== 'NOT_READ' ||
      value.rawValue !== null ||
      value.observedTotalCodepoints !== 0 ||
      field.links.length)
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
  if (
    isEligible &&
    ![
      'VALUE',
      'BLANK',
      'NOT_READ',
      'NOT_LOADED',
      'ACCESS_DENIED',
      'TRUNCATED',
    ].includes(value.state)
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_QUALIFICATION_INVALID');
  if (
    value.state === 'BLANK' &&
    (typeof value.rawValue !== 'string' ||
      value.rawValue.trim() !== '' ||
      value.observedTotalCodepoints !== [...value.rawValue].length)
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_PAYLOAD_INVALID');
  const unread = !['VALUE', 'BLANK'].includes(value.state),
    occurrences = read.rosterEvidence.unknownRequiredSurfaces.filter(
      (id) => id === field.fieldId,
    ).length;
  if (
    occurrences !== (unread ? 1 : 0) ||
    (unread && context.tab.state === 'VALUE')
  )
    reject('TDMS_ANONYMOUS_OWN_RAW_GAP_INVALID');
  return true;
}
export function validateReviewedAnonymousOwnRawRead({
  scopeId,
  owner,
  read,
} = {}) {
  if (!reviewedAnonymousOwnRawModel(scopeId)) return false;
  for (const field of read.fields || [])
    validateReviewedAnonymousOwnRawField({ scopeId, owner, read, field });
  return true;
}
