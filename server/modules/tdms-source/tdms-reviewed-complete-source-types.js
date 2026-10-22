// Pure EFRequest surface contract from the SHA-qualified 2026-10-14 code delta.
// Native fields describe observations; they do not supply source authority.
import { tdmsError } from './tdms-source.types';
import {
  isReviewedAdHandlingOwner,
  REVIEWED_AD_HANDLING_NATIVE_MODEL,
} from './tdms-reviewed-ad-handling-native-model';
import { validateReviewedAdHandlingSurfaceEvidence } from './tdms-reviewed-ad-handling-required-surfaces';
import {
  isReviewedAdItemOwner,
  REVIEWED_AD_ITEM_NATIVE_MODEL,
  validateReviewedAdItemDetailsQueryEvidence,
} from './tdms-reviewed-ad-item-native-model';
import {
  isReviewedEfStructureTab,
  isReviewedEfStructureTable,
  validateReviewedEfStructurePurposeEvidence,
  validateReviewedEfStructureUsesEvidence,
} from './tdms-reviewed-efrequest-structure-native-model';

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
export const REVIEWED_EFREQUEST_QUERY_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-efrequest-native-default-query@1',
  schemaVersion: 'wiselink.tdms-efrequest-native-query.v1',
  evidenceRef:
    'TDMS_EF_REQUIRED_FOUR_GRIDS_NATIVE_QUERY_INPUT_ROOT_20261014.raw.json',
  evidenceSha256:
    'f1812385ea01025f8b15669758c2e6451f8568a2c2d708a0cbb9604521e838dc',
  scopeId: 'ENGINEERING_ASSESSMENT',
  searchPlaceholder: 'Search in table',
  grids: Object.freeze(
    [
      'attachments.table.primary',
      'attachments.table.secondary',
      'document.refDoc.list',
      'document.EFRDoc.list',
    ]
      .map((gridId) =>
        REVIEWED_EFREQUEST_NATIVE_MODEL.nativeGridSurfaces.find(
          (grid) => grid.gridId === gridId,
        ),
      )
      .map((grid) =>
        Object.freeze({
          gridId: grid.gridId,
          tabId: grid.tabId,
          panelLocator: grid.panelLocator,
          searchId: grid.gridId + '.searchInListTextBox',
          selectedOnlyRequired: grid.gridId !== 'attachments.table.primary',
          selectedOnlyControlId: grid.gridId + '_WTablePanel_selectedOnlyMenu',
          selectedOnlyItemId: grid.gridId + '_WTablePanel.selectedOnlyViewItem',
          utilityIds: Object.freeze(
            grid.gridId.startsWith('attachments.table.')
              ? [
                  'header_' + grid.gridId + '_titleBarMask',
                  grid.gridId + '.searchInListLoadingWheel',
                  'footer_' + grid.gridId + '_titleBarMask',
                ]
              : [grid.gridId + '.searchInListLoadingWheel'],
          ),
        }),
      ),
  ),
});
// These four raw surfaces have no reviewed effective query or source end.
export const REVIEWED_EFREQUEST_RELATED_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-efrequest-related-raw-surfaces@1',
  schemaVersion: 'wiselink.tdms-efrequest-related-raw.v1',
  scopeId: 'ENGINEERING_ASSESSMENT',
  queryReviewState: 'NOT_READ',
  evidenceRef:
    'TDMS_EF_FOUR_REMAINING_TAB_PURPOSE_NATIVE_INPUT_ROOT_20261014.raw.json',
  evidenceSha256:
    '01326567d25422badb1fe24e60b7407b553ab40f8f62880f5da0a33587d668a2',
  decisionSha256:
    'c4628caf80006d3ad3877aeab833b1183267ddee54a7a291a5152cf6abeb2471',
  grids: [
    {
      gridId: 'whereUsed.view',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      tableTitle: 'Where Used',
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          rawCaption: ' ',
          nativeColumnToken: 'checker',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Number',
          rawCaption: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Version',
          rawCaption: 'Version',
          nativeColumnToken: 'groupedVersions',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Name',
          rawCaption: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Context',
          rawCaption: 'Context',
          nativeColumnToken: 'containerName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
      ],
      rawControlIds: [
        'whereUsed.viewfilterSelect',
        'whereUsed.view.fitTextField',
      ],
      utilityIds: [
        'header_whereUsed.view_titleBarMask',
        'footer_whereUsed.view_titleBarMask',
      ],
    },
    {
      gridId: 'document.relatedDocsReferencesDocuments.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      tableTitle: 'References Documents',
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          rawCaption: ' ',
          nativeColumnToken: 'checker',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Object Type Indicator',
          rawCaption: 'Object Type Indicator',
          nativeColumnToken: 'type_icon',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Number',
          rawCaption: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Version',
          rawCaption: 'Version',
          nativeColumnToken: 'version',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'editComment',
          rawCaption: 'editComment',
          nativeColumnToken: 'editComment',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'View Information',
          rawCaption: 'View Information',
          nativeColumnToken: 'infoPageAction',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Name',
          rawCaption: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Context',
          rawCaption: 'Context',
          nativeColumnToken: 'containerName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'State',
          rawCaption: 'State',
          nativeColumnToken: 'state',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'Last Modified',
          rawCaption: 'Last Modified',
          nativeColumnToken: 'last_updated',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Comments',
          rawCaption: 'Comments',
          nativeColumnToken: 'linkDescription',
          valuePolicy: 'NOT_READ_UNREVIEWED_ROW_TEXT_QUALIFICATION',
        },
      ],
      rawControlIds: [
        'document.relatedDocsReferencesDocuments.listfilterSelect',
        'document.relatedDocsReferencesDocuments.list.searchInListTextBox',
      ],
      utilityIds: [
        'document.relatedDocsReferencesDocuments.list.searchInListLoadingWheel',
      ],
    },
    {
      gridId: 'document.relatedDocsReferencedByDocuments.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      tableTitle: 'Referenced By Documents',
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: 'Object Type Indicator',
          rawCaption: 'Object Type Indicator',
          nativeColumnToken: 'type_icon',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Number',
          rawCaption: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Version',
          rawCaption: 'Version',
          nativeColumnToken: 'version',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'View Information',
          rawCaption: 'View Information',
          nativeColumnToken: 'infoPageAction',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Name',
          rawCaption: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Context',
          rawCaption: 'Context',
          nativeColumnToken: 'containerName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'State',
          rawCaption: 'State',
          nativeColumnToken: 'state',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'Last Modified',
          rawCaption: 'Last Modified',
          nativeColumnToken: 'last_updated',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
      ],
      rawControlIds: [
        'document.relatedDocsReferencedByDocuments.listfilterSelect',
        'document.relatedDocsReferencedByDocuments.list.searchInListTextBox',
      ],
      utilityIds: [
        'document.relatedDocsReferencedByDocuments.list.searchInListLoadingWheel',
      ],
    },
    {
      gridId: 'part.relatedDocumentsDescribesParts.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      tableTitle: 'Describes Parts',
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      columns: [
        {
          actualLabel: '',
          rawCaption: ' ',
          nativeColumnToken: 'checker',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Object Type Indicator',
          rawCaption: 'Object Type Indicator',
          nativeColumnToken: 'type_icon',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Number',
          rawCaption: 'Number',
          nativeColumnToken: 'number',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Version',
          rawCaption: 'Version',
          nativeColumnToken: 'version',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'View Information',
          rawCaption: 'View Information',
          nativeColumnToken: 'infoPageAction',
          valuePolicy: 'NOT_READ_NATIVE_CONTROL',
        },
        {
          actualLabel: 'Name',
          rawCaption: 'Name',
          nativeColumnToken: 'name',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'Context',
          rawCaption: 'Context',
          nativeColumnToken: 'containerName',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
        {
          actualLabel: 'State',
          rawCaption: 'State',
          nativeColumnToken: 'state',
          valuePolicy: 'NATIVE_STATE_METADATA_ONLY',
        },
        {
          actualLabel: 'Last Modified',
          rawCaption: 'Last Modified',
          nativeColumnToken: 'last_updated',
          valuePolicy: 'EXISTING_TYPED_VALUE',
        },
      ],
      rawControlIds: [
        'part.relatedDocumentsDescribesParts.listfilterSelect',
        'part.relatedDocumentsDescribesParts.list.searchInListTextBox',
      ],
      utilityIds: [
        'part.relatedDocumentsDescribesParts.list.searchInListLoadingWheel',
      ],
    },
  ],
});

