// Pure Source model from the SHA-qualified 21/11 file handoff; no collector or authority.
import { tdmsError } from './tdms-source.types';
import {
  validateReviewedAdHandlingTreeTable,
  REVIEWED_AD_HANDLING_NATIVE_TREE_MODEL as treeModel,
} from './tdms-reviewed-ad-handling-native-tree';
import {
  validateReviewedAdHandlingSurfaceEvidence,
  validateReviewedAdHandlingRequiredTable,
  REVIEWED_AD_HANDLING_REQUIRED_SURFACE_MODEL as surfaceModel,
} from './tdms-reviewed-ad-handling-required-surfaces';
// Actual native captions and contexts; unknown text and relations remain unread.
export const REVIEWED_AD_HANDLING_NATIVE_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-handling-native-readonly-surfaces@1',
  scopeId: 'AD_HANDLING_FORM',
  nativeClass: 'wt.change2.WTChangeRequest2',
  nativeTypeId: null,
  nativeHeaderType: 'AD处理单',
  detailTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_changeRequestDetailsTab',
  detailPanel: '#infoPage_myTab_object_changeRequestDetailsTab',
  rootLocator: '#infoPagemainInfoPagePanel',
  technicalVersionSemantics: 'UNREVIEWED',
  sections: [
    {
      sectionId: 'General',
      sectionLabel: 'Attributes',
      dataStoreId: 'dataStoreGeneral',
      fieldLabels: [
        'Name:',
        'AD处理单编号:',
        'Category:',
        'AD处理单版本:',
        'Change Admin I:',
        'AD号:',
        'Description:',
        '修正案号:',
        'Proposed Solution:',
        'AD处理单标题:',
        'AD紧急程度:',
        'ATA章节:',
        '被替代的适航指令号:',
        '相关适航指令号:',
        '受影响的机型:',
        '受影响的发动机类型:',
        '受影响的APU类型:',
        '受影响的起落架类型:',
        '受影响的附件:',
        '适用性备注:',
        '生效日期:',
        '接收日期:',
        '评估截止日期:',
        '原始发动机:',
        '任务来源:',
        '再评估日期:',
        '是否需要再评估:',
        '用户:',
      ],
    },
    {
      sectionId: 'Justification',
      sectionLabel: 'Justification',
      dataStoreId: 'dataStoreJustification',
      fieldLabels: [
        'RelateOid:',
        'Recurring Cost:',
        'AD号:',
        'Nonrecurring Cost:',
        'AD处理单标题:',
        'AD处理单版本:',
        'AD处理单编号:',
        'AD紧急程度:',
        'ATA章节:',
        'IsLatest:',
        '任务来源:',
        '修正案号:',
        '原始发动机:',
        '受影响的APU类型:',
        '受影响的APU类型ID:',
        '受影响的发动机类型:',
        '受影响的发动机类型ID:',
        '受影响的机型:',
        '受影响的机型ID:',
        '受影响的起落架类型:',
        '受影响的起落架类型ID:',
        '受影响的附件:',
        '接收日期:',
        '改版原因:',
        '生效日期:',
        '相关适航指令号:',
        '被替代的适航指令号:',
        '评估截止日期:',
        '适用性备注:',
        '需要改版的AD分处理单:',
      ],
    },
    {
      sectionId: 'BusinessAttributesGroup',
      sectionLabel: 'Business Attributes',
      dataStoreId: 'dataStoreBusinessAttributesGroup',
      fieldLabels: [
        '改版原因:',
        '改版时间:',
        '再评估日期:',
        '是否需要再评估:',
        '用户:',
      ],
    },
    {
      sectionId: 'Process',
      sectionLabel: 'Process',
      dataStoreId: 'dataStoreProcess',
      fieldLabels: [
        'Context:',
        'Need Date:',
        'Complexity:',
        'Resolution Date:',
        'Request Priority:',
      ],
    },
    {
      sectionId: 'System',
      sectionLabel: 'System',
      dataStoreId: 'dataStoreSystem',
      fieldLabels: [
        'Team Name:',
        'Modified By:',
        'Location:',
        'Last Modified:',
        'Created By:',
        'Created On:',
      ],
    },
  ],
  tabs: [
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_changeRequestDetailsTab',
      label: 'Details',
      panelLocator: '#infoPage_myTab_object_changeRequestDetailsTab',
    },
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_changeRequestProcessTab',
      label: 'Process',
      panelLocator: '#infoPage_myTab_object_changeRequestProcessTab',
    },
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_changeObjectsHistoryTab',
      label: 'History',
      panelLocator: '#infoPage_myTab_object_changeObjectsHistoryTab',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_265293102',
      label: '附件',
      panelLocator: '#infoPage_myTab_tab_jcaGen_265293102',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_1995075121',
      label: '成员',
      panelLocator: '#infoPage_myTab_tab_jcaGen_1995075121',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_adTreeReport',
      label: 'AD RelationShip',
      panelLocator: '#infoPage_myTab_ad_adTreeReport',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_ADHistory',
      label: 'History Table',
      panelLocator: '#infoPage_myTab_ad_ADHistory',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_5754962897',
      label: '新建选项卡 1',
      panelLocator: '#infoPage_myTab_tab_jcaGen_5754962897',
    },
  ],
  nonContentControl: {
    actionId: 'infoPageinfoPanelID__new_tab_action',
    rawCaption: '',
    semantic: 'NATIVE_TAB_CREATE_ACTION',
    tag: 'LI',
    tagQuery: 'li[id^="infoPageinfoPanelID__"]',
    rawClassEvidenceState: 'NOT_READ',
  },
  businessMetadata: [
    {
      sectionId: 'General',
      dataStoreId: 'dataStoreGeneral',
      sectionIndex: 1,
      label: 'AD处理单编号:',
    },
    {
      sectionId: 'General',
      dataStoreId: 'dataStoreGeneral',
      sectionIndex: 3,
      label: 'AD处理单版本:',
    },
    {
      sectionId: 'Justification',
      dataStoreId: 'dataStoreJustification',
      sectionIndex: 5,
      label: 'AD处理单版本:',
    },
    {
      sectionId: 'Justification',
      dataStoreId: 'dataStoreJustification',
      sectionIndex: 6,
      label: 'AD处理单编号:',
    },
    {
      sectionId: 'System',
      dataStoreId: 'dataStoreSystem',
      sectionIndex: 3,
      label: 'Last Modified:',
    },
    {
      sectionId: 'System',
      dataStoreId: 'dataStoreSystem',
      sectionIndex: 5,
      label: 'Created On:',
    },
  ],
  unreviewedTextFields: [
    { sectionId: 'General', label: 'Description:' },
    { sectionId: 'General', label: 'Proposed Solution:' },
    { sectionId: 'General', label: '适用性备注:' },
    { sectionId: 'Justification', label: '改版原因:' },
    { sectionId: 'Justification', label: '适用性备注:' },
    { sectionId: 'BusinessAttributesGroup', label: '改版原因:' },
  ],
  nativeAttachmentGridId: 'attachments.table.secondary',
  relationRoleModel: 'UNREVIEWED',
  evidenceRef:
    'TDMS_AD_CHAIN_IDENTITY_CLOSURE_ROOT_20261014/evidence/TDMS_AD_CHANGEREQUEST_KNOWN_OBJECT_REQUIRED_INPUT_ROOT_20261014.json',
  evidenceSha256:
    '7fb14049de584d74e181f9507fa9653713c670b6ed2494d90a351038be71ad63',
  ownStateLocator: '#infoPageinfoPageTitleBarLifeCycleState',
  stateEvidenceSha256:
    '938a74cf5242927630ff7a362732c699b94720a39fbe6ccd6c0421443cc9ce4c',
  rawTextCaptureBoundary:
    'QUALIFIED_OWN_STATE_RAW_CAPTURE; SEMANTIC_PURPOSE_UNKNOWN',
  rawCaptureReviewSha256:
    'f76f99cbe66b4c1a55e709ff1cf28d10a9da48b62dbb2f826ab9dc4d0c810b7f',
});
for (const key of [
  'sections',
  'tabs',
  'businessMetadata',
  'unreviewedTextFields',
]) {
  Object.freeze(REVIEWED_AD_HANDLING_NATIVE_MODEL[key]);
  for (const spec of REVIEWED_AD_HANDLING_NATIVE_MODEL[key])
    Object.freeze(spec);
}
const m = REVIEWED_AD_HANDLING_NATIVE_MODEL;
const reject = (code) => {
  throw tdmsError(code);
};
const exact = (value, keys) =>
  value &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
