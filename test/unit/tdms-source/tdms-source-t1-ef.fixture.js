import { copyComplete } from './tdms-complete-owned.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import {
  syntheticAnonymous,
  resealT1,
  t1StructuralRosters,
} from './tdms-source-t1.fixture';
import {
  REVIEWED_EFREQUEST_QUERY_MODEL as queryModel,
  REVIEWED_EFREQUEST_RELATED_MODEL as relatedModel,
  REVIEWED_EFREQUEST_TAB_PURPOSE_MODEL as purposeModel,
} from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';

// Every value/DOM shape below is fabricated. No native source, query, click,
// transport or collector runs; these are immutable incoming-wire examples.
const node = (id, tag = 'DIV', rawClassName = '', visible = true) => ({
  id,
  tag,
  rawClassName,
  visible,
});
const bound = (model, owner, tabId, panelLocator) => ({
  schemaVersion: model.schemaVersion,
  modelRevision: model.modelRevision,
  scopeId: model.scopeId,
  ownerSourceRecordId: owner.sourceRecordId,
  ownerSourceVersion: copyComplete(owner.sourceVersion),
  ownerSourceModifiedRaw: owner.sourceModifiedRaw,
  nativeTypeId: owner.nativeTypeId,
  tabId,
  panelLocator,
});
const headers = (columns) =>
  columns.map((c) => ({
    tag: 'TD',
    rawClassName: 'x-grid3-td-' + c.nativeColumnToken,
    rawCaptionText: c.actualLabel || '\u00a0',
    actualLabel: c.actualLabel,
    nativeColumnToken: c.nativeColumnToken,
    visible: true,
  }));