// Source-native named views; this is never a backend NONE/ALL declaration.
export const REVIEWED_EFREQUEST_RELATED_QUERY_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-efrequest-related-native-current-query@1',
  schemaVersion: 'wiselink.tdms-efrequest-related-native-query.v1',
  scopeId: 'ENGINEERING_ASSESSMENT',
  evidenceRef:
    'TDMS_EF_RELATED_VIEW_DEFINITION_NATIVE_INPUT_ROOT_20261014/read-only-input-result.json',
  evidenceSha256:
    'fa68dd74266cd79228fb3420baadb9fc7c704245c99f7151fb166ab277411d22',
  queryScope: 'NATIVE_CURRENT_SELECTED_VIEW',
  grids: [
    {
      gridId: 'whereUsed.view',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'whereUsed.viewfilterSelect',
      viewName: 'Latest',
      options: ['All Revisions', 'Latest'],
      searchId: 'whereUsed.view.fitTextField',
      searchPlaceholder: 'Find in tree',
      selectedCountRequired: true,
      selectedOnlyRequired: false,
      selectedOnlyControlId: null,
      selectedOnlyItemId: null,
    },
    {
      gridId: 'document.relatedDocsReferencesDocuments.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'document.relatedDocsReferencesDocuments.listfilterSelect',
      viewName: 'Default',
      options: [
        'Default',
        'TR资料手册视图',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      searchId:
        'document.relatedDocsReferencesDocuments.list.searchInListTextBox',
      searchPlaceholder: 'Search in table',
      selectedCountRequired: true,
      selectedOnlyRequired: true,
      selectedOnlyControlId:
        'document.relatedDocsReferencesDocuments.list_WTablePanel_selectedOnlyMenu',
      selectedOnlyItemId:
        'document.relatedDocsReferencesDocuments.list_WTablePanel.selectedOnlyViewItem',
    },
    {
      gridId: 'document.relatedDocsReferencedByDocuments.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'document.relatedDocsReferencedByDocuments.listfilterSelect',
      viewName: 'Default',
      options: [
        'Default',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      searchId:
        'document.relatedDocsReferencedByDocuments.list.searchInListTextBox',
      searchPlaceholder: 'Search in table',
      selectedCountRequired: false,
      selectedOnlyRequired: false,
      selectedOnlyControlId: null,
      selectedOnlyItemId: null,
    },
    {
      gridId: 'part.relatedDocumentsDescribesParts.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'part.relatedDocumentsDescribesParts.listfilterSelect',
      viewName: 'Default',
      options: [
        'Default',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      searchId: 'part.relatedDocumentsDescribesParts.list.searchInListTextBox',
      searchPlaceholder: 'Search in table',
      selectedCountRequired: true,
      selectedOnlyRequired: true,
      selectedOnlyControlId:
        'part.relatedDocumentsDescribesParts.list_WTablePanel_selectedOnlyMenu',
      selectedOnlyItemId:
        'part.relatedDocumentsDescribesParts.list_WTablePanel.selectedOnlyViewItem',
    },
  ],
});

export const REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-efrequest-related-native-current-query@2',
  schemaVersion: 'wiselink.tdms-efrequest-related-native-query.v2',
  scopeId: 'ENGINEERING_ASSESSMENT',
  evidenceRef:
    'TDMS_EF_RELATED_VIEW_DEFINITION_NATIVE_INPUT_ROOT_20261014/read-only-input-result.json',
  evidenceSha256:
    'fa68dd74266cd79228fb3420baadb9fc7c704245c99f7151fb166ab277411d22',
  queryScope: 'NATIVE_CURRENT_SELECTED_VIEW',
  grids: [
    {
      gridId: 'whereUsed.view',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'whereUsed.viewfilterSelect',
      viewName: 'Latest',
      options: ['All Revisions', 'Latest'],
      searchId: 'whereUsed.view.fitTextField',
      searchPlaceholder: 'Find in tree',
      selectedCountRequired: true,
      selectedOnlyRequired: false,
      selectedOnlyControlId: null,
      selectedOnlyItemId: null,
    },
    {
      gridId: 'document.relatedDocsReferencesDocuments.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'document.relatedDocsReferencesDocuments.listfilterSelect',
      viewName: 'Default',
      options: [
        'Default',
        'TR资料手册视图',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      searchId:
        'document.relatedDocsReferencesDocuments.list.searchInListTextBox',
      searchPlaceholder: 'Search in table',
      selectedCountRequired: true,
      selectedOnlyRequired: true,
      selectedOnlyControlId:
        'document.relatedDocsReferencesDocuments.list_WTablePanel_selectedOnlyMenu',
      selectedOnlyItemId:
        'document.relatedDocsReferencesDocuments.list_WTablePanel.selectedOnlyViewItem',
    },
    {
      gridId: 'document.relatedDocsReferencedByDocuments.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'document.relatedDocsReferencedByDocuments.listfilterSelect',
      viewName: 'Default',
      options: [
        'Default',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      searchId:
        'document.relatedDocsReferencedByDocuments.list.searchInListTextBox',
      searchPlaceholder: 'Search in table',
      selectedCountRequired: false,
      selectedOnlyRequired: false,
      selectedOnlyControlId: null,
      selectedOnlyItemId: null,
    },
    {
      gridId: 'part.relatedDocumentsDescribesParts.list',
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      viewId: 'part.relatedDocumentsDescribesParts.listfilterSelect',
      viewName: 'Default',
      options: [
        'Default',
        '---------------------',
        'Save As View ...',
        'Customize ...',
      ],
      searchId: 'part.relatedDocumentsDescribesParts.list.searchInListTextBox',
      searchPlaceholder: 'Search in table',
      selectedCountRequired: true,
      selectedOnlyRequired: true,
      selectedOnlyControlId:
        'part.relatedDocumentsDescribesParts.list_WTablePanel_selectedOnlyMenu',
      selectedOnlyItemId:
        'part.relatedDocumentsDescribesParts.list_WTablePanel.selectedOnlyViewItem',
    },
  ],
  rawModelRevision: 'tdms-reviewed-efrequest-related-raw-windows@2',
  rawSchemaVersion: 'wiselink.tdms-efrequest-related-raw-windows.v2',
  treeSupport: 'UNSUPPORTED',
});

// Component purpose never asserts equal alias body values or a second source read.
export const REVIEWED_EFREQUEST_TAB_PURPOSE_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-efrequest-tab-component-purpose@1',
  schemaVersion: 'wiselink.tdms-efrequest-tab-purpose.v1',
  scopeId: 'ENGINEERING_ASSESSMENT',
  evidenceRef:
    'TDMS_EF_FOUR_REMAINING_TAB_PURPOSE_NATIVE_INPUT_ROOT_20261014.raw.json',
  evidenceSha256:
    '01326567d25422badb1fe24e60b7407b553ab40f8f62880f5da0a33587d668a2',
  decisionSha256:
    'c4628caf80006d3ad3877aeab833b1183267ddee54a7a291a5152cf6abeb2471',
  aliases: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_225694243',
      panelLocator: '#infoPage_myTab_tab_jcaGen_225694243',
      label: '附件',
      purpose: 'CANONICAL_ATTACHMENT_COMPONENT_REUSE',
      reasonCode: 'TDMS_COMPLETE_EFREQUEST_CANONICAL_COMPONENT_REUSE',
      components: [
        {
          componentId: 'objectattachments',
          tocId:
            'infoPage_myTab_tab_jcaGen_225694243_objectattachments_tocItem',
          wrapperId:
            'wrap_infoPage_myTab_tab_jcaGen_225694243_objectattachments',
        },
      ],
      grids: [
        {
          gridId: 'attachments.table.secondary',
          componentId: 'objectattachments',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Label or File Name',
              nativeColumnToken: 'attachmentsName',
            },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageActionAttachment',
            },
            { actualLabel: 'Format Icon', nativeColumnToken: 'formatIcon' },
            { actualLabel: 'Format', nativeColumnToken: 'formatName' },
            {
              actualLabel: 'Attachment Description',
              nativeColumnToken: 'description',
            },
            {
              actualLabel: 'Last Modified',
              nativeColumnToken: 'thePersistInfo_modifyStamp',
            },
            { actualLabel: 'Modified By', nativeColumnToken: 'modifier' },
          ],
        },
      ],
      attributeSections: [],
      canonicalKind: 'TABLE',
      canonicalTabId:
        'infoPageinfoPanelID__infoPage_myTab_object_docContentInfoDetails',
      canonicalPanelLocator: '#infoPage_myTab_object_docContentInfoDetails',
      canonicalTableId: 'attachments.table.secondary',
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_1902225244',
      panelLocator: '#infoPage_myTab_tab_jcaGen_1902225244',
      label: '新建选项卡 1',
      purpose:
        'CANONICAL_ATTRIBUTES_COMPONENT_REUSE_PLUS_SCOPE_EXCLUDED_HISTORY',
      reasonCode: 'TDMS_COMPLETE_EFREQUEST_CANONICAL_COMPONENT_REUSE',
      components: [
        {
          componentId: 'objectattributes',
          tocId:
            'infoPage_myTab_tab_jcaGen_1902225244_objectattributes_tocItem',
          wrapperId:
            'wrap_infoPage_myTab_tab_jcaGen_1902225244_objectattributes',
        },
        {
          componentId: 'historylegacyLCHistory',
          tocId:
            'infoPage_myTab_tab_jcaGen_1902225244_historylegacyLCHistory_tocItem',
          wrapperId:
            'wrap_infoPage_myTab_tab_jcaGen_1902225244_historylegacyLCHistory',
        },
      ],
      grids: [
        {
          gridId: 'lifecycleHistoryTableId',
          componentId: 'historylegacyLCHistory',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Life Cycle Name',
              nativeColumnToken: 'lifeCycleName',
            },
            { actualLabel: 'Team', nativeColumnToken: 'teamTemplateIdentity' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            {
              actualLabel: 'Action',
              nativeColumnToken: 'lifecyclehistoryaction',
            },
            { actualLabel: 'User', nativeColumnToken: 'lifeCycleUserName' },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
            },
          ],
        },
        {
          gridId: 'votingHistoryTableId',
          componentId: 'historylegacyLCHistory',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            { actualLabel: 'Role', nativeColumnToken: 'roleName' },
            { actualLabel: 'Signer', nativeColumnToken: 'signerFullName' },
            { actualLabel: 'Vote', nativeColumnToken: 'lcVote' },
            { actualLabel: 'Comment', nativeColumnToken: 'comments' },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
            },
          ],
        },
      ],
      attributeSections: [
        {
          sectionId: 'BusinessAttributesGroup',
          dataStoreId: 'dataStoreBusinessAttributesGroup',
          labels: [
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
          dataStoreId: 'dataStoreMoreAttributesGroup',
          labels: [
            'Description:',
            ' ',
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
      canonicalKind: 'FIELDS',
      canonicalTabId:
        'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
      canonicalPanelLocator: '#infoPage_myTab_object_docInfoDefaultDetails',
      canonicalTableId: null,
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_5831746073',
      panelLocator: '#infoPage_myTab_tab_jcaGen_5831746073',
      label: '新建选项卡 2',
      purpose: 'CONFIRMED_HISTORY_COMPONENT_SCOPE_EXCLUSION',
      reasonCode: 'TDMS_COMPLETE_EFREQUEST_ALIAS_HISTORY_SCOPE_EXCLUDED',
      components: [
        {
          componentId: 'historylegacyLCHistory',
          tocId:
            'infoPage_myTab_tab_jcaGen_5831746073_historylegacyLCHistory_tocItem',
          wrapperId:
            'wrap_infoPage_myTab_tab_jcaGen_5831746073_historylegacyLCHistory',
        },
      ],
      grids: [
        {
          gridId: 'lifecycleHistoryTableId',
          componentId: 'historylegacyLCHistory',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Life Cycle Name',
              nativeColumnToken: 'lifeCycleName',
            },
            { actualLabel: 'Team', nativeColumnToken: 'teamTemplateIdentity' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            {
              actualLabel: 'Action',
              nativeColumnToken: 'lifecyclehistoryaction',
            },
            { actualLabel: 'User', nativeColumnToken: 'lifeCycleUserName' },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
            },
          ],
        },
        {
          gridId: 'votingHistoryTableId',
          componentId: 'historylegacyLCHistory',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            { actualLabel: 'Role', nativeColumnToken: 'roleName' },
            { actualLabel: 'Signer', nativeColumnToken: 'signerFullName' },
            { actualLabel: 'Vote', nativeColumnToken: 'lcVote' },
            { actualLabel: 'Comment', nativeColumnToken: 'comments' },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
            },
          ],
        },
      ],
      attributeSections: [],
      canonicalKind: null,
      canonicalTabId: null,
      canonicalPanelLocator: null,
      canonicalTableId: null,
    },
  ],
});
const queryCanonical = (value) =>
  JSON.stringify(
    (function order(v) {
      return Array.isArray(v)
        ? v.map(order)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, order(v[k])]),
            )
          : v;
    })(value),
  );
const queryTokens = (value) =>
  typeof value === 'string' ? value.split(/\s+/u).filter(Boolean) : [];
const queryList = (value) => Array.isArray(value) && value.length <= 1000;
const queryNumber = (value) => Number.isSafeInteger(value) && value >= 0;
const queryNode = (node) =>
  exactKeys(node, ['id', 'tag', 'rawClassName', 'visible']) &&
  (node.id === null ||
    (typeof node.id === 'string' && node.id.length <= 500)) &&
  typeof node.tag === 'string' &&
  typeof node.rawClassName === 'string' &&
  node.rawClassName.length <= 1000 &&
  typeof node.visible === 'boolean';
const queryFail = (code) => {
  throw tdmsError(code);
};
const efBoundProof = (
  proof,
  model,
  { scopeId, owner, tabId, panelLocator, gridId } = {},
) =>
  proof?.schemaVersion === model.schemaVersion &&
  proof.modelRevision === model.modelRevision &&
  proof.scopeId === scopeId &&
  proof.ownerSourceRecordId === owner.sourceRecordId &&
  proof.nativeTypeId === owner.nativeTypeId &&
  queryCanonical(proof.ownerSourceVersion) ===
    queryCanonical(owner.sourceVersion) &&
  proof.ownerSourceModifiedRaw === owner.sourceModifiedRaw &&
  proof.tabId === tabId &&
  proof.panelLocator === panelLocator &&
  (gridId === undefined || proof.gridId === gridId);