export function isReviewedAdHandlingOwner({ scopeId, owner } = {}) {
  return (
    scopeId === m.scopeId &&
    /^(?:OR|VR):wt\.change2\.WTChangeRequest2:\d{1,24}$/u.test(
      owner?.sourceRecordId || '',
    ) &&
    owner.rawHeaderType === m.nativeHeaderType &&
    owner.rawHeaderIdentifier === owner.number &&
    typeof owner.number === 'string' &&
    owner.number.length > 0 &&
    owner.nativeTypeId === null &&
    owner.nativeTypeEvidence?.state === 'NOT_READ' &&
    owner.nativeTypeEvidence.rawValue === null &&
    owner.nativeTypeEvidence.observedTotalCodepoints === 0 &&
    owner.scopeEvidence?.nativeTypeOrigin === 'REQUIRED_RELATION_TARGET'
  );
}
export function validateReviewedAdHandlingOwner(args = {}) {
  if (args.scopeId !== m.scopeId) return false;
  if (!isReviewedAdHandlingOwner(args))
    reject('TDMS_COMPLETE_AD_HANDLING_OWNER_MODEL_INVALID');
  const owner = args.owner,
    expectedLocator = m.detailPanel + ' [expected-label=Version:]';
  if (
    owner.sourceVersion?.confirmation !== 'VERSION_UNCONFIRMED' ||
    owner.sourceVersion.rawRevision !== null ||
    owner.sourceVersion.rawIteration !== null ||
    [owner.technicalVersionEvidence, owner.technicalVersionFieldEvidence].some(
      (v) =>
        v?.state !== 'ABSENT' ||
        v.actualLabel !== 'Version:' ||
        v.rawValue !== null ||
        v.locator !== expectedLocator ||
        v.observedTotalCodepoints !== 0,
    )
  )
    reject('TDMS_COMPLETE_AD_HANDLING_TECHNICAL_MODEL_UNREVIEWED');
  return true;
}
function fieldContext(field, spec) {
  const prefix = m.detailPanel + ' #' + spec.dataStoreId + ' > ';
  return (
    field?.tabId === m.detailTabId &&
    field.sectionId === m.detailTabId + '::' + spec.sectionId &&
    field.labelOrigin === 'NATIVE_SOURCE_DECLARED' &&
    field.nativeControl?.tag === 'TD' &&
    field.nativeControl.readOnly === null &&
    field.nativeControl.disabled === null &&
    field.fieldId === field.value?.locator &&
    typeof field.fieldId === 'string' &&
    field.fieldId.startsWith(prefix) &&
    Array.isArray(field.links) &&
    field.links.length === 0
  );
}
export function validateReviewedAdHandlingBusinessMetadata({
  scopeId,
  owner,
  fields,
} = {}) {
  if (!validateReviewedAdHandlingOwner({ scopeId, owner })) return false;
  if (!Array.isArray(fields))
    reject('TDMS_COMPLETE_AD_HANDLING_METADATA_MODEL_INVALID');
  const matches = fields.filter((f) =>
    m.businessMetadata.some((spec) => spec.label === f.value?.actualLabel),
  );
  if (matches.length !== m.businessMetadata.length)
    reject('TDMS_COMPLETE_AD_HANDLING_METADATA_MODEL_INVALID');
  const values = [];
  for (const spec of m.businessMetadata) {
    const rows = matches.filter(
      (f) =>
        f.value.actualLabel === spec.label &&
        f.sectionId === m.detailTabId + '::' + spec.sectionId,
    );
    if (
      rows.length !== 1 ||
      !fieldContext(rows[0], spec) ||
      rows[0].value.state !== 'VALUE' ||
      typeof rows[0].value.rawValue !== 'string' ||
      !rows[0].value.rawValue.trim() ||
      [...rows[0].value.rawValue].length !==
        rows[0].value.observedTotalCodepoints
    )
      reject('TDMS_COMPLETE_AD_HANDLING_METADATA_MODEL_INVALID');
    values.push(rows[0].value);
  }
  const [
    generalNumber,
    generalVersion,
    justificationVersion,
    justificationNumber,
    modified,
    created,
  ] = values;
  if (
    generalNumber.rawValue !== justificationNumber.rawValue ||
    generalVersion.rawValue !== justificationVersion.rawValue ||
    owner.rawHeaderIdentifier !==
      generalNumber.rawValue + '-' + generalVersion.rawValue ||
    owner.businessVersion?.rawRevision !== generalVersion.rawValue ||
    owner.businessVersion.rawIteration !== null ||
    owner.businessVersion.confirmation !== 'SOURCE_DECLARED' ||
    [
      'state',
      'actualLabel',
      'rawValue',
      'locator',
      'observedTotalCodepoints',
    ].some((k) => owner.businessVersionEvidence?.[k] !== generalVersion[k]) ||
    owner.sourceModifiedRaw !== modified.rawValue ||
    owner.sourceCreatedRaw !== created.rawValue
  )
    reject('TDMS_COMPLETE_AD_HANDLING_BUSINESS_MIRROR_CHANGED');
  return true;
}
export function validateReviewedAdHandlingRead({ scopeId, owner, read } = {}) {
  if (!validateReviewedAdHandlingOwner({ scopeId, owner })) return false;
  const sections = (read.sections || []).filter(
      (s) => s.tabId === m.detailTabId,
    ),
    fields = (read.fields || []).filter((f) => f.tabId === m.detailTabId);
  if (
    sections.length !== m.sections.length ||
    fields.length !== m.sections.reduce((n, s) => n + s.fieldLabels.length, 0)
  )
    reject('TDMS_COMPLETE_AD_HANDLING_DETAIL_MODEL_INVALID');
  let index = 0;
  for (const spec of m.sections) {
    const section = sections.find(
      (s) => s.sectionId === m.detailTabId + '::' + spec.sectionId,
    );
    if (
      !section ||
      section.panelLocator !== m.detailPanel + ' #' + spec.sectionId ||
      section.label !== spec.sectionLabel ||
      section.state !== 'VALUE' ||
      section.sourceDeclared !== true
    )
      reject('TDMS_COMPLETE_AD_HANDLING_DETAIL_MODEL_INVALID');
    for (const label of spec.fieldLabels) {
      const f = fields[index++];
      if (
        !fieldContext({ ...f, links: [] }, spec) ||
        f.value.actualLabel !== label
      )
        reject('TDMS_COMPLETE_AD_HANDLING_DETAIL_MODEL_INVALID');
      validateReviewedAdHandlingRawTextField({ scopeId, owner, field: f });
    }
  }
  validateReviewedAdHandlingBusinessMetadata({ scopeId, owner, fields });
  if (
    !read.rosterEvidence?.layoutEvidencePending ||
    !Array.isArray(read.tabs) ||
    JSON.stringify(read.tabs.map((t) => [t.tabId, t.label, t.panelLocator])) !==
      JSON.stringify(m.tabs.map((t) => [t.tabId, t.label, t.panelLocator])) ||
    read.tabs.some(
      (t) =>
        t.required !== true ||
        (t.tabId !== m.detailTabId &&
          t.tabId !== treeModel.tabId &&
          t.state !== 'NOT_READ'),
    ) ||
    !Array.isArray(read.rosterEvidence.nativeTabStripIds) ||
    read.rosterEvidence.nonContentControls?.length !== 1 ||
    !Array.isArray(read.rosterEvidence.nativeTabStripIds) ||
    read.rosterEvidence.nonContentControls?.length !== 1 ||
    (read.relationTables || []).length >
      1 +
        surfaceModel.adjacentDetails.grids.length +
        surfaceModel.panels.reduce((n, p) => n + p.grids.length, 0)
  )
    reject('TDMS_COMPLETE_AD_HANDLING_REQUIRED_SURFACE_UNREVIEWED');
  for (const tab of read.tabs)
    if (tab.purposeEvidence !== undefined)
      validateReviewedAdHandlingSurfaceEvidence(tab.purposeEvidence, {
        scopeId,
        owner,
        tab,
        read,
      });
  for (const table of read.relationTables || [])
    if (!validateReviewedAdHandlingTreeTable({ scopeId, owner, table })) {
      const tab = read.tabs.find((t) => t.tabId === table.tabId);
      if (
        !tab?.purposeEvidence ||
        !validateReviewedAdHandlingRequiredTable({
          scopeId,
          owner,
          table,
          window: tab.purposeEvidence.windows[1],
        })
      )
        reject('TDMS_COMPLETE_AD_HANDLING_REQUIRED_SURFACE_UNREVIEWED');
    }
  return true;
}

