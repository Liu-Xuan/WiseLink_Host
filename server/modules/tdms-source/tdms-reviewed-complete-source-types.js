// Pure EFRequest surface contract from the SHA-qualified 2026-10-14 code delta.
// Native fields describe observations; they do not supply source authority.
import { tdmsError } from './tdms-source.types';
import {
  isReviewedAdItemOwner,
  REVIEWED_AD_ITEM_NATIVE_MODEL,
} from './tdms-reviewed-ad-item-native-model';

export const EFREQUEST_READONLY_MODEL_REVISION =
  'tdms-reviewed-efrequest-readonly-surfaces@1';
export const REVIEWED_EFREQUEST_NATIVE_MODEL = Object.freeze({
  modelRevision: EFREQUEST_READONLY_MODEL_REVISION,
  scopeId: 'ENGINEERING_ASSESSMENT',
  nativeClass: 'wt.doc.WTDocument',
  nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest',
  nativeHeaderType: '工程文件编写评估单',
  detailTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
  detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
  rootLocator: '#infoPagemainInfoPagePanel',
  technicalVersion: Object.freeze({
    source: 'OWN_HEADER_THIRD_SLOT',
    locator: '#infoPageIdentityObjectIdentifier',
  }),
  modifiedMirrors: Object.freeze(['General', 'MoreAttributesGroup']),
  nonContentControl: Object.freeze({
    actionId: 'infoPageinfoPanelID__new_tab_action',
    tag: 'LI',
    classToken: 'x-tab-with-icon',
    rawCaption: '',
    semantic: 'NATIVE_TAB_CREATE_ACTION',
  }),
  scopeExcludedTabReason:
    'TDMS_COMPLETE_OWN_TAB_NOT_REQUIRED_BY_CONFIRMED_SCOPE',
  scopeExcludedTabs: Object.freeze([
    Object.freeze({
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docObjectsHistoryTab',
      label: 'History',
      panelLocator: '#infoPage_myTab_object_docObjectsHistoryTab',
    }),
    Object.freeze({
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_45658671',
      label: '工作流进程',
      panelLocator: '#infoPage_myTab_tab_jcaGen_45658671',
    }),
    Object.freeze({
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_866988688',
      label: '成员',
      panelLocator: '#infoPage_myTab_tab_jcaGen_866988688',
    }),
    Object.freeze({
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_866988689',
      label: '笔记本',
      panelLocator: '#infoPage_myTab_tab_jcaGen_866988689',
    }),
  ]),
  nativeGridSurfaces: Object.freeze([
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docContentInfoDetails',
      panelLocator: '#infoPage_myTab_object_docContentInfoDetails',
      gridId: 'attachments.table.primary',
      nativeUiRole: 'PRIMARY_CONTENT',
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
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
      evidenceRef:
        'TDMS_EFREQUEST_REQUIRED_TABS_NATIVE_INPUT_ROOT_20261014/ef-safe.json',
      evidenceSha256:
        '5f90d1437eff2ae97832190696cb3679643561d14c3bb86781c64559f3bc4999',
      evidenceJsonPointer: '/parts/0/requestedPanels/0/grids/0',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docContentInfoDetails',
      panelLocator: '#infoPage_myTab_object_docContentInfoDetails',
      gridId: 'attachments.table.secondary',
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
      evidenceRef:
        'TDMS_EFREQUEST_REQUIRED_TABS_NATIVE_INPUT_ROOT_20261014/ef-safe.json',
      evidenceSha256:
        '5f90d1437eff2ae97832190696cb3679643561d14c3bb86781c64559f3bc4999',
      evidenceJsonPointer: '/parts/0/requestedPanels/0/grids/1',
    },
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_referenceDocumentTable',
      panelLocator: '#infoPage_myTab_object_referenceDocumentTable',
      gridId: 'document.refDoc.list',
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
      evidenceRef:
        'TDMS_EFREQUEST_REQUIRED_TABS_NATIVE_INPUT_ROOT_20261014/ef-safe.json',
      evidenceSha256:
        '5f90d1437eff2ae97832190696cb3679643561d14c3bb86781c64559f3bc4999',
      evidenceJsonPointer: '/parts/0/requestedPanels/1/grids/0',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_EFRDocumentTable',
      panelLocator: '#infoPage_myTab_object_EFRDocumentTable',
      gridId: 'document.EFRDoc.list',
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
      evidenceRef:
        'TDMS_EFREQUEST_REQUIRED_TABS_NATIVE_INPUT_ROOT_20261014/ef-safe.json',
      evidenceSha256:
        '5f90d1437eff2ae97832190696cb3679643561d14c3bb86781c64559f3bc4999',
      evidenceJsonPointer: '/parts/0/requestedPanels/2/grids/0',
    },
  ]),
});
const own = (v, k) => Object.hasOwn(v || {}, k);
const exactKeys = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => own(v, k));
const nativeRef = /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u;
const reject = () => {
  throw tdmsError('TDMS_REVIEWED_COMPLETE_TAB_ROSTER_INVALID');
};