function efHeaders(headers, columns, reject) {
  if (!queryList(headers) || headers.length !== columns.length) reject();
  for (const [i, h] of headers.entries())
    if (
      !exactKeys(h, [
        'tag',
        'rawClassName',
        'rawCaptionText',
        'actualLabel',
        'nativeColumnToken',
        'visible',
      ]) ||
      h.tag !== 'TD' ||
      typeof h.rawCaptionText !== 'string' ||
      h.rawCaptionText.length > 200 ||
      h.rawCaptionText.trim() !== h.actualLabel ||
      h.actualLabel !== columns[i].actualLabel ||
      h.nativeColumnToken !== columns[i].nativeColumnToken ||
      typeof h.visible !== 'boolean' ||
      queryTokens(h.rawClassName)
        .filter((t) => t.startsWith('x-grid3-td-'))
        .join() !==
        'x-grid3-td-' + h.nativeColumnToken
    )
      reject();
}
export function reviewedEfRequestAliasModel({ scopeId, owner, tab } = {}) {
  return isReviewedEfRequestOwner({ scopeId, owner })
    ? REVIEWED_EFREQUEST_TAB_PURPOSE_MODEL.aliases.find(
        (a) => a.tabId === tab?.tabId,
      ) || null
    : null;
}
export function validateReviewedEfRequestTabPurposeEvidence(
  proof,
  { scopeId, owner, tab, read } = {},
) {
  const model = reviewedEfRequestAliasModel({ scopeId, owner, tab });
  if (!model) {
    if (proof !== undefined) queryFail('TDMS_EFREQUEST_ALIAS_PURPOSE_INVALID');
    return null;
  }
  if (proof === undefined)
    return {
      complete: false,
      reasonCode: 'TDMS_EFREQUEST_ALIAS_PURPOSE_MISSING',
    };
  const reject = () => queryFail('TDMS_EFREQUEST_ALIAS_PURPOSE_INVALID'),
    m = REVIEWED_EFREQUEST_TAB_PURPOSE_MODEL;
  if (
    !exactKeys(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerSourceModifiedRaw',
      'nativeTypeId',
      'tabId',
      'panelLocator',
      'purpose',
      'bodyEvidenceState',
      'before',
      'after',
      'settledReads',
      'canonicalBinding',
    ]) ||
    !efBoundProof(proof, m, {
      scopeId,
      owner,
      tabId: model.tabId,
      panelLocator: model.panelLocator,
    }) ||
    tab.label !== model.label ||
    tab.panelLocator !== model.panelLocator ||
    proof.purpose !== model.purpose ||
    proof.bodyEvidenceState !== 'NOT_READ' ||
    proof.settledReads !== 2 ||
    queryCanonical(proof.before) !== queryCanonical(proof.after)
  )
    reject();
  for (const frame of [proof.before, proof.after]) {
    if (
      !exactKeys(frame, [
        'activeTabId',
        'panelId',
        'panelVisible',
        'tocNodes',
        'wrapperNodes',
        'gridSchemas',
        'attributeSections',
        'fields',
        'embedded',
      ]) ||
      frame.activeTabId !== model.tabId ||
      frame.panelId !== model.panelLocator.slice(1) ||
      frame.panelVisible !== true ||
      !queryList(frame.tocNodes) ||
      !queryList(frame.wrapperNodes) ||
      !queryList(frame.gridSchemas) ||
      !queryList(frame.attributeSections) ||
      !queryList(frame.fields) ||
      !queryList(frame.embedded) ||
      frame.embedded.length
    )
      reject();
    for (const [key, idKey, classToken] of [
      ['tocNodes', 'tocId', 'myTab-link'],
      ['wrapperNodes', 'wrapperId', 'x-panel'],
    ]) {
      const nodes = frame[key];
      if (
        queryCanonical(nodes.map((n) => n.id)) !==
        queryCanonical(model.components.map((c) => c[idKey]))
      )
        reject();
      if (
        nodes.some(
          (n) =>
            !queryNode(n) ||
            n.tag !== 'DIV' ||
            !n.visible ||
            !queryTokens(n.rawClassName).includes(classToken),
        )
      )
        reject();
    }
    if (frame.gridSchemas.length !== model.grids.length) reject();
    for (const [i, g] of frame.gridSchemas.entries()) {
      const expected = model.grids[i],
        component = model.components.find(
          (c) => c.componentId === expected.componentId,
        );
      if (
        !exactKeys(g, ['gridId', 'wrapperId', 'node', 'nativeHeaders']) ||
        g.gridId !== expected.gridId ||
        g.wrapperId !== component.wrapperId ||
        !queryNode(g.node) ||
        g.node.id !== g.gridId ||
        g.node.tag !== 'DIV' ||
        !g.node.visible ||
        !queryTokens(g.node.rawClassName).includes('x-grid-panel')
      )
        reject();
      efHeaders(g.nativeHeaders, expected.columns, reject);
    }
    if (frame.attributeSections.length !== model.attributeSections.length)
      reject();
    const expectedFields = [];
    for (const [i, a] of frame.attributeSections.entries()) {
      const expected = model.attributeSections[i];
      if (
        !exactKeys(a, [
          'sectionId',
          'dataStoreId',
          'section',
          'store',
          'wrapperId',
        ]) ||
        a.sectionId !== expected.sectionId ||
        a.dataStoreId !== expected.dataStoreId ||
        a.wrapperId !==
          model.components.find((c) => c.componentId === 'objectattributes')
            .wrapperId ||
        !queryNode(a.section) ||
        a.section.id !== a.sectionId ||
        a.section.tag !== 'FIELDSET' ||
        !a.section.visible ||
        !queryNode(a.store) ||
        a.store.id !== a.dataStoreId ||
        a.store.tag !== 'DIV' ||
        !a.store.visible
      )
        reject();
      for (const label of expected.labels)
        expectedFields.push({
          sectionId: a.sectionId,
          dataStoreId: a.dataStoreId,
          actualLabel: label.trim(),
        });
    }
    if (frame.fields.length !== expectedFields.length) reject();
    for (const [i, f] of frame.fields.entries()) {
      const expected = expectedFields[i];
      if (
        !exactKeys(f, [
          'sectionId',
          'dataStoreId',
          'labelTag',
          'rawClassName',
          'rawCaptionText',
          'actualLabel',
          'valueTag',
          'captionLocator',
          'valueLocator',
          'visible',
          'bodyEvidenceState',
        ]) ||
        f.sectionId !== expected.sectionId ||
        f.dataStoreId !== expected.dataStoreId ||
        f.actualLabel !== expected.actualLabel ||
        typeof f.rawCaptionText !== 'string' ||
        f.rawCaptionText.length > 200 ||
        f.rawCaptionText.trim() !== f.actualLabel ||
        f.labelTag !== 'TD' ||
        f.valueTag !== 'TD' ||
        !queryTokens(f.rawClassName).includes('attributePanel-label') ||
        f.visible !== true ||
        f.bodyEvidenceState !== 'NOT_READ' ||
        ![f.captionLocator, f.valueLocator].every(
          (v) =>
            typeof v === 'string' &&
            v.startsWith(model.panelLocator + ' ') &&
            v.length <= 700,
        )
      )
        reject();
    }
  }
  if (
    !Array.isArray(read?.tabs) ||
    !Array.isArray(read.fields) ||
    !Array.isArray(read.relationTables)
  )
    reject();
  for (const items of [
    read.fields,
    read.sections,
    read.relationTables,
    read.rosterEvidence?.structuralRosters,
  ])
    if (items?.some((v) => v.tabId === model.tabId)) reject();
  if (
    read.attachments?.some(
      (a) =>
        a.locator === model.panelLocator ||
        a.locator.startsWith(model.panelLocator + ' '),
    )
  )
    reject();
  const binding = proof.canonicalBinding;
  if (model.canonicalKind === null) {
    if (binding !== null) reject();
  } else {
    if (
      !exactKeys(binding, [
        'kind',
        'ownerSourceRecordId',
        'ownerSourceVersion',
        'ownerSourceModifiedRaw',
        'tabId',
        'panelLocator',
        'tableId',
        'fieldIds',
      ]) ||
      binding.kind !== model.canonicalKind ||
      binding.ownerSourceRecordId !== owner.sourceRecordId ||
      queryCanonical(binding.ownerSourceVersion) !==
        queryCanonical(owner.sourceVersion) ||
      binding.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
      binding.tabId !== model.canonicalTabId ||
      binding.panelLocator !== model.canonicalPanelLocator ||
      binding.tableId !== model.canonicalTableId ||
      !queryList(binding.fieldIds)
    )
      reject();
    if (
      !read.tabs.some(
        (t) =>
          t.tabId === binding.tabId &&
          t.panelLocator === binding.panelLocator &&
          t.required === true,
      )
    )
      reject();
    if (binding.kind === 'TABLE') {
      const tables = read.relationTables.filter(
        (t) =>
          t.tableId === binding.tableId &&
          t.tabId === binding.tabId &&
          t.panelLocator === binding.panelLocator,
      );
      if (
        tables.length !== 1 ||
        tables[0].ownerSourceRecordId !== owner.sourceRecordId ||
        queryCanonical(tables[0].ownerSourceVersion) !==
          queryCanonical(owner.sourceVersion) ||
        binding.fieldIds.length
      )
        reject();
    } else {
      const fields = read.fields.filter(
        (f) =>
          f.tabId === binding.tabId &&
          model.attributeSections.some(
            (a) => f.sectionId === binding.tabId + '::' + a.sectionId,
          ),
      );
      if (
        queryCanonical(fields.map((f) => f.fieldId)) !==
          queryCanonical(binding.fieldIds) ||
        queryCanonical(fields.map((f) => f.value.actualLabel)) !==
          queryCanonical(
            model.attributeSections.flatMap((a) =>
              a.labels.map((l) => l.trim()),
            ),
          )
      )
        reject();
    }
  }
  return { complete: true, reasonCode: null };
}
export function validateReviewedEfRequestRelatedSurfaceEvidence(
  proof,
  { scopeId, owner, table } = {},
) {
  if (scopeId === 'AD_ITEM')
    return validateReviewedAdItemDetailsQueryEvidence(proof, {
      scopeId,
      owner,
      table,
    });
  if (isReviewedEfStructureTable(table))
    return validateReviewedEfStructureUsesEvidence(proof, {
      scopeId,
      owner,
      table,
    });
  const model = isReviewedEfRequestOwner({ scopeId, owner })
    ? REVIEWED_EFREQUEST_RELATED_MODEL.grids.find(
        (g) => g.gridId === table?.gridId,
      )
    : null;
  if (!model) {
    if (proof !== undefined)
      queryFail('TDMS_EFREQUEST_RELATED_SURFACE_INVALID');
    return null;
  }
  const pending = {
    complete: false,
    reasonCode:
      proof === undefined
        ? 'TDMS_EFREQUEST_RELATED_RAW_PROOF_MISSING'
        : 'TDMS_EFREQUEST_RELATED_QUERY_UNREVIEWED',
  };
  const reject = () => queryFail('TDMS_EFREQUEST_RELATED_SURFACE_INVALID');
  if (
    table.tabId !== model.tabId ||
    table.panelLocator !== model.panelLocator ||
    table.relationshipRole !== 'UNKNOWN' ||
    table.direction !== 'UNKNOWN' ||
    queryCanonical(table.rawHeaders) !==
      queryCanonical(model.columns.map((c) => c.actualLabel))
  )
    reject();
  for (const row of table.rows || []) {
    if (
      row.cells.length !== model.columns.length ||
      row.observedVersion.confirmation !== 'VERSION_UNCONFIRMED' ||
      row.observedVersion.rawRevision !== null ||
      row.observedVersion.rawIteration !== null
    )
      reject();
    for (const [i, c] of model.columns.entries())
      if (
        c.valuePolicy.startsWith('NOT_READ') &&
        (row.cells[i].state !== 'NOT_READ' ||
          row.cells[i].rawValue !== null ||
          row.cells[i].observedTotalCodepoints !== 0 ||
          row.sourceLinks.some(
            (l) =>
              l.nativeColumnToken === c.nativeColumnToken ||
              l.nativeColumnLabel === c.actualLabel,
          ))
      )
        reject();
    if (
      row.sourceLinks.some(
        (l) =>
          l.nativeColumnToken !== 'number' || l.nativeColumnLabel !== 'Number',
      )
    )
      reject();
  }
  const query = validateReviewedEfRequestRelatedQueryEvidence(
    table.relatedQueryEvidence,
    { scopeId, owner, table },
  );
  // Native-view inventory does not certify the confirmed relation scope.
  if (
    table.efQueryEvidence !== undefined ||
    table.enumerationState === 'VALUE' ||
    table.terminal.nativeTerminal ||
    table.terminal.trueZero ||
    table.terminal.kind !== 'UNCONFIRMED'
  )
    reject();
  if (proof === undefined) return pending;
  if (
    proof.modelRevision ===
    REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL.rawModelRevision
  ) {
    validateEfRelatedWindowSurface(proof, { scopeId, owner, table, model });
    return query ? { ...query, complete: false } : pending;
  }
  const m = REVIEWED_EFREQUEST_RELATED_MODEL;
  if (
    !exactKeys(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
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
    !efBoundProof(proof, m, {
      scopeId,
      owner,
      tabId: model.tabId,
      panelLocator: model.panelLocator,
      gridId: model.gridId,
    }) ||
    proof.queryReviewState !== 'NOT_READ' ||
    proof.settledReads !== 2 ||
    queryCanonical(proof.before) !== queryCanonical(proof.after)
  )
    reject();
  for (const frame of [proof.before, proof.after]) {
    if (
      !exactKeys(frame, [
        'activeTabId',
        'panelId',
        'panelVisible',
        'gridVisible',
        'nativeHeaders',
        'titles',
        'controls',
        'counts',
        'rowShapes',
        'pagers',
        'treeNodes',
        'scrollers',
        'loading',
        'permissionMarkers',
      ]) ||
      frame.activeTabId !== model.tabId ||
      frame.panelId !== model.panelLocator.slice(1) ||
      !frame.panelVisible ||
      !frame.gridVisible
    )
      reject();
    efHeaders(frame.nativeHeaders, model.columns, reject);
    for (const key of [
      'titles',
      'controls',
      'counts',
      'rowShapes',
      'pagers',
      'treeNodes',
      'scrollers',
      'permissionMarkers',
    ])
      if (!queryList(frame[key])) reject();
    if (
      frame.titles.some(
        (n) =>
          !exactKeys(n, ['node', 'rawText']) ||
          !queryNode(n.node) ||
          typeof n.rawText !== 'string' ||
          n.rawText.length > 200,
      )
    )
      reject();
    for (const c of frame.controls) {
      if (
        !exactKeys(c, [
          'node',
          'type',
          'rawValue',
          'valueEvidenceState',
          'disabled',
        ]) ||
        !queryNode(c.node) ||
        typeof c.disabled !== 'boolean' ||
        (c.type !== null && typeof c.type !== 'string') ||
        !['VALUE', 'BLANK', 'NOT_READ'].includes(c.valueEvidenceState)
      )
        reject();
      if (c.valueEvidenceState === 'NOT_READ') {
        if (c.rawValue !== null) reject();
      } else if (
        !model.rawControlIds.includes(c.node.id) ||
        c.node.tag !== 'INPUT' ||
        c.type !== 'text' ||
        typeof c.rawValue !== 'string' ||
        c.rawValue.length > 1000
      )
        reject();
    }
    for (const c of frame.counts)
      if (
        !exactKeys(c, ['node', 'rawText']) ||
        !queryNode(c.node) ||
        c.node.tag !== 'SPAN' ||
        !queryTokens(c.node.rawClassName).includes('tableCount') ||
        typeof c.rawText !== 'string' ||
        c.rawText.length > 200
      )
        reject();
    for (const row of frame.rowShapes)
      if (
        !exactKeys(row, ['node', 'occurrenceId', 'attributes']) ||
        !queryNode(row.node) ||
        typeof row.occurrenceId !== 'string' ||
        !exactKeys(row.attributes, [
          'ariaRowIndex',
          'dataRowIndex',
          'ariaLevel',
          'dataDepth',
          'nativeRelationId',
          'rawRole',
          'rawDirection',
        ])
      )
        reject();
    for (const key of ['pagers', 'treeNodes', 'permissionMarkers'])
      if (frame[key].some((n) => !queryNode(n))) reject();
    for (const n of frame.scrollers)
      if (
        !exactKeys(n, ['node', 'top', 'height', 'viewport']) ||
        !queryNode(n.node) ||
        [n.top, n.height, n.viewport].some((v) => !Number.isFinite(v) || v < 0)
      )
        reject();
    const loading = frame.loading;
    if (
      !exactKeys(loading, [
        'utilitySlots',
        'masks',
        'stopButtons',
        'busyNodes',
        'active',
      ]) ||
      typeof loading.active !== 'boolean' ||
      loading.active
    )
      reject();
    for (const key of ['utilitySlots', 'masks', 'stopButtons', 'busyNodes'])
      if (!queryList(loading[key])) reject();
    if (
      [...loading.masks, ...loading.stopButtons, ...loading.busyNodes].some(
        (n) => !queryNode(n) || n.visible,
      )
    )
      reject();
    for (const n of loading.utilitySlots)
      if (
        !exactKeys(n, ['node', 'childElementCount', 'rawText']) ||
        !queryNode(n.node) ||
        !queryNumber(n.childElementCount) ||
        (n.rawText !== null && typeof n.rawText !== 'string') ||
        (n.node.visible &&
          (!model.utilityIds.includes(n.node.id) ||
            n.node.tag !== 'DIV' ||
            !queryTokens(n.node.rawClassName).includes('xtb-text') ||
            n.childElementCount !== 0 ||
            n.rawText !== ''))
      )
        reject();
    if (frame.permissionMarkers.some((n) => n.visible)) reject();
    const visibleRows = frame.rowShapes.filter((r) => r.node.visible);
    if (
      queryCanonical(visibleRows.map((r) => r.occurrenceId)) !==
      queryCanonical(table.rows.map((r) => r.occurrenceId))
    )
      reject();
  }
  return query
    ? {
        ...query,
        complete: false,
        reasonCode:
          query.reasonCode || 'TDMS_EFREQUEST_RELATED_CONTRACT_SCOPE_UNPROVEN',
      }
    : pending;
}
function efRelatedPagingEvidence(paging, reject) {
  if (!exactKeys(paging, ['first', 'prev', 'next', 'last', 'page'])) reject();
  for (const kind of ['first', 'prev', 'next', 'last']) {
    const c = paging[kind];
    if (c === null) continue;
    if (
      !exactKeys(c, [
        'node',
        'indicator',
        'wrapper',
        'nativeDisabled',
        'ariaDisabled',
        'disabled',
      ]) ||
      ![c.node, c.indicator, c.wrapper].every(queryNode) ||
      c.node.tag !== 'BUTTON' ||
      !['BUTTON', 'IMG', 'SPAN'].includes(c.indicator.tag) ||
      !queryTokens(c.indicator.rawClassName).includes('x-tbar-page-' + kind) ||
      ![c.node, c.indicator, c.wrapper].every((n) => n.visible) ||
      typeof c.nativeDisabled !== 'boolean' ||
      typeof c.disabled !== 'boolean' ||
      (c.ariaDisabled !== null && typeof c.ariaDisabled !== 'string')
    )
      reject();
    const derived =
      c.nativeDisabled ||
      c.ariaDisabled === 'true' ||
      [c.node, c.wrapper].some((n) =>
        queryTokens(n.rawClassName).some((c) =>
          ['x-item-disabled', 'x-btn-disabled'].includes(c),
        ),
      );
    if (c.disabled !== derived) reject();
  }
  if (
    paging.page !== null &&
    (!exactKeys(paging.page, ['node', 'type', 'rawValue']) ||
      !queryNode(paging.page.node) ||
      paging.page.node.tag !== 'INPUT' ||
      !paging.page.node.visible ||
      !queryTokens(paging.page.node.rawClassName).includes(
        'x-tbar-page-number',
      ) ||
      paging.page.type !== 'text' ||
      typeof paging.page.rawValue !== 'string' ||
      paging.page.rawValue.length > 160)
  )
    reject();
  if (
    ['first', 'prev', 'next', 'last'].some((k) => paging[k] !== null) &&
    (!paging.next ||
      !paging.page ||
      !/^\d+$/u.test(paging.page.rawValue) ||
      Number(paging.page.rawValue) < 1)
  )
    reject();
}

const efRelatedWindowPosition = (window) =>
  Object.fromEntries(
    [
      'reportedTotal',
      'pageRaw',
      'scroll',
      'nextControl',
      'rowOccurrenceIds',
      'globalIndices',
      'treePending',
    ].map((k) => [k, window[k]]),
  );

function validateEfRelatedWindowSurface(
  proof,
  { scopeId, owner, table, model },
) {
  const m = REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL,
    reject = () => queryFail('TDMS_EFREQUEST_RELATED_SURFACE_INVALID');
  if (
    !exactKeys(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerSourceModifiedRaw',
      'nativeTypeId',
      'tabId',
      'panelLocator',
      'gridId',
      'queryReviewState',
      'indexOrigin',
      'windows',
      'stopReason',
    ]) ||
    !efBoundProof(
      proof,
      {
        ...m,
        schemaVersion: m.rawSchemaVersion,
        modelRevision: m.rawModelRevision,
      },
      {
        scopeId,
        owner,
        tabId: model.tabId,
        panelLocator: model.panelLocator,
        gridId: model.gridId,
      },
    ) ||
    proof.queryReviewState !== 'NOT_READ' ||
    proof.indexOrigin !==
      {
        NATIVE_PAGER: 'NATIVE_PAGE_SEQUENCE',
        VIRTUAL_SCROLL: 'NATIVE_GLOBAL_ROW_INDEX',
        DOM_ROWS: 'COMPLETE_DOM_ORDER',
      }[table.scanMode] ||
    !queryList(proof.windows) ||
    !proof.windows.length ||
    proof.windows.length !== table.windows.length ||
    (proof.stopReason !== null && typeof proof.stopReason !== 'string') ||
    table.stopReason !==
      (proof.stopReason || 'TDMS_EFREQUEST_RELATED_CONTRACT_SCOPE_UNPROVEN')
  )
    reject();
  const rowMap = new Map(table.rows.map((row) => [row.occurrenceId, row])),
    orderedIndices = new Map();
  for (const [ordinal, pair] of proof.windows.entries()) {
    if (
      !exactKeys(pair, [
        'windowOrdinal',
        'before',
        'after',
        'settledReads',
        'position',
      ]) ||
      pair.windowOrdinal !== ordinal ||
      pair.settledReads !== 2 ||
      queryCanonical(pair.before) !== queryCanonical(pair.after) ||
      queryCanonical(pair.position) !==
        queryCanonical(efRelatedWindowPosition(table.windows[ordinal]))
    )
      reject();
    for (const frame of [pair.before, pair.after]) {
      efRelatedPagingEvidence(frame.paging, reject);
      const next = frame.paging.next,
        expected = {
          present: !!next,
          enabled: !!next && !next.disabled,
          terminalDeclared: !!next && next.disabled,
        };
      if (
        queryCanonical(expected) !==
          queryCanonical(pair.position.nextControl) ||
        pair.position.pageRaw !== (frame.paging.page?.rawValue ?? null)
      )
        reject();
      const sc = frame.scrollers?.[0],
        scroll = pair.position.scroll;
      if (
        frame.scrollers?.length !== 1 ||
        !scroll ||
        scroll.top !== sc.top ||
        scroll.height !== sc.height ||
        scroll.viewport !== sc.viewport ||
        scroll.atTop !== sc.top <= 1 ||
        scroll.atBottom !== sc.top + sc.viewport >= sc.height - 1
      )
        reject();
      const subset = pair.position.rowOccurrenceIds.map((id) => rowMap.get(id));
      if (subset.some((row) => !row)) reject();
      if (
        queryCanonical(
          subset
            .filter((row) => row.globalIndex !== null)
            .map((row) => row.globalIndex),
        ) !== queryCanonical(pair.position.globalIndices)
      )
        reject();
      const { paging, ...legacyFrame } = frame,
        raw = REVIEWED_EFREQUEST_RELATED_MODEL;
      // Validate the common frame shape and column/permission policies with the
      // unchanged legacy validator; this projection is never persisted as @1.
      validateReviewedEfRequestRelatedSurfaceEvidence(
        {
          schemaVersion: raw.schemaVersion,
          modelRevision: raw.modelRevision,
          scopeId: proof.scopeId,
          ownerSourceRecordId: proof.ownerSourceRecordId,
          ownerSourceVersion: proof.ownerSourceVersion,
          ownerSourceModifiedRaw: proof.ownerSourceModifiedRaw,
          nativeTypeId: proof.nativeTypeId,
          tabId: proof.tabId,
          panelLocator: proof.panelLocator,
          gridId: proof.gridId,
          queryReviewState: 'NOT_READ',
          before: legacyFrame,
          after: legacyFrame,
          settledReads: 2,
        },
        {
          scopeId,
          owner,
          table: { ...table, rows: subset, relatedQueryEvidence: undefined },
        },
      );
      if (pair.position.treePending !== frame.treeNodes.length) reject();
      for (const shape of frame.rowShapes) {
        const a = shape.attributes;
        if (Object.values(a).some((v) => v !== null && typeof v !== 'string'))
          reject();
        const rawIndex = a.ariaRowIndex ?? a.dataRowIndex,
          nativeIndex =
            rawIndex !== null && /^\d+$/u.test(rawIndex)
              ? Number(rawIndex) - (a.ariaRowIndex !== null ? 1 : 0)
              : null;
        const row = rowMap.get(shape.occurrenceId);
        if (table.scanMode === 'NATIVE_PAGER' && nativeIndex === null && row) {
          if (!orderedIndices.has(shape.occurrenceId))
            orderedIndices.set(shape.occurrenceId, orderedIndices.size);
          if (row.globalIndex !== orderedIndices.get(shape.occurrenceId))
            reject();
        }
        if (
          row &&
          (row.nativeRelationId !== a.nativeRelationId ||
            row.rawRole !== a.rawRole ||
            row.rawDirection !== a.rawDirection ||
            (nativeIndex !== null && row.globalIndex !== nativeIndex))
        )
          reject();
      }
    }
  }
}

