import { copyComplete } from './tdms-complete-owned.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { syntheticEfRelatedQueries } from './tdms-source-t1-current-notice.fixture';
import { resealT1 } from './tdms-source-t1.fixture';
import { REVIEWED_EFREQUEST_RELATED_WINDOW_MODEL as windowModel } from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';

const node = (id, tag = 'DIV', rawClassName = '') => ({
  id,
  tag,
  rawClassName,
  visible: true,
});
const position = (w) =>
  Object.fromEntries(
    [
      'reportedTotal',
      'pageRaw',
      'scroll',
      'nextControl',
      'rowOccurrenceIds',
      'globalIndices',
      'treePending',
    ].map((key) => [key, copyComplete(w[key])]),
  );

// All rows, controls and source identities are fabricated. The original @1
// fixture is reused only as the reviewed owner/query/column schema carrier.
export function syntheticEfRelatedWindows(
  scanMode = 'NATIVE_PAGER',
  { gridIndex = 0, duplicatePayload = false, nativeIndexed = false } = {},
) {
  const env = syntheticEfRelatedQueries(),
    p = proofOfCurrent(env),
    m = windowModel,
    model = m.grids[gridIndex];
  for (const read of p.reads) {
    const table = read.relationTables.find((t) => t.gridId === model.gridId),
      originalRaw = table.relatedSurfaceEvidence,
      originalQuery = table.relatedQueryEvidence,
      originalRow = table.rows[0];
    table.scanMode = scanMode;
    table.reportedTotal = 2;
    table.countEvidence.rawText = '(2 objects)';
    table.stopReason = 'TDMS_EFREQUEST_RELATED_CONTRACT_SCOPE_UNPROVEN';
    table.rows = [0, 1].map((index) => {
      const row = copyComplete(originalRow);
      row.occurrenceId = model.gridId + ':synthetic-window-' + index;
      row.nativeRowId = 'synthetic-native-page-row-' + index;
      row.globalIndex = index;
      if (!duplicatePayload && index === 1) {
        const number = row.sourceLinks[0].numberRaw + '-SECOND',
          ref = 'OR:wt.doc.WTDocument:' + (997200 + gridIndex);
        const cell = row.cells.find((c) => c.actualLabel === 'Number');
        cell.rawValue = number;
        cell.observedTotalCodepoints = number.length;
        Object.assign(row.sourceLinks[0], {
          numberRaw: number,
          targetRef: ref,
          rawHref: '/Windchill/tcomp/infoPage?oid=' + ref,
        });
      }
      row.sourceLinks[0].locator =
        model.panelLocator + ' [id="' + row.nativeRowId + '"] a.number';
      return row;
    });
    table.terminal.total = table.terminal.captured = 2;
    // This flag describes contiguous captured ordinals only. Contract/native
    // terminal and trueZero remain unconfirmed, including duplicate payloads.
    table.terminal.allGlobalIndices = true;
    const subsets =
      scanMode === 'DOM_ROWS' ? [table.rows] : table.rows.map((row) => [row]);
    const rawWindows = [],
      queryWindows = [];
    table.windows = subsets.map((rows, ordinal) => {
      const frame = copyComplete(originalRaw.after),
        pager = scanMode === 'NATIVE_PAGER',
        virtual = scanMode === 'VIRTUAL_SCROLL',
        last = ordinal === subsets.length - 1;
      frame.counts.find((c) => !c.rawText.includes('selected')).rawText =
        '(2 objects)';
      frame.rowShapes = rows.map((row) => ({
        node: node(row.nativeRowId, 'DIV', 'x-grid3-row'),
        occurrenceId: row.occurrenceId,
        attributes: {
          ariaRowIndex: null,
          dataRowIndex: nativeIndexed ? String(row.globalIndex) : null,
          ariaLevel: null,
          dataDepth: null,
          nativeRelationId: null,
          rawRole: null,
          rawDirection: null,
        },
      }));
      frame.scrollers[0].top = virtual ? ordinal * 100 : 0;
      frame.scrollers[0].height = virtual ? 200 : 100;
      frame.paging = {
        first: null,
        prev: null,
        next: null,
        last: null,
        page: null,
      };
      if (pager) {
        frame.paging.next = {
          node: node('synthetic-next-' + ordinal, 'BUTTON', 'x-btn'),
          indicator: node(null, 'IMG', 'x-tbar-page-next'),
          wrapper: node('synthetic-next-wrap-' + ordinal, 'SPAN', 'x-btn'),
          nativeDisabled: last,
          ariaDisabled: null,
          disabled: last,
        };
        frame.paging.page = {
          node: node('synthetic-page-input', 'INPUT', 'x-tbar-page-number'),
          type: 'text',
          rawValue: String(ordinal + 1),
        };
        frame.pagers = [copyComplete(frame.paging.next.node)];
      }
      const scroll = {
        top: frame.scrollers[0].top,
        height: frame.scrollers[0].height,
        viewport: frame.scrollers[0].viewport,
        atTop: !virtual || ordinal === 0,
        atBottom: !virtual || last,
      };
      const w = {
        ordinal,
        rowOccurrenceIds: rows.map((row) => row.occurrenceId),
        globalIndices: rows.map((row) => row.globalIndex),
        reportedTotal: 2,
        pageRaw: frame.paging.page?.rawValue ?? null,
        scroll,
        nextControl: {
          present: pager,
          enabled: pager && !last,
          terminalDeclared: pager && last,
        },
        stableReads: 2,
        treePending: 0,
        observedAt: read.observedAt,
      };
      rawWindows.push({
        windowOrdinal: ordinal,
        before: copyComplete(frame),
        after: copyComplete(frame),
        settledReads: 2,
        position: position(w),
      });
      const queryFrame = {
        ...copyComplete(originalQuery.windows[0].after),
        surface: copyComplete(frame),
      };
      queryWindows.push({
        windowOrdinal: ordinal,
        before: queryFrame,
        after: copyComplete(queryFrame),
        settledReads: 2,
      });
      return w;
    });
    const { before, after, settledReads, ...rawIdentity } = originalRaw;
    table.relatedSurfaceEvidence = {
      ...rawIdentity,
      schemaVersion: m.rawSchemaVersion,
      modelRevision: m.rawModelRevision,
      indexOrigin: {
        NATIVE_PAGER: 'NATIVE_PAGE_SEQUENCE',
        VIRTUAL_SCROLL: 'NATIVE_GLOBAL_ROW_INDEX',
        DOM_ROWS: 'COMPLETE_DOM_ORDER',
      }[scanMode],
      windows: rawWindows,
      stopReason: null,
    };
    table.relatedQueryEvidence = {
      ...originalQuery,
      schemaVersion: m.schemaVersion,
      modelRevision: m.modelRevision,
      windows: queryWindows,
    };
  }
  return resealT1(env);
}

export function windowTable(read, gridIndex = 0) {
  return read.relationTables.find(
    (table) => table.gridId === windowModel.grids[gridIndex].gridId,
  );
}

export function mirrorRawQuerySurfaces(table) {
  for (const [index, raw] of table.relatedSurfaceEvidence.windows.entries()) {
    table.relatedQueryEvidence.windows[index].before.surface = copyComplete(
      raw.before,
    );
    table.relatedQueryEvidence.windows[index].after.surface = copyComplete(
      raw.after,
    );
  }
}