function queryFrame(model, table) {
  const selectedOnly = {
    state: 'NOT_APPLICABLE',
    control: null,
    button: null,
    popup: null,
    item: null,
    parentLi: null,
    checkItemIds: [],
    sequence: [],
  };
  if (model.selectedOnlyRequired)
    Object.assign(selectedOnly, {
      state: 'VALUE',
      control: node(model.selectedOnlyControlId, 'TABLE'),
      button: node(null, 'BUTTON', 'optionsButton'),
      popup: node('synthetic-menu', 'DIV', 'x-menu'),
      item: {
        ...node(model.selectedOnlyItemId, 'A', 'x-menu-item x-menu-check-item'),
        rawText: 'View Selected Objects Only',
      },
      parentLi: node(
        'x-menu-el-' + model.selectedOnlyItemId,
        'LI',
        'x-menu-list-item',
      ),
      checkItemIds: [model.selectedOnlyItemId],
      sequence: ['BUTTON_OPENED', 'ITEM_READ', 'BUTTON_CLOSED'],
    });
  return {
    activeTabId: model.tabId,
    panelId: model.panelLocator.slice(1),
    panelVisible: true,
    gridVisible: true,
    search: {
      id: model.searchId,
      tag: 'INPUT',
      type: 'text',
      name: model.searchId,
      rawClassName: 'x-form-text x-form-field x-form-empty-field',
      rawValue: 'Search in table',
      visible: true,
      disabled: false,
      normalization: 'EMPTY_NATIVE_PLACEHOLDER',
    },
    selectedOnly,
    additionalControls: [],
    counts: [
      {
        tag: 'SPAN',
        rawClassName: 'tableCount',
        rawText: '(0 objects)',
        visible: true,
      },
      ...(model.selectedOnlyRequired
        ? [
            {
              tag: 'SPAN',
              rawClassName: 'tableCount',
              rawText: '(0 objects selected)',
              visible: true,
            },
          ]
        : []),
    ],
    loading: {
      utilitySlots: model.utilityIds.map((id) => ({
        ...node(id, 'DIV', 'xtb-text'),
        childElementCount: 0,
        rawText: '',
      })),
      masks: [],
      stopButtons: [],
      busyNodes: [],
    },
    structure: {
      rows: table.rows.map((r) => node(r.nativeRowId, 'DIV', 'x-grid3-row')),
      hiddenRows: 0,
      pagers: [],
      treeNodes: [],
      scrollers: [
        { ...node('synthetic-scroller'), top: 0, height: 100, viewport: 100 },
      ],
    },
    permissionMarkers: [],
  };
}
export function syntheticEfQueries() {
  const env = syntheticAnonymous(),
    p = proofOfCurrent(env);
  for (const read of p.reads) {
    for (const table of read.relationTables) {
      const m = queryModel.grids.find((g) => g.gridId === table.gridId),
        frame = queryFrame(m, table);
      table.efQueryEvidence = {
        ...bound(queryModel, read.owner, m.tabId, m.panelLocator),
        gridId: m.gridId,
        windows: [
          {
            windowOrdinal: 0,
            before: frame,
            after: copyComplete(frame),
            settledReads: 2,
          },
        ],
      };
    }
  }
  return resealT1(env);
}
export function syntheticEfRelated() {
  const env = syntheticEfQueries(),
    p = proofOfCurrent(env);
  for (const read of p.reads) {
    for (const [index, m] of relatedModel.grids.entries()) {
      const ref = 'OR:wt.doc.WTDocument:' + (992100 + index),
        number = 'SYNTHETIC-RELATED-' + index;
      if (!read.tabs.some((t) => t.tabId === m.tabId))
        read.tabs.push({
          tabId: m.tabId,
          panelLocator: m.panelLocator,
          label: 'Related objects',
          state: 'VALUE',
          required: true,
          sourceDeclared: true,
          reasonCode: null,
        });
      const row = {
        occurrenceId: m.gridId + ':synthetic-0',
        globalIndex: null,
        nativeRowId: 'synthetic-row-' + index,
        treePath: [],
        treeDepth: null,
        nativeRelationId: null,
        rawRole: null,
        rawDirection: null,
        observedVersion: {
          rawRevision: null,
          rawIteration: null,
          confirmation: 'VERSION_UNCONFIRMED',
        },
        cells: m.columns.map((c) => ({
          actualLabel: c.actualLabel,
          state: c.valuePolicy.startsWith('NOT_READ') ? 'NOT_READ' : 'VALUE',
          rawValue: c.valuePolicy.startsWith('NOT_READ')
            ? null
            : c.nativeColumnToken === 'number'
              ? number
              : 'Synthetic cell',
          observedTotalCodepoints: c.valuePolicy.startsWith('NOT_READ')
            ? 0
            : c.nativeColumnToken === 'number'
              ? number.length
              : 'Synthetic cell'.length,
        })),
        sourceLinks: [
          {
            rawHref: '/Windchill/tcomp/infoPage?oid=' + ref,
            targetRef: ref,
            numberRaw: number,
            nativeRole: 'NUMBER_LINK',
            locator: m.panelLocator + ' #' + m.gridId + ' a.number',
            nativeColumnLabel: 'Number',
            nativeColumnToken: 'number',
          },
        ],
      };
      const table = {
        tableId: m.gridId,
        gridId: m.gridId,
        tabId: m.tabId,
        panelLocator: m.panelLocator,
        tableTitle: m.tableTitle,
        relationshipRole: 'UNKNOWN',
        direction: 'UNKNOWN',
        rawHeaders: m.columns.map((c) => c.actualLabel),
        reportedTotal: 1,
        countEvidence: {
          rawText: '(1 object)',
          exact: false,
          locator: m.panelLocator + ' span.tableCount',
        },
        scanMode: 'DOM_ROWS',
        rows: [row],
        windows: [
          {
            ordinal: 0,
            rowOccurrenceIds: [row.occurrenceId],
            globalIndices: [],
            reportedTotal: 1,
            pageRaw: null,
            scroll: null,
            nextControl: {
              present: false,
              enabled: false,
              terminalDeclared: false,
            },
            stableReads: 2,
            treePending: 0,
            observedAt: read.observedAt,
          },
        ],
        treeExpansions: [],
        terminal: {
          kind: 'UNCONFIRMED',
          total: 1,
          captured: 1,
          allGlobalIndices: false,
          allTreeNodesExpanded: true,
          nativeTerminal: false,
          trueZero: false,
          settledReads: 2,
        },
        enumerationState: 'NOT_READ',
        stopReason: 'TDMS_EFREQUEST_RELATED_QUERY_UNREVIEWED',
        ownerSourceRecordId: read.owner.sourceRecordId,
        ownerSourceVersion: copyComplete(read.owner.sourceVersion),
        observedAt: read.observedAt,
      };
      const frame = {
        activeTabId: m.tabId,
        panelId: m.panelLocator.slice(1),
        panelVisible: true,
        gridVisible: true,
        nativeHeaders: headers(m.columns),
        titles: [],
        controls: [],
        counts: [],
        rowShapes: [
          {
            node: node(row.nativeRowId, 'DIV', 'x-grid3-row'),
            occurrenceId: row.occurrenceId,
            attributes: {
              ariaRowIndex: null,
              dataRowIndex: null,
              ariaLevel: null,
              dataDepth: null,
              nativeRelationId: null,
              rawRole: null,
              rawDirection: null,
            },
          },
        ],
        pagers: [],
        treeNodes: [],
        scrollers: [],
        permissionMarkers: [],
        loading: {
          utilitySlots: [],
          masks: [],
          stopButtons: [],
          busyNodes: [],
          active: false,
        },
      };
      table.relatedSurfaceEvidence = {
        ...bound(relatedModel, read.owner, m.tabId, m.panelLocator),
        gridId: m.gridId,
        queryReviewState: 'NOT_READ',
        before: frame,
        after: copyComplete(frame),
        settledReads: 2,
      };
      read.relationTables.push(table);
    }
    read.rosterEvidence.tabIds = read.tabs.map((t) => t.tabId);
    read.rosterEvidence.nativeTabStripIds = [
      ...read.rosterEvidence.tabIds,
      'infoPageinfoPanelID__new_tab_action',
    ];
    t1StructuralRosters(read);
  }
  return resealT1(env);
}
export function syntheticEfAliases() {
  const env = syntheticEfQueries(),
    p = proofOfCurrent(env);
  for (const read of p.reads) {
    for (const m of purposeModel.aliases) {
      const frame = {
        activeTabId: m.tabId,
        panelId: m.panelLocator.slice(1),
        panelVisible: true,
        tocNodes: m.components.map((c) => node(c.tocId, 'DIV', 'myTab-link')),
        wrapperNodes: m.components.map((c) =>
          node(c.wrapperId, 'DIV', 'x-panel'),
        ),
        gridSchemas: m.grids.map((g) => ({
          gridId: g.gridId,
          wrapperId: m.components.find((c) => c.componentId === g.componentId)
            .wrapperId,
          node: node(g.gridId, 'DIV', 'x-grid-panel'),
          nativeHeaders: headers(g.columns),
        })),
        attributeSections: m.attributeSections.map((s) => ({
          sectionId: s.sectionId,
          dataStoreId: s.dataStoreId,
          section: node(s.sectionId, 'FIELDSET'),
          store: node(s.dataStoreId),
          wrapperId: m.components.find(
            (c) => c.componentId === 'objectattributes',
          ).wrapperId,
        })),
        fields: m.attributeSections.flatMap((s) =>
          s.labels.map((label, i) => ({
            sectionId: s.sectionId,
            dataStoreId: s.dataStoreId,
            labelTag: 'TD',
            rawClassName: 'attributePanel-label',
            rawCaptionText: label,
            actualLabel: label.trim(),
            valueTag: 'TD',
            captionLocator:
              m.panelLocator + ' #' + s.dataStoreId + ' td.caption-' + i,
            valueLocator:
              m.panelLocator + ' #' + s.dataStoreId + ' td.value-' + i,
            visible: true,
            bodyEvidenceState: 'NOT_READ',
          })),
        ),
        embedded: [],
      };
      let canonicalBinding = null;
      if (m.canonicalKind !== null) {
        // The attribute alias reuses the canonical own field rosters; it never
        // supplies a second body's values or a second source reading.
        canonicalBinding = {
          kind: m.canonicalKind,
          ownerSourceRecordId: read.owner.sourceRecordId,
          ownerSourceVersion: copyComplete(read.owner.sourceVersion),
          ownerSourceModifiedRaw: read.owner.sourceModifiedRaw,
          tabId: m.canonicalTabId,
          panelLocator: m.canonicalPanelLocator,
          tableId: m.canonicalTableId,
          fieldIds:
            m.canonicalKind === 'FIELDS'
              ? read.fields
                  .filter((f) =>
                    m.attributeSections.some(
                      (s) =>
                        f.sectionId === m.canonicalTabId + '::' + s.sectionId,
                    ),
                  )
                  .map((f) => f.fieldId)
              : [],
        };
      }
      if (m.canonicalKind === 'TABLE')
        read.relationTables.find(
          (t) => t.gridId === m.canonicalTableId,
        ).tableId = m.canonicalTableId;
      const purposeEvidence = {
        ...bound(purposeModel, read.owner, m.tabId, m.panelLocator),
        purpose: m.purpose,
        bodyEvidenceState: 'NOT_READ',
        before: frame,
        after: copyComplete(frame),
        settledReads: 2,
        canonicalBinding,
      };
      read.tabs.push({
        tabId: m.tabId,
        label: m.label,
        panelLocator: m.panelLocator,
        required: false,
        state: 'NOT_READ',
        sourceDeclared: true,
        reasonCode: m.reasonCode,
        purposeEvidence,
      });
    }
    read.rosterEvidence.tabIds = read.tabs.map((t) => t.tabId);
    read.rosterEvidence.nativeTabStripIds = [
      ...read.rosterEvidence.tabIds,
      'infoPageinfoPanelID__new_tab_action',
    ];
    t1StructuralRosters(read);
  }
  return resealT1(env);
}