function efRelatedPageOccurrenceFingerprint(row) {
  const { occurrenceId, globalIndex, nativeRowId, sourceLinks, ...values } =
    row;
  return queryCanonical({
    ...values,
    sourceLinks: sourceLinks.map(({ locator, ...link }) => link),
  });
}

function efRelatedPageOccurrenceUnproven(table) {
  if (table.scanMode !== 'NATIVE_PAGER') return false;
  const rowMap = new Map(table.rows.map((row) => [row.occurrenceId, row])),
    seen = new Set();
  for (const pair of table.relatedSurfaceEvidence?.windows || []) {
    const current = [];
    for (const shape of pair.after.rowShapes) {
      const row = rowMap.get(shape.occurrenceId);
      if (!row) continue;
      const a = shape.attributes,
        raw = a.ariaRowIndex ?? a.dataRowIndex,
        native =
          raw !== null &&
          /^\d+$/u.test(raw) &&
          Number(raw) - (a.ariaRowIndex !== null ? 1 : 0) >= 0,
        key = efRelatedPageOccurrenceFingerprint(row);
      if (!native && seen.has(key)) return true;
      current.push(key);
    }
    for (const key of current) seen.add(key);
  }
  return false;
}

function efRelatedCurrentViewWindowsComplete(proof, table) {
  const raw = table.relatedSurfaceEvidence,
    total = table.reportedTotal,
    rows = table.rows,
    windows = table.windows;
  if (
    raw?.modelRevision !==
      REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL.rawModelRevision ||
    raw.stopReason !== null ||
    !queryNumber(total) ||
    !windows.length ||
    rows.length !== total ||
    rows.some((row, i) => row.globalIndex !== i) ||
    new Set(rows.map((r) => r.occurrenceId)).size !== total
  )
    return false;
  const union = new Set();
  let previous = null;
  for (const [i, w] of windows.entries()) {
    const frame = raw.windows[i].after,
      p = frame.paging;
    if (
      w.reportedTotal !== total ||
      w.treePending !== 0 ||
      frame.treeNodes.length ||
      !w.scroll ||
      w.scroll.viewport <= 0 ||
      w.scroll.height < w.scroll.viewport ||
      frame.scrollers.length !== 1 ||
      !frame.scrollers[0].node.visible ||
      w.scroll.top < 0 ||
      frame.rowShapes.length !== w.rowOccurrenceIds.length ||
      queryCanonical(frame.rowShapes.map((r) => r.occurrenceId)) !==
        queryCanonical(w.rowOccurrenceIds)
    )
      return false;
    for (const id of w.rowOccurrenceIds) union.add(id);
    if (table.scanMode === 'NATIVE_PAGER') {
      if (
        !p.next ||
        !p.page ||
        Number(w.pageRaw) !== i + 1 ||
        (previous && !previous.nextControl.enabled) ||
        (i === windows.length - 1 && w.nextControl.enabled)
      )
        return false;
    } else if (table.scanMode === 'VIRTUAL_SCROLL') {
      if (
        p.next ||
        p.page ||
        (i === 0 && !w.scroll.atTop) ||
        (previous &&
          (w.scroll.top <= previous.scroll.top ||
            w.scroll.viewport !== previous.scroll.viewport ||
            w.scroll.height !== previous.scroll.height)) ||
        frame.rowShapes.some((shape) => {
          const a = shape.attributes,
            n = a.ariaRowIndex ?? a.dataRowIndex;
          return n === null || !/^\d+$/u.test(n);
        }) ||
        (i === windows.length - 1 && !w.scroll.atBottom)
      )
        return false;
    } else if (
      table.scanMode !== 'DOM_ROWS' ||
      windows.length !== 1 ||
      frame.pagers.length ||
      p.page ||
      p.next ||
      !w.scroll.atBottom
    )
      return false;
    previous = w;
  }
  return union.size === rows.length;
}

