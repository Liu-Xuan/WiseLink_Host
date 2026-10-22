import { tdmsError } from './tdms-source.types';
// A native fixed container roster supplies DOM ordinals, never native row IDs.
// This model does not establish the table's view, applicability or business version.
import { createHash } from 'node:crypto';
// Same canonical JSON/SHA256 as the normal contract and native directory digest.
const canonical = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? '[' + v.map(canonical).join(',') + ']'
      : '{' +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',') +
        '}';
const sha256 = (v) => createHash('sha256').update(canonical(v)).digest('hex');
export const RELATED_STATUS_FIXED_ROW_SLOT_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-related-status-fixed-dom-slots.v1',
  modelRevision: 'tdms-related-status-fixed-dom-slots@1',
  indexOrigin: 'NATIVE_FIXED_DOM_ORDER',
  slotEncoding: 'INDEX_NODE_TOP_HEIGHT_CELLCOUNT@1',
  slotRootLocator:
    '#infoPage_myTab_object_latestStatusLink #relatedStatusLinkTable .x-grid3-body',
  scopeId: 'AEO',
  nativeTypeId:
    'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
  rawHeaderType: 'Publication Source',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_object_latestStatusLink',
  panelLocator: '#infoPage_myTab_object_latestStatusLink',
  gridId: 'relatedStatusLinkTable',
  columns: Object.freeze(
    [
      ['Object Type Indicator', 'type_icon'],
      ['Number', 'number'],
      ['Feed Back Order', 'feedbackOid'],
      ['Updator', 'executeor'],
      ['Execute Time', 'executeDate'],
      ['Document Number', 'docOid'],
      ['AC/ENG/APU', 'standaloneOid'],
      ['Status', 'state'],
      ['State Comments', 'stateComments'],
      ['Standalone expired date', 'danjiexpireDate'],
      ['Delay Request', 'delayRequest'],
      ['SUBS', 'subs'],
      ['SUBSED', 'subsBy'],
      ['EQUAL', 'equiv'],
      ['EQUALED', 'equivBy'],
      ['Modify Date', 'modifyDate'],
      ['OperatorBase', 'OperatorBase'],
    ].map(([actualLabel, nativeColumnToken]) =>
      Object.freeze({ actualLabel, nativeColumnToken }),
    ),
  ),
});
const keys = (v, list) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === list.length &&
  list.every((k) => Object.hasOwn(v, k));
