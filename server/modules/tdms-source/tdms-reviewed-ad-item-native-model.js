// Exact partial AD_ITEM surface from the SHA-qualified 2026-10-14 code handoff.
// Optional paired roster evidence identifies this model; older observations keep their interpretation.
import { tdmsError } from './tdms-source.types';
export const REVIEWED_AD_ITEM_NATIVE_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-item-native-readonly-surfaces@1',
  scopeId: 'AD_ITEM',
  nativeClass: 'wt.change2.WTChangeActivity2',
  nativeTypeId: null,
  nativeHeaderType: 'AD处理条目',
  detailTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
  detailPanel: '#infoPage_myTab_object_changeTaskDetailsTab',
  rootLocator: '#infoPagemainInfoPagePanel',
  technicalVersionSemantics: 'UNREVIEWED',
  businessVersionSemantics: 'UNREVIEWED',
  nonContentControl: {
    actionId: 'infoPageinfoPanelID__new_tab_action',
    tag: 'LI',
    classToken: 'x-tab-with-icon',
    rawCaption: '',
    semantic: 'NATIVE_TAB_CREATE_ACTION',
  },
  tabs: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      label: 'Details',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskProcessTab',
      label: 'Process',
      panelLocator: '#infoPage_myTab_object_changeTaskProcessTab',
    },
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_referenceDocumentTable',
      label: 'Reference Document Table',
      panelLocator: '#infoPage_myTab_object_referenceDocumentTable',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_EFRDocumentTable',
      label: 'EFR Document Table',
      panelLocator: '#infoPage_myTab_object_EFRDocumentTable',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_adTreeReport',
      label: 'AD RelationShip',
      panelLocator: '#infoPage_myTab_ad_adTreeReport',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_979795311',
      label: '成员',
      panelLocator: '#infoPage_myTab_tab_jcaGen_979795311',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_1259031177',
      label: '生命周期历史记录',
      panelLocator: '#infoPage_myTab_tab_jcaGen_1259031177',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_3748929190',
      label: '新建选项卡 1',
      panelLocator: '#infoPage_myTab_tab_jcaGen_3748929190',
    },
  ],
  sections: [
    {
      sectionId: 'General',
      sectionLabel: 'Attributes',
      dataStoreId: 'dataStoreGeneral',
      fieldLabels: [
        'Name:',
        'AD段落号:',
        'ATA章节:',
        '段号:',
        '评估人:',
        '是否重检:',
        '完成期限:',
        '首检时限:',
        '重检间隔:',
        '终止措施截止期限:',
        '适航指令要求:',
        '评估意见:',
        '受影响的飞机:',
        '受影响的发动机:',
        '受影响的APU:',
        '受影响的起落架:',
        '受影响的附件:',
        '是否适用:',
      ],
    },
    {
      sectionId: 'BusinessAttributesGroup',
      sectionLabel: 'Business Attributes',
      dataStoreId: 'dataStoreBusinessAttributesGroup',
      fieldLabels: [
        '是否适用:',
        'AD段落号:',
        'ATA章节:',
        '历史时限:',
        '受影响的APU:',
        '受影响的发动机:',
        '受影响的起落架:',
        '受影响的附件:',
        '受影响的飞机:',
        '完成期限:',
        '是否重检:',
        '段号:',
        '终止措施截止期限:',
        '结构化终止措施截止期限:',
        '结构化重检间隔:',
        '结构化首检时限:',
        '评估人:',
        '评估意见:',
        '适航指令要求:',
        '重检间隔:',
        '非结构化终止措施截止期限:',
        '非结构化重检间隔:',
        '非结构化首检时限:',
        '非结构完成期限:',
        '首检时限:',
      ],
    },
    {
      sectionId: 'Process',
      sectionLabel: 'Process',
      dataStoreId: 'dataStoreProcess',
      fieldLabels: ['Assignee:', 'Need Date:', 'Reviewer:'],
    },
    {
      sectionId: 'System',
      sectionLabel: 'System',
      dataStoreId: 'dataStoreSystem',
      fieldLabels: [
        'Team Name:',
        'Modified By:',
        'Created By:',
        'Last Modified:',
        'Created On:',
      ],
    },
  ],
  nativeGridSurfaces: [
    {
      gridId: 'attachments.table.secondary',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      nativeUiRole: 'ATTACHMENTS',
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          nativeColumnToken: 'checker',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Label or File Name',
          nativeColumnToken: 'attachmentsName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'View Information',
          nativeColumnToken: 'infoPageActionAttachment',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Format Icon',
          nativeColumnToken: 'formatIcon',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Format',
          nativeColumnToken: 'formatName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Attachment Description',
          nativeColumnToken: 'description',
          valuePolicy: 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION',
        },
        {
          actualLabel: 'Last Modified',
          nativeColumnToken: 'thePersistInfo_modifyStamp',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Modified By',
          nativeColumnToken: 'modifier',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
      ],
      evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
      evidenceSha256:
        '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
    },
    {
      gridId: 'changeTask_affectedItems_table',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      nativeUiRole: null,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          nativeColumnToken: 'checker',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'General Status',
          nativeColumnToken: 'statusFamily_General',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Change Status',
          nativeColumnToken: 'statusFamily_Change',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Object Type Indicator',
          nativeColumnToken: 'type_icon',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Version',
          nativeColumnToken: 'version',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'View Information',
          nativeColumnToken: 'infoPageAction',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'On Order',
          nativeColumnToken: 'onOrderDisposition',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Work-in-Process',
          nativeColumnToken: 'inventoryDisposition',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Finished',
          nativeColumnToken: 'finishedDisposition',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Annotation Sets',
          nativeColumnToken: 'associatedAnnotations',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Comments',
          nativeColumnToken: 'aadDescription',
          valuePolicy: 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION',
        },
      ],
      evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
      evidenceSha256:
        '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
    },
    {
      gridId: 'changeTask_resultingItems_table',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      nativeUiRole: null,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          nativeColumnToken: 'checker',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'General Status',
          nativeColumnToken: 'statusFamily_General',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Change Status',
          nativeColumnToken: 'statusFamily_Change',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Object Type Indicator',
          nativeColumnToken: 'type_icon',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Version',
          nativeColumnToken: 'version',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Unincorporated Changes Table Parameters',
          nativeColumnToken: 'launchIncorpHangingChange',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Compare Objects',
          nativeColumnToken: 'compare',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'View Information',
          nativeColumnToken: 'infoPageAction',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'State',
          nativeColumnToken: 'current_lifecycle_state',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'Comments',
          nativeColumnToken: 'crDescription',
          valuePolicy: 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION',
        },
      ],
      evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
      evidenceSha256:
        '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
    },
    {
      gridId: 'document.refDoc.list',
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_referenceDocumentTable',
      panelLocator: '#infoPage_myTab_object_referenceDocumentTable',
      nativeUiRole: null,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          nativeColumnToken: 'checker',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Reference Document Number',
          nativeColumnToken: 'docNumber',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'RefDocumentVersionNo',
          nativeColumnToken: 'docVersion',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'RefDocumentSourcing',
          nativeColumnToken: 'sourcing',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Reference Document Type',
          nativeColumnToken: 'docType',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Reference Document Title',
          nativeColumnToken: 'docName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'RefDocumentDate',
          nativeColumnToken: 'issueDate',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
      ],
      evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
      evidenceSha256:
        '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
    },
    {
      gridId: 'document.EFRDoc.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_EFRDocumentTable',
      panelLocator: '#infoPage_myTab_object_EFRDocumentTable',
      nativeUiRole: null,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          nativeColumnToken: 'checker',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFR Document Operation',
          nativeColumnToken: 'operationType',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFR Document Number',
          nativeColumnToken: 'numberDisPlay',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'State',
          nativeColumnToken: 'stateDisplay',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'EFRDocumentNumber2',
          nativeColumnToken: 'returnNumberDisPlay',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFRDocState2',
          nativeColumnToken: 'returnStateDisplay',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'EFR Document Type',
          nativeColumnToken: 'docType',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFR Document Name',
          nativeColumnToken: 'docName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFR Document IssueDate',
          nativeColumnToken: 'issueDate',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFR Document Operator',
          nativeColumnToken: 'userRef_fullName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'EFR Document Description',
          nativeColumnToken: 'docDescription',
          valuePolicy: 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION',
        },
        {
          actualLabel: 'Comments',
          nativeColumnToken: 'comments',
          valuePolicy: 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION',
        },
      ],
      evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
      evidenceSha256:
        '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
    },
    {
      gridId: 'mytreetable',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_adTreeReport',
      panelLocator: '#infoPage_myTab_ad_adTreeReport',
      nativeUiRole: null,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: 'Object Type Indicator',
          nativeColumnToken: 'type_icon',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'View Information',
          nativeColumnToken: 'infoPageAction',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Primary Content',
          nativeColumnToken: 'primaryAttachmentProperties',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'AD序号',
          nativeColumnToken: 'IBA|ADSequenceNO',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'State',
          nativeColumnToken: 'state',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'Created By',
          nativeColumnToken: 'creator',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Last Modified',
          nativeColumnToken: 'thePersistInfo_modifyStamp',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
      ],
      evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
      evidenceSha256:
        '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
    },
  ],
  evidenceRef: 'tdms-ad-item-own-native-input18/ad-item-safe.json',
  evidenceSha256:
    '8b010ceac8272f8a04a6a0fe04687cd3a7abcd17ee6dc167fac1f0da55dd36ee',
});
const m = REVIEWED_AD_ITEM_NATIVE_MODEL;
const nativeRef = /^(?:OR|VR):wt\.change2\.WTChangeActivity2:\d{1,24}$/u;
const reject = (code) => {
  throw tdmsError(code);
};
export function isReviewedAdItemOwner({ scopeId, owner } = {}) {
  return (
    scopeId === m.scopeId &&
    nativeRef.test(owner?.sourceRecordId || '') &&
    owner.rawHeaderType === m.nativeHeaderType
  );
}
// An observed class/header is not native subtype evidence and grants no identity facet.
export function validateReviewedAdItemOwner({ scopeId, owner } = {}) {
  if (scopeId !== m.scopeId) return false;
  if (
    !isReviewedAdItemOwner({ scopeId, owner }) ||
    owner.nativeTypeId !== null ||
    owner.nativeTypeEvidence?.state !== 'NOT_READ' ||
    owner.nativeTypeEvidence.rawValue !== null ||
    owner.rawHeaderIdentifier !== owner.number ||
    owner.sourceVersion?.confirmation !== 'VERSION_UNCONFIRMED' ||
    owner.sourceVersion.rawRevision !== null ||
    owner.sourceVersion.rawIteration !== null ||
    owner.technicalVersionEvidence?.state !== 'ABSENT' ||
    owner.technicalVersionFieldEvidence?.state !== 'ABSENT' ||
    owner.businessVersion !== null ||
    owner.businessVersionEvidence?.state !== 'NOT_READ'
  )
    reject('TDMS_COMPLETE_AD_ITEM_OWNER_MODEL_INVALID');
  return true;
}
export function validateReviewedAdItemRead({ scopeId, owner, read } = {}) {
  if (!isReviewedAdItemRead({ scopeId, owner, read })) return false;
  validateReviewedAdItemOwner({ scopeId, owner });
  const bad = () => reject('TDMS_COMPLETE_AD_ITEM_DETAIL_MODEL_INVALID');
  if (
    JSON.stringify(read.tabs.map((t) => [t.tabId, t.label, t.panelLocator])) !==
      JSON.stringify(m.tabs.map((t) => [t.tabId, t.label, t.panelLocator])) ||
    JSON.stringify(read.rosterEvidence.nativeTabStripIds) !==
      JSON.stringify([
        ...m.tabs.map((t) => t.tabId),
        m.nonContentControl.actionId,
      ]) ||
    !Array.isArray(read.rosterEvidence.nonContentControls) ||
    read.rosterEvidence.nonContentControls.length !== 1 ||
    read.rosterEvidence.layoutEvidencePending !== true
  )
    bad();
  const fields = read.fields.filter((f) => f.tabId === m.detailTabId),
    labels = m.sections.flatMap((s) => s.fieldLabels);
  if (fields.length !== labels.length) bad();
  let index = 0;
  for (const section of m.sections) {
    const sid = m.detailTabId + '::' + section.sectionId,
      sections = read.sections.filter((s) => s.sectionId === sid);
    if (
      sections.length !== 1 ||
      sections[0].label !== section.sectionLabel ||
      sections[0].panelLocator !== m.detailPanel + ' #' + section.sectionId
    )
      bad();
    for (const label of section.fieldLabels) {
      const f = fields[index++];
      if (
        f.sectionId !== sid ||
        f.value.actualLabel !== label ||
        f.labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
        f.nativeControl.tag !== 'TD' ||
        f.nativeControl.readOnly !== null ||
        f.nativeControl.disabled !== null ||
        f.fieldId !== f.value.locator ||
        !f.fieldId.startsWith(
          m.detailPanel + ' #' + section.dataStoreId + ' > ',
        )
      )
        bad();
      if (
        label === '评估意见:' &&
        !['Approved', '已批准', 'Estimated'].includes(owner.stateRaw) &&
        (f.value.state !== 'NOT_APPLICABLE' || f.links.length)
      )
        bad();
      if (
        label === 'Last Modified:' &&
        (f.value.state !== 'VALUE' ||
          f.value.rawValue !== owner.sourceModifiedRaw)
      )
        bad();
      if (
        label === 'Created On:' &&
        (f.value.state !== 'VALUE' ||
          f.value.rawValue !== owner.sourceCreatedRaw)
      )
        bad();
    }
  }
  for (const f of read.fields.filter((f) => f.tabId !== m.detailTabId))
    if (
      f.value.state !== 'NOT_READ' ||
      f.value.rawValue !== null ||
      f.links.length
    )
      bad();
  for (const spec of m.nativeGridSurfaces) {
    if (!read.relationTables.some((t) => t.gridId === spec.gridId)) {
      const tab = read.tabs.find((t) => t.tabId === spec.tabId);
      if (
        !tab ||
        !['NOT_READ', 'NOT_LOADED', 'ACCESS_DENIED'].includes(tab.state)
      )
        bad();
    }
  }
  const seenGrids = new Set();
  for (const table of read.relationTables) {
    if (seenGrids.has(table.gridId)) bad();
    seenGrids.add(table.gridId);
    const spec = m.nativeGridSurfaces.find((g) => g.gridId === table.gridId);
    if (
      !spec ||
      table.tabId !== spec.tabId ||
      table.panelLocator !== spec.panelLocator ||
      table.relationshipRole !== 'UNKNOWN' ||
      table.direction !== 'UNKNOWN' ||
      JSON.stringify(table.rawHeaders) !==
        JSON.stringify(spec.columns.map((c) => c.actualLabel))
    )
      bad();
    if (
      spec.gridId === 'mytreetable' &&
      (table.enumerationState === 'VALUE' ||
        table.terminal.kind === 'NATIVE_END' ||
        table.terminal.trueZero)
    )
      bad();
    for (const row of table.rows) {
      if (row.cells.length !== spec.columns.length) bad();
      for (const [i, column] of spec.columns.entries())
        if (
          column.valuePolicy === 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION'
        ) {
          const value = row.cells[i];
          if (
            value.state !== 'NOT_READ' ||
            value.rawValue !== null ||
            value.observedTotalCodepoints !== 0 ||
            row.sourceLinks.some(
              (l) =>
                l.nativeColumnLabel === column.actualLabel ||
                l.nativeColumnToken === column.nativeColumnToken,
            )
          )
            bad();
        }
      for (const link of row.sourceLinks) {
        const column = spec.columns.find(
          (c) => c.nativeColumnToken === link.nativeColumnToken,
        );
        if (!column || column.actualLabel !== link.nativeColumnLabel) bad();
      }
    }
  }
  return true;
}

export function isReviewedAdItemRead({ scopeId, owner, read } = {}) {
  return (
    isReviewedAdItemOwner({ scopeId, owner }) &&
    Object.hasOwn(read?.rosterEvidence || {}, 'nativeTabStripIds') &&
    Object.hasOwn(read?.rosterEvidence || {}, 'nonContentControls')
  );
}
// Current paired observations use the reviewed own-field user references. Keep
// historical unpaired AD_ITEM projections byte-identical, including UNKNOWN roles.
export function classifyReviewedAdItemOwnReference({
  scopeId,
  owner,
  read,
  fieldActualLabel,
  targetRef,
} = {}) {
  if (
    !isReviewedAdItemRead({ scopeId, owner, read }) ||
    !['Created By:', 'Modified By:'].includes(fieldActualLabel) ||
    !/^(?:OR|VR):wt\.org\.WTUser:\d{1,24}$/u.test(targetRef || '')
  )
    return null;
  return {
    relationshipRole: 'OUT_OF_SCOPE_REFERENCE',
    modelRoleOrigin: 'REVIEWED_OUT_OF_SCOPE_OWN_FIELD_MODEL',
    direction: 'SOURCE_TO_TARGET',
  };
}
