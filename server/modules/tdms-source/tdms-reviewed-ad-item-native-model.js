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
// These native levels describe presented UI rows only, never business parentage.
export const REVIEWED_AD_ITEM_NATIVE_UI_TREE_MODEL = Object.freeze({
  scopeId: 'AD_ITEM',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_adTreeReport',
  panelLocator: '#infoPage_myTab_ad_adTreeReport',
  gridId: 'mytreetable',
  gridClassToken: 'ux-maximgb-tg-panel',
  levelClassPrefix: 'ux-maximgb-tg-level-',
  reviewedLevels: [0, 1],
  pathMeaning: 'PRESENTED_NATIVE_UI_ROW_IDENTITY_ONLY',
});
Object.freeze(REVIEWED_AD_ITEM_NATIVE_UI_TREE_MODEL.reviewedLevels);
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
      table.relationshipRole !==
        (table.relatedSurfaceEvidence?.schemaVersion ===
        REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.schemaVersion
          ? 'CURRENT_CONTENT'
          : 'UNKNOWN') ||
      table.direction !== 'UNKNOWN' ||
      JSON.stringify(table.rawHeaders) !==
        JSON.stringify(spec.columns.map((c) => c.actualLabel))
    )
      bad();
    if (table.relatedSurfaceEvidence !== undefined)
      validateReviewedAdItemDetailsQueryEvidence(table.relatedSurfaceEvidence, {
        scopeId,
        owner,
        table,
      });
    if (
      spec.gridId === 'mytreetable' &&
      (table.enumerationState === 'VALUE' ||
        table.terminal.kind === 'NATIVE_END' ||
        table.terminal.trueZero)
    )
      bad();
    // @1 has no producer-generation marker. Preserve its old evidence-absent
    // TREE projection; supplied hierarchy must be consistent across every row.
    if (
      spec.gridId === 'mytreetable' &&
      table.scanMode === 'TREE' &&
      table.rows.some(
        (row) => row.treeDepth !== null || row.treePath.length !== 0,
      )
    ) {
      const stack = [],
        ui = REVIEWED_AD_ITEM_NATIVE_UI_TREE_MODEL;
      for (const row of table.rows) {
        const depth = row.treeDepth,
          last = row.treePath.at(-1),
          ordinal = row.occurrenceId.match(/^mytreetable:ROW(\d+)$/u)?.[1];
        if (
          !ui.reviewedLevels.includes(depth) ||
          depth > stack.length ||
          row.treePath.length !== depth + 1 ||
          typeof last !== 'string' ||
          (row.nativeRowId !== null
            ? last !== row.nativeRowId
            : !/^ROW-\d+$/u.test(last)) ||
          (row.nativeRowId === null &&
            ordinal !== undefined &&
            last !== 'ROW-' + Number(ordinal)) ||
          JSON.stringify(row.treePath.slice(0, -1)) !==
            JSON.stringify(stack.slice(0, depth))
        )
          bad();
        stack.length = depth;
        stack[depth] = last;
      }
    }
    for (const row of table.rows) {
      if (row.cells.length !== spec.columns.length) bad();
      for (const [i, column] of spec.columns.entries())
        if (
          column.valuePolicy === 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION'
        ) {
          const value = row.cells[i];
          if (
            value.state === 'BLANK' &&
            itemEfrStrictBlankCell(table, row, column.nativeColumnToken, owner)
          )
            continue;
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

// Current native control/count observations, not query or endpoint certification.
export const REVIEWED_AD_ITEM_DETAILS_QUERY_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-item-details-native-query-surface@1',
  schemaVersion: 'wiselink.tdms-ad-item-details-native-query-surface.v1',
  scopeId: 'AD_ITEM',
  evidenceRef:
    'native-input-batch-root-20261015-second-window/AD_ITEM_DETAILS_QUERY_INPUT.json',
  evidenceSha256:
    '3464e334cb67dd6baba49e379326118429620ccd521eeaa4946c48eda004f70d',
  queryReviewState: 'NOT_READ',
  queryDefinition: 'UNKNOWN',
  backendCriteria: 'UNKNOWN',
  stopReason: 'TDMS_COMPLETE_AD_ITEM_DETAILS_QUERY_AND_END_UNREVIEWED',
  grids: [
    {
      gridId: 'attachments.table.secondary',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      controls: [
        {
          id: 'attachments.table.secondary.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'changeTask_affectedItems_table',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      controls: [
        {
          id: 'changeTask_affectedItems_tablefilterSelect',
          kind: 'NATIVE_VIEW_RAW',
        },
        {
          id: 'changeTask_affectedItems_table.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'changeTask_resultingItems_table',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      controls: [
        {
          id: 'changeTask_resultingItems_tablefilterSelect',
          kind: 'NATIVE_VIEW_RAW',
        },
        {
          id: 'changeTask_resultingItems_table.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
  ],
});
for (const grid of REVIEWED_AD_ITEM_DETAILS_QUERY_MODEL.grids) {
  for (const control of grid.controls) Object.freeze(control);
  Object.freeze(grid.controls);
  Object.freeze(grid);
}
Object.freeze(REVIEWED_AD_ITEM_DETAILS_QUERY_MODEL.grids);
const q = REVIEWED_AD_ITEM_DETAILS_QUERY_MODEL;
// Normal cache/package serialization may reorder object keys; array order is native evidence.
const qStable = (value) =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? '[' + value.map(qStable).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + qStable(value[key]))
          .join(',') +
        '}';
const qSame = (a, b) => qStable(a) === qStable(b);
const qExact = (value, keys) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const qReject = () =>
  reject('TDMS_COMPLETE_AD_ITEM_DETAILS_QUERY_SURFACE_INVALID');
const qText = (value, max, nullable = false) => {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > max) qReject();
};
export function reviewedAdItemDetailsQueryModel({
  scopeId,
  owner,
  table,
} = {}) {
  if (scopeId !== q.scopeId || !isReviewedAdItemOwner({ scopeId, owner }))
    return null;
  return (
    q.grids.find(
      (g) =>
        g.gridId === table?.gridId &&
        g.tabId === table?.tabId &&
        g.panelLocator === table?.panelLocator,
    ) || null
  );
}
function validateItemQueryFrame(frame, model, table) {
  if (
    !qExact(frame, [
      'activeTabId',
      'panelId',
      'gridId',
      'columns',
      'controls',
      'counts',
      'position',
    ])
  )
    qReject();
  if (
    frame.activeTabId !== model.tabId ||
    frame.panelId !== model.panelLocator.slice(1) ||
    frame.gridId !== model.gridId
  )
    qReject();
  const native = m.nativeGridSurfaces.find((g) => g.gridId === model.gridId);
  if (
    !qSame(
      frame.columns,
      native.columns.map((c) => ({
        actualLabel: c.actualLabel,
        nativeColumnToken: c.nativeColumnToken,
      })),
    )
  )
    qReject();
  if (!Array.isArray(frame.controls) || frame.controls.length > 100) qReject();
  const seen = new Set();
  for (const control of frame.controls) {
    if (
      !qExact(control, [
        'id',
        'tag',
        'rawClassName',
        'type',
        'name',
        'rawValue',
        'valueEvidenceState',
        'disabled',
        'ariaExpanded',
        'title',
      ])
    )
      qReject();
    qText(control.id, 300, true);
    qText(control.tag, 30);
    qText(control.rawClassName, 1000);
    qText(control.type, 40, true);
    qText(control.name, 300, true);
    qText(control.ariaExpanded, 100, true);
    qText(control.title, 500, true);
    if (
      typeof control.disabled !== 'boolean' ||
      (control.id !== null && seen.has(control.id))
    )
      qReject();
    if (control.id !== null) seen.add(control.id);
    const known = model.controls.find((c) => c.id === control.id),
      readable =
        known &&
        control.tag === 'INPUT' &&
        control.type === 'text' &&
        control.name === known.id &&
        ['x-form-text', 'x-form-field'].every((token) =>
          control.rawClassName.split(/\s+/u).includes(token),
        );
    if (readable) {
      qText(control.rawValue, 1000);
      if (
        control.valueEvidenceState !==
        (control.rawValue.trim() ? 'VALUE' : 'BLANK')
      )
        qReject();
    } else if (
      control.rawValue !== null ||
      control.valueEvidenceState !== 'NOT_READ'
    )
      qReject();
  }
  if (!Array.isArray(frame.counts) || frame.counts.length > 2) qReject();
  let total = null,
    selected = null,
    raw = null;
  for (const count of frame.counts) {
    if (!qExact(count, ['id', 'tag', 'rawClassName', 'rawText'])) qReject();
    qText(count.id, 300, true);
    qText(count.rawClassName, 1000);
    qText(count.rawText, 200);
    if (
      count.tag !== 'SPAN' ||
      !count.rawClassName.split(/\s+/u).includes('tableCount')
    )
      qReject();
    const text = count.rawText.replace(/\s+/gu, ' ').trim(),
      a = text.match(/^\(\s*(\d+)\s+objects?\s*\)$/iu),
      b = text.match(/^\(\s*(\d+)\s+objects?\s+selected\s*\)$/iu);
    if (!a && !b) qReject();
    const n = Number((a || b)[1]);
    if (!Number.isSafeInteger(n) || n > 20000) qReject();
    if (a) {
      if (total !== null) qReject();
      total = n;
      raw = text;
    } else {
      if (selected !== null) qReject();
      selected = n;
    }
  }
  if (
    table.reportedTotal !== total ||
    table.countEvidence.exact !== (total !== null) ||
    table.countEvidence.rawText !== raw
  )
    qReject();
  const w = table.windows?.[0],
    expected = w && {
      reportedTotal: w.reportedTotal,
      pageRaw: w.pageRaw,
      scroll: w.scroll,
      nextControl: w.nextControl,
      rowOccurrenceIds: w.rowOccurrenceIds,
      globalIndices: w.globalIndices,
      treePending: w.treePending,
    };
  if (!expected || !qSame(frame.position, expected)) qReject();
}
export function validateReviewedAdItemDetailsQueryEvidence(
  proof,
  { scopeId, owner, table } = {},
) {
  if (proof?.schemaVersion === REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.schemaVersion)
    return validateReviewedAdItemFlatQueryEvidence(proof, {
      scopeId,
      owner,
      table,
    });
  const model = reviewedAdItemDetailsQueryModel({ scopeId, owner, table });
  if (!model) {
    if (proof !== undefined) qReject();
    const native =
      scopeId === q.scopeId &&
      isReviewedAdItemOwner({ scopeId, owner }) &&
      m.nativeGridSurfaces.find(
        (g) =>
          g.gridId === table?.gridId &&
          g.tabId === table?.tabId &&
          g.panelLocator === table?.panelLocator,
      );
    return native
      ? {
          complete: false,
          queryKnown: false,
          reasonCode: 'TDMS_COMPLETE_AD_ITEM_RELATED_QUERY_AND_END_UNREVIEWED',
        }
      : null;
  }
  // Historical @1 receipts still decode. Missing fresh raw proof remains partial
  // when the normal completeness consumer revisits that historical payload.
  if (proof === undefined)
    return {
      complete: false,
      queryKnown: false,
      reasonCode: 'TDMS_COMPLETE_AD_ITEM_DETAILS_RAW_QUERY_MISSING',
    };
  validateReviewedAdItemOwner({ scopeId, owner });
  if (
    !qExact(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerBusinessVersion',
      'ownerNumber',
      'ownStateRaw',
      'ownerSourceModifiedRaw',
      'nativeTypeId',
      'tabId',
      'panelLocator',
      'gridId',
      'queryReviewState',
      'before',
      'after',
      'settledReads',
    ]) ||
    proof.schemaVersion !== q.schemaVersion ||
    proof.modelRevision !== q.modelRevision ||
    proof.scopeId !== q.scopeId ||
    proof.ownerSourceRecordId !== owner.sourceRecordId ||
    !qSame(proof.ownerSourceVersion, owner.sourceVersion) ||
    !qSame(proof.ownerBusinessVersion, owner.businessVersion) ||
    proof.ownerNumber !== owner.number ||
    proof.ownStateRaw !== owner.stateRaw ||
    proof.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
    proof.nativeTypeId !== null ||
    proof.tabId !== model.tabId ||
    proof.panelLocator !== model.panelLocator ||
    proof.gridId !== model.gridId ||
    proof.queryReviewState !== 'NOT_READ' ||
    proof.settledReads !== 2
  )
    qReject();
  if (
    table.countEvidence?.locator !==
      model.panelLocator + ' [id="' + model.gridId + '"] span.tableCount' ||
    table.relationshipRole !== 'UNKNOWN' ||
    table.direction !== 'UNKNOWN' ||
    table.ownerSourceRecordId !== owner.sourceRecordId ||
    !qSame(table.ownerSourceVersion, owner.sourceVersion) ||
    table.enumerationState !== 'NOT_READ' ||
    table.stopReason !== q.stopReason ||
    table.terminal.kind !== 'UNCONFIRMED' ||
    table.terminal.nativeTerminal !== false ||
    table.terminal.trueZero !== false ||
    table.terminal.allTreeNodesExpanded !== false ||
    table.windows?.length !== 1 ||
    table.treeExpansions?.length
  )
    qReject();
  if (
    !qSame(
      table.rawHeaders,
      m.nativeGridSurfaces
        .find((g) => g.gridId === model.gridId)
        .columns.map((c) => c.actualLabel),
    )
  )
    qReject();
  validateItemQueryFrame(proof.before, model, table);
  validateItemQueryFrame(proof.after, model, table);
  if (!qSame(proof.before, proof.after)) qReject();
  return {
    complete: false,
    queryKnown: false,
    rawControlStateCaptured: proof.after.controls.some((c) =>
      ['VALUE', 'BLANK'].includes(c.valueEvidenceState),
    ),
    requiredControlsObserved: model.controls.every((expected) =>
      proof.after.controls.some(
        (c) =>
          c.id === expected.id &&
          ['VALUE', 'BLANK'].includes(c.valueEvidenceState),
      ),
    ),
    backendCriteria: 'UNKNOWN',
    reasonCode: q.stopReason,
  };
}

// Pure serialized AD_ITEM query/body/blank proof decoders from the exact @7
// Source closure. DOM collection, alias tabs and source scheduling are not run here.
// Current source-presented flat business queries; historical raw-only @2 remains decodable.
export const REVIEWED_AD_ITEM_FLAT_QUERY_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-ad-item-flat-native-query.v1',
  modelRevision: 'tdms-reviewed-ad-item-flat-native-query@1',
  scopeId: 'AD_ITEM',
  evidenceRef: 'AD_ITEM_SIX_BUSINESS_QUERY_SCOPE_NATIVE_INPUT.json',
  evidenceSha256:
    '15e6a415fcf053c47c3db271cd60d3e25743a5f4172157920ca9e5e9cfd55e15',
  queryScope: 'OWNER_PRESENTED_CURRENT_BUSINESS_RELATIONS',
  searchPlaceholder: 'Search in table',
  stopReason: 'TDMS_COMPLETE_AD_ITEM_FLAT_QUERY_SCOPE_UNPROVEN',
  grids: [
    {
      gridId: 'attachments.table.secondary',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      searchId: 'attachments.table.secondary.searchInListTextBox',
      viewId: null,
      viewOptions: [],
      viewName: null,
      selectedOnlyItemId:
        'attachments.table.secondary_WTablePanel.selectedOnlyViewItem',
      controls: [
        {
          id: 'attachments.table.secondary.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'changeTask_affectedItems_table',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      searchId: 'changeTask_affectedItems_table.searchInListTextBox',
      viewId: 'changeTask_affectedItems_tablefilterSelect',
      viewOptions: [
        'All',
        'CAD Documents',
        'Choices',
        'Documents',
        'Dynamic Documents',
        'Notes',
        'Option Sets',
        'Parts',
        'Variant Specifications',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      viewName: 'All',
      selectedOnlyItemId:
        'changeTask_affectedItems_table_WTablePanel.selectedOnlyViewItem',
      controls: [
        {
          id: 'changeTask_affectedItems_tablefilterSelect',
          kind: 'NATIVE_VIEW_RAW',
        },
        {
          id: 'changeTask_affectedItems_table.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'changeTask_resultingItems_table',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeTaskDetailsTab',
      panelLocator: '#infoPage_myTab_object_changeTaskDetailsTab',
      searchId: 'changeTask_resultingItems_table.searchInListTextBox',
      viewId: 'changeTask_resultingItems_tablefilterSelect',
      viewOptions: [
        'All',
        'CAD Documents',
        'Choices',
        'Documents',
        'Dynamic Documents',
        'Notes',
        'Option Sets',
        'Parts',
        'Variant Specifications',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      viewName: 'All',
      selectedOnlyItemId:
        'changeTask_resultingItems_table_WTablePanel.selectedOnlyViewItem',
      controls: [
        {
          id: 'changeTask_resultingItems_tablefilterSelect',
          kind: 'NATIVE_VIEW_RAW',
        },
        {
          id: 'changeTask_resultingItems_table.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'document.refDoc.list',
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_referenceDocumentTable',
      panelLocator: '#infoPage_myTab_object_referenceDocumentTable',
      searchId: 'document.refDoc.list.searchInListTextBox',
      viewId: null,
      viewOptions: [],
      viewName: null,
      selectedOnlyItemId:
        'document.refDoc.list_WTablePanel.selectedOnlyViewItem',
      controls: [
        {
          id: 'document.refDoc.list.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'document.EFRDoc.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_EFRDocumentTable',
      panelLocator: '#infoPage_myTab_object_EFRDocumentTable',
      searchId: 'document.EFRDoc.list.searchInListTextBox',
      viewId: null,
      viewOptions: [],
      viewName: null,
      selectedOnlyItemId:
        'document.EFRDoc.list_WTablePanel.selectedOnlyViewItem',
      controls: [
        {
          id: 'document.EFRDoc.list.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
    {
      gridId: 'attachments.table.secondary',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_3748929190',
      panelLocator: '#infoPage_myTab_tab_jcaGen_3748929190',
      searchId: 'attachments.table.secondary.searchInListTextBox',
      viewId: null,
      viewOptions: [],
      viewName: null,
      selectedOnlyItemId:
        'attachments.table.secondary_WTablePanel.selectedOnlyViewItem',
      controls: [
        {
          id: 'attachments.table.secondary.searchInListTextBox',
          kind: 'NATIVE_SEARCH_RAW',
        },
      ],
    },
  ],
});

for (const g of REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.grids) {
  Object.freeze(g.viewOptions);
  for (const c of g.controls) Object.freeze(c);
  Object.freeze(g.controls);
  Object.freeze(g);
}

Object.freeze(REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.grids);

export function reviewedAdItemFlatQueryModel({ scopeId, owner, table } = {}) {
  if (scopeId !== 'AD_ITEM' || !isReviewedAdItemOwner({ scopeId, owner }))
    return null;
  return (
    REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.grids.find(
      (g) =>
        g.gridId === table?.gridId &&
        g.tabId === table?.tabId &&
        g.panelLocator === table?.panelLocator,
    ) || null
  );
}

// Only page-authoritative native query semantics. Endpoint/content use normal table rules.
export function reviewedAdItemFlatQueryReady(frame, model) {
  if (
    !frame ||
    !frame.nativeQuery ||
    frame.nativeQuery.additionalControls.length ||
    frame.nativeQuery.loading
  )
    return false;
  const controls = frame.controls,
    search = controls.filter((c) => c.id === model.searchId);
  if (
    search.length !== 1 ||
    search[0].disabled ||
    search[0].tag !== 'INPUT' ||
    search[0].type !== 'text' ||
    search[0].name !== model.searchId ||
    search[0].rawValue !== 'Search in table' ||
    !search[0].rawClassName.split(/\s+/u).includes('x-form-empty-field')
  )
    return false;
  const q = frame.nativeQuery,
    s = q.selectedOnly;
  if (
    s.state !== 'VALUE' ||
    s.itemId !== model.selectedOnlyItemId ||
    s.tag !== 'A' ||
    s.rawText !== 'View Selected Objects Only' ||
    !['x-menu-item', 'x-menu-check-item'].every((c) =>
      s.rawClassName.split(/\s+/u).includes(c),
    ) ||
    s.checkedClassPresent ||
    (s.ariaChecked !== null && s.ariaChecked !== 'false') ||
    JSON.stringify(s.sequence) !==
      JSON.stringify(['BUTTON_OPENED', 'ITEM_READ', 'BUTTON_CLOSED'])
  )
    return false;
  const v = q.view;
  if (model.viewId) {
    const view = controls.filter((c) => c.id === model.viewId),
      selected = v.options.filter((o) =>
        o.rawClassName.split(/\s+/u).includes('x-combo-selected'),
      );
    if (
      view.length !== 1 ||
      view[0].disabled ||
      view[0].rawValue !== model.viewName ||
      v.state !== 'VALUE' ||
      v.inputBefore !== model.viewName ||
      v.inputAfter !== model.viewName ||
      selected.length !== 1 ||
      selected[0].rawText !== model.viewName ||
      JSON.stringify(v.options.map((o) => o.rawText)) !==
        JSON.stringify(model.viewOptions) ||
      JSON.stringify(v.sequence) !==
        JSON.stringify(['ARROW_OPENED', 'CHOICES_READ', 'ACTIVE_TAB_CLOSED'])
    )
      return false;
  } else if (v.state !== 'NOT_APPLICABLE') return false;
  const total = frame.counts.filter((c) =>
    /^\(\s*\d+\s+objects?\s*\)$/iu.test(c.rawText),
  );
  const selected = frame.counts.filter((c) =>
    /^\(\s*\d+\s+objects?\s+selected\s*\)$/iu.test(c.rawText),
  );
  return (
    total.length === 1 &&
    selected.length === 1 &&
    frame.counts.length === 2 &&
    Number(total[0].rawText.match(/\d+/u)[0]) ===
      frame.position.reportedTotal &&
    Number(selected[0].rawText.match(/\d+/u)[0]) <=
      frame.position.reportedTotal &&
    (frame.position.reportedTotal !== 0 || q.hiddenRows === 0)
  );
}

const ITEM_EFR_SCOPED_BODY_SCHEMA =
  'wiselink.tdms-ad-item-efr-scoped-native-body.v1';

const itemEfrBodyRoot = String.raw`#document\.EFRDoc\.list`;

const itemEfrBodyCssIdent = String.raw`(?:\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[\t\n\f\r ])?|[^\n\r\f])|[-\w]|[^\x00-\x7f])+`;

const itemEfrBodyNamedLocator = new RegExp(
  String.raw`^#document\\\.EFRDoc\\\.list #(${itemEfrBodyCssIdent})$`,
  'u',
);

const itemEfrBodyUnescape = (raw) =>
  raw.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\f\r ])?|([^\n\r\f]))/gu,
    (_, hex, char) => {
      if (!hex) return char;
      const cp = Number.parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(cp);
    },
  );

function itemEfrBodyNodeValid(body) {
  const named =
      typeof body?.locator === 'string' &&
      body.locator.match(itemEfrBodyNamedLocator),
    classes =
      typeof body?.rawClassName === 'string'
        ? body.rawClassName.split(/\s+/u)
        : [];
  return (
    qExact(body, ['tag', 'id', 'rawClassName', 'locator']) &&
    body.tag === 'DIV' &&
    typeof body.id === 'string' &&
    body.id.length > 0 &&
    body.id.length <= 300 &&
    body.id !== 'document.EFRDoc.list' &&
    typeof body.rawClassName === 'string' &&
    body.rawClassName.length <= 1000 &&
    classes.includes('x-grid3-body') &&
    !classes.includes('x-grid3-row') &&
    !!named &&
    itemEfrBodyUnescape(named[1]) === body.id
  );
}

function itemEfrBodyRowValid(body, row) {
  const columns = m.nativeGridSurfaces.find(
    (g) => g.gridId === 'document.EFRDoc.list',
  ).columns;
  return (
    itemEfrBodyNodeValid(body) &&
    qExact(row, [
      'occurrenceId',
      'globalIndex',
      'nativeRowId',
      'nativeOrdinal',
      'tag',
      'rawClassName',
      'locator',
      'cellColumnTokens',
    ]) &&
    row.tag === 'DIV' &&
    row.nativeRowId === null &&
    Number.isSafeInteger(row.nativeOrdinal) &&
    row.nativeOrdinal >= 0 &&
    row.nativeOrdinal < 1000 &&
    row.globalIndex === row.nativeOrdinal &&
    row.occurrenceId === 'document.EFRDoc.list:ROW' + row.nativeOrdinal &&
    typeof row.rawClassName === 'string' &&
    row.rawClassName.length <= 1000 &&
    row.rawClassName.split(/\s+/u).includes('x-grid3-row') &&
    !row.rawClassName.split(/\s+/u).includes('x-grid3-body') &&
    row.locator ===
      body.locator + ' > div:nth-child(' + (row.nativeOrdinal + 1) + ')' &&
    qSame(
      row.cellColumnTokens,
      columns.map((c) => c.nativeColumnToken),
    )
  );
}

function validateItemEfrScopedBodyEvidence(e, table, window) {
  if (
    table.gridId !== 'document.EFRDoc.list' ||
    table.tableId !== 'document.EFRDoc.list' ||
    table.tabId !==
      'infoPageinfoPanelID__infoPage_myTab_object_EFRDocumentTable' ||
    table.panelLocator !== '#infoPage_myTab_object_EFRDocumentTable' ||
    table.scanMode !== 'DOM_ROWS' ||
    !qExact(e, ['schemaVersion', 'body', 'rows']) ||
    e.schemaVersion !== ITEM_EFR_SCOPED_BODY_SCHEMA ||
    !itemEfrBodyNodeValid(e.body) ||
    !Array.isArray(e.rows) ||
    e.rows.length > 1000 ||
    e.rows.length !== window.rowOccurrenceIds.length ||
    window.globalIndices.length !== e.rows.length
  )
    qReject();
  for (const [i, row] of e.rows.entries()) {
    const typed = table.rows.filter((r) => r.occurrenceId === row.occurrenceId);
    if (
      !itemEfrBodyRowValid(e.body, row) ||
      row.nativeOrdinal !== i ||
      window.rowOccurrenceIds[i] !== row.occurrenceId ||
      window.globalIndices[i] !== row.globalIndex ||
      typed.length !== 1 ||
      typed[0].nativeRowId !== null ||
      typed[0].globalIndex !== row.globalIndex
    )
      qReject();
  }
  return true;
}

function itemEfrBodyRowBindingValid(binding, occurrenceId) {
  return (
    qExact(binding, ['schemaVersion', 'body', 'row', 'windowOrdinals']) &&
    binding.schemaVersion === ITEM_EFR_SCOPED_BODY_SCHEMA &&
    itemEfrBodyRowValid(binding.body, binding.row) &&
    binding.row.occurrenceId === occurrenceId &&
    Array.isArray(binding.windowOrdinals) &&
    binding.windowOrdinals.length > 0 &&
    binding.windowOrdinals.length <= 200 &&
    new Set(binding.windowOrdinals).size === binding.windowOrdinals.length &&
    binding.windowOrdinals.every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n < 200,
    )
  );
}

// Hash/comparison view only. Raw observations and raw packages are never changed.
function itemEfrBodyLayoutView(value, maps) {
  if (Array.isArray(value))
    return value.map((v) => itemEfrBodyLayoutView(v, maps));
  if (!value || typeof value !== 'object') return value;
  const out = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, itemEfrBodyLayoutView(v, maps)]),
  );
  for (const map of maps) {
    // cellLocator exists only in the strict blank proof validated by the caller.
    for (const key of ['locator', 'evidenceLocator', 'cellLocator'])
      if (
        typeof out[key] === 'string' &&
        (out[key] === map.from || out[key].startsWith(map.from + ' > '))
      )
        out[key] = map.to + out[key].slice(map.from.length);
    if (
      value.tag === 'DIV' &&
      value.id === map.id &&
      value.locator === map.from &&
      typeof value.rawClassName === 'string' &&
      value.rawClassName.split(/\s+/u).includes('x-grid3-body')
    )
      out.id = null;
  }
  return out;
}

function itemEfrBodyColumnPath(link, row) {
  const columns = m.nativeGridSurfaces.find(
      (g) => g.gridId === 'document.EFRDoc.list',
    ).columns,
    index = columns.findIndex(
      (c) =>
        c.nativeColumnToken === link.nativeColumnToken &&
        c.actualLabel === link.nativeColumnLabel,
    );
  if (
    index < 0 ||
    columns[index].valuePolicy ===
      'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION' ||
    typeof link.locator !== 'string' ||
    !link.locator.startsWith(row.locator + ' > ')
  )
    return false;
  const tail = link.locator
    .slice(row.locator.length + 3)
    .split(' > ')
    .map((p) =>
      p.match(/^(div|span|table|tbody|tr|td|a):nth-child\(([1-9]\d*)\)$/u),
    );
  return (
    !tail.some((p) => !p) &&
    tail.length >= 5 &&
    tail[0][1] === 'table' &&
    tail[1][1] === 'tbody' &&
    tail[2][1] === 'tr' &&
    tail.slice(0, 3).every((p) => p[2] === '1') &&
    tail[3][1] === 'td' &&
    Number(tail[3][2]) === index + 1 &&
    tail.at(-1)[1] === 'a' &&
    tail.at(-1)[2] === '1' &&
    tail
      .slice(4, -1)
      .every((p) => ['div', 'span'].includes(p[1]) && p[2] === '1')
  );
}

function itemEfrBodyReadView(read) {
  if (
    !isReviewedAdItemOwner({ scopeId: 'AD_ITEM', owner: read?.owner }) ||
    !Array.isArray(read.relationTables)
  )
    return null;
  const tables = read.relationTables.filter(
    (t) =>
      t.tableId === 'document.EFRDoc.list' &&
      t.gridId === 'document.EFRDoc.list',
  );
  if (tables.length !== 1) return null;
  const table = tables[0],
    proof = table.relatedSurfaceEvidence;
  if (proof?.schemaVersion !== REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.schemaVersion)
    return null;
  try {
    if (
      !validateReviewedAdItemFlatQueryEvidence(proof, {
        scopeId: 'AD_ITEM',
        owner: read.owner,
        table,
      }).queryKnown
    )
      return null;
  } catch {
    return null;
  }
  const frames = proof.windowPairs.flatMap((p) => [p.before, p.after]),
    maps = [],
    bindings = [];
  for (const frame of frames) {
    const e = frame.nativeQuery.efrBody;
    if (!e || !/^ext-gen\d{1,20}$/u.test(e.body.id)) return null;
    const map = {
      from: e.body.locator,
      to: itemEfrBodyRoot + ' [REVIEWED_SCOPED_NATIVE_BODY]',
      id: e.body.id,
    };
    if (!maps.some((m) => m.from === map.from)) maps.push(map);
    for (const row of e.rows) {
      const typed = table.rows.find((r) => r.occurrenceId === row.occurrenceId);
      if (
        !typed ||
        typed.sourceLinks.some((l) => !itemEfrBodyColumnPath(l, row))
      )
        return null;
      for (const [index, link] of typed.sourceLinks.entries())
        bindings.push({
          tableId: table.tableId,
          row,
          index,
          link,
          maps: [map],
        });
    }
  }
  if (!maps.length) return null;
  const copy = {
    ...read,
    relationTables: read.relationTables.map((t) =>
      t === table ? itemEfrBodyLayoutView(t, maps) : t,
    ),
  };
  return { read: copy, bindings };
}

function itemEfrBodyOccurrenceView(o, binding) {
  const { row, link, index, tableId, maps } = binding;
  return o?.origin === 'RELATION_TABLE' &&
    o.tableId === tableId &&
    o.occurrenceId === row.occurrenceId &&
    o.linkIndex === index &&
    o.targetRef === link.targetRef &&
    o.rawHref === link.rawHref &&
    o.numberRaw === link.numberRaw &&
    o.locator === link.locator &&
    o.nativeColumnToken === link.nativeColumnToken &&
    o.nativeColumnLabel === link.nativeColumnLabel
    ? itemEfrBodyLayoutView(o, maps)
    : null;
}

export function reviewedAdItemEfrBodySemanticProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (
    value.schemaVersion === 'wiselink.tdms-daily-package.v1' &&
    Array.isArray(value.records) &&
    Array.isArray(value.edges)
  ) {
    const edgeMaps = [];
    for (const record of value.records) {
      const p = record.rawFields?.completeOwnedSource;
      if (
        p?.scopeId !== 'AD_ITEM' ||
        p.requestedCriteria?.sourceObjectRef !== record.sourceRecordId ||
        !Array.isArray(p.targetOccurrences)
      )
        continue;
      const view = itemEfrBodyReadView(p.reads?.[1]);
      if (!view) continue;
      for (const o of p.targetOccurrences)
        for (const b of view.bindings)
          if (itemEfrBodyOccurrenceView(o, b))
            edgeMaps.push({
              source: record.sourceRecordId,
              target: o.targetRef,
              from: o.locator,
              to: itemEfrBodyLayoutView(o, b.maps).locator,
            });
    }
    if (!edgeMaps.length) return value;
    return {
      ...value,
      records: value.records.map((r) =>
        r.rawFields?.completeOwnedSource
          ? {
              ...r,
              rawFields: {
                ...r.rawFields,
                completeOwnedSource: reviewedAdItemEfrBodySemanticProjection(
                  r.rawFields.completeOwnedSource,
                ),
              },
            }
          : r,
      ),
      edges: value.edges.map((e) => {
        const match = edgeMaps.find(
          (m) =>
            m.source === e.fromSourceRecordId &&
            m.target === e.toSourceRecordId &&
            e.relationKind === 'document.EFRDoc.list' &&
            m.from === e.evidenceLocator,
        );
        return match ? { ...e, evidenceLocator: match.to } : e;
      }),
    };
  }
  if (
    value.scopeId === 'AD_ITEM' &&
    Array.isArray(value.reads) &&
    Array.isArray(value.targetOccurrences)
  ) {
    const views = value.reads.map(itemEfrBodyReadView);
    if (views.some((v) => !v)) return value;
    return {
      ...value,
      reads: views.map((v) => v.read),
      targetOccurrences: value.targetOccurrences.map((o) => {
        for (const b of views[1].bindings) {
          const copy = itemEfrBodyOccurrenceView(o, b);
          if (copy) return copy;
        }
        return o;
      }),
    };
  }
  return itemEfrBodyReadView(value)?.read || value;
}

function validateItemFlatFrame(frame, model, table, window, owner) {
  if (
    !qExact(frame, [
      'activeTabId',
      'panelId',
      'gridId',
      'columns',
      'controls',
      'counts',
      'position',
      'nativeQuery',
    ]) ||
    frame.activeTabId !== model.tabId ||
    frame.panelId !== model.panelLocator.slice(1) ||
    frame.gridId !== model.gridId
  )
    qReject();
  const native = m.nativeGridSurfaces.find((g) => g.gridId === model.gridId);
  if (
    !qSame(
      frame.columns,
      native.columns.map((c) => ({
        actualLabel: c.actualLabel,
        nativeColumnToken: c.nativeColumnToken,
      })),
    )
  )
    qReject();
  if (
    !Array.isArray(frame.controls) ||
    frame.controls.length !== model.controls.length
  )
    qReject();
  for (const [i, c] of frame.controls.entries()) {
    if (
      !qExact(c, [
        'id',
        'tag',
        'rawClassName',
        'type',
        'name',
        'rawValue',
        'valueEvidenceState',
        'disabled',
        'ariaExpanded',
        'title',
      ]) ||
      c.id !== model.controls[i].id ||
      c.tag !== 'INPUT' ||
      c.type !== 'text' ||
      c.name !== c.id ||
      typeof c.disabled !== 'boolean' ||
      !['x-form-text', 'x-form-field'].every((t) =>
        c.rawClassName?.split(/\s+/u).includes(t),
      )
    )
      qReject();
    for (const k of ['id', 'rawClassName', 'type', 'name', 'rawValue'])
      qText(c[k], 1000);
    qText(c.ariaExpanded, 100, true);
    qText(c.title, 500, true);
    if (c.valueEvidenceState !== (c.rawValue.trim() ? 'VALUE' : 'BLANK'))
      qReject();
  }
  if (!Array.isArray(frame.counts) || frame.counts.length > 2) qReject();
  let total = null,
    selected = null,
    raw = null;
  for (const c of frame.counts) {
    if (
      !qExact(c, ['tag', 'rawClassName', 'rawText']) ||
      c.tag !== 'SPAN' ||
      !c.rawClassName?.split(/\s+/u).includes('tableCount')
    )
      qReject();
    qText(c.rawClassName, 1000);
    qText(c.rawText, 200);
    const text = c.rawText.replace(/\s+/gu, ' ').trim(),
      a = text.match(/^\(\s*(\d+)\s+objects?\s*\)$/iu),
      b = text.match(/^\(\s*(\d+)\s+objects?\s+selected\s*\)$/iu);
    if (!a && !b) qReject();
    const n = Number((a || b)[1]);
    if (!Number.isSafeInteger(n) || n > 20000) qReject();
    if (a) {
      if (total !== null) qReject();
      total = n;
      raw = text;
    } else {
      if (selected !== null) qReject();
      selected = n;
    }
  }
  if (
    total !== table.reportedTotal ||
    table.countEvidence.exact !== (total !== null) ||
    table.countEvidence.rawText !== raw
  )
    qReject();
  const expected = {
    reportedTotal: window.reportedTotal,
    pageRaw: window.pageRaw,
    scroll: window.scroll,
    nextControl: window.nextControl,
    rowOccurrenceIds: window.rowOccurrenceIds,
    globalIndices: window.globalIndices,
    treePending: window.treePending,
  };
  if (!qSame(frame.position, expected)) qReject();
  const n = frame.nativeQuery,
    bodyKeys = Object.hasOwn(n || {}, 'efrBody') ? ['efrBody'] : [],
    blankKeys = Object.hasOwn(n || {}, 'strictBlankEvidence')
      ? ['strictBlankEvidence']
      : [];
  if (
    !qExact(n, [
      'view',
      'selectedOnly',
      'additionalControls',
      'hiddenRows',
      'loading',
      ...bodyKeys,
      ...blankKeys,
    ]) ||
    !Array.isArray(n.additionalControls) ||
    n.additionalControls.length > 100 ||
    !Number.isSafeInteger(n.hiddenRows) ||
    n.hiddenRows < 0 ||
    typeof n.loading !== 'boolean'
  )
    qReject();
  if (bodyKeys.length)
    validateItemEfrScopedBodyEvidence(n.efrBody, table, window);
  if (blankKeys.length)
    validateItemEfrStrictBlankFrame(
      n.strictBlankEvidence,
      frame,
      table,
      window,
      owner,
    );
  if (table.gridId === 'document.EFRDoc.list')
    for (const id of window.rowOccurrenceIds) {
      const row = table.rows.find((r) => r.occurrenceId === id);
      for (const [index, token] of [
        [10, 'docDescription'],
        [11, 'comments'],
      ]) {
        const value = row?.cells[index],
          proved = n.strictBlankEvidence?.cells.some(
            (c) => c.occurrenceId === id && c.nativeColumnToken === token,
          );
        if (
          !proved &&
          (value?.state !== 'NOT_READ' ||
            value.rawValue !== null ||
            value.observedTotalCodepoints !== 0)
        )
          qReject();
      }
    }
  for (const c of n.additionalControls) {
    if (!qExact(c, ['id', 'tag', 'rawClassName'])) qReject();
    qText(c.id, 300, true);
    qText(c.tag, 30);
    qText(c.rawClassName, 1000);
  }
  const s = n.selectedOnly;
  if (
    !qExact(s, [
      'state',
      'itemId',
      'tag',
      'rawClassName',
      'parentClassName',
      'rawText',
      'ariaChecked',
      'checkedClassPresent',
      'openerClassName',
      'popupClassName',
      'sequence',
    ]) ||
    !['VALUE', 'UNKNOWN'].includes(s.state) ||
    typeof s.checkedClassPresent !== 'boolean' ||
    !Array.isArray(s.sequence)
  )
    qReject();
  for (const k of [
    'itemId',
    'tag',
    'rawClassName',
    'parentClassName',
    'rawText',
    'ariaChecked',
    'openerClassName',
    'popupClassName',
  ])
    qText(s[k], 1000, true);
  if (
    s.state === 'VALUE' &&
    (s.itemId !== model.selectedOnlyItemId ||
      s.tag !== 'A' ||
      !s.popupClassName?.split(/\s+/u).includes('x-menu') ||
      !s.openerClassName?.split(/\s+/u).includes('optionsButton'))
  )
    qReject();
  const v = n.view;
  if (
    !qExact(v, [
      'state',
      'inputBefore',
      'inputAfter',
      'popupClassName',
      'triggerClassName',
      'options',
      'sequence',
    ]) ||
    !['VALUE', 'UNKNOWN', 'NOT_APPLICABLE'].includes(v.state) ||
    !Array.isArray(v.options) ||
    v.options.length > 30 ||
    !Array.isArray(v.sequence)
  )
    qReject();
  for (const k of [
    'inputBefore',
    'inputAfter',
    'popupClassName',
    'triggerClassName',
  ])
    qText(v[k], 1000, true);
  for (const o of v.options) {
    if (!qExact(o, ['rawText', 'rawClassName'])) qReject();
    qText(o.rawText, 200);
    qText(o.rawClassName, 1000);
  }
  if (
    v.state === 'VALUE' &&
    (!model.viewId ||
      !v.popupClassName?.split(/\s+/u).includes('x-combo-list') ||
      !v.triggerClassName?.split(/\s+/u).includes('x-form-arrow-trigger'))
  )
    qReject();
  if (!model.viewId && v.state !== 'NOT_APPLICABLE') qReject();
}

export function validateReviewedAdItemFlatQueryEvidence(
  proof,
  { scopeId, owner, table } = {},
) {
  const model = reviewedAdItemFlatQueryModel({ scopeId, owner, table });
  if (!model) qReject();
  validateReviewedAdItemOwner({ scopeId, owner });
  const a = REVIEWED_AD_ITEM_FLAT_QUERY_MODEL;
  if (
    !qExact(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerBusinessVersion',
      'ownerNumber',
      'ownStateRaw',
      'ownerSourceModifiedRaw',
      'nativeTypeId',
      'tabId',
      'panelLocator',
      'gridId',
      'queryReviewState',
      'before',
      'after',
      'settledReads',
      'windowPairs',
    ]) ||
    proof.schemaVersion !== a.schemaVersion ||
    proof.modelRevision !== a.modelRevision ||
    proof.scopeId !== scopeId ||
    proof.ownerSourceRecordId !== owner.sourceRecordId ||
    !qSame(proof.ownerSourceVersion, owner.sourceVersion) ||
    !qSame(proof.ownerBusinessVersion, owner.businessVersion) ||
    proof.ownerNumber !== owner.number ||
    proof.ownStateRaw !== owner.stateRaw ||
    proof.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
    proof.nativeTypeId !== null ||
    proof.tabId !== model.tabId ||
    proof.panelLocator !== model.panelLocator ||
    proof.gridId !== model.gridId ||
    proof.settledReads !== 2 ||
    table.relationshipRole !== 'CURRENT_CONTENT' ||
    table.direction !== 'UNKNOWN' ||
    table.ownerSourceRecordId !== owner.sourceRecordId ||
    !qSame(table.ownerSourceVersion, owner.sourceVersion) ||
    !qSame(
      table.rawHeaders,
      m.nativeGridSurfaces
        .find((g) => g.gridId === model.gridId)
        .columns.map((c) => c.actualLabel),
    ) ||
    table.scanMode === 'TREE' ||
    table.treeExpansions?.length ||
    !Array.isArray(proof.windowPairs) ||
    !proof.windowPairs.length ||
    proof.windowPairs.length !== table.windows?.length
  )
    qReject();
  let known = true,
    firstQuery = null;
  for (const [i, pair] of proof.windowPairs.entries()) {
    if (
      !qExact(pair, ['windowOrdinal', 'before', 'after', 'settledReads']) ||
      pair.windowOrdinal !== i ||
      pair.settledReads !== 2 ||
      !qSame(pair.before, pair.after)
    )
      qReject();
    validateItemFlatFrame(pair.before, model, table, table.windows[i], owner);
    validateItemFlatFrame(pair.after, model, table, table.windows[i], owner);
    const query = {
      controls: pair.after.controls,
      view: pair.after.nativeQuery.view,
      selectedOnly: pair.after.nativeQuery.selectedOnly,
      additionalControls: pair.after.nativeQuery.additionalControls,
    };
    if (firstQuery && !qSame(firstQuery, query)) qReject();
    firstQuery = query;
    known = reviewedAdItemFlatQueryReady(pair.after, model) && known;
  }
  if (
    !qSame(proof.before, proof.windowPairs[0].before) ||
    !qSame(proof.after, proof.windowPairs.at(-1).after) ||
    proof.queryReviewState !== (known ? 'VALUE' : 'NOT_READ')
  )
    qReject();
  if (
    !known &&
    (table.enumerationState === 'VALUE' ||
      table.terminal.nativeTerminal ||
      table.terminal.trueZero)
  )
    qReject();
  if (table.terminal.nativeTerminal) {
    const ws = table.windows,
      last = ws.at(-1),
      scroll = last.scroll;
    if (last.treePending !== 0 || table.reportedTotal !== table.rows.length)
      qReject();
    if (
      table.scanMode === 'NATIVE_PAGER' &&
      (ws.some(
        (w, i) =>
          Number(w.pageRaw) !== i + 1 ||
          (i < ws.length - 1 && w.nextControl.enabled !== true),
      ) ||
        last.nextControl.enabled !== false ||
        last.nextControl.terminalDeclared !== true)
    )
      qReject();
    if (
      table.scanMode === 'VIRTUAL_SCROLL' &&
      (ws[0].scroll?.atTop !== true || scroll?.atBottom !== true)
    )
      qReject();
    if (
      table.scanMode === 'DOM_ROWS' &&
      (last.nextControl.present ||
        (scroll && scroll.height > scroll.viewport + 1))
    )
      qReject();
  }
  return {
    complete: known,
    queryKnown: known,
    contractScopeCoverage: known ? 'PROVEN' : 'UNPROVEN',
    backendCriteria: 'NOT_REQUIRED_PAGE_AUTHORITY',
    reasonCode: known ? null : a.stopReason,
  };
}

// Only these two native EFR columns have a reviewed empty renderer. Preserve
// the literal source character separately from the canonical empty-cell value.
const itemEfrBlankSchema = 'wiselink.tdms-ad-item-efr-strict-blank.v1';

const itemEfrBlankTokens = ['docDescription', 'comments'];

function validateItemEfrStrictBlankFrame(e, frame, table, window, owner) {
  const bad = () => reject('TDMS_AD_ITEM_EFR_STRICT_BLANK_UNPROVEN');
  if (
    !qExact(e, [
      'schemaVersion',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownStateRaw',
      'ownerSourceModifiedRaw',
      'cells',
    ]) ||
    e.schemaVersion !== itemEfrBlankSchema ||
    table.gridId !== 'document.EFRDoc.list' ||
    e.ownerSourceRecordId !== owner.sourceRecordId ||
    !qSame(e.ownerSourceVersion, owner.sourceVersion) ||
    e.ownStateRaw !== owner.stateRaw ||
    e.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
    typeof e.ownerSourceModifiedRaw !== 'string' ||
    !e.ownerSourceModifiedRaw.trim() ||
    !Array.isArray(e.cells) ||
    !e.cells.length ||
    e.cells.length > 2000 ||
    !frame.nativeQuery.efrBody
  )
    bad();
  validateItemEfrScopedBodyEvidence(frame.nativeQuery.efrBody, table, window);
  const ids = new Set();
  for (const c of e.cells) {
    if (
      !qExact(c, [
        'occurrenceId',
        'globalIndex',
        'nativeColumnToken',
        'cellLocator',
        'tdClass',
        'childTag',
        'childClass',
        'childAttributeNames',
        'cellInnerHTML',
        'childInnerHTML',
        'rawText',
        'observedTotalCodepoints',
        'truncated',
      ]) ||
      !itemEfrBlankTokens.includes(c.nativeColumnToken)
    )
      bad();
    const key = c.occurrenceId + '::' + c.nativeColumnToken,
      bodyRow = frame.nativeQuery.efrBody.rows.find(
        (r) => r.occurrenceId === c.occurrenceId,
      ),
      row = table.rows.find((r) => r.occurrenceId === c.occurrenceId),
      index = c.nativeColumnToken === 'docDescription' ? 10 : 11;
    if (
      ids.has(key) ||
      !bodyRow ||
      !row ||
      !window.rowOccurrenceIds.includes(c.occurrenceId) ||
      c.globalIndex !== row.globalIndex ||
      c.globalIndex !== bodyRow.globalIndex
    )
      bad();
    ids.add(key);
    const cls = 'x-grid3-cell-inner x-grid3-col-' + c.nativeColumnToken,
      td = [
        'x-grid3-col',
        'x-grid3-cell',
        'x-grid3-td-' + c.nativeColumnToken,
        ...(index === 11 ? ['x-grid3-cell-last'] : []),
      ];
    if (
      c.cellLocator !==
        bodyRow.locator +
          ' > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(' +
          (index + 1) +
          ')' ||
      typeof c.tdClass !== 'string' ||
      !qSame(c.tdClass.trim().split(/\s+/u), td) ||
      c.childTag !== 'DIV' ||
      c.childClass !== cls ||
      !qSame(c.childAttributeNames, ['class']) ||
      c.cellInnerHTML !== '<div class="' + cls + '">&nbsp;</div>' ||
      c.childInnerHTML !== '&nbsp;' ||
      c.rawText !== '\u00a0' ||
      c.observedTotalCodepoints !== 1 ||
      c.truncated !== false ||
      row.cells[index]?.state !== 'BLANK' ||
      row.cells[index].rawValue !== '' ||
      row.cells[index].observedTotalCodepoints !== 0 ||
      row.sourceLinks.some((l) => l.nativeColumnToken === c.nativeColumnToken)
    )
      bad();
  }
  for (const id of window.rowOccurrenceIds) {
    const row = table.rows.find((r) => r.occurrenceId === id);
    for (const [index, token] of [
      [10, 'docDescription'],
      [11, 'comments'],
    ])
      if (row?.cells[index]?.state === 'BLANK' && !ids.has(id + '::' + token))
        bad();
  }
  return true;
}

function itemEfrStrictBlankCell(table, row, token, owner) {
  if (
    table.gridId !== 'document.EFRDoc.list' ||
    !itemEfrBlankTokens.includes(token) ||
    table.relatedSurfaceEvidence?.schemaVersion !==
      REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.schemaVersion
  )
    return false;
  validateReviewedAdItemFlatQueryEvidence(table.relatedSurfaceEvidence, {
    scopeId: 'AD_ITEM',
    owner,
    table,
  });
  const pairs = table.relatedSurfaceEvidence.windowPairs.filter((_, i) =>
    table.windows[i].rowOccurrenceIds.includes(row.occurrenceId),
  );
  return (
    pairs.length > 0 &&
    pairs.every((p) =>
      [p.before, p.after].every((f) =>
        f.nativeQuery.strictBlankEvidence?.cells.some(
          (c) =>
            c.occurrenceId === row.occurrenceId &&
            c.nativeColumnToken === token,
        ),
      ),
    )
  );
}

// Native EFR rows identify a current Item's main/return engineering references.
// This permits independent target reads; it never qualifies Description/Comments,
// derives technical revisions from document numbers, or certifies a whole table.
export const REVIEWED_AD_ITEM_EFR_OCCURRENCE_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-item-efr-metadata-occurrence@1',
  scopeId: 'AD_ITEM',
  gridId: 'document.EFRDoc.list',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_object_EFRDocumentTable',
  panelLocator: '#infoPage_myTab_object_EFRDocumentTable',
  evidenceSha256:
    '279db64167009f2f3cf90c4307184c7a93cee16f42742a82d30ee9bdb9801997',
  repeatedEvidenceSha256:
    'bfd6aa148e35120b5830c6eb95ede2672b1642f80ab72e63fe34f9a77b5e8649',
  deferredReferenceReason:
    'REVIEWED_AD_ITEM_EFR_CURRENT_DEFERRED_NATIVE_CATEGORY',
});

const itemEfrUnknown = () => ({
  rawRevision: null,
  rawIteration: null,
  confirmation: 'VERSION_UNCONFIRMED',
});

function itemEfrInfoTarget(raw) {
  let u;
  try {
    u = new URL(raw, 'http://tdms.airchina.com/Windchill/');
  } catch {
    return null;
  }
  if (
    u.origin !== 'http://tdms.airchina.com' ||
    u.username ||
    u.password ||
    u.pathname !== '/Windchill/app/' ||
    u.search !== '' ||
    !/^#ptc1\/tcomp\/infoPage\?/u.test(u.hash)
  )
    return null;
  const fragment = new URLSearchParams(u.hash.split('?')[1] || '');
  if (
    [...fragment.keys()].some((k) => !['oid', 'u8'].includes(k)) ||
    fragment.getAll('u8').length > 1 ||
    (fragment.has('u8') && fragment.get('u8') !== '1')
  )
    return null;
  const refs = fragment.getAll('oid');
  return refs.length === 1 &&
    /^VR:wt\.epm\.EPMDocument:\d{1,24}$/u.test(refs[0])
    ? refs[0]
    : null;
}

const itemEfrCssIdent = String.raw`(?:\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[\t\n\f\r ])?|[^\n\r\f])|[-\w]|[^\x00-\x7f])+`;

const itemEfrNamedRow = new RegExp(
  String.raw`^ #(${itemEfrCssIdent}) > (.+)$`,
  'u',
);

const itemEfrGridLocator = String.raw`#document\.EFRDoc\.list`;

const itemEfrCssUnescape = (raw) =>
  raw.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\f\r ])?|([^\n\r\f]))/gu,
    (_, hex, char) => {
      if (!hex) return char;
      const cp = Number.parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(cp);
    },
  );

