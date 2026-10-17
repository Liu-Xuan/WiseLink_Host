import {
  REVIEWED_AD_HANDLING_REQUIRED_SURFACE_MODEL as hModel,
  adHandlingRequiredTableId,
} from '../../../server/modules/tdms-source/tdms-reviewed-ad-handling-required-surfaces';
import {
  REVIEWED_AD_ITEM_NATIVE_MODEL as itemModel,
  REVIEWED_AD_ITEM_DETAILS_QUERY_MODEL as queryModel,
} from '../../../server/modules/tdms-source/tdms-reviewed-ad-item-native-model';
import { syntheticHandling, resealT1 } from './tdms-source-t1.fixture';
import { copyComplete } from './tdms-complete-owned.fixture';
import { resealMetadata } from './tdms-metadata-aditem.fixture';
import {
  syntheticAdItemPresentedTree,
  syntheticAdItemLegacyProjection,
} from './tdms-source268-ui-tree.fixture';

// Newly fabricated observations only. Archived golden/Source265/268 fixtures
// remain unchanged; no real TDMS body, collector or DOM is involved.
const clone = copyComplete;
export const consumerProof = (env) =>
  env.package.records[0].rawFields.completeOwnedSource;
export function syntheticHRequiredSurfaces(rowCount = 1) {
  const env = syntheticHandling();
  for (const read of consumerProof(env).reads) {
    const owner = read.owner;
    read.relationTables = [];
    for (const panel of [...hModel.panels, hModel.adjacentDetails]) {
      const tab = read.tabs.find((t) => t.tabId === panel.tabId);
      Object.assign(tab, {
        required: true,
        state: 'NOT_READ',
        reasonCode: hModel.stopReason,
      });
      const window = {
        panelId: panel.panelLocator.slice(1),
        activeTabId: panel.tabId,
        fieldLabels: [],
        controls: panel.controlIds.map((id) => ({
          id,
          tag: 'INPUT',
          rawClassName: 'SYNTHETIC-CONTROL',
          disabled: false,
          readOnly: false,
          valueState: 'NOT_READ',
        })),
        frames: panel.frameIds.map((id) => ({
          id,
          tag: 'IFRAME',
          rawSrc:
            'timeline.jsp?oid=' + encodeURIComponent(owner.sourceRecordId),
          contentState: 'NOT_READ',
        })),
        loading: panel.maskIds.map((id) => ({
          id,
          rawClassName: 'SYNTHETIC-MASK',
          active: false,
        })),
        grids: panel.grids.map((g) => ({
          gridId: g.gridId,
          rawClassName: g.requiredClassTokens.join(' '),
          columns: g.columns.map((c) => ({
            actualLabel: c.actualLabel,
            nativeColumnToken: c.nativeColumnToken,
          })),
          rows: Array.from({ length: rowCount }, (_, index) => ({
            nativeRowId: 'SYNTHETIC-ROW-' + index,
            rawClassName: 'x-grid3-row',
            cellColumnTokens: g.columns.map((c) => c.nativeColumnToken),
            represented: true,
          })),
          loadingPresent: false,
          pagerPresent: false,
          pagerEnabled: false,
        })),
      };
      tab.purposeEvidence = {
        schemaVersion: hModel.schemaVersion,
        modelRevision: hModel.modelRevision,
        tabId: panel.tabId,
        panelLocator: panel.panelLocator,
        ownerSourceRecordId: owner.sourceRecordId,
        ownerSourceVersion: clone(owner.sourceVersion),
        ownerBusinessVersion: clone(owner.businessVersion),
        ownStateRaw: owner.stateRaw,
        ownModifiedRaw: owner.sourceModifiedRaw,
        queryDefinition: 'UNKNOWN',
        bodyCoverage: 'UNPROVEN',
        terminalEvidence: 'UNKNOWN',
        windows: [clone(window), clone(window)],
      };
      read.rosterEvidence.unknownRequiredSurfaces.push(
        panel.panelLocator + ' [native-body-coverage-unproven]',
      );
      for (const grid of panel.grids) {
        const tableId = adHandlingRequiredTableId(panel.tabId, grid.gridId);
        const rows = Array.from({ length: rowCount }, (_, index) => ({
          occurrenceId: tableId + ':ROW-' + index,
          globalIndex: null,
          nativeRowId: 'SYNTHETIC-ROW-' + index,
          treePath: [],
          treeDepth: null,
          nativeRelationId: null,
          rawRole: null,
          rawDirection: null,
          cells: grid.columns.map((c) => ({
            actualLabel: c.actualLabel,
            rawValue: null,
            state: 'NOT_READ',
            observedTotalCodepoints: 0,
          })),
          sourceLinks: [],
          observedVersion: clone(owner.sourceVersion),
        }));
        read.relationTables.push({
          tableId,
          tabId: panel.tabId,
          tableTitle: grid.gridId,
          panelLocator: panel.panelLocator,
          gridId: grid.gridId,
          relationshipRole: 'UNKNOWN',
          direction: 'UNKNOWN',
          rawHeaders: grid.columns.map((c) => c.actualLabel),
          reportedTotal: null,
          countEvidence: {
            rawText: null,
            exact: false,
            locator: panel.panelLocator + ' [id="' + grid.gridId + '"]',
          },
          scanMode: 'DOM_ROWS',
          rows,
          windows: [
            {
              ordinal: 0,
              rowOccurrenceIds: rows.map((r) => r.occurrenceId),
              globalIndices: [],
              reportedTotal: null,
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
            total: null,
            captured: rows.length,
            allGlobalIndices: false,
            allTreeNodesExpanded: false,
            nativeTerminal: false,
            trueZero: false,
            settledReads: 2,
          },
          enumerationState: 'NOT_READ',
          stopReason: hModel.stopReason,
          ownerSourceRecordId: owner.sourceRecordId,
          ownerSourceVersion: clone(owner.sourceVersion),
          observedAt: read.observedAt,
        });
      }
    }
  }
  return resealT1(env);
}

export function syntheticItemQuery({
  zeroDetails = false,
  legacyTree = false,
} = {}) {
  const env = legacyTree
    ? syntheticAdItemLegacyProjection('TREE')
    : syntheticAdItemPresentedTree();
  for (const read of consumerProof(env).reads) {
    const owner = read.owner;
    for (const table of read.relationTables) {
      const native = itemModel.nativeGridSurfaces.find(
        (g) => g.gridId === table.gridId,
      );
      const model = queryModel.grids.find((g) => g.gridId === table.gridId);
      Object.assign(table, {
        enumerationState: 'NOT_READ',
        stopReason: model
          ? queryModel.stopReason
          : 'TDMS_COMPLETE_AD_ITEM_RELATED_QUERY_AND_END_UNREVIEWED',
      });
      Object.assign(table.terminal, {
        kind: 'UNCONFIRMED',
        nativeTerminal: false,
        trueZero: false,
        allTreeNodesExpanded: false,
      });
      table.countEvidence.locator =
        native.panelLocator + ' [id="' + native.gridId + '"] span.tableCount';
      if (!model) continue;
      if (zeroDetails) {
        table.rows = [];
        table.reportedTotal = 0;
        table.windows[0].rowOccurrenceIds = [];
        table.windows[0].globalIndices = [];
        table.windows[0].reportedTotal = 0;
        Object.assign(table.terminal, {
          total: 0,
          captured: 0,
          allGlobalIndices: true,
        });
      }
      table.countEvidence.rawText = '(' + table.reportedTotal + ' objects)';
      table.countEvidence.exact = true;
      const w = table.windows[0];
      const frame = {
        activeTabId: model.tabId,
        panelId: model.panelLocator.slice(1),
        gridId: model.gridId,
        columns: native.columns.map((c) => ({
          actualLabel: c.actualLabel,
          nativeColumnToken: c.nativeColumnToken,
        })),
        controls: model.controls.map((c) => ({
          id: c.id,
          tag: 'INPUT',
          rawClassName: 'x-form-text x-form-field x-form-empty-field',
          type: 'text',
          name: c.id,
          rawValue: c.kind === 'NATIVE_VIEW_RAW' ? 'All' : 'Search in table',
          valueEvidenceState: 'VALUE',
          disabled: false,
          ariaExpanded: null,
          title: null,
        })),
        counts: [
          {
            id: null,
            tag: 'SPAN',
            rawClassName: 'tableCount',
            rawText: table.countEvidence.rawText,
          },
          {
            id: null,
            tag: 'SPAN',
            rawClassName: 'tableCount',
            rawText: '(0 objects selected)',
          },
        ],
        position: clone({
          reportedTotal: w.reportedTotal,
          pageRaw: w.pageRaw,
          scroll: w.scroll,
          nextControl: w.nextControl,
          rowOccurrenceIds: w.rowOccurrenceIds,
          globalIndices: w.globalIndices,
          treePending: w.treePending,
        }),
      };
      table.relatedSurfaceEvidence = {
        schemaVersion: queryModel.schemaVersion,
        modelRevision: queryModel.modelRevision,
        scopeId: 'AD_ITEM',
        ownerSourceRecordId: owner.sourceRecordId,
        ownerSourceVersion: clone(owner.sourceVersion),
        ownerBusinessVersion: clone(owner.businessVersion),
        ownerNumber: owner.number,
        ownStateRaw: owner.stateRaw,
        ownerSourceModifiedRaw: owner.sourceModifiedRaw,
        nativeTypeId: null,
        tabId: model.tabId,
        panelLocator: model.panelLocator,
        gridId: model.gridId,
        queryReviewState: 'NOT_READ',
        before: clone(frame),
        after: clone(frame),
        settledReads: 2,
      };
    }
  }
  return resealMetadata(env);
}