// Three distinct results: known native UI query, that view's inventory, and
// confirmed-contract coverage. Named views never manufacture backend criteria.
export function validateReviewedEfRequestRelatedQueryEvidence(
  proof,
  { scopeId, owner, table } = {},
) {
  const multi =
      proof?.modelRevision ===
      REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL.modelRevision,
    m = multi
      ? REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL
      : REVIEWED_EFREQUEST_RELATED_QUERY_MODEL,
    model = isReviewedEfRequestOwner({ scopeId, owner })
      ? m.grids.find((g) => g.gridId === table?.gridId)
      : null;
  const missing = {
    complete: false,
    queryKnown: false,
    currentViewInventoryComplete: false,
    contractScopeCoverage: 'UNKNOWN',
    reasonCode: 'TDMS_EFREQUEST_RELATED_QUERY_MISSING',
  };
  if (!model) {
    if (proof !== undefined) queryFail('TDMS_EFREQUEST_RELATED_QUERY_INVALID');
    return null;
  }
  if (proof === undefined) return missing;
  const reject = () => queryFail('TDMS_EFREQUEST_RELATED_QUERY_INVALID');
  if (
    !exactKeys(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerSourceModifiedRaw',
      'nativeTypeId',
      'tabId',
      'panelLocator',
      'gridId',
      'queryScope',
      'contractScopeCoverage',
      'windows',
    ]) ||
    !efBoundProof(proof, m, {
      scopeId,
      owner,
      tabId: model.tabId,
      panelLocator: model.panelLocator,
      gridId: model.gridId,
    }) ||
    proof.queryScope !== m.queryScope ||
    table.tabId !== model.tabId ||
    table.panelLocator !== model.panelLocator ||
    !exactKeys(proof.contractScopeCoverage, ['state', 'proof']) ||
    proof.contractScopeCoverage.state !== 'UNKNOWN' ||
    proof.contractScopeCoverage.proof !== null ||
    !queryList(proof.windows) ||
    !proof.windows.length ||
    proof.windows.length !== table.windows?.length
  )
    reject();
  if (
    multi &&
    table.relatedSurfaceEvidence?.modelRevision !== m.rawModelRevision
  )
    reject();
  let reason = null,
    endReason = null,
    firstQuery = null;
  const pending = (code) => {
    reason ||= code;
  };
  const attrs = (value) =>
    queryList(value) &&
    value.length <= 80 &&
    value.every(
      (a) =>
        exactKeys(a, ['name', 'value']) &&
        typeof a.name === 'string' &&
        a.name.length <= 100 &&
        typeof a.value === 'string' &&
        a.value.length <= 2000,
    );
  const input = (value) =>
    exactKeys(value, [
      'node',
      'type',
      'name',
      'rawValue',
      'disabled',
      'rawAttributes',
    ]) &&
    queryNode(value.node) &&
    value.node.tag === 'INPUT' &&
    value.type === 'text' &&
    typeof value.rawValue === 'string' &&
    value.rawValue.length <= 1000 &&
    typeof value.disabled === 'boolean' &&
    attrs(value.rawAttributes);
  const namedNode = (node, tag, cls) =>
    queryNode(node) &&
    node.tag === tag &&
    queryTokens(node.rawClassName).includes(cls);
  for (const [index, pair] of proof.windows.entries()) {
    if (
      !exactKeys(pair, ['windowOrdinal', 'before', 'after', 'settledReads']) ||
      pair.windowOrdinal !== index ||
      pair.settledReads !== 2 ||
      queryCanonical(pair.before) !== queryCanonical(pair.after)
    )
      queryFail('TDMS_EFREQUEST_RELATED_QUERY_CHANGED');
    const f = pair.after;
    if (
      !exactKeys(f, [
        'view',
        'selectedOnly',
        'additionalControls',
        'panelUnreviewedNodes',
        'surface',
      ]) ||
      !queryList(f.additionalControls) ||
      !queryList(f.panelUnreviewedNodes) ||
      [...f.additionalControls, ...f.panelUnreviewedNodes].some(
        (n) => !queryNode(n),
      )
    )
      reject();
    if (f.additionalControls.length)
      pending('TDMS_EFREQUEST_RELATED_QUERY_CONTROL_UNREVIEWED');
    if (f.panelUnreviewedNodes.some((n) => n.visible))
      pending('TDMS_EFREQUEST_RELATED_VISIBLE_COMPONENT_UNREVIEWED');
    const shape = { ...f, surface: null };
    if (firstQuery === null) firstQuery = shape;
    else if (multi && queryCanonical(shape) !== queryCanonical(firstQuery))
      pending('TDMS_EFREQUEST_RELATED_QUERY_CHANGED');
    const view = f.view;
    if (
      !exactKeys(view, [
        'state',
        'input',
        'wrapper',
        'arrow',
        'popup',
        'header',
        'options',
        'inputBefore',
        'inputAfter',
        'serializedValue',
        'backendCriteria',
        'sequence',
      ]) ||
      !['VALUE', 'UNKNOWN'].includes(view.state) ||
      !queryList(view.options) ||
      !queryList(view.sequence) ||
      !exactKeys(view.serializedValue, ['state', 'rawValue']) ||
      view.serializedValue.state !== 'NOT_EXPOSED' ||
      view.serializedValue.rawValue !== null ||
      !exactKeys(view.backendCriteria, ['state', 'rawValue']) ||
      view.backendCriteria.state !== 'NOT_READ' ||
      view.backendCriteria.rawValue !== null
    )
      reject();
    if (view.state === 'UNKNOWN') {
      if (
        [
          view.input,
          view.wrapper,
          view.arrow,
          view.popup,
          view.header,
          view.inputBefore,
          view.inputAfter,
        ].some((x) => x !== null) ||
        view.options.length ||
        view.sequence.length
      )
        reject();
      pending('TDMS_EFREQUEST_RELATED_VIEW_UNREAD');
    } else {
      if (
        !input(view.input) ||
        view.input.node.id !== model.viewId ||
        view.input.name !== model.viewId ||
        !namedNode(view.wrapper, 'DIV', 'x-form-field-wrap') ||
        !queryTokens(view.wrapper.rawClassName).includes(
          'x-form-field-trigger-wrap',
        ) ||
        !namedNode(view.arrow, 'IMG', 'x-form-arrow-trigger') ||
        !queryTokens(view.arrow.rawClassName).includes('x-form-trigger') ||
        !exactKeys(view.popup, ['node', 'rawAttributes']) ||
        !namedNode(view.popup.node, 'DIV', 'x-combo-list') ||
        !attrs(view.popup.rawAttributes) ||
        !exactKeys(view.header, ['node', 'rawText']) ||
        !namedNode(view.header.node, 'DIV', 'x-combo-list-hd') ||
        view.header.rawText !== '- Pick a View -' ||
        view.options.some(
          (o) =>
            !exactKeys(o, ['node', 'rawText', 'rawAttributes']) ||
            !namedNode(o.node, 'DIV', 'x-combo-list-item') ||
            typeof o.rawText !== 'string' ||
            o.rawText.length > 200 ||
            !attrs(o.rawAttributes),
        )
      )
        reject();
      if (
        ![
          view.input.node,
          view.wrapper,
          view.arrow,
          view.popup.node,
          view.header.node,
          ...view.options.map((o) => o.node),
        ].every((n) => n.visible) ||
        view.input.disabled ||
        queryCanonical(view.sequence) !==
          queryCanonical(['ARROW_OPENED', 'CHOICES_READ', 'ACTIVE_TAB_CLOSED'])
      )
        pending('TDMS_EFREQUEST_RELATED_VIEW_UNREAD');
      const selected = view.options.filter((o) =>
        queryTokens(o.node.rawClassName).includes('x-combo-selected'),
      );
      if (
        selected.length !== 1 ||
        selected[0].rawText !== model.viewName ||
        view.input.rawValue !== model.viewName ||
        view.inputBefore !== model.viewName ||
        view.inputAfter !== model.viewName
      )
        pending('TDMS_EFREQUEST_RELATED_VIEW_CHANGED_OR_FILTERED');
      if (
        queryCanonical(view.options.map((o) => o.rawText)) !==
        queryCanonical(model.options)
      )
        pending('TDMS_EFREQUEST_RELATED_VIEW_ROSTER_UNREVIEWED');
    }
    const selected = f.selectedOnly;
    if (
      !exactKeys(selected, [
        'state',
        'control',
        'button',
        'popup',
        'item',
        'parentLi',
        'checkItemIds',
        'sequence',
        'nativeChecked',
        'ariaChecked',
      ]) ||
      !['VALUE', 'NOT_APPLICABLE', 'UNKNOWN'].includes(selected.state) ||
      !queryList(selected.checkItemIds) ||
      !queryList(selected.sequence) ||
      selected.nativeChecked !== null ||
      (selected.ariaChecked !== null &&
        typeof selected.ariaChecked !== 'string')
    )
      reject();
    if (selected.state !== 'VALUE') {
      if (
        [
          selected.control,
          selected.button,
          selected.popup,
          selected.item,
          selected.parentLi,
        ].some((n) => n !== null) ||
        selected.checkItemIds.length ||
        selected.sequence.length ||
        selected.ariaChecked !== null
      )
        reject();
      if (model.selectedOnlyRequired || selected.state !== 'NOT_APPLICABLE')
        pending('TDMS_EFREQUEST_RELATED_SELECTED_ONLY_UNREAD');
    } else {
      if (
        !model.selectedOnlyRequired ||
        !queryNode(selected.control) ||
        selected.control.id !== model.selectedOnlyControlId ||
        selected.control.tag !== 'TABLE' ||
        !namedNode(selected.button, 'BUTTON', 'optionsButton') ||
        !namedNode(selected.popup, 'DIV', 'x-menu') ||
        !exactKeys(selected.item, [
          'id',
          'tag',
          'rawClassName',
          'visible',
          'rawText',
        ]) ||
        !queryNode(
          Object.fromEntries(
            Object.entries(selected.item).filter(([k]) => k !== 'rawText'),
          ),
        ) ||
        selected.item.id !== model.selectedOnlyItemId ||
        selected.item.tag !== 'A' ||
        selected.item.rawText !== 'View Selected Objects Only' ||
        !queryTokens(selected.item.rawClassName).includes('x-menu-item') ||
        !queryTokens(selected.item.rawClassName).includes(
          'x-menu-check-item',
        ) ||
        !namedNode(selected.parentLi, 'LI', 'x-menu-list-item') ||
        selected.parentLi.id !== 'x-menu-el-' + model.selectedOnlyItemId
      )
        reject();
      if (
        ![
          selected.control,
          selected.button,
          selected.popup,
          selected.item,
          selected.parentLi,
        ].every((n) => n.visible) ||
        selected.ariaChecked !== null ||
        queryCanonical(selected.checkItemIds) !==
          queryCanonical([model.selectedOnlyItemId]) ||
        queryCanonical(selected.sequence) !==
          queryCanonical(['BUTTON_OPENED', 'ITEM_READ', 'BUTTON_CLOSED'])
      )
        pending('TDMS_EFREQUEST_RELATED_SELECTED_ONLY_UNREAD');
      if (
        /checked/iu.test(
          selected.item.rawClassName + ' ' + selected.parentLi.rawClassName,
        )
      )
        pending('TDMS_EFREQUEST_RELATED_SELECTED_ONLY_FILTERED');
    }
    const s = f.surface,
      raw = table.relatedSurfaceEvidence;
    if (
      !s ||
      s.activeTabId !== model.tabId ||
      s.panelId !== model.panelLocator.slice(1) ||
      s.panelVisible !== true ||
      s.gridVisible !== true ||
      !queryList(s.controls) ||
      !queryList(s.counts) ||
      !queryList(s.rowShapes) ||
      !queryList(s.pagers) ||
      !queryList(s.treeNodes) ||
      !queryList(s.scrollers) ||
      !queryList(s.permissionMarkers) ||
      (multi
        ? queryCanonical(pair.before.surface) !==
            queryCanonical(raw?.windows?.[index]?.before) ||
          queryCanonical(s) !== queryCanonical(raw?.windows?.[index]?.after)
        : (index === 0 &&
            queryCanonical(pair.before.surface) !==
              queryCanonical(raw?.before)) ||
          (index === proof.windows.length - 1 &&
            queryCanonical(s) !== queryCanonical(raw?.after)))
    )
      reject();
    const searches = s.controls.filter((c) => c.node?.id === model.searchId);
    if (
      searches.length !== 1 ||
      searches[0].node.tag !== 'INPUT' ||
      searches[0].type !== 'text' ||
      searches[0].disabled ||
      !searches[0].node.visible ||
      searches[0].valueEvidenceState !== 'VALUE' ||
      searches[0].rawValue !== model.searchPlaceholder ||
      !queryTokens(searches[0].node.rawClassName).includes('x-form-empty-field')
    )
      pending('TDMS_EFREQUEST_RELATED_SEARCH_FILTERED_OR_UNREAD');
    const totals = s.counts.filter(
        (c) =>
          c.node?.visible && /^\(\s*\d+\s+objects?\s*\)$/iu.test(c.rawText),
      ),
      selectedCounts = s.counts.filter(
        (c) =>
          c.node?.visible &&
          /^\(\s*\d+\s+objects?\s+selected\s*\)$/iu.test(c.rawText),
      );
    if (
      s.counts.some(
        (c) =>
          !queryNode(c.node) ||
          c.node.tag !== 'SPAN' ||
          !queryTokens(c.node.rawClassName).includes('tableCount') ||
          typeof c.rawText !== 'string',
      ) ||
      totals.length !== 1 ||
      selectedCounts.length !== (model.selectedCountRequired ? 1 : 0) ||
      totals.length + selectedCounts.length !== s.counts.length ||
      Number(totals[0]?.rawText.match(/\d+/u)?.[0]) !==
        table.windows[index].reportedTotal
    )
      pending('TDMS_EFREQUEST_RELATED_COUNT_UNPROVEN');
    const loading = s.loading;
    if (
      !loading ||
      loading.active !== false ||
      !['utilitySlots', 'masks', 'stopButtons', 'busyNodes'].every((k) =>
        queryList(loading[k]),
      )
    )
      reject();
    const slots = REVIEWED_EFREQUEST_RELATED_MODEL.grids.find(
      (g) => g.gridId === model.gridId,
    ).utilityIds;
    if (
      loading.utilitySlots.length !== slots.length ||
      loading.utilitySlots.some(
        (n, i) =>
          !queryNode(n.node) ||
          n.node.id !== slots[i] ||
          n.node.tag !== 'DIV' ||
          !queryTokens(n.node.rawClassName).includes('xtb-text') ||
          !queryNumber(n.childElementCount) ||
          (n.node.visible && (n.childElementCount !== 0 || n.rawText !== '')),
      ) ||
      [...loading.masks, ...loading.stopButtons, ...loading.busyNodes].some(
        (n) => !queryNode(n) || n.visible,
      )
    )
      pending('TDMS_EFREQUEST_RELATED_LOADING_UNSETTLED');
    if (s.permissionMarkers.some((n) => !queryNode(n) || n.visible))
      pending('TDMS_EFREQUEST_RELATED_PERMISSION_UNVERIFIED');
    // This version certifies only a single fully observed native-view window.
    // A pager, tree, virtual prefix or unvisited end remains explicit, even if a
    // caption is present. Generic contract terminal/trueZero stay unconfirmed.
    if (multi) continue;
    const window = table.windows[index],
      visibleRows = s.rowShapes.filter((r) => r.node.visible),
      total = table.reportedTotal;
    if (
      proof.windows.length !== 1 ||
      !queryNumber(total) ||
      s.rowShapes.length !== visibleRows.length ||
      visibleRows.length !== total ||
      table.rows.length !== total ||
      queryCanonical(visibleRows.map((r) => r.occurrenceId)) !==
        queryCanonical(table.rows.map((r) => r.occurrenceId)) ||
      !queryList(window.globalIndices) ||
      window.globalIndices.length !== total ||
      new Set(window.globalIndices).size !== total ||
      window.globalIndices.some((n, i) => n !== i) ||
      window.treePending !== 0 ||
      s.pagers.length ||
      s.treeNodes.length ||
      s.scrollers.length !== 1 ||
      s.scrollers.some(
        (n) =>
          !queryNode(n.node) ||
          !n.node.visible ||
          n.viewport <= 0 ||
          n.top < 0 ||
          n.height < n.viewport ||
          n.top + n.viewport < n.height - 1,
      ) ||
      !window.scroll ||
      window.scroll.atBottom !== true ||
      (total === 0 && window.scroll.atTop !== true)
    )
      endReason ||= 'TDMS_EFREQUEST_RELATED_VIEW_END_UNPROVEN';
  }
  if (
    multi &&
    (table.relatedSurfaceEvidence?.stopReason ===
      'TDMS_EFREQUEST_RELATED_PAGE_OCCURRENCE_UNPROVEN' ||
      efRelatedPageOccurrenceUnproven(table))
  )
    endReason = 'TDMS_EFREQUEST_RELATED_PAGE_OCCURRENCE_UNPROVEN';
  else if (multi && !efRelatedCurrentViewWindowsComplete(proof, table))
    endReason = 'TDMS_EFREQUEST_RELATED_VIEW_END_UNPROVEN';
  const queryKnown = reason === null,
    currentViewInventoryComplete = queryKnown && endReason === null;
  return {
    complete: false,
    queryKnown,
    currentViewInventoryComplete,
    contractScopeCoverage: 'UNKNOWN',
    reasonCode:
      reason || endReason || 'TDMS_EFREQUEST_RELATED_CONTRACT_SCOPE_UNPROVEN',
  };
}