// Consume the normal producer's locator grammar, not a token/label assertion.
// Anonymous ROWn is bound to every containing native window, named rows to their
// actual nativeRowId. Anchor-ID-only and other unknown paths remain unqualified.
function itemEfrEndpointRowPath(
  locator,
  occurrenceId,
  column,
  { table, row, bodyBinding } = {},
) {
  if (bodyBinding) {
    if (
      !itemEfrBodyRowBindingValid(bodyBinding, occurrenceId) ||
      typeof locator !== 'string' ||
      !locator.startsWith(bodyBinding.row.locator + ' > ')
    )
      return null;
    const tail = locator
      .slice(bodyBinding.row.locator.length + 3)
      .split(' > ')
      .map((p) =>
        p.match(/^(div|span|table|tbody|tr|td|a):nth-child\(([1-9]\d*)\)$/u),
      );
    if (
      tail.some((p) => !p) ||
      tail.length < 5 ||
      tail[0][1] !== 'table' ||
      tail[1][1] !== 'tbody' ||
      tail[2][1] !== 'tr' ||
      tail.slice(0, 3).some((p) => p[2] !== '1') ||
      tail[3][1] !== 'td' ||
      Number(tail[3][2]) !== column + 1 ||
      tail.at(-1)[1] !== 'a' ||
      tail.at(-1)[2] !== '1' ||
      tail
        .slice(4, -1)
        .some((p) => !['div', 'span'].includes(p[1]) || p[2] !== '1')
    )
      return null;
    return bodyBinding.row.locator;
  }
  if (typeof locator !== 'string' || !locator.startsWith(itemEfrGridLocator))
    return null;
  const suffix = locator.slice(itemEfrGridLocator.length),
    named = suffix.match(itemEfrNamedRow),
    anonymous = suffix.match(/^ > (.+)$/u);
  let rawPath,
    prefix,
    nativeOrdinal = null;
  if (named) {
    const id = itemEfrCssUnescape(named[1]);
    if (
      occurrenceId !== 'document.EFRDoc.list:' + id ||
      (row && row.nativeRowId !== id)
    )
      return null;
    rawPath = named[2];
    prefix = itemEfrGridLocator + ' #' + named[1];
  } else if (anonymous) {
    const ordinal = occurrenceId?.match(
      /^document\.EFRDoc\.list:ROW(0|[1-9]\d*)$/u,
    );
    if (!ordinal || (row && row.nativeRowId !== null)) return null;
    nativeOrdinal = Number(ordinal[1]);
    if (!Number.isSafeInteger(nativeOrdinal)) return null;
    rawPath = anonymous[1];
    prefix = itemEfrGridLocator;
  } else return null;
  const rawParts = rawPath.split(' > '),
    parts = rawParts.map((p) =>
      p.match(/^(div|span|table|tbody|tr|td|a):nth-child\(([1-9]\d*)\)$/u),
    );
  if (parts.some((p) => !p)) return null;
  const tableIndex = parts.findIndex((p) => p[1] === 'table');
  if (named) {
    if (tableIndex !== 0) return null;
  } else {
    if (
      tableIndex < 1 ||
      parts.slice(0, tableIndex).some((p) => p[1] !== 'div') ||
      Number(parts[tableIndex - 1][2]) !== nativeOrdinal + 1
    )
      return null;
    prefix += ' > ' + rawParts.slice(0, tableIndex).join(' > ');
  }
  const tail = parts.slice(tableIndex);
  if (
    tail.length < 5 ||
    tail[0][1] !== 'table' ||
    tail[1][1] !== 'tbody' ||
    tail[2][1] !== 'tr' ||
    tail.slice(0, 3).some((p) => p[2] !== '1') ||
    tail[3][1] !== 'td' ||
    Number(tail[3][2]) !== column + 1 ||
    tail.at(-1)[1] !== 'a' ||
    tail.at(-1)[2] !== '1' ||
    tail
      .slice(4, -1)
      .some((p) => !['div', 'span'].includes(p[1]) || p[2] !== '1')
  )
    return null;
  if (table) {
    if (
      !row ||
      !Number.isSafeInteger(row.globalIndex) ||
      row.globalIndex < 0 ||
      !Array.isArray(table.windows)
    )
      return null;
    const windows = table.windows.filter((w) =>
      w.rowOccurrenceIds?.includes(occurrenceId),
    );
    if (!windows.length) return null;
    for (const w of windows) {
      const ordinal = w.rowOccurrenceIds.indexOf(occurrenceId);
      if (
        w.ordinal !== table.windows.indexOf(w) ||
        w.stableReads !== 2 ||
        new Set(w.rowOccurrenceIds).size !== w.rowOccurrenceIds.length ||
        w.globalIndices?.length !== w.rowOccurrenceIds.length ||
        w.globalIndices[ordinal] !== row.globalIndex ||
        (nativeOrdinal !== null &&
          (ordinal !== nativeOrdinal || row.globalIndex !== nativeOrdinal))
      )
        return null;
    }
  }
  return prefix;
}