export function isReviewedEfRequestHeader({
  scopeId,
  sourceRecordId,
  nativeTypeId,
  rawHeaderType,
} = {}) {
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  return (
    scopeId === m.scopeId &&
    nativeRef.test(sourceRecordId || '') &&
    nativeTypeId === m.nativeTypeId &&
    rawHeaderType === m.nativeHeaderType
  );
}
export function isReviewedEfRequestOwner({ scopeId, owner } = {}) {
  return (
    isReviewedEfRequestHeader({
      scopeId,
      sourceRecordId: owner?.sourceRecordId,
      nativeTypeId: owner?.nativeTypeId,
      rawHeaderType: owner?.rawHeaderType,
    }) &&
    owner?.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === owner.nativeTypeId
  );
}

// The current-content purpose excludes these exact native surfaces. Their
// unread bodies remain source data, never absence or zero historical relations.
export function isReviewedEfRequestScopeExcludedTab({
  scopeId,
  owner,
  tab,
} = {}) {
  return (
    isReviewedEfRequestOwner({ scopeId, owner }) &&
    REVIEWED_EFREQUEST_NATIVE_MODEL.scopeExcludedTabs.some(
      (t) =>
        t.tabId === tab?.tabId &&
        t.label === tab?.label &&
        t.panelLocator === tab?.panelLocator,
    )
  );
}
export function validateReviewedCompleteTabPurposes({
  scopeId,
  owner,
  read,
} = {}) {
  const rejectPurpose = () => {
    throw tdmsError('TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID');
  };
  if (!Array.isArray(read?.tabs)) rejectPurpose();
  let excluded = 0;
  for (const tab of read.tabs) {
    if (!isReviewedEfRequestScopeExcludedTab({ scopeId, owner, tab })) {
      if (
        tab.required !== true ||
        tab.reasonCode ===
          REVIEWED_EFREQUEST_NATIVE_MODEL.scopeExcludedTabReason
      )
        rejectPurpose();
      continue;
    }
    if (
      tab.required !== false ||
      tab.state !== 'NOT_READ' ||
      tab.reasonCode !== REVIEWED_EFREQUEST_NATIVE_MODEL.scopeExcludedTabReason
    )
      rejectPurpose();
    excluded++;
    for (const items of [
      read.fields,
      read.sections,
      read.relationTables,
      read.rosterEvidence?.structuralRosters,
    ])
      if (Array.isArray(items) && items.some((v) => v.tabId === tab.tabId))
        rejectPurpose();
    if (
      Array.isArray(read.attachments) &&
      read.attachments.some(
        (a) =>
          typeof a.locator === 'string' &&
          (a.locator === tab.panelLocator ||
            a.locator.startsWith(tab.panelLocator + ' ')),
      )
    )
      rejectPurpose();
  }
  if (
    excluded &&
    validateReviewedCompleteTabRoster({
      scopeId,
      owner,
      rosterEvidence: read.rosterEvidence,
      contentTabIds: read.tabs.map((t) => t.tabId),
    }) !== true
  )
    rejectPurpose();
  return excluded > 0;
}
// Saved zero rows prove the native grid/column model, not row-link ownership,
// direction, target opinion qualification or complete source enumeration.
export function validateReviewedEfRequestGridRosters({
  scopeId,
  owner,
  read,
} = {}) {
  if (!isReviewedEfRequestOwner({ scopeId, owner })) return null;
  const rejectGrid = () => {
    throw tdmsError('TDMS_REVIEWED_EFREQUEST_GRID_ROSTER_INVALID');
  };
  if (!Array.isArray(read?.relationTables)) rejectGrid();
  let complete = true;
  for (const model of REVIEWED_EFREQUEST_NATIVE_MODEL.nativeGridSurfaces) {
    const found = read.relationTables.filter((t) => t.gridId === model.gridId);
    if (found.length > 1) rejectGrid();
    if (!found.length) {
      complete = false;
      continue;
    }
    const table = found[0];
    if (
      table.tabId !== model.tabId ||
      table.panelLocator !== model.panelLocator ||
      table.relationshipRole !== model.relationshipRole ||
      table.direction !== model.direction ||
      !Array.isArray(table.rawHeaders) ||
      JSON.stringify(table.rawHeaders) !==
        JSON.stringify(model.columns.map((c) => c.actualLabel))
    )
      rejectGrid();
    if (!Array.isArray(table.rows)) rejectGrid();
    for (const row of table.rows) {
      if (
        !Array.isArray(row.cells) ||
        row.cells.length !== model.columns.length ||
        !Array.isArray(row.sourceLinks)
      )
        rejectGrid();
      for (const [index, column] of model.columns.entries())
        if (
          column.valuePolicy === 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION'
        ) {
          const value = row.cells[index];
          if (
            value?.state !== 'NOT_READ' ||
            value.rawValue !== null ||
            value.observedTotalCodepoints !== 0 ||
            row.sourceLinks.some(
              (l) =>
                l.nativeColumnLabel === column.actualLabel ||
                l.nativeColumnToken === column.nativeColumnToken,
            )
          )
            rejectGrid();
        }
      for (const link of row.sourceLinks) {
        const column = model.columns.find(
          (c) => c.actualLabel === link.nativeColumnLabel,
        );
        if (!column || link.nativeColumnToken !== column.nativeColumnToken)
          rejectGrid();
      }
    }
  }
  return complete;
}
export function validateReviewedCompleteTabRoster({
  scopeId,
  owner,
  rosterEvidence,
  contentTabIds,
} = {}) {
  const hasStrip = own(rosterEvidence, 'nativeTabStripIds');
  const hasControls = own(rosterEvidence, 'nonContentControls');
  if (!hasStrip && !hasControls) return false;
  if (
    !hasStrip ||
    !hasControls ||
    !(
      isReviewedEfRequestOwner({ scopeId, owner }) ||
      isReviewedAdItemOwner({ scopeId, owner })
    )
  )
    reject();
  const strip = rosterEvidence.nativeTabStripIds;
  const controls = rosterEvidence.nonContentControls;
  const ids = (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 100 &&
    v.every(
      (id) =>
        typeof id === 'string' &&
        id.length <= 200 &&
        /^infoPageinfoPanelID__/u.test(id),
    ) &&
    new Set(v).size === v.length;
  if (
    !ids(strip) ||
    !ids(contentTabIds) ||
    !Array.isArray(controls) ||
    controls.length !== 1 ||
    JSON.stringify(rosterEvidence.tabIds) !== JSON.stringify(contentTabIds)
  )
    reject();
  const c = controls[0];
  const m =
    scopeId === 'AD_ITEM'
      ? REVIEWED_AD_ITEM_NATIVE_MODEL
      : REVIEWED_EFREQUEST_NATIVE_MODEL;
  const a = m.nonContentControl;
  if (
    !exactKeys(c, [
      'actionId',
      'tag',
      'rawClassName',
      'rawCaption',
      'locator',
      'rootLocator',
      'semantic',
      'modelRevision',
    ]) ||
    c.actionId !== a.actionId ||
    c.tag !== a.tag ||
    typeof c.rawClassName !== 'string' ||
    JSON.stringify(c.rawClassName.split(/\s+/u).filter(Boolean)) !==
      JSON.stringify([a.classToken]) ||
    c.rawCaption !== a.rawCaption ||
    c.locator !== '#' + a.actionId ||
    c.rootLocator !== m.rootLocator ||
    c.semantic !== a.semantic ||
    c.modelRevision !== m.modelRevision
  )
    reject();
  if (
    strip.at(-1) !== a.actionId ||
    contentTabIds.includes(a.actionId) ||
    JSON.stringify(strip.filter((id) => id !== a.actionId)) !==
      JSON.stringify(contentTabIds)
  )
    reject();
  return true;
}

export function isReviewedEfRequestUnknownFieldCaption({
  scopeId,
  owner,
  field,
} = {}) {
  const v = field?.value;
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  return (
    isReviewedEfRequestOwner({ scopeId, owner }) &&
    field?.labelOrigin === 'NATIVE_SOURCE_DECLARED' &&
    field.tabId === m.detailTabId &&
    field.sectionId === m.detailTabId + '::MoreAttributesGroup' &&
    field.nativeControl?.tag === 'TD' &&
    v?.actualLabel === '' &&
    v.state === 'NOT_READ' &&
    v.rawValue === null &&
    v.observedTotalCodepoints === 0 &&
    v.locator === field.fieldId &&
    typeof v.locator === 'string' &&
    v.locator.startsWith(m.detailPanel + ' ') &&
    Array.isArray(field.links) &&
    field.links.length === 0
  );
}

export function validateReviewedEfRequestModifiedMirrors({
  scopeId,
  owner,
  fields,
} = {}) {
  if (!isReviewedEfRequestOwner({ scopeId, owner })) return false;
  const m = REVIEWED_EFREQUEST_NATIVE_MODEL;
  const rows = Array.isArray(fields)
    ? fields.filter((f) => f?.value?.actualLabel === 'Last Modified:')
    : [];
  if (
    rows.length !== 2 ||
    m.modifiedMirrors.some((section, index) => {
      const f = rows[index];
      return (
        f.tabId !== m.detailTabId ||
        f.sectionId !== m.detailTabId + '::' + section ||
        f.labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
        f.nativeControl?.tag !== 'TD' ||
        f.fieldId !== f.value.locator
      );
    })
  )
    throw tdmsError('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_INVALID');
  const readable = rows.filter((f) => f.value.state === 'VALUE');
  const unread = rows.filter((f) =>
    ['NOT_READ', 'NOT_LOADED', 'ACCESS_DENIED'].includes(f.value.state),
  );
  if (!readable.length)
    throw tdmsError('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_UNREAD');
  if (
    readable.length + unread.length !== rows.length ||
    readable.some((f) => f.value.rawValue !== owner.sourceModifiedRaw)
  )
    throw tdmsError('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_CHANGED');
  return {
    state: unread.length ? 'NOT_READ' : 'VALUE',
    unreadLocators: unread.map((f) => f.value.locator),
  };
}

// The saved AD own Details DOM proves these two exact modified-field surfaces.
// This limited model does not review AD business-version or required-layout semantics.
export const REVIEWED_AD_MODIFIED_MIRROR_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-own-modified-mirrors@1',
  scopeId: 'AD',
  nativeClass: 'wt.doc.WTDocument',
  nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.ADDocument',
  nativeHeaderType: 'AD文档',
  detailTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
  detailPanel: '#infoPage_myTab_object_docInfoDefaultDetails',
  modifiedMirrors: [
    {
      sectionId: 'General',
      sectionLabel: 'General',
      dataStoreId: 'dataStoreGeneral',
    },
    {
      sectionId: 'MoreAttributesGroup',
      sectionLabel: 'System',
      dataStoreId: 'dataStoreMoreAttributesGroup',
    },
  ],
  evidenceRef: 'work/TDMS_AD_DETAIL_PRIMARY_READONLY_DOM_20261011.json',
  evidenceSha256:
    'cea8af044626d78307908e120acaf0c76edf191b0f5a1d24fbefbc2ce732c598',
});
Object.freeze(REVIEWED_AD_MODIFIED_MIRROR_MODEL.modifiedMirrors);
for (const spec of REVIEWED_AD_MODIFIED_MIRROR_MODEL.modifiedMirrors)
  Object.freeze(spec);