function efNumberTarget(rawHref) {
  let url;
  try {
    url = new URL(rawHref, 'http://tdms.airchina.com/Windchill/');
  } catch {
    return null;
  }
  if (
    url.origin !== 'http://tdms.airchina.com' ||
    url.username ||
    url.password ||
    !(
      url.pathname.endsWith('/tcomp/infoPage') ||
      /^#ptc\d+\/tcomp\/infoPage(?:\?|$)/u.test(url.hash)
    )
  )
    return null;
  const fragment = new URLSearchParams(url.hash.split('?')[1] || '');
  if (
    [...url.searchParams.keys(), ...fragment.keys()].some((k) =>
      /token|auth|sig|session|ticket/iu.test(k),
    )
  )
    return null;
  const values = [...url.searchParams.getAll('oid'), ...fragment.getAll('oid')];
  return values.length === 1 ? values[0] : null;
}
// A collection obligation is independent of the native relation's unknown
// role/direction and does not assert current membership or table completeness.
export function reviewedEfRequestRequiredTargetPurpose({
  scopeId,
  owner,
  table,
  row,
  link,
} = {}) {
  const model = isReviewedEfRequestOwner({ scopeId, owner })
    ? REVIEWED_EFREQUEST_RELATED_MODEL.grids.find(
        (g) => g.gridId === table?.gridId,
      )
    : null;
  if (!model || table.relatedSurfaceEvidence === undefined) return null;
  validateReviewedEfRequestRelatedSurfaceEvidence(
    table.relatedSurfaceEvidence,
    { scopeId, owner, table },
  );
  const numberIndex = model.columns.findIndex(
    (c) => c.nativeColumnToken === 'number',
  );
  if (
    table.tableId !== model.gridId ||
    !table.rows.includes(row) ||
    !row.sourceLinks.includes(link) ||
    link.nativeRole !== 'NUMBER_LINK' ||
    link.nativeColumnLabel !== 'Number' ||
    link.nativeColumnToken !== 'number' ||
    row.cells[numberIndex]?.state !== 'VALUE' ||
    !link.numberRaw ||
    efNumberTarget(link.rawHref) !== link.targetRef
  )
    return null;
  return {
    kind: 'REQUIRED_TARGET_OWN_SOURCE',
    modelRevision: REVIEWED_EFREQUEST_RELATED_MODEL.modelRevision,
    scopeId,
    gridId: model.gridId,
  };
}
export function isReviewedEfRequestRequiredTargetOccurrence(occurrence) {
  const m = REVIEWED_EFREQUEST_RELATED_MODEL,
    p = occurrence?.collectionPurpose;
  return (
    exactKeys(p, ['kind', 'modelRevision', 'scopeId', 'gridId']) &&
    p.kind === 'REQUIRED_TARGET_OWN_SOURCE' &&
    p.modelRevision === m.modelRevision &&
    p.scopeId === m.scopeId &&
    m.grids.some((g) => g.gridId === p.gridId) &&
    occurrence.tableId === p.gridId &&
    occurrence.relationshipRole === 'UNKNOWN' &&
    occurrence.direction === 'UNKNOWN' &&
    occurrence.modelRoleOrigin ===
      'REVIEWED_EF_REQUIRED_TARGET_COLLECTION_PURPOSE' &&
    occurrence.nativeLinkRole === 'NUMBER_LINK' &&
    occurrence.nativeColumnLabel === 'Number' &&
    occurrence.nativeColumnToken === 'number' &&
    typeof occurrence.numberRaw === 'string' &&
    !!occurrence.numberRaw &&
    typeof occurrence.locator === 'string' &&
    !!occurrence.locator &&
    efNumberTarget(occurrence.rawHref) === occurrence.targetRef
  );
}
export const isRequiredTargetOccurrence = (occurrence) =>
  occurrence?.relationshipRole === 'CURRENT_CONTENT' ||
  isReviewedEfRequestRequiredTargetOccurrence(occurrence);
