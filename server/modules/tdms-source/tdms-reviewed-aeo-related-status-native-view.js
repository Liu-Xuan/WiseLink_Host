// Source status-notice SHA f0617e4b: pure native-view model, never execution authority.
import { tdmsError } from './tdms-source.types';
// Reviewed AEO native metadata shape. This model gives current-parent meaning
// only after normal own, per-window query and complete row/end bindings.
export const REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-related-status-source-view.v2',
  kind: 'AEO_OWNER_BOUND_IMPLICIT_NATIVE_TABLE',
  modelRevision: 'tdms-reviewed-aeo-related-status-implicit-native-view@1',
  meaning:
    'OWNER_BOUND_IMPLICIT_CURRENT_AEO_APPLICABLE_STATUSLINK_SURFACE_WITH_NO_ACTIVE_NATIVE_TABLE_SEARCH',
  sourceScopeIds: ['AEO'],
  nativeTypeId:
    'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
  nativeHeaderType: 'Publication Source',
  engineeringSubtype: 'AEO',
  rawTypeField: 'EO整体',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_object_latestStatusLink',
  panelLocator: '#infoPage_myTab_object_latestStatusLink',
  gridId: 'relatedStatusLinkTable',
  evidenceLocator:
    '#infoPage_myTab_object_latestStatusLink #relatedStatusLinkTable',
  semanticAuthority: {
    ruleId: 'AEO_CURRENT_APPLICABILITY_WITH_EQUIVALENT_PRIOR_EXECUTION_BASIS',
    evidenceRef: 'TDMS_EF_AND_AEO_USER_BUSINESS_RULE_UPDATE_ROOT_20261014.json',
    evidenceSha256:
      '8493f8df492525620ba503e4f3ae6cee9519955fdb8e4d5ab1072ddbd78e08ea',
  },
  nativeInputPins: [
    {
      file: 'all-attributes-own-input.json',
      sha256:
        '7a9493ff0d24d1652e4e5b091bc04c57d69278fadeb9101e80d26605a5e413b1',
    },
    {
      file: 'initial-control-window.json',
      sha256:
        '04d931e4fa5eb4d373f2f5ee5c76dc786146d60ed89384b72588f6ce2f7003d7',
    },
    {
      file: 'own-version-before.json',
      sha256:
        '54a46b2f01cbbc13a4e14645fafffa3469e2f6429f9f3f41e0e7412e40096de6',
    },
    {
      file: 'own-version-bound-input.json',
      sha256:
        '5e8b322c23f0086cb22270327a7fe08183a6c5f00c97b946f7fc036724b9d221',
    },
    {
      file: 'top-control-detail.json',
      sha256:
        '5a32f6a8dc97f7c9414108a3dab1d33bb5dab25781d64fa9f223e741eb60d5ab',
    },
  ],
  columns: [
    { actualLabel: 'Object Type Indicator', nativeColumnToken: 'type_icon' },
    { actualLabel: 'Number', nativeColumnToken: 'number' },
    { actualLabel: 'Feed Back Order', nativeColumnToken: 'feedbackOid' },
    { actualLabel: 'Updator', nativeColumnToken: 'executeor' },
    { actualLabel: 'Execute Time', nativeColumnToken: 'executeDate' },
    { actualLabel: 'Document Number', nativeColumnToken: 'docOid' },
    { actualLabel: 'AC/ENG/APU', nativeColumnToken: 'standaloneOid' },
    { actualLabel: 'Status', nativeColumnToken: 'state' },
    { actualLabel: 'State Comments', nativeColumnToken: 'stateComments' },
    {
      actualLabel: 'Standalone expired date',
      nativeColumnToken: 'danjiexpireDate',
    },
    { actualLabel: 'Delay Request', nativeColumnToken: 'delayRequest' },
    { actualLabel: 'SUBS', nativeColumnToken: 'subs' },
    { actualLabel: 'SUBSED', nativeColumnToken: 'subsBy' },
    { actualLabel: 'EQUAL', nativeColumnToken: 'equiv' },
    { actualLabel: 'EQUALED', nativeColumnToken: 'equivBy' },
    { actualLabel: 'Modify Date', nativeColumnToken: 'modifyDate' },
    { actualLabel: 'OperatorBase', nativeColumnToken: 'OperatorBase' },
  ],
  toolbarRosters: [
    {
      role: 'TITLE',
      root: {
        tag: 'DIV',
        attributes: {
          id: 'relatedStatusLinkTable.titleBar',
          class: 'x-toolbar x-small-editor x-toolbar-layout-ct',
          style: 'width: auto;',
        },
        childCount: 1,
        visible: true,
      },
      nodes: [
        {
          parentIndex: -1,
          tag: 'TABLE',
          attributes: { cellspacing: '0', class: 'x-toolbar-ct' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 0,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 1,
          tag: 'TR',
          attributes: {},
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 2,
          tag: 'TD',
          attributes: { class: 'x-toolbar-left', align: 'left' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 3,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 4,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 5,
          tag: 'TR',
          attributes: { class: 'x-toolbar-left-row' },
          childCount: 4,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 6,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 7,
          tag: 'TABLE',
          attributes: {
            id: 'relatedStatusLinkTable_toggle',
            cellspacing: '0',
            class: 'x-btn tableToggle x-btn-icon',
          },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 8,
          tag: 'TBODY',
          attributes: { class: 'x-btn-small x-btn-icon-small-left' },
          childCount: 3,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 9,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 10,
          tag: 'TD',
          attributes: { class: 'x-btn-tl' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 11,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 10,
          tag: 'TD',
          attributes: { class: 'x-btn-tc' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 10,
          tag: 'TD',
          attributes: { class: 'x-btn-tr' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 14,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 9,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 16,
          tag: 'TD',
          attributes: { class: 'x-btn-ml' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 17,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 16,
          tag: 'TD',
          attributes: { class: 'x-btn-mc' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 19,
          tag: 'EM',
          attributes: { class: '', unselectable: 'on' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 20,
          tag: 'BUTTON',
          attributes: {
            type: 'button',
            id: '%EXT_GEN%',
            class: ' x-btn-text expandCollapse_collapsed',
          },
          childCount: 0,
          visible: true,
          disabled: false,
        },
        {
          parentIndex: 16,
          tag: 'TD',
          attributes: { class: 'x-btn-mr' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 22,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 9,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 24,
          tag: 'TD',
          attributes: { class: 'x-btn-bl' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 25,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 24,
          tag: 'TD',
          attributes: { class: 'x-btn-bc' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 24,
          tag: 'TD',
          attributes: { class: 'x-btn-br' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 28,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 6,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 30,
          tag: 'DIV',
          attributes: { class: 'xtb-text', id: '%EXT_COMP%' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 6,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 32,
          tag: 'DIV',
          attributes: {
            class: 'xtb-text x-masked-relative x-masked',
            id: 'header_relatedStatusLinkTable_titleBarMask',
            style: 'height: 15px; width: 0px; visibility: hidden;',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 33,
          tag: 'DIV',
          attributes: {
            class: 'ext-el-mask-msg titleBarMask',
            id: '%EXT_GEN%',
            style: 'left: 1px; top: 0px;',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 34,
          tag: 'DIV',
          attributes: { class: 'titleBarkMaskMsg' },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 6,
          tag: 'TD',
          attributes: {
            class: 'x-toolbar-cell x-hide-display',
            id: '%EXT_GEN%',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 36,
          tag: 'TABLE',
          attributes: {
            id: 'header_relatedStatusLinkTable_cancelDataSourceButton',
            cellspacing: '0',
            class: 'x-btn cancelButton x-btn-icon',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 37,
          tag: 'TBODY',
          attributes: { class: 'x-btn-small x-btn-icon-small-left' },
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 38,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 39,
          tag: 'TD',
          attributes: { class: 'x-btn-tl' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 40,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 39,
          tag: 'TD',
          attributes: { class: 'x-btn-tc' },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 39,
          tag: 'TD',
          attributes: { class: 'x-btn-tr' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 43,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 38,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 45,
          tag: 'TD',
          attributes: { class: 'x-btn-ml' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 46,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 45,
          tag: 'TD',
          attributes: { class: 'x-btn-mc' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 48,
          tag: 'EM',
          attributes: { class: '', unselectable: 'on' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 49,
          tag: 'BUTTON',
          attributes: {
            type: 'button',
            id: '%EXT_GEN%',
            style: 'background-image: url("netmarkets/images/load_stop.png");',
            class: ' x-btn-text',
          },
          childCount: 0,
          visible: false,
          disabled: false,
        },
        {
          parentIndex: 45,
          tag: 'TD',
          attributes: { class: 'x-btn-mr' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 51,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 38,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 53,
          tag: 'TD',
          attributes: { class: 'x-btn-bl' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 54,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 53,
          tag: 'TD',
          attributes: { class: 'x-btn-bc' },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 53,
          tag: 'TD',
          attributes: { class: 'x-btn-br' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 57,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 2,
          tag: 'TD',
          attributes: { class: 'x-toolbar-right', align: 'right' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 59,
          tag: 'TABLE',
          attributes: { cellspacing: '0', class: 'x-toolbar-right-ct' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 60,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 61,
          tag: 'TR',
          attributes: {},
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 62,
          tag: 'TD',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 63,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 64,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 65,
          tag: 'TR',
          attributes: { class: 'x-toolbar-right-row' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 66,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 67,
          tag: 'DIV',
          attributes: { class: 'xtb-text', id: '%EXT_COMP%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 68,
          tag: 'SPAN',
          attributes: { class: 'tableCount' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 62,
          tag: 'TD',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 70,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 71,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 72,
          tag: 'TR',
          attributes: { class: 'x-toolbar-extras-row' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
      ],
    },
    {
      role: 'SEARCH',
      root: {
        tag: 'DIV',
        attributes: {
          id: 'relatedStatusLinkTable.toolBar',
          class: 'x-toolbar x-small-editor ecaToolbar x-toolbar-layout-ct',
          style: 'width: auto;',
        },
        childCount: 1,
        visible: true,
      },
      nodes: [
        {
          parentIndex: -1,
          tag: 'TABLE',
          attributes: { cellspacing: '0', class: 'x-toolbar-ct' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 0,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 1,
          tag: 'TR',
          attributes: {},
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 2,
          tag: 'TD',
          attributes: { class: 'x-toolbar-left', align: 'left' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 3,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 4,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 5,
          tag: 'TR',
          attributes: { class: 'x-toolbar-left-row' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 2,
          tag: 'TD',
          attributes: { class: 'x-toolbar-right', align: 'right' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 7,
          tag: 'TABLE',
          attributes: { cellspacing: '0', class: 'x-toolbar-right-ct' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 8,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 9,
          tag: 'TR',
          attributes: {},
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 10,
          tag: 'TD',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 11,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 12,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 13,
          tag: 'TR',
          attributes: { class: 'x-toolbar-right-row' },
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 14,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 15,
          tag: 'DIV',
          attributes: {
            class: 'xtb-text',
            id: 'relatedStatusLinkTable.searchInListLoadingWheel',
            style: 'width: 28px; height: 15px;',
          },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 14,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 17,
          tag: 'DIV',
          attributes: {
            class: 'x-form-field-wrap x-form-field-trigger-wrap',
            id: '%EXT_GEN%',
            style: 'width: 119px;',
          },
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 18,
          tag: 'INPUT',
          attributes: {
            type: 'text',
            size: '16',
            autocomplete: 'off',
            id: 'relatedStatusLinkTable.searchInListTextBox',
            name: 'relatedStatusLinkTable.searchInListTextBox',
            class: 'x-form-text x-form-field x-form-empty-field',
            style: 'width: 94px;',
          },
          childCount: 0,
          visible: true,
          disabled: false,
        },
        {
          parentIndex: 18,
          tag: 'SPAN',
          attributes: { class: 'x-form-twin-triggers', id: '%EXT_GEN%' },
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 20,
          tag: 'IMG',
          attributes: {
            src: 'netmarkets/images/sp.gif',
            class: 'x-form-trigger x-form-clear-trigger',
            id: '%EXT_GEN%',
            style: 'display: none;',
          },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 20,
          tag: 'IMG',
          attributes: {
            src: 'netmarkets/images/sp.gif',
            class: 'x-form-trigger x-form-search-trigger',
            id: '%EXT_GEN%',
          },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 10,
          tag: 'TD',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 23,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 24,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 25,
          tag: 'TR',
          attributes: { class: 'x-toolbar-extras-row' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
      ],
    },
    {
      role: 'FOOTER',
      root: {
        tag: 'DIV',
        attributes: {
          id: '%EXT_COMP%',
          class: 'x-toolbar x-small-editor x-toolbar-layout-ct',
          style: 'width: auto;',
        },
        childCount: 1,
        visible: true,
      },
      nodes: [
        {
          parentIndex: -1,
          tag: 'TABLE',
          attributes: { cellspacing: '0', class: 'x-toolbar-ct' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 0,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 1,
          tag: 'TR',
          attributes: {},
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 2,
          tag: 'TD',
          attributes: { class: 'x-toolbar-left', align: 'left' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 3,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 4,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 5,
          tag: 'TR',
          attributes: { class: 'x-toolbar-left-row' },
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 6,
          tag: 'TD',
          attributes: { class: 'x-toolbar-cell', id: '%EXT_GEN%' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 7,
          tag: 'DIV',
          attributes: {
            class: 'xtb-text x-masked-relative x-masked',
            id: 'footer_relatedStatusLinkTable_titleBarMask',
            style: 'height: 15px; width: 0px; visibility: hidden;',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 8,
          tag: 'DIV',
          attributes: {
            class: 'ext-el-mask-msg titleBarMask',
            id: '%EXT_GEN%',
            style: 'left: 1px; top: 0px;',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 9,
          tag: 'DIV',
          attributes: { class: 'titleBarkMaskMsg' },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 6,
          tag: 'TD',
          attributes: {
            class: 'x-toolbar-cell x-hide-display',
            id: '%EXT_GEN%',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 11,
          tag: 'TABLE',
          attributes: {
            id: 'footer_relatedStatusLinkTable_cancelDataSourceButton',
            cellspacing: '0',
            class: 'x-btn cancelButton x-btn-icon',
          },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 12,
          tag: 'TBODY',
          attributes: { class: 'x-btn-small x-btn-icon-small-left' },
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 13,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 14,
          tag: 'TD',
          attributes: { class: 'x-btn-tl' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 15,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 14,
          tag: 'TD',
          attributes: { class: 'x-btn-tc' },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 14,
          tag: 'TD',
          attributes: { class: 'x-btn-tr' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 18,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 13,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 20,
          tag: 'TD',
          attributes: { class: 'x-btn-ml' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 21,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 20,
          tag: 'TD',
          attributes: { class: 'x-btn-mc' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 23,
          tag: 'EM',
          attributes: { class: '', unselectable: 'on' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 24,
          tag: 'BUTTON',
          attributes: {
            type: 'button',
            id: '%EXT_GEN%',
            style: 'background-image: url("netmarkets/images/load_stop.png");',
            class: ' x-btn-text',
          },
          childCount: 0,
          visible: false,
          disabled: false,
        },
        {
          parentIndex: 20,
          tag: 'TD',
          attributes: { class: 'x-btn-mr' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 26,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 13,
          tag: 'TR',
          attributes: {},
          childCount: 3,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 28,
          tag: 'TD',
          attributes: { class: 'x-btn-bl' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 29,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 28,
          tag: 'TD',
          attributes: { class: 'x-btn-bc' },
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 28,
          tag: 'TD',
          attributes: { class: 'x-btn-br' },
          childCount: 1,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 32,
          tag: 'I',
          attributes: {},
          childCount: 0,
          visible: false,
          disabled: null,
        },
        {
          parentIndex: 2,
          tag: 'TD',
          attributes: { class: 'x-toolbar-right', align: 'right' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 34,
          tag: 'TABLE',
          attributes: { cellspacing: '0', class: 'x-toolbar-right-ct' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 35,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 36,
          tag: 'TR',
          attributes: {},
          childCount: 2,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 37,
          tag: 'TD',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 38,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 39,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 40,
          tag: 'TR',
          attributes: { class: 'x-toolbar-right-row' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 37,
          tag: 'TD',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 42,
          tag: 'TABLE',
          attributes: { cellspacing: '0' },
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 43,
          tag: 'TBODY',
          attributes: {},
          childCount: 1,
          visible: true,
          disabled: null,
        },
        {
          parentIndex: 44,
          tag: 'TR',
          attributes: { class: 'x-toolbar-extras-row' },
          childCount: 0,
          visible: true,
          disabled: null,
        },
      ],
    },
  ],
  hiddenParameterIds: [
    'rmRows_relatedStatusLinkTable',
    'noItemString_table__relatedStatusLinkTable_TABLE',
    'selectAllCheckBox_table__relatedStatusLinkTable_TABLE',
    'saveAsViewJavascriptUrl_table__relatedStatusLinkTable_TABLE',
  ],
  maxWindows: 200,
});

const aeoNativeStatusInvalid = () => {
  throw tdmsError('TDMS_COMPLETE_AEO_STATUS_NATIVE_VIEW_INVALID');
};
const aeoNativeStatusKeys = (value, names) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== names.length ||
    Object.keys(value).some((key) => !names.includes(key))
  )
    aeoNativeStatusInvalid();
};
const aeoNativeStatusTime = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));
const aeoNativeStatusText = (value, max = 700) =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
function aeoNativeStatusStable(value) {
  if (Array.isArray(value))
    return '[' + value.map(aeoNativeStatusStable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .filter((key) => key !== 'observedAt')
        .map(
          (key) =>
            JSON.stringify(key) + ':' + aeoNativeStatusStable(value[key]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const aeoNativeStatusSame = (a, b) =>
  aeoNativeStatusStable(a) === aeoNativeStatusStable(b);
export function isReviewedAeoImplicitStatusOwner(owner) {
  const model = REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL,
    technical = owner?.sourceVersion,
    business = owner?.businessVersion,
    evidence = owner?.businessVersionEvidence;
  return (
    /^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(
      owner?.sourceRecordId || '',
    ) &&
    owner.nativeTypeId === model.nativeTypeId &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === model.nativeTypeId &&
    owner.rawHeaderType === model.nativeHeaderType &&
    owner.scopeEvidence?.engineeringSubtype === model.engineeringSubtype &&
    owner.scopeEvidence.rawTypeField === model.rawTypeField &&
    technical?.confirmation === 'SOURCE_DECLARED' &&
    aeoNativeStatusText(technical.rawRevision, 200) &&
    /^\d{1,20}$/u.test(technical.rawIteration || '') &&
    owner.technicalVersionEvidence?.state === 'VALUE' &&
    owner.technicalVersionEvidence.rawValue ===
      technical.rawRevision + '.' + technical.rawIteration &&
    aeoNativeStatusText(owner.number, 500) &&
    typeof owner.rawHeaderIdentifier === 'string' &&
    owner.rawHeaderIdentifier.startsWith(owner.number + ',') &&
    owner.rawHeaderIdentifier.slice(owner.number.length + 1).trim() ===
      technical.rawRevision + '.' + technical.rawIteration &&
    business?.confirmation === 'SOURCE_DECLARED' &&
    /^R[0-9]{1,6}$/u.test(business.rawRevision || '') &&
    business.rawIteration === null &&
    evidence?.state === 'VALUE' &&
    evidence.actualLabel === 'EO编号:' &&
    typeof evidence.rawValue === 'string' &&
    evidence.rawValue.trim() === owner.number + '-' + business.rawRevision &&
    typeof evidence.locator === 'string' &&
    /(?:^|\s)#dataStorePrimary_Attributes(?=\s|$)/u.test(evidence.locator) &&
    aeoNativeStatusText(owner.sourceModifiedRaw) &&
    aeoNativeStatusTime(owner.observedAt)
  );
}
export function aeoImplicitStatusOwnerBinding(owner) {
  if (!isReviewedAeoImplicitStatusOwner(owner)) aeoNativeStatusInvalid();
  return {
    sourceRecordId: owner.sourceRecordId,
    nativeTypeId: owner.nativeTypeId,
    rawHeaderType: owner.rawHeaderType,
    engineeringSubtype: owner.scopeEvidence.engineeringSubtype,
    technicalVersion: owner.sourceVersion,
    businessVersion: owner.businessVersion,
    modifiedRaw: owner.sourceModifiedRaw,
    rawHeaderIdentifier: owner.rawHeaderIdentifier,
  };
}
function aeoNativeStatusStyle(value) {
  if (typeof value !== 'string' || value.length > 1000)
    aeoNativeStatusInvalid();
  const result = {};
  for (const declaration of value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean)) {
    const split = declaration.indexOf(':');
    if (split < 1) aeoNativeStatusInvalid();
    const key = declaration.slice(0, split).trim(),
      raw = declaration.slice(split + 1).trim();
    if (Object.hasOwn(result, key)) aeoNativeStatusInvalid();
    result[key] = raw;
  }
  return result;
}
function aeoNativeStatusAttributes(actual, expected) {
  aeoNativeStatusKeys(actual, Object.keys(expected));
  for (const [name, value] of Object.entries(expected)) {
    const raw = actual[name];
    if (typeof raw !== 'string' || raw.length > 1000) aeoNativeStatusInvalid();
    if (value === '%EXT_GEN%' || value === '%EXT_COMP%') {
      if (
        !(
          value === '%EXT_GEN%' ? /^ext-gen\d{1,20}$/u : /^ext-comp-\d{1,20}$/u
        ).test(raw)
      )
        aeoNativeStatusInvalid();
    } else if (name === 'class') {
      if (
        raw.trim().split(/\s+/u).join(' ') !==
        value.trim().split(/\s+/u).join(' ')
      )
        aeoNativeStatusInvalid();
    } else if (name === 'style') {
      const a = aeoNativeStatusStyle(raw),
        e = aeoNativeStatusStyle(value);
      aeoNativeStatusKeys(a, Object.keys(e));
      for (const [property, v] of Object.entries(e)) {
        if (
          ['width', 'height', 'left', 'top'].includes(property) &&
          v !== 'auto'
        ) {
          if (
            !/^-?\d+(?:\.\d+)?px$/u.test(a[property]) ||
            Math.abs(Number.parseFloat(a[property])) > 20000 ||
            (['width', 'height'].includes(property) &&
              Number.parseFloat(a[property]) < 0)
          )
            aeoNativeStatusInvalid();
        } else if (a[property] !== v) aeoNativeStatusInvalid();
      }
    } else if (raw !== value) aeoNativeStatusInvalid();
  }
}
export function validateReviewedAeoStatusToolbarRosters(rosters) {
  const model = REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL;
  if (!Array.isArray(rosters) || rosters.length !== model.toolbarRosters.length)
    aeoNativeStatusInvalid();
  const ids = new Set();
  for (const [index, roster] of rosters.entries()) {
    const expected = model.toolbarRosters[index];
    aeoNativeStatusKeys(roster, ['role', 'locator', 'root', 'nodes']);
    if (roster.role !== expected.role) aeoNativeStatusInvalid();
    aeoNativeStatusKeys(roster.root, [
      'tag',
      'attributes',
      'childCount',
      'visible',
    ]);
    if (
      roster.root.tag !== expected.root.tag ||
      roster.root.childCount !== expected.root.childCount ||
      roster.root.visible !== true
    )
      aeoNativeStatusInvalid();
    aeoNativeStatusAttributes(roster.root.attributes, expected.root.attributes);
    if (
      roster.locator !==
      model.evidenceLocator + ' [id="' + roster.root.attributes.id + '"]'
    )
      aeoNativeStatusInvalid();
    if (
      !Array.isArray(roster.nodes) ||
      roster.nodes.length !== expected.nodes.length
    )
      aeoNativeStatusInvalid();
    for (const [i, node] of roster.nodes.entries()) {
      const template = expected.nodes[i];
      aeoNativeStatusKeys(node, [
        'parentIndex',
        'tag',
        'attributes',
        'childCount',
        'visible',
        'disabled',
      ]);
      if (
        node.parentIndex !== template.parentIndex ||
        node.tag !== template.tag ||
        node.childCount !== template.childCount ||
        node.visible !== template.visible ||
        node.disabled !== template.disabled
      )
        aeoNativeStatusInvalid();
      aeoNativeStatusAttributes(node.attributes, template.attributes);
    }
    for (const node of [roster.root, ...roster.nodes])
      if (Object.hasOwn(node.attributes, 'id')) {
        const id = node.attributes.id;
        if (ids.has(id)) aeoNativeStatusInvalid();
        ids.add(id);
      }
  }
  return rosters;
}
function aeoNativeStatusPosition(position) {
  aeoNativeStatusKeys(position, [
    'reportedTotal',
    'pageRaw',
    'scroll',
    'nextControl',
    'rowOccurrenceIds',
    'globalIndices',
    'treePending',
  ]);
  if (
    position.reportedTotal !== null &&
    (!Number.isSafeInteger(position.reportedTotal) ||
      position.reportedTotal < 0 ||
      position.reportedTotal > 20000)
  )
    aeoNativeStatusInvalid();
  if (position.pageRaw !== null && !aeoNativeStatusText(position.pageRaw, 160))
    aeoNativeStatusInvalid();
  if (position.scroll !== null) {
    aeoNativeStatusKeys(position.scroll, [
      'top',
      'height',
      'viewport',
      'atTop',
      'atBottom',
    ]);
    for (const k of ['top', 'height', 'viewport'])
      if (
        !Number.isFinite(position.scroll[k]) ||
        position.scroll[k] < 0 ||
        position.scroll[k] > 20000000
      )
        aeoNativeStatusInvalid();
    for (const k of ['atTop', 'atBottom'])
      if (typeof position.scroll[k] !== 'boolean') aeoNativeStatusInvalid();
  }
  aeoNativeStatusKeys(position.nextControl, [
    'present',
    'enabled',
    'terminalDeclared',
  ]);
  if (
    Object.values(position.nextControl).some(
      (value) => typeof value !== 'boolean',
    )
  )
    aeoNativeStatusInvalid();
  for (const key of ['rowOccurrenceIds', 'globalIndices'])
    if (
      !Array.isArray(position[key]) ||
      position[key].length > 1000 ||
      new Set(position[key]).size !== position[key].length
    )
      aeoNativeStatusInvalid();
  if (
    position.rowOccurrenceIds.some((value) => !aeoNativeStatusText(value)) ||
    position.globalIndices.some(
      (value) => !Number.isSafeInteger(value) || value < 0 || value > 20000,
    ) ||
    !Number.isSafeInteger(position.treePending) ||
    position.treePending < 0 ||
    position.treePending > 1000
  )
    aeoNativeStatusInvalid();
}
export function validateReviewedAeoStatusNativeFrame(frame, { owner } = {}) {
  const model = REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL;
  aeoNativeStatusKeys(frame, [
    'ownerBinding',
    'activeTabId',
    'panelId',
    'gridId',
    'toolbarRosters',
    'hiddenParameterRoster',
    'query',
    'utilities',
    'columns',
    'position',
    'observedAt',
  ]);
  if (
    !aeoNativeStatusSame(
      frame.ownerBinding,
      aeoImplicitStatusOwnerBinding(owner),
    ) ||
    frame.activeTabId !== model.tabId ||
    frame.panelId !== model.panelLocator.slice(1) ||
    frame.gridId !== model.gridId ||
    !aeoNativeStatusTime(frame.observedAt) ||
    Date.parse(frame.observedAt) < Date.parse(owner.observedAt) ||
    !aeoNativeStatusSame(frame.columns, model.columns)
  )
    aeoNativeStatusInvalid();
  validateReviewedAeoStatusToolbarRosters(frame.toolbarRosters);
  if (
    !Array.isArray(frame.hiddenParameterRoster) ||
    frame.hiddenParameterRoster.length > model.hiddenParameterIds.length ||
    new Set(frame.hiddenParameterRoster.map((p) => p.id)).size !==
      frame.hiddenParameterRoster.length
  )
    aeoNativeStatusInvalid();
  for (const parameter of frame.hiddenParameterRoster) {
    aeoNativeStatusKeys(parameter, ['id', 'tag', 'type']);
    if (
      parameter.tag !== 'INPUT' ||
      parameter.type !== 'hidden' ||
      !model.hiddenParameterIds.includes(parameter.id)
    )
      aeoNativeStatusInvalid();
  }
  const q = frame.query;
  aeoNativeStatusKeys(q, [
    'id',
    'tag',
    'type',
    'name',
    'rawClassName',
    'rawValue',
    'ariaLabel',
    'placeholder',
    'disabled',
    'visible',
    'normalization',
  ]);
  if (
    q.id !== 'relatedStatusLinkTable.searchInListTextBox' ||
    q.tag !== 'INPUT' ||
    q.type !== 'text' ||
    q.name !== q.id ||
    q.rawClassName?.trim().split(/\s+/u).join(' ') !==
      'x-form-text x-form-field x-form-empty-field' ||
    q.rawValue !== 'Search in table' ||
    q.ariaLabel !== null ||
    q.placeholder !== null ||
    q.disabled !== false ||
    q.visible !== true ||
    q.normalization !== 'EMPTY_NATIVE_TEXT'
  )
    aeoNativeStatusInvalid();
  aeoNativeStatusKeys(frame.utilities, [
    'headerLoadingText',
    'footerLoadingText',
    'searchWheelRawText',
  ]);
  if (
    frame.utilities.headerLoadingText !== 'Loading...' ||
    frame.utilities.footerLoadingText !== 'Loading...' ||
    frame.utilities.searchWheelRawText !== ''
  )
    aeoNativeStatusInvalid();
  aeoNativeStatusPosition(frame.position);
  return frame;
}
export function validateReviewedAeoImplicitStatusSourceView(
  view,
  { owner, tabId, panelLocator, gridId, table = null, read = null } = {},
) {
  const model = REVIEWED_AEO_RELATED_STATUS_NATIVE_VIEW_MODEL;
  aeoNativeStatusKeys(view, [
    'schemaVersion',
    'kind',
    'state',
    'modelRevision',
    'meaning',
    'semanticAuthority',
    'backendFiltersState',
    'evidenceLocator',
    'ownerSourceRecordId',
    'nativeTypeId',
    'rawHeaderType',
    'engineeringSubtype',
    'ownerTechnicalVersion',
    'ownerBusinessVersion',
    'ownerModifiedRaw',
    'tabId',
    'panelLocator',
    'gridId',
    'windows',
    'observedAt',
  ]);
  if (
    !isReviewedAeoImplicitStatusOwner(owner) ||
    view.schemaVersion !== model.schemaVersion ||
    view.kind !== model.kind ||
    view.state !== 'VALUE' ||
    view.modelRevision !== model.modelRevision ||
    view.meaning !== model.meaning ||
    !aeoNativeStatusSame(view.semanticAuthority, model.semanticAuthority) ||
    view.backendFiltersState !== 'UNKNOWN' ||
    view.evidenceLocator !== model.evidenceLocator ||
    view.ownerSourceRecordId !== owner.sourceRecordId ||
    view.nativeTypeId !== owner.nativeTypeId ||
    view.rawHeaderType !== owner.rawHeaderType ||
    view.engineeringSubtype !== model.engineeringSubtype ||
    !aeoNativeStatusSame(view.ownerTechnicalVersion, owner.sourceVersion) ||
    !aeoNativeStatusSame(view.ownerBusinessVersion, owner.businessVersion) ||
    view.ownerModifiedRaw !== owner.sourceModifiedRaw ||
    view.tabId !== model.tabId ||
    tabId !== model.tabId ||
    view.panelLocator !== model.panelLocator ||
    panelLocator !== model.panelLocator ||
    view.gridId !== model.gridId ||
    gridId !== model.gridId ||
    !aeoNativeStatusTime(view.observedAt) ||
    Date.parse(view.observedAt) < Date.parse(owner.observedAt)
  )
    aeoNativeStatusInvalid();
  if (
    !Array.isArray(view.windows) ||
    !view.windows.length ||
    view.windows.length > model.maxWindows
  )
    aeoNativeStatusInvalid();
  let first = null,
    lastAt = Date.parse(owner.observedAt);
  for (const [ordinal, pair] of view.windows.entries()) {
    aeoNativeStatusKeys(pair, [
      'windowOrdinal',
      'before',
      'after',
      'settledReads',
    ]);
    if (pair.windowOrdinal !== ordinal || pair.settledReads !== 2)
      aeoNativeStatusInvalid();
    for (const frame of [pair.before, pair.after]) {
      validateReviewedAeoStatusNativeFrame(frame, { owner });
      if (
        Date.parse(frame.observedAt) < lastAt ||
        Date.parse(frame.observedAt) > Date.parse(view.observedAt)
      )
        aeoNativeStatusInvalid();
      lastAt = Date.parse(frame.observedAt);
    }
    if (!aeoNativeStatusSame(pair.before, pair.after)) aeoNativeStatusInvalid();
    const { position, observedAt, ...structure } = pair.after;
    if (first && !aeoNativeStatusSame(first, structure))
      aeoNativeStatusInvalid();
    first = structure;
    if (table) {
      const window = table.windows?.[ordinal];
      if (!window) aeoNativeStatusInvalid();
      const expected = {
        reportedTotal: window.reportedTotal,
        pageRaw: window.pageRaw,
        scroll: window.scroll,
        nextControl: window.nextControl,
        rowOccurrenceIds: window.rowOccurrenceIds,
        globalIndices: window.globalIndices,
        treePending: window.treePending,
      };
      if (
        !aeoNativeStatusSame(position, expected) ||
        !aeoNativeStatusSame(
          table.rawHeaders,
          model.columns.map((c) => c.actualLabel),
        ) ||
        Date.parse(pair.after.observedAt) > Date.parse(window.observedAt)
      )
        aeoNativeStatusInvalid();
    }
  }
  if (
    table &&
    (table.windows.length !== view.windows.length ||
      table.ownerSourceRecordId !== owner.sourceRecordId ||
      !aeoNativeStatusSame(table.ownerSourceVersion, owner.sourceVersion))
  )
    aeoNativeStatusInvalid();
  if (read) {
    const subtype = (read.fields || []).filter((f) =>
      ['指令类别:', '指令类别', '指令类别：'].includes(f.value?.actualLabel),
    );
    if (
      subtype.length !== 1 ||
      subtype[0].labelOrigin !== 'NATIVE_SOURCE_DECLARED' ||
      subtype[0].value.state !== 'VALUE' ||
      subtype[0].value.rawValue !== 'AEO' ||
      !aeoNativeStatusTime(read.observedAt) ||
      Date.parse(view.observedAt) > Date.parse(read.observedAt)
    )
      aeoNativeStatusInvalid();
  }
  return view;
}