function itemEfrScopedBodyBinding(table, row) {
  const windows = table.windows.filter((w) =>
    w.rowOccurrenceIds.includes(row.occurrenceId),
  );
  let binding = null;
  const evidence = windows.map(
    (w) =>
      table.relatedSurfaceEvidence.windowPairs[w.ordinal]?.after?.nativeQuery
        ?.efrBody,
  );
  if (evidence.some(Boolean) && evidence.some((e) => !e)) return null;
  for (const w of windows) {
    const frame = table.relatedSurfaceEvidence.windowPairs[w.ordinal]?.after,
      e = frame?.nativeQuery?.efrBody;
    if (!e) {
      if (binding) return null;
      continue;
    }
    validateItemEfrScopedBodyEvidence(e, table, w);
    const native = e.rows.find((r) => r.occurrenceId === row.occurrenceId);
    if (!native) return null;
    const value = {
      schemaVersion: ITEM_EFR_SCOPED_BODY_SCHEMA,
      body: e.body,
      row: native,
      windowOrdinals: windows.map((w) => w.ordinal),
    };
    if (binding && !qSame(binding, value)) return null;
    binding = value;
  }
  return binding;
}

export function reviewedAdItemEfrMetadataOccurrence({
  scopeId,
  owner,
  read,
  table,
  row,
  link,
} = {}) {
  const a = REVIEWED_AD_ITEM_EFR_OCCURRENCE_MODEL;
  if (
    scopeId !== a.scopeId ||
    table?.gridId !== a.gridId ||
    table.tableId !== a.gridId ||
    table.tabId !== a.tabId ||
    table.panelLocator !== a.panelLocator ||
    !table.rows?.includes(row) ||
    !row?.sourceLinks?.includes(link) ||
    !['numberDisPlay', 'returnNumberDisPlay'].includes(link.nativeColumnToken)
  )
    return null;
  validateReviewedAdItemOwner({ scopeId, owner });
  const bad = () => reject('TDMS_AD_ITEM_EFR_METADATA_OCCURRENCE_UNPROVEN');
  if (
    !read ||
    !qSame(read.owner, owner) ||
    table.ownerSourceRecordId !== owner.sourceRecordId ||
    !qSame(table.ownerSourceVersion, owner.sourceVersion) ||
    !qSame(row.observedVersion, itemEfrUnknown())
  )
    bad();
  if (
    table.relatedSurfaceEvidence?.schemaVersion !==
    REVIEWED_AD_ITEM_FLAT_QUERY_MODEL.schemaVersion
  )
    return null;
  if (
    !validateReviewedAdItemFlatQueryEvidence(table.relatedSurfaceEvidence, {
      scopeId,
      owner,
      table,
    }).queryKnown
  )
    return null;
  const columns = m.nativeGridSurfaces.find(
    (g) => g.gridId === a.gridId,
  ).columns;
  if (
    row.cells.length !== columns.length ||
    !qSame(
      table.rawHeaders,
      columns.map((c) => c.actualLabel),
    )
  )
    bad();
  const cell = (token) =>
    row.cells[columns.findIndex((c) => c.nativeColumnToken === token)];
  const complete = (v) =>
    (v?.state === 'VALUE' &&
      typeof v.rawValue === 'string' &&
      !!v.rawValue.trim() &&
      [...v.rawValue].length === v.observedTotalCodepoints) ||
    (v?.state === 'BLANK' &&
      v.rawValue === '' &&
      v.observedTotalCodepoints === 0);
  for (const [i, c] of columns.entries())
    if (c.valuePolicy === 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION') {
      if (
        row.cells[i].state === 'BLANK' &&
        itemEfrStrictBlankCell(table, row, c.nativeColumnToken, owner)
      )
        continue;
      if (
        row.cells[i].state !== 'NOT_READ' ||
        row.cells[i].rawValue !== null ||
        row.cells[i].observedTotalCodepoints !== 0 ||
        row.sourceLinks.some((l) => l.nativeColumnToken === c.nativeColumnToken)
      )
        bad();
    } else if (!complete(row.cells[i])) return null;
  const category = cell('docType').rawValue,
    operation = cell('operationType').rawValue;
  if (
    !['PEO-S', 'PEO-L', 'CEO-S'].includes(category) ||
    !['Revise', 'Link'].includes(operation)
  )
    return null;
  if (row.rawRole !== operation) bad();
  const bodyBinding = itemEfrScopedBodyBinding(table, row);
  const paths = new Map();
  const endpoint = (token) => {
    const c = columns.find((c) => c.nativeColumnToken === token),
      links = row.sourceLinks.filter((l) => l.nativeColumnToken === token);
    if (
      links.length !== 1 ||
      links[0].nativeColumnLabel !== c.actualLabel ||
      links[0].nativeRole !== 'NATIVE_LINK' ||
      cell(token).state !== 'VALUE' ||
      links[0].numberRaw !== cell(token).rawValue ||
      itemEfrInfoTarget(links[0].rawHref) !== links[0].targetRef
    )
      return null;
    const rowPath = itemEfrEndpointRowPath(
      links[0].locator,
      row.occurrenceId,
      columns.indexOf(c),
      { table, row, bodyBinding },
    );
    if (!rowPath) return null;
    paths.set(token, rowPath);
    return links[0].targetRef;
  };
  const main = endpoint('numberDisPlay'),
    returned = endpoint('returnNumberDisPlay');
  if (!main || cell('stateDisplay').state !== 'VALUE') return null;
  if (operation === 'Revise') {
    if (
      !returned ||
      returned === main ||
      cell('returnStateDisplay').state !== 'VALUE' ||
      paths.get('numberDisPlay') !== paths.get('returnNumberDisPlay')
    )
      return null;
  } else if (
    returned !== null ||
    row.sourceLinks.some(
      (l) => l.nativeColumnToken === 'returnNumberDisPlay',
    ) ||
    cell('returnNumberDisPlay').state !== 'BLANK' ||
    cell('returnStateDisplay').state !== 'BLANK'
  )
    return null;
  const role = link.nativeColumnToken === 'numberDisPlay' ? 'MAIN' : 'RETURN';
  if (link.targetRef !== (role === 'MAIN' ? main : returned)) return null;
  return {
    nativeCategory: category,
    rawOperation: operation,
    endpointRole: role,
    mainTargetRef: main,
    returnTargetRef: returned,
    ...(bodyBinding ? { nativeBodyRowBinding: bodyBinding } : {}),
  };
}

export function reviewedAdItemEfrRequiredTargetPurpose(args = {}) {
  const metadata = reviewedAdItemEfrMetadataOccurrence(args),
    a = REVIEWED_AD_ITEM_EFR_OCCURRENCE_MODEL;
  return metadata?.nativeCategory === 'CEO-S'
    ? {
        kind: 'REQUIRED_TARGET_OWN_SOURCE',
        modelRevision: a.modelRevision,
        scopeId: a.scopeId,
        gridId: a.gridId,
        ...metadata,
      }
    : null;
}