// Optional in historical observations. Missing/unknown proof never upgrades
// a new complete facet; the current raw JSON is model input, not an ACK.
export function validateReviewedEfRequestQueryEvidence(
  proof,
  { scopeId, owner, table } = {},
) {
  const m = REVIEWED_EFREQUEST_QUERY_MODEL;
  const model = m.grids.find((grid) => grid.gridId === table?.gridId);
  if (proof === undefined)
    return isReviewedEfRequestOwner({ scopeId, owner }) && model
      ? { complete: false, reasonCode: 'TDMS_EFREQUEST_QUERY_PROOF_MISSING' }
      : null;
  const reject = () => queryFail('TDMS_EFREQUEST_QUERY_PROOF_INVALID');
  if (
    !isReviewedEfRequestOwner({ scopeId, owner }) ||
    !model ||
    !exactKeys(proof, [
      'schemaVersion',
      'modelRevision',
      'scopeId',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerSourceModifiedRaw',
      'nativeTypeId',
      'tabId',
      'panelLocator',
      'gridId',
      'windows',
    ]) ||
    proof.schemaVersion !== m.schemaVersion ||
    proof.modelRevision !== m.modelRevision ||
    proof.scopeId !== scopeId ||
    proof.ownerSourceRecordId !== owner.sourceRecordId ||
    proof.nativeTypeId !== owner.nativeTypeId ||
    proof.ownerSourceModifiedRaw !== owner.sourceModifiedRaw ||
    queryCanonical(proof.ownerSourceVersion) !==
      queryCanonical(owner.sourceVersion) ||
    proof.tabId !== model.tabId ||
    proof.panelLocator !== model.panelLocator ||
    proof.gridId !== model.gridId ||
    table.tabId !== model.tabId ||
    table.panelLocator !== model.panelLocator ||
    !queryList(proof.windows) ||
    !queryList(table.windows) ||
    proof.windows.length !== table.windows.length ||
    !proof.windows.length
  )
    reject();
  let reason = null;
  const pending = (code) => {
    reason ||= code;
  };
  for (const [index, pair] of proof.windows.entries()) {
    if (
      !exactKeys(pair, ['windowOrdinal', 'before', 'after', 'settledReads']) ||
      pair.windowOrdinal !== index ||
      pair.settledReads !== 2 ||
      queryCanonical(pair.before) !== queryCanonical(pair.after)
    )
      queryFail('TDMS_EFREQUEST_QUERY_OR_STRUCTURE_CHANGED');
    const frame = pair.after;
    if (
      !exactKeys(frame, [
        'activeTabId',
        'panelId',
        'panelVisible',
        'gridVisible',
        'search',
        'selectedOnly',
        'additionalControls',
        'counts',
        'loading',
        'structure',
        'permissionMarkers',
      ]) ||
      frame.activeTabId !== model.tabId ||
      frame.panelId !== model.panelLocator.slice(1) ||
      typeof frame.panelVisible !== 'boolean' ||
      typeof frame.gridVisible !== 'boolean'
    )
      reject();
    if (!frame.panelVisible || !frame.gridVisible)
      pending('TDMS_EFREQUEST_QUERY_SURFACE_UNREAD');
    const search = frame.search;
    if (
      !exactKeys(search, [
        'id',
        'tag',
        'type',
        'name',
        'rawClassName',
        'rawValue',
        'visible',
        'disabled',
        'normalization',
      ]) ||
      search.id !== model.searchId ||
      !(search.tag === null || search.tag === 'INPUT') ||
      !(search.type === null || ['text', 'search'].includes(search.type)) ||
      !(search.name === null || search.name === model.searchId) ||
      !(
        search.rawClassName === null || typeof search.rawClassName === 'string'
      ) ||
      !(
        search.rawValue === null ||
        (typeof search.rawValue === 'string' && search.rawValue.length <= 1000)
      ) ||
      typeof search.visible !== 'boolean' ||
      typeof search.disabled !== 'boolean'
    )
      reject();
    const classes = queryTokens(search.rawClassName),
      normalization =
        search.tag !== 'INPUT' || !search.visible || search.rawValue === null
          ? 'UNKNOWN'
          : search.rawValue === m.searchPlaceholder &&
              classes.includes('x-form-empty-field')
            ? 'EMPTY_NATIVE_PLACEHOLDER'
            : search.rawValue === ''
              ? 'EMPTY_LITERAL'
              : 'FILTERED';
    if (search.normalization !== normalization) reject();
    if (normalization !== 'EMPTY_NATIVE_PLACEHOLDER')
      pending(
        normalization === 'FILTERED'
          ? 'TDMS_EFREQUEST_QUERY_FILTERED'
          : 'TDMS_EFREQUEST_QUERY_CONTROL_UNREAD',
      );
    if (search.disabled) pending('TDMS_EFREQUEST_QUERY_CONTROL_UNREAD');
    if (
      search.tag === 'INPUT' &&
      (!classes.includes('x-form-text') || !classes.includes('x-form-field'))
    )
      pending('TDMS_EFREQUEST_QUERY_CONTROL_UNREVIEWED');
    const selected = frame.selectedOnly;
    if (
      !exactKeys(selected, [
        'state',
        'control',
        'button',
        'popup',
        'item',
        'parentLi',
        'checkItemIds',
        'sequence',
      ]) ||
      !['VALUE', 'NOT_APPLICABLE', 'UNKNOWN'].includes(selected.state) ||
      !queryList(selected.checkItemIds) ||
      !queryList(selected.sequence)
    )
      reject();
    if (selected.state !== 'VALUE') {
      if (
        [
          selected.control,
          selected.button,
          selected.popup,
          selected.item,
          selected.parentLi,
        ].some((x) => x !== null) ||
        selected.checkItemIds.length ||
        selected.sequence.length
      )
        reject();
      if (selected.state !== 'NOT_APPLICABLE' || model.selectedOnlyRequired)
        pending('TDMS_EFREQUEST_SELECTED_ONLY_UNREAD');
    } else {
      if (
        !model.selectedOnlyRequired ||
        !queryNode(selected.control) ||
        selected.control.id !== model.selectedOnlyControlId ||
        selected.control.tag !== 'TABLE' ||
        !queryNode(selected.button) ||
        selected.button.tag !== 'BUTTON' ||
        !queryTokens(selected.button.rawClassName).includes('optionsButton') ||
        !queryNode(selected.popup) ||
        selected.popup.tag !== 'DIV' ||
        !queryTokens(selected.popup.rawClassName).includes('x-menu') ||
        !exactKeys(selected.item, [
          'id',
          'tag',
          'rawClassName',
          'visible',
          'rawText',
        ]) ||
        !queryNode(
          Object.fromEntries(
            Object.entries(selected.item).filter(([key]) => key !== 'rawText'),
          ),
        ) ||
        selected.item.id !== model.selectedOnlyItemId ||
        selected.item.tag !== 'A' ||
        selected.item.rawText !== 'View Selected Objects Only' ||
        !queryNode(selected.parentLi) ||
        selected.parentLi.id !== 'x-menu-el-' + model.selectedOnlyItemId ||
        selected.parentLi.tag !== 'LI'
      )
        reject();
      if (
        ![
          selected.control,
          selected.button,
          selected.popup,
          selected.item,
          selected.parentLi,
        ].every((node) => node.visible) ||
        queryCanonical(selected.sequence) !==
          queryCanonical(['BUTTON_OPENED', 'ITEM_READ', 'BUTTON_CLOSED']) ||
        queryCanonical(selected.checkItemIds) !==
          queryCanonical([model.selectedOnlyItemId])
      )
        pending('TDMS_EFREQUEST_SELECTED_ONLY_UNREAD');
      const itemClasses = queryTokens(selected.item.rawClassName),
        liClasses = queryTokens(selected.parentLi.rawClassName);
      if (
        !itemClasses.includes('x-menu-item') ||
        !itemClasses.includes('x-menu-check-item') ||
        !liClasses.includes('x-menu-list-item')
      )
        reject();
      if (
        [...itemClasses, ...liClasses].some((token) => /checked/iu.test(token))
      )
        pending('TDMS_EFREQUEST_QUERY_FILTERED');
    }
    if (
      !queryList(frame.additionalControls) ||
      frame.additionalControls.some((node) => !queryNode(node)) ||
      !queryList(frame.permissionMarkers) ||
      frame.permissionMarkers.some((node) => !queryNode(node))
    )
      reject();
    if (frame.additionalControls.length)
      pending('TDMS_EFREQUEST_QUERY_CONTROL_UNREVIEWED');
    if (frame.permissionMarkers.some((node) => node.visible))
      pending('TDMS_EFREQUEST_PERMISSION_UNVERIFIED');
    if (
      !queryList(frame.counts) ||
      frame.counts.some(
        (node) =>
          !exactKeys(node, ['tag', 'rawClassName', 'rawText', 'visible']) ||
          node.tag !== 'SPAN' ||
          !queryTokens(node.rawClassName).includes('tableCount') ||
          typeof node.rawText !== 'string' ||
          typeof node.visible !== 'boolean',
      )
    )
      reject();
    const total = frame.counts.filter(
      (node) =>
        node.visible && /^\(\s*\d+\s+objects?\s*\)$/iu.test(node.rawText),
    );
    const selection = frame.counts.filter(
      (node) =>
        node.visible &&
        /^\(\s*\d+\s+objects?\s+selected\s*\)$/iu.test(node.rawText),
    );
    if (
      total.length !== 1 ||
      selection.length !== (model.selectedOnlyRequired ? 1 : 0) ||
      total.length + selection.length !== frame.counts.length ||
      Number(total[0]?.rawText.match(/\d+/u)?.[0]) !==
        table.windows[index].reportedTotal
    )
      pending('TDMS_EFREQUEST_NATIVE_COUNT_UNPROVEN');
    const loading = frame.loading;
    if (
      !exactKeys(loading, [
        'utilitySlots',
        'masks',
        'stopButtons',
        'busyNodes',
      ]) ||
      !queryList(loading.utilitySlots) ||
      !queryList(loading.masks) ||
      !queryList(loading.stopButtons) ||
      !queryList(loading.busyNodes) ||
      loading.masks.some((node) => !queryNode(node)) ||
      loading.stopButtons.some((node) => !queryNode(node)) ||
      loading.busyNodes.some((node) => !queryNode(node))
    )
      reject();
    if (loading.utilitySlots.length !== model.utilityIds.length)
      pending('TDMS_EFREQUEST_LOADING_UNSETTLED');
    for (const [slotIndex, slot] of loading.utilitySlots.entries()) {
      if (
        !exactKeys(slot, [
          'id',
          'tag',
          'rawClassName',
          'visible',
          'childElementCount',
          'rawText',
        ]) ||
        !queryNode(
          Object.fromEntries(
            Object.entries(slot).filter(
              ([key]) => !['childElementCount', 'rawText'].includes(key),
            ),
          ),
        ) ||
        !queryNumber(slot.childElementCount) ||
        !(slot.rawText === null || typeof slot.rawText === 'string')
      )
        reject();
      if (
        slot.id !== model.utilityIds[slotIndex] ||
        slot.tag !== 'DIV' ||
        !queryTokens(slot.rawClassName).includes('xtb-text') ||
        slot.childElementCount !== 0 ||
        slot.rawText !== ''
      )
        pending('TDMS_EFREQUEST_LOADING_UNSETTLED');
    }
    if (
      [...loading.masks, ...loading.stopButtons, ...loading.busyNodes].some(
        (node) => node.visible,
      )
    )
      pending('TDMS_EFREQUEST_LOADING_UNSETTLED');
    const structure = frame.structure;
    if (
      !exactKeys(structure, [
        'rows',
        'hiddenRows',
        'pagers',
        'treeNodes',
        'scrollers',
      ]) ||
      !queryList(structure.rows) ||
      !queryNumber(structure.hiddenRows) ||
      !queryList(structure.pagers) ||
      !queryList(structure.treeNodes) ||
      !queryList(structure.scrollers) ||
      [...structure.rows, ...structure.pagers, ...structure.treeNodes].some(
        (node) => !queryNode(node),
      ) ||
      structure.hiddenRows !==
        structure.rows.filter((node) => !node.visible).length
    )
      reject();
    for (const scroller of structure.scrollers)
      if (
        !exactKeys(scroller, [
          'id',
          'tag',
          'rawClassName',
          'visible',
          'top',
          'height',
          'viewport',
        ]) ||
        !queryNode(
          Object.fromEntries(
            Object.entries(scroller).filter(
              ([key]) => !['top', 'height', 'viewport'].includes(key),
            ),
          ),
        ) ||
        !['top', 'height', 'viewport'].every(
          (key) => Number.isFinite(scroller[key]) && scroller[key] >= 0,
        )
      )
        reject();
    if (
      table.reportedTotal === 0 &&
      (structure.rows.length ||
        structure.hiddenRows ||
        structure.pagers.length ||
        structure.treeNodes.length ||
        structure.scrollers.length !== 1 ||
        structure.scrollers.some(
          (node) =>
            !node.visible ||
            node.top !== 0 ||
            node.viewport <= 0 ||
            node.height !== node.viewport,
        ))
    )
      pending('TDMS_EFREQUEST_NATIVE_ZERO_END_UNPROVEN');
  }
  return { complete: reason === null, reasonCode: reason };
}
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
    if (scopeId === 'AD_HANDLING_FORM' && tab.purposeEvidence !== undefined) {
      validateReviewedAdHandlingSurfaceEvidence(tab.purposeEvidence, {
        scopeId,
        owner,
        tab,
        read,
      });
      continue;
    }
    if (isReviewedEfStructureTab({ scopeId, owner, tab })) {
      const structurePurpose = validateReviewedEfStructurePurposeEvidence(
        tab.purposeEvidence,
        {
          scopeId,
          owner,
          tab,
          read,
        },
      );
      if (
        !structurePurpose?.complete &&
        (tab.required !== true ||
          tab.state !== 'NOT_READ' ||
          tab.reasonCode !== 'TDMS_COMPLETE_EF_STRUCTURE_END_UNPROVEN')
      )
        rejectPurpose();
      if (
        structurePurpose?.complete &&
        (tab.required !== true || tab.state !== 'VALUE' || tab.reasonCode !== null)
      )
        rejectPurpose();
      continue;
    }
    const alias = reviewedEfRequestAliasModel({ scopeId, owner, tab });
    if (alias) {
      const purpose = validateReviewedEfRequestTabPurposeEvidence(
        tab.purposeEvidence,
        { scopeId, owner, tab, read },
      );
      if (!purpose.complete) {
        if (tab.required !== true || tab.reasonCode === alias.reasonCode)
          rejectPurpose();
        continue;
      }
      if (
        tab.required !== false ||
        tab.state !== 'NOT_READ' ||
        tab.reasonCode !== alias.reasonCode
      )
        rejectPurpose();
      excluded++;
      continue;
    }
    if (tab.purposeEvidence !== undefined) rejectPurpose();
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
    if (
      ![
        model.panelLocator + ' [id="' + model.gridId + '"] span.tableCount',
        // Previously admitted source selector; keep its same panel/grid binding.
        model.panelLocator + ' #' + model.gridId + ' .tableCount',
      ].includes(table.countEvidence?.locator)
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
  for (const model of REVIEWED_EFREQUEST_RELATED_MODEL.grids) {
    const found = read.relationTables.filter((t) => t.gridId === model.gridId);
    if (found.length > 1) rejectGrid();
    if (!found.length) {
      complete = false;
      continue;
    }
    validateReviewedEfRequestRelatedSurfaceEvidence(
      found[0].relatedSurfaceEvidence,
      { scopeId, owner, table: found[0] },
    );
  }
  return complete;
}
// Optional-for-old paired observations. A present pair is meaningful only for
// the exact reviewed EFRequest owner and this native non-content control.
export function validateReviewedCompleteTabRoster({
  scopeId,
  owner,
  rosterEvidence,
  contentTabIds,
} = {}) {
  const hasStrip = own(rosterEvidence, 'nativeTabStripIds'),
    hasControls = own(rosterEvidence, 'nonContentControls');
  if (!hasStrip && !hasControls) return false;
  if (
    !hasStrip ||
    !hasControls ||
    !(
      isReviewedEfRequestOwner({ scopeId, owner }) ||
      isReviewedAdItemOwner({ scopeId, owner }) ||
      isReviewedAdHandlingOwner({ scopeId, owner })
    )
  )
    reject();
  const strip = rosterEvidence.nativeTabStripIds,
    controls = rosterEvidence.nonContentControls;
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
  const c = controls[0],
    m =
      scopeId === 'AD_HANDLING_FORM'
        ? REVIEWED_AD_HANDLING_NATIVE_MODEL
        : scopeId === 'AD_ITEM'
          ? REVIEWED_AD_ITEM_NATIVE_MODEL
          : REVIEWED_EFREQUEST_NATIVE_MODEL,
    a = m.nonContentControl;
  const handling = scopeId === 'AD_HANDLING_FORM';
  if (handling) {
    if (
      !exactKeys(c, [
        'actionId',
        'tag',
        'rawClassName',
        'rawClassEvidenceState',
        'rawCaption',
        'tagQuery',
        'locator',
        'rootLocator',
        'semantic',
        'modelRevision',
      ]) ||
      c.actionId !== a.actionId ||
      c.tag !== a.tag ||
      c.rawClassName !== null ||
      c.rawClassEvidenceState !== 'NOT_READ' ||
      c.tagQuery !== a.tagQuery ||
      c.rawCaption !== a.rawCaption ||
      c.locator !== '#' + a.actionId ||
      c.rootLocator !== m.rootLocator ||
      c.semantic !== a.semantic ||
      c.modelRevision !== m.modelRevision
    )
      reject();
  }
  if (
    !handling &&
    (!exactKeys(c, [
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
      c.modelRevision !== m.modelRevision)
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