const reject = () => {
  throw tdmsError('TDMS_COMPLETE_RELATION_FIXED_SLOT_EVIDENCE_INVALID');
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  integer = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
export function isReviewedRelatedStatusFixedSlotOwner({
  scopeId,
  owner,
  table,
} = {}) {
  const m = RELATED_STATUS_FIXED_ROW_SLOT_MODEL;
  return (
    scopeId === m.scopeId &&
    /^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(
      owner?.sourceRecordId || '',
    ) &&
    owner.nativeTypeId === m.nativeTypeId &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === m.nativeTypeId &&
    owner.rawHeaderType === m.rawHeaderType &&
    owner.scopeEvidence?.engineeringSubtype === m.scopeId &&
    owner.sourceVersion?.confirmation === 'SOURCE_DECLARED' &&
    table?.tabId === m.tabId &&
    table.panelLocator === m.panelLocator &&
    table.gridId === m.gridId &&
    table.tableId === m.gridId
  );
}
export function requiresRelatedStatusFixedSlotEvidence(table) {
  return (
    table?.gridId === RELATED_STATUS_FIXED_ROW_SLOT_MODEL.gridId &&
    table.scanMode === 'VIRTUAL_SCROLL' &&
    table.rows?.some(
      (r) =>
        r.nativeRowId === null &&
        r.globalIndex !== null &&
        /^relatedStatusLinkTable:ROW\d+$/u.test(r.occurrenceId || ''),
    )
  );
}
export function validateRelatedStatusFixedRowSlotEvidence(
  evidence,
  { scopeId, owner, table } = {},
) {
  if (evidence === undefined) {
    if (requiresRelatedStatusFixedSlotEvidence(table)) reject();
    return false;
  }
  const m = RELATED_STATUS_FIXED_ROW_SLOT_MODEL;
  if (
    !isReviewedRelatedStatusFixedSlotOwner({ scopeId, owner, table }) ||
    !keys(evidence, [
      'schemaVersion',
      'modelRevision',
      'indexOrigin',
      'columns',
      'slotRootLocator',
      'slotEncoding',
      'windows',
    ]) ||
    evidence.schemaVersion !== m.schemaVersion ||
    evidence.modelRevision !== m.modelRevision ||
    evidence.indexOrigin !== m.indexOrigin ||
    evidence.slotRootLocator !== m.slotRootLocator ||
    evidence.slotEncoding !== m.slotEncoding ||
    table.scanMode !== 'VIRTUAL_SCROLL' ||
    !table.countEvidence?.exact ||
    !integer(table.reportedTotal, 1000) ||
    table.reportedTotal < 2 ||
    !Array.isArray(evidence.columns) ||
    evidence.columns.length !== m.columns.length ||
    evidence.columns.some(
      (c, i) =>
        !keys(c, ['actualLabel', 'nativeColumnToken']) ||
        c.actualLabel !== m.columns[i].actualLabel ||
        c.nativeColumnToken !== m.columns[i].nativeColumnToken,
    ) ||
    !same(
      table.rawHeaders,
      m.columns.map((c) => c.actualLabel),
    ) ||
    !Array.isArray(evidence.windows) ||
    !evidence.windows.length ||
    evidence.windows.length > 200 ||
    evidence.windows.length !== table.windows?.length
  )
    reject();
  let baseline = null;
  const captured = new Set(),
    references = new Map();
  for (const [ordinal, pair] of evidence.windows.entries()) {
    const window = table.windows[ordinal],
      n = table.reportedTotal;
    if (
      !keys(pair, ['windowOrdinal', 'before', 'after', 'referenceBindings']) ||
      pair.windowOrdinal !== ordinal ||
      window.ordinal !== ordinal ||
      window.stableReads !== 2 ||
      window.reportedTotal !== n ||
      window.pageRaw !== null ||
      window.treePending !== 0 ||
      window.nextControl?.present !== false ||
      !window.scroll ||
      window.scroll.viewport <= 0 ||
      window.scroll.height <= window.scroll.viewport ||
      window.rowOccurrenceIds.length !== window.globalIndices.length ||
      !Array.isArray(pair.referenceBindings) ||
      pair.referenceBindings.length !== window.rowOccurrenceIds.length
    )
      reject();
    const layout = [];
    for (const side of [pair.before, pair.after]) {
      if (
        !keys(side, ['reportedTotal', 'slots']) ||
        side.reportedTotal !== n ||
        !Array.isArray(side.slots) ||
        side.slots.length !== n
      )
        reject();
      const tokens = new Set();
      let previous = null;
      for (const [i, slot] of side.slots.entries()) {
        if (!Array.isArray(slot) || slot.length !== 5) reject();
        const [index, nodeCaptureId, contentTop, height, cellCount] = slot;
        if (
          index !== i ||
          !integer(nodeCaptureId, 1000) ||
          nodeCaptureId < 1 ||
          tokens.has(nodeCaptureId) ||
          !Number.isFinite(contentTop) ||
          contentTop < 0 ||
          !Number.isFinite(height) ||
          height <= 0 ||
          ![0, 17].includes(cellCount) ||
          contentTop + height > window.scroll.height + 1 ||
          (previous && Math.abs(contentTop - previous[2] - previous[3]) > 1)
        )
          reject();
        tokens.add(nodeCaptureId);
        previous = slot;
      }
      layout.push(side.slots.map((slot) => slot.slice(0, 4)));
    }
    if (
      !same(pair.before, pair.after) ||
      !same(layout[0], layout[1]) ||
      (baseline && !same(baseline, layout[0]))
    )
      reject();
    baseline ||= layout[0];
    const visible = pair.after.slots
      .filter(
        (s) =>
          s[4] === 17 &&
          s[2] + s[3] > window.scroll.top &&
          s[2] < window.scroll.top + window.scroll.viewport,
      )
      .map((s) => s[0]);
    if (!same(visible, window.globalIndices)) reject();
    for (const [i, index] of window.globalIndices.entries()) {
      const occurrence = 'relatedStatusLinkTable:ROW' + index,
        row = table.rows.find((r) => r.occurrenceId === occurrence);
      const binding = pair.referenceBindings[i];
      if (
        window.rowOccurrenceIds[i] !== occurrence ||
        !row ||
        row.globalIndex !== index ||
        row.nativeRowId !== null ||
        row.treeDepth !== null ||
        row.treePath?.length !== 0 ||
        row.cells?.length !== 17 ||
        !Array.isArray(row.sourceLinks) ||
        !keys(binding, ['globalIndex', 'occurrenceId', 'sourceLinksSha256']) ||
        binding.globalIndex !== index ||
        binding.occurrenceId !== occurrence ||
        binding.sourceLinksSha256 !== sha256(row.sourceLinks) ||
        (references.has(occurrence) &&
          references.get(occurrence) !== binding.sourceLinksSha256)
      )
        reject();
      references.set(occurrence, binding.sourceLinksSha256);
      captured.add(occurrence);
    }
  }
  if (
    captured.size !== table.rows.length ||
    table.rows.some((r) => !captured.has(r.occurrenceId))
  )
    reject();
  if (
    table.enumerationState === 'VALUE' &&
    (!table.windows[0].scroll.atTop ||
      !table.windows.at(-1).scroll.atBottom ||
      captured.size !== table.reportedTotal)
  )
    reject();
  return true;
}