export function isReviewedAdHandlingRawTextField({
  scopeId,
  owner,
  field,
} = {}) {
  if (!isReviewedAdHandlingOwner({ scopeId, owner })) return false;
  const spec = m.sections.find(
    (s) => field?.sectionId === m.detailTabId + '::' + s.sectionId,
  );
  return (
    !!spec &&
    fieldContext({ ...field, links: [] }, spec) &&
    m.unreviewedTextFields.some(
      (s) =>
        s.sectionId === spec.sectionId && s.label === field.value?.actualLabel,
    )
  );
}
export function validateReviewedAdHandlingRawTextField({
  scopeId,
  owner,
  field,
} = {}) {
  const rawSlot = isReviewedAdHandlingRawTextField({ scopeId, owner, field });
  if (!rawSlot) {
    if (Object.hasOwn(field || {}, 'rawTextQualification'))
      reject('TDMS_AD_HANDLING_RAW_TEXT_CONTEXT_INVALID');
    return false;
  }
  const q = field.rawTextQualification,
    eligible = ['Approved', '已批准', 'Estimated'].includes(owner.stateRaw),
    reason = eligible
      ? null
      : owner.stateRaw === 'Estimating'
        ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
        : 'TDMS_OPINION_STATE_NOT_ELIGIBLE';
  if (
    !exact(q, [
      'semanticPurpose',
      'ownerSourceRecordId',
      'ownStateRaw',
      'observedAt',
      'reasonCode',
    ]) ||
    q.semanticPurpose !== 'SEMANTIC_PURPOSE_UNKNOWN' ||
    q.ownerSourceRecordId !== owner.sourceRecordId ||
    q.ownStateRaw !== owner.stateRaw ||
    q.observedAt !== owner.observedAt ||
    q.reasonCode !== reason
  )
    reject('TDMS_AD_HANDLING_RAW_TEXT_QUALIFICATION_INVALID');
  if (
    !eligible &&
    (field.value.state !== 'NOT_READ' ||
      field.value.rawValue !== null ||
      field.value.observedTotalCodepoints !== 0 ||
      field.links.length)
  )
    reject(
      owner.stateRaw === 'Estimating'
        ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
        : 'TDMS_OPINION_STATE_NOT_ELIGIBLE',
    );
  if (
    eligible &&
    ![
      'VALUE',
      'BLANK',
      'NOT_READ',
      'NOT_LOADED',
      'TRUNCATED',
      'ACCESS_DENIED',
    ].includes(field.value.state)
  )
    reject('TDMS_AD_HANDLING_RAW_TEXT_STATE_INVALID');
  return true;
}
