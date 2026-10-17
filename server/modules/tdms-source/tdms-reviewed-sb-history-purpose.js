// Pure SB consumer model selectively vendored from Source 0.2.76 / handoff @9.
import { tdmsError } from './tdms-source.types';
export const REVIEWED_SB_HISTORY_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-history-reference.v1',
  modelRevision: 'tdms-reviewed-sb-history-reference@1',
  reasonCode: 'TDMS_COMPLETE_SB_HISTORY_REFERENCE_ONLY',
  panels: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docObjectsHistoryTab',
      label: 'History',
      panelLocator: '#infoPage_myTab_object_docObjectsHistoryTab',
      componentIds: [
        'infoPage_myTab_object_docObjectsHistoryTab_historyversionHistory_tocItem',
        'infoPage_myTab_object_docObjectsHistoryTab_historytimelineHistory_tocItem',
        'wrap_infoPage_myTab_object_docObjectsHistoryTab_historyversionHistory',
        'wrap_infoPage_myTab_object_docObjectsHistoryTab_historytimelineHistory',
      ],
      grids: [
        {
          gridId: 'version.history.document',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'General Status',
              nativeColumnToken: 'statusFamily_General',
            },
            {
              actualLabel: 'Change Status',
              nativeColumnToken: 'statusFamily_Change',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Version', nativeColumnToken: 'version' },
            { actualLabel: 'Format Icon', nativeColumnToken: 'formatIcon' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'versionInfoPageAction',
            },
            {
              actualLabel: 'Open Associated Content',
              nativeColumnToken: 'openAsscContent',
            },
            {
              actualLabel: 'Information compare',
              nativeColumnToken: 'infoCompareAction',
            },
            { actualLabel: 'File Name', nativeColumnToken: 'fileName' },
            { actualLabel: 'Size', nativeColumnToken: 'fileSize' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            { actualLabel: 'Comments', nativeColumnToken: 'iterationNote' },
            { actualLabel: 'Modified By', nativeColumnToken: 'modified_by' },
            {
              actualLabel: 'Last Modified',
              nativeColumnToken: 'thePersistInfo_modifyStamp',
            },
            {
              actualLabel: 'Authorization',
              nativeColumnToken: 'authorization',
            },
            { actualLabel: 'Predecessor', nativeColumnToken: 'predecessor' },
            { actualLabel: 'Revision', nativeColumnToken: 'revision' },
          ],
        },
      ],
    },
  ],
});
// These exact history components preserve observed references only. No row body or historical enumeration is certified.
export function createSbHistoryValidator(model) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const exact = (v, keys) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const fail = () => {
    throw tdmsError('TDMS_COMPLETE_SB_HISTORY_PURPOSE_INVALID');
  };
  const ownerMatches = (scopeId, owner) =>
    ['SB', 'SL', 'SIL', 'SB-IN', 'MT'].includes(scopeId) &&
    owner?.scopeEvidence?.businessType === scopeId &&
    owner.nativeTypeId === 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument' &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === owner.nativeTypeId &&
    owner.rawHeaderType === 'SB文档' &&
    /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(
      owner.sourceRecordId || '',
    );
  function panel({ scopeId, owner, tab }) {
    return ownerMatches(scopeId, owner)
      ? model.panels.find(
          (p) =>
            p.tabId === tab?.tabId &&
            p.label === tab.label &&
            p.panelLocator === tab.panelLocator,
        ) || null
      : null;
  }
  function timelineReady(embedded, owner, initial = false) {
    if (
      !exact(embedded, ['id', 'rawSrc', 'readyState', 'bodyState']) ||
      embedded.id !== 'timelineIFrame' ||
      embedded.bodyState !== 'NOT_READ' ||
      !(
        initial ? ['loading', 'interactive', 'complete'] : ['complete']
      ).includes(embedded.readyState)
    )
      fail();
    try {
      if (typeof embedded.rawSrc !== 'string') fail();
      const u = new URL(embedded.rawSrc);
      if (
        u.origin !== 'http://tdms.airchina.com' ||
        u.username ||
        u.password ||
        u.hash ||
        ![
          '/Windchill/app/netmarkets/jsp/history/timelineHistory-iframe.jsp',
          '/Windchill/netmarkets/jsp/history/timelineHistory-iframe.jsp',
        ].includes(u.pathname) ||
        u.searchParams.getAll('oid').length !== 1 ||
        u.searchParams.get('oid') !== owner.sourceRecordId ||
        [...u.searchParams.keys()].some(
          (k) => !['oid', 'u8', 'AjaxEnabled'].includes(k),
        ) ||
        ['u8', 'AjaxEnabled'].some(
          (k) =>
            u.searchParams.getAll(k).length > 1 ||
            (u.searchParams.has(k) &&
              u.searchParams.get(k) !== (k === 'u8' ? '1' : 'thirdLevelNav')),
        )
      )
        fail();
    } catch {
      fail();
    }
    return embedded.readyState === 'complete';
  }
  function validate(e, { scopeId, owner, tab, read }) {
    const p = panel({ scopeId, owner, tab });
    if (
      !p ||
      !exact(e, [
        'schemaVersion',
        'modelRevision',
        'ownerSourceRecordId',
        'sourceVersion',
        'sourceModifiedRaw',
        'ownStateRaw',
        'sourceContext',
        'tabId',
        'panelLocator',
        'purpose',
        'bodyState',
        'enumerationState',
        'before',
        'after',
        'settledReads',
      ]) ||
      e.schemaVersion !== model.schemaVersion ||
      e.modelRevision !== model.modelRevision ||
      e.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(e.sourceVersion, owner.sourceVersion) ||
      e.sourceModifiedRaw !== owner.sourceModifiedRaw ||
      e.ownStateRaw !== owner.stateRaw ||
      !same(e.sourceContext, read.sourceContext) ||
      e.tabId !== p.tabId ||
      e.panelLocator !== p.panelLocator ||
      e.purpose !== 'HISTORY_REFERENCE_ONLY' ||
      e.bodyState !== 'NOT_READ' ||
      e.enumerationState !== 'NOT_ENUMERATED' ||
      e.settledReads !== 2 ||
      !same(e.before, e.after)
    )
      fail();
    const f = e.before;
    if (
      !exact(f, [
        'activeTabId',
        'panelId',
        'visible',
        'componentIds',
        'grids',
        'fieldCount',
        'embeddedCount',
        'loading',
        'blockingMarkerCount',
        'rawReferences',
        'unknownSurfaceCount',
        'historyMetadata',
        'embeddedReferences',
      ]) ||
      f.activeTabId !== p.tabId ||
      f.panelId !== p.panelLocator.slice(1) ||
      f.visible !== true ||
      !same(f.componentIds, p.componentIds) ||
      f.fieldCount !== 0 ||
      f.embeddedCount !== 1 ||
      f.loading !== false ||
      f.blockingMarkerCount !== 0 ||
      f.unknownSurfaceCount !== 0 ||
      !Array.isArray(f.grids) ||
      f.grids.length !== p.grids.length ||
      !Array.isArray(f.rawReferences) ||
      f.rawReferences.length > 10000
    )
      fail();
    for (const [i, g] of f.grids.entries()) {
      const m = p.grids[i];
      if (
        !exact(g, ['gridId', 'visible', 'columns', 'renderedRowCount']) ||
        g.gridId !== m.gridId ||
        g.visible !== true ||
        !same(g.columns, m.columns) ||
        !Number.isSafeInteger(g.renderedRowCount) ||
        g.renderedRowCount < 0 ||
        g.renderedRowCount > 10000
      )
        fail();
    }
    for (const r of f.rawReferences)
      if (
        !exact(r, ['locator', 'rawHref']) ||
        typeof r.locator !== 'string' ||
        !r.locator.startsWith(p.panelLocator + ' ') ||
        typeof r.rawHref !== 'string' ||
        r.rawHref.length > 20000
      )
        fail();
    if (
      !Array.isArray(f.historyMetadata) ||
      f.historyMetadata.length !== f.grids[0].renderedRowCount ||
      !Array.isArray(f.embeddedReferences) ||
      f.embeddedReferences.length !== 1
    )
      fail();
    for (const row of f.historyMetadata) {
      if (
        !exact(row, ['rowOrdinal', 'version', 'predecessor', 'revision']) ||
        !Number.isSafeInteger(row.rowOrdinal) ||
        row.rowOrdinal < 0 ||
        row.rowOrdinal >= f.historyMetadata.length
      )
        fail();
      for (const key of ['version', 'predecessor', 'revision'])
        if (typeof row[key] !== 'string' || row[key].length > 20000) fail();
    }
    if (
      new Set(f.historyMetadata.map((r) => r.rowOrdinal)).size !==
      f.historyMetadata.length
    )
      fail();
    timelineReady(f.embeddedReferences[0], owner);
    if (
      tab.required !== false ||
      tab.state !== 'NOT_READ' ||
      tab.reasonCode !== model.reasonCode
    )
      fail();
    for (const key of ['fields', 'sections', 'relationTables'])
      if (read[key]?.some((x) => x.tabId === p.tabId)) fail();
    return { complete: true, bodyRead: false, enumerationComplete: false };
  }
  return { panel, validate, timelineReady };
}
const validator = createSbHistoryValidator(REVIEWED_SB_HISTORY_MODEL);
export const reviewedSbHistoryPanel = validator.panel;
export const validateReviewedSbHistoryPurpose = validator.validate;
