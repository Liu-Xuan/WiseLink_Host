// Pure Source model from the SHA-qualified 21/11 file handoff; no collector or authority.
import { tdmsError } from './tdms-source.types';
// This model proves presented native hierarchy, never complete tree enumeration.
export const REVIEWED_AD_HANDLING_NATIVE_TREE_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-handling-native-tree@1',
  scopeId: 'AD_HANDLING_FORM',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_adTreeReport',
  panelLocator: '#infoPage_myTab_ad_adTreeReport',
  gridId: 'mytreetable',
  tableTitle: 'AD RelationShip',
  numberRole: 'NATIVE_TREE_NUMBER_TARGET',
  countMeaning: 'RENDERED_NODE_COUNT_ONLY',
  nativeCount: Object.freeze({
    nodeTag: 'SPAN',
    nodeClassToken: 'tableCount',
    candidateLimit: 2,
  }),
  collapsedControl: Object.freeze({
    tag: 'DIV',
    class: 'ux-maximgb-tg-elbow-active ux-maximgb-tg-elbow-end-plus',
    id: null,
    ariaExpanded: null,
    expandedClass: 'ux-maximgb-tg-elbow-active ux-maximgb-tg-elbow-end-minus',
    inputSha256:
      'a4d8ed376391203b98c027e0337f8909eb1a5c79f83220e3b3b2c9f9632fc283',
  }),
  stopReason: 'TDMS_COMPLETE_AD_HANDLING_TREE_TERMINAL_UNREVIEWED',
  inputSha256:
    '532c368213c7bb7f806f4f9219af3d530766094224bc5d113912b12ce98d5a28',
  columns: Object.freeze(
    [
      ['Object Type Indicator', 'type_icon'],
      ['Number', 'number'],
      ['View Information', 'infoPageAction'],
      ['Primary Content', 'primaryAttachmentProperties'],
      ['Name', 'name'],
      ['AD序号', 'IBA|ADSequenceNO'],
      ['State', 'state'],
      ['Created By', 'creator'],
      ['Last Modified', 'thePersistInfo_modifyStamp'],
    ].map(([actualLabel, nativeColumnToken]) =>
      Object.freeze({
        actualLabel,
        nativeColumnToken,
        valuePolicy:
          nativeColumnToken === 'number'
            ? 'NATIVE_NUMBER_IDENTITY'
            : 'NOT_READ',
      }),
    ),
  ),
});
const m = REVIEWED_AD_HANDLING_NATIVE_TREE_MODEL;
const fail = () => {
  throw tdmsError('TDMS_COMPLETE_AD_HANDLING_TREE_MODEL_INVALID');
};
const exact = (v, keys) =>
  v &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const raw = (v, max = 1000) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const tokens = (v) => (typeof v === 'string' ? v.trim().split(/\s+/u) : []);
const classes = [
  'wt.doc.WTDocument',
  'wt.change2.WTChangeRequest2',
  'wt.change2.WTChangeOrder2',
  'wt.change2.WTChangeActivity2',
];
const classAt = (ref, depth) =>
  new RegExp(
    '^(?:OR|VR):' + classes[depth]?.replaceAll('.', '\\.') + ':\\d{1,24}$',
    'u',
  ).test(ref || '');
