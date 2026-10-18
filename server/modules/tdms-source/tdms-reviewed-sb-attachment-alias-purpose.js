// Pure SB consumer model selectively vendored from Source 0.2.73 / handoff @8.
import { tdmsError } from './tdms-source.types';
export const REVIEWED_SB_ATTACHMENT_ALIAS_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-attachment-alias.v1',
  modelRevision: 'tdms-reviewed-sb-attachment-alias@1',
  reasonCode: 'TDMS_COMPLETE_SB_ATTACHMENT_CANONICAL_ALIAS',
  canonicalTabId:
    'infoPageinfoPanelID__infoPage_myTab_object_docContentInfoDetails',
  panels: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_225694243',
      label: '附件',
      panelLocator: '#infoPage_myTab_tab_jcaGen_225694243',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_225694243_objectattachments_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_225694243_objectattachments',
      ],
      grids: [
        {
          gridId: 'attachments.table.secondary',
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
    },
  ],
});
// These exact attachment alias components preserve observed references only. No row body or historical enumeration is certified.
export function createSbAttachmentAliasValidator(model) {
  const same = (a, b) => {
    if (a === b) return true;
    if (
      !a ||
      !b ||
      typeof a !== 'object' ||
      typeof b !== 'object' ||
      Array.isArray(a) !== Array.isArray(b)
    )
      return false;
    if (Array.isArray(a) && a.length !== b.length) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
    );
  };
  const exact = (v, keys) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const fail = () => {
    throw tdmsError('TDMS_COMPLETE_SB_ATTACHMENT_ALIAS_PURPOSE_INVALID');
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
        'aliasTable',
        'canonicalTableId',
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
      e.purpose !== 'CANONICAL_ATTACHMENT_ALIAS' ||
      e.bodyState !== 'BOUND_TO_CANONICAL' ||
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
      ]) ||
      f.activeTabId !== p.tabId ||
      f.panelId !== p.panelLocator.slice(1) ||
      f.visible !== true ||
      !same(f.componentIds, p.componentIds) ||
      f.fieldCount !== 0 ||
      f.embeddedCount !== 0 ||
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
    const canonical = read.relationTables.filter(
        (t) =>
          t.tabId === model.canonicalTabId && t.gridId === p.grids[0].gridId,
      ),
      alias = e.aliasTable;
    if (
      canonical.length !== 1 ||
      e.canonicalTableId !== canonical[0].tableId ||
      alias?.tabId !== tab.tabId ||
      alias.panelLocator !== tab.panelLocator ||
      alias.gridId !== p.grids[0].gridId ||
      alias.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(alias.ownerSourceVersion, owner.sourceVersion)
    )
      fail();
    const projection = (t) => ({
      rawHeaders: t.rawHeaders,
      reportedTotal: t.reportedTotal,
      enumerationState: t.enumerationState,
      rows: t.rows.map((row) => ({
        observedVersion: row.observedVersion,
        cells: row.cells.map((cell) => ({
          actualLabel: cell.actualLabel,
          state: cell.state,
          rawValue: cell.rawValue,
          observedTotalCodepoints: cell.observedTotalCodepoints,
        })),
        sourceLinks: row.sourceLinks.map((link) => ({
          rawHref: link.rawHref,
          targetRef: link.targetRef,
          numberRaw: link.numberRaw,
          nativeRole: link.nativeRole,
          nativeColumnLabel: link.nativeColumnLabel,
          nativeColumnToken: link.nativeColumnToken,
        })),
      })),
    });
    if (!same(projection(alias), projection(canonical[0]))) fail();
    if (
      tab.required !== false ||
      tab.state !== 'NOT_READ' ||
      tab.reasonCode !== model.reasonCode
    )
      fail();
    for (const key of ['fields', 'sections', 'relationTables'])
      if (read[key]?.some((x) => x.tabId === p.tabId)) fail();
    return { complete: true, canonicalAlias: true, enumerationComplete: false };
  }
  return { panel, validate };
}
const validator = createSbAttachmentAliasValidator(
  REVIEWED_SB_ATTACHMENT_ALIAS_MODEL,
);
export const reviewedSbAttachmentAliasPanel = validator.panel;
export const validateReviewedSbAttachmentAliasPurpose = validator.validate;