export function isReviewedAdModifiedMirrorOwner({ scopeId, owner } = {}) {
  const m = REVIEWED_AD_MODIFIED_MIRROR_MODEL;
  return (
    scopeId === m.scopeId &&
    nativeRef.test(owner?.sourceRecordId || '') &&
    owner.nativeTypeId === m.nativeTypeId &&
    owner.rawHeaderType === m.nativeHeaderType &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === m.nativeTypeId
  );
}
export function validateReviewedAdModifiedMirrors({
  scopeId,
  owner,
  fields,
  sections,
} = {}) {
  if (!isReviewedAdModifiedMirrorOwner({ scopeId, owner })) return false;
  const m = REVIEWED_AD_MODIFIED_MIRROR_MODEL,
    rows = Array.isArray(fields)
      ? fields.filter((f) => f?.value?.actualLabel === 'Last Modified:')
      : [];
  const error = (code) => {
    throw tdmsError(code);
  };
  if (
    rows.length !== 2 ||
    m.modifiedMirrors.some((spec, index) => {
      const f = rows[index],
        sectionId = m.detailTabId + '::' + spec.sectionId,
        matching = Array.isArray(sections)
          ? sections.filter((s) => s?.sectionId === sectionId)
          : [],
        section = matching[0];
      return (
        f.tabId !== m.detailTabId ||
        f.sectionId !== sectionId ||
        f.labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
        f.nativeControl?.tag !== 'TD' ||
        f.nativeControl.readOnly !== null ||
        f.nativeControl.disabled !== null ||
        f.fieldId !== f.value.locator ||
        typeof f.value.locator !== 'string' ||
        !f.value.locator.startsWith(
          m.detailPanel + ' #' + spec.dataStoreId + ' > ',
        ) ||
        !Array.isArray(f.links) ||
        f.links.length !== 0 ||
        matching.length !== 1 ||
        section.tabId !== m.detailTabId ||
        section.panelLocator !== m.detailPanel + ' #' + spec.sectionId ||
        section.label !== spec.sectionLabel ||
        section.sourceDeclared !== true ||
        section.state !== 'VALUE'
      );
    })
  )
    error('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_INVALID');
  if (rows.some((f) => f.value.state !== 'VALUE'))
    error('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_UNREAD');
  if (
    typeof owner.sourceModifiedRaw !== 'string' ||
    !owner.sourceModifiedRaw.trim() ||
    rows.some(
      (f) =>
        f.value.rawValue !== owner.sourceModifiedRaw ||
        f.value.observedTotalCodepoints !== [...owner.sourceModifiedRaw].length,
    )
  )
    error('TDMS_COMPLETE_OWN_MODIFIED_MIRROR_CHANGED');
  return { state: 'VALUE', unreadLocators: [] };
}