function numberTarget(rawHref) {
  let u;
  try {
    u = new URL(rawHref, 'http://tdms.airchina.com/Windchill/');
  } catch {
    return null;
  }
  if (
    u.origin !== 'http://tdms.airchina.com' ||
    u.username ||
    u.password ||
    !(
      u.pathname.endsWith('/tcomp/infoPage') ||
      /^#ptc\d+\/tcomp\/infoPage(?:\?|$)/u.test(u.hash)
    )
  )
    return null;
  const hash = new URLSearchParams(u.hash.split('?')[1] || '');
  if (
    [...u.searchParams.keys(), ...hash.keys()].some((k) =>
      /token|auth|sig|session|ticket/iu.test(k),
    )
  )
    return null;
  const query = u.searchParams.getAll('oid'),
    fragment = hash.getAll('oid');
  const values = [...query, ...fragment];
  return values.length === 1 ? values[0] : null;
}
export function isReviewedAdHandlingTreeTable({ scopeId, owner, table } = {}) {
  return (
    scopeId === m.scopeId &&
    owner?.rawHeaderType === 'AD处理单' &&
    owner.nativeTypeId === null &&
    classAt(owner.sourceRecordId, 1) &&
    table?.tableId === m.gridId &&
    table.gridId === m.gridId &&
    table.tabId === m.tabId &&
    table.panelLocator === m.panelLocator &&
    table.tableTitle === m.tableTitle
  );
}
function validateTreeShape(shape, row, i, allowCollapsed = false) {
  const link = row.sourceLinks?.[0];
  if (
    !exact(shape, [
      'occurrenceId',
      'rowClass',
      'numberCellClass',
      'levelClass',
      'uiWrap',
      'elbows',
      'numberLink',
    ]) ||
    shape.occurrenceId !== row.occurrenceId ||
    row.occurrenceId !== m.gridId + ':TREE:' + link?.targetRef ||
    !raw(shape.rowClass) ||
    !tokens(shape.rowClass).includes('x-grid3-row') ||
    !raw(shape.numberCellClass) ||
    !same(tokens(shape.numberCellClass), [
      'x-grid3-col',
      'x-grid3-cell',
      'x-grid3-td-number',
    ]) ||
    !exact(shape.uiWrap, ['class', 'style']) ||
    shape.uiWrap.class !== 'ux-maximgb-tg-uiwrap' ||
    !raw(shape.uiWrap.style, 200) ||
    !Array.isArray(shape.elbows) ||
    shape.elbows.length < 1 ||
    shape.elbows.length > 4 ||
    row.globalIndex !== null ||
    row.nativeRelationId !== null ||
    row.rawRole !== null ||
    row.rawDirection !== null ||
    row.sourceLinks?.length !== 1 ||
    !link ||
    link.nativeRole !== m.numberRole ||
    link.nativeColumnLabel !== 'Number' ||
    link.nativeColumnToken !== 'number' ||
    !exact(shape.numberLink, ['rawHref', 'locator', 'targetRef']) ||
    shape.numberLink.rawHref !== link.rawHref ||
    shape.numberLink.locator !== link.locator ||
    shape.numberLink.targetRef !== link.targetRef ||
    numberTarget(link.rawHref) !== link.targetRef
  )
    fail();
  const width = shape.uiWrap.style.match(/^\s*width:\s*(\d+)px\s*;?\s*$/u),
    depth = width ? Number(width[1]) / 16 - 1 : null;
  const level = tokens(shape.rowClass).filter((c) =>
    c.startsWith('ux-maximgb-tg-level-'),
  );
  if (
    !Number.isSafeInteger(depth) ||
    depth < 0 ||
    depth > 3 ||
    level.length > 1 ||
    shape.levelClass !== (level[0] ?? null) ||
    (level.length === 1 && level[0] !== 'ux-maximgb-tg-level-' + depth) ||
    shape.elbows.length !== depth + 1 ||
    row.treeDepth !== depth ||
    !classAt(link.targetRef, depth)
  )
    fail();
  for (const [j, elbow] of shape.elbows.entries()) {
    if (!exact(elbow, ['class', 'style']) || !raw(elbow.style, 200)) fail();
    const left = elbow.style.match(/^\s*left:\s*(\d+)px\s*;?\s*$/u);
    if (
      !left ||
      Number(left[1]) !== (j === depth ? 1 + 16 * depth : 16 * j) ||
      (j < depth && elbow.class !== 'ux-maximgb-tg-elbow-empty') ||
      (j === depth &&
        ![
          m.collapsedControl.expandedClass,
          'ux-maximgb-tg-elbow-end',
          ...(allowCollapsed && [1, 2].includes(depth)
            ? [m.collapsedControl.class]
            : []),
        ].includes(elbow.class))
    )
      fail();
  }
  // Only the observed single-chain shapes are reviewed; new roots/branches need review.
  if (
    i !== depth ||
    (depth < 3 &&
      shape.elbows.at(-1).class !== m.collapsedControl.expandedClass &&
      !(
        allowCollapsed &&
        [1, 2].includes(depth) &&
        shape.elbows.at(-1).class === m.collapsedControl.class
      )) ||
    (depth === 3 && shape.elbows.at(-1).class !== 'ux-maximgb-tg-elbow-end')
  )
    fail();
  return {
    depth,
    collapsed: shape.elbows.at(-1).class === m.collapsedControl.class,
  };
}
export function validateReviewedAdHandlingTreeTable({
  scopeId,
  owner,
  table: t,
  allowCollapsed = false,
} = {}) {
  if (!isReviewedAdHandlingTreeTable({ scopeId, owner, table: t })) {
    if (t?.nativeTreeEvidence !== undefined) fail();
    return false;
  }
  const evidence = t.nativeTreeEvidence;
  if (
    !exact(evidence, ['modelRevision', 'columns', 'rowShapes', 'titleRaw']) ||
    evidence.modelRevision !== m.modelRevision ||
    !same(
      evidence.columns,
      m.columns.map(({ actualLabel, nativeColumnToken }) => ({
        actualLabel,
        nativeColumnToken,
      })),
    ) ||
    !raw(evidence.titleRaw, 500) ||
    !/^\s*AD RelationShip(?:\s*\(\s*\d+\s+objects?\s*\))?\s*$/iu.test(
      evidence.titleRaw,
    ) ||
    !same(
      t.rawHeaders,
      m.columns.map((c) => c.actualLabel),
    ) ||
    t.ownerSourceRecordId !== owner.sourceRecordId ||
    !same(t.ownerSourceVersion, owner.sourceVersion) ||
    t.relationshipRole !== 'CURRENT_CONTENT' ||
    t.direction !== 'UNKNOWN' ||
    t.scanMode !== 'TREE' ||
    !['NOT_READ', 'TRUNCATED'].includes(t.enumerationState) ||
    t.stopReason !== m.stopReason ||
    t.countEvidence?.exact !== false ||
    t.terminal?.kind !== 'UNCONFIRMED' ||
    t.terminal.nativeTerminal !== false ||
    t.terminal.allGlobalIndices !== false ||
    t.terminal.allTreeNodesExpanded !== false ||
    t.terminal.trueZero !== false ||
    t.terminal.settledReads !== 2 ||
    !Array.isArray(t.treeExpansions) ||
    t.treeExpansions.length > 2 ||
    !Array.isArray(t.rows) ||
    t.rows.length < 2 ||
    t.rows.length > 1000 ||
    !Array.isArray(evidence.rowShapes) ||
    evidence.rowShapes.length !== t.rows.length ||
    !Array.isArray(t.windows) ||
    t.windows.length !== t.treeExpansions.length + 1 ||
    t.windows.some((w) => w.globalIndices?.length !== 0)
  )
    fail();
  const count = t.countEvidence.rawText?.match(
      /^\(\s*(\d+)\s+objects?\s*\)$/iu,
    ),
    titleCount = evidence.titleRaw.match(/\(\s*(\d+)\s+objects?\s*\)/iu);
  if (
    (t.countEvidence.rawText !== null &&
      (!count || Number(count[1]) !== t.reportedTotal)) ||
    (titleCount && Number(titleCount[1]) !== t.reportedTotal)
  )
    fail();
  const stack = [],
    refs = new Set();
  let ownerSeen = 0;
  for (const [i, row] of t.rows.entries()) {
    const { depth, collapsed } = validateTreeShape(
        evidence.rowShapes[i],
        row,
        i,
        allowCollapsed,
      ),
      link = row.sourceLinks[0];
    if (
      depth > stack.length ||
      refs.has(link.targetRef) ||
      (collapsed && i !== t.rows.length - 1)
    )
      fail();
    stack.length = depth;
    stack[depth] = link.targetRef;
    refs.add(link.targetRef);
    if (
      !same(row.treePath, stack) ||
      row.observedVersion?.confirmation !== 'VERSION_UNCONFIRMED' ||
      row.observedVersion.rawRevision !== null ||
      row.observedVersion.rawIteration !== null ||
      row.cells?.length !== m.columns.length
    )
      fail();
    for (const [j, cell] of row.cells.entries()) {
      if (
        cell.actualLabel !== m.columns[j].actualLabel ||
        (j === 1 &&
          (cell.state !== 'VALUE' || cell.rawValue !== link.numberRaw)) ||
        (j !== 1 &&
          (cell.state !== 'NOT_READ' ||
            cell.rawValue !== null ||
            cell.observedTotalCodepoints !== 0))
      )
        fail();
    }
    if (depth === 1) {
      if (
        link.targetRef !== owner.sourceRecordId ||
        link.numberRaw !== owner.number
      )
        fail();
      ownerSeen++;
    }
  }
  if (
    ownerSeen !== 1 ||
    !same(
      t.windows.at(-1).rowOccurrenceIds,
      t.rows.map((r) => r.occurrenceId),
    )
  )
    fail();
  for (const [i, w] of t.windows.entries()) {
    if (
      w.ordinal !== i ||
      w.stableReads !== 2 ||
      w.globalIndices.length ||
      !Array.isArray(w.rowOccurrenceIds) ||
      (w.reportedTotal !== null &&
        w.reportedTotal !== w.rowOccurrenceIds.length)
    )
      fail();
  }
  for (const [i, e] of t.treeExpansions.entries()) {
    if (
      !exact(e, [
        'nativeRowId',
        'path',
        'beforeExpanded',
        'afterExpanded',
        'addedOccurrenceIds',
        'controlLocator',
        'beforeShape',
        'afterShape',
        'beforeControl',
        'afterControl',
        'beforeWindowOrdinal',
        'afterWindowOrdinal',
      ]) ||
      e.beforeExpanded !== false ||
      e.afterExpanded !== true ||
      e.beforeWindowOrdinal !== i ||
      e.afterWindowOrdinal !== i + 1 ||
      !raw(e.controlLocator, 700) ||
      !Array.isArray(e.path) ||
      e.path.length < 2 ||
      e.path.length > 3
    )
      fail();
    const row = t.rows.find(
        (r) => r.sourceLinks[0].targetRef === e.path.at(-1),
      ),
      before = t.windows[i],
      after = t.windows[i + 1];
    if (
      !row ||
      e.nativeRowId !== row.nativeRowId ||
      !same(e.path, row.treePath) ||
      !before.rowOccurrenceIds.includes(row.occurrenceId) ||
      !after.rowOccurrenceIds.includes(row.occurrenceId) ||
      !same(
        after.rowOccurrenceIds.slice(0, before.rowOccurrenceIds.length),
        before.rowOccurrenceIds,
      ) ||
      after.rowOccurrenceIds.length !== before.rowOccurrenceIds.length + 1 ||
      !same(
        e.addedOccurrenceIds,
        after.rowOccurrenceIds.filter(
          (id) => !before.rowOccurrenceIds.includes(id),
        ),
      )
    )
      fail();
    for (const [key, expectedClass] of [
      ['beforeControl', m.collapsedControl.class],
      ['afterControl', m.collapsedControl.expandedClass],
    ]) {
      const c = e[key];
      if (
        !exact(c, ['tag', 'attributes']) ||
        c.tag !== m.collapsedControl.tag ||
        !exact(c.attributes, ['class', 'style']) ||
        c.attributes.class !== expectedClass ||
        c.attributes.style !==
          (key === 'beforeControl' ? e.beforeShape : e.afterShape).elbows.at(-1)
            .style
      )
        fail();
    }
    const shapeRow = (shape) => ({
      ...row,
      sourceLinks: [{ ...row.sourceLinks[0], ...shape.numberLink }],
    });
    const a = validateTreeShape(
        e.beforeShape,
        shapeRow(e.beforeShape),
        row.treeDepth,
        true,
      ),
      b = validateTreeShape(
        e.afterShape,
        shapeRow(e.afterShape),
        row.treeDepth,
      );
    if (
      !a.collapsed ||
      b.collapsed ||
      a.depth !== b.depth ||
      e.beforeShape.numberLink.targetRef !== row.sourceLinks[0].targetRef ||
      e.afterShape.numberLink.targetRef !== row.sourceLinks[0].targetRef ||
      e.beforeShape.numberLink.rawHref !== e.afterShape.numberLink.rawHref
    )
      fail();
  }
  return true;
}
export function reviewedAdHandlingTreeOccurrence({
  scopeId,
  owner,
  table,
  row,
  link,
} = {}) {
  if (!validateReviewedAdHandlingTreeTable({ scopeId, owner, table }))
    return null;
  if (
    !table.rows.includes(row) ||
    row.sourceLinks.length !== 1 ||
    row.sourceLinks[0] !== link
  )
    fail();
  return {
    relationshipRole:
      link.targetRef === owner.sourceRecordId
        ? 'OUT_OF_SCOPE_REFERENCE'
        : 'CURRENT_CONTENT',
    modelRoleOrigin: 'REVIEWED_NATIVE_TREE_MODEL',
    treePath: row.treePath,
  };
}
