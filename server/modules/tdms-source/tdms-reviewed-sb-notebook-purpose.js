// Pure SB consumer model selectively vendored from Source 0.2.76 / handoff @9.
import { tdmsError } from './tdms-source.types';
export const REVIEWED_SB_NOTEBOOK_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-notebook-mixed.v1',
  modelRevision: 'tdms-reviewed-sb-notebook-mixed@1',
  reasonCode: 'TDMS_COMPLETE_SB_NOTEBOOK_MIXED',
  businessGridId: 'netmarkets.notebookfolder.referenceNotebook',
  panels: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_866988689',
      label: '笔记本',
      panelLocator: '#infoPage_myTab_tab_jcaGen_866988689',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_866988689_historytimelineHistory_tocItem',
        'infoPage_myTab_tab_jcaGen_866988689_historylegacyLCHistory_tocItem',
        'infoPage_myTab_tab_jcaGen_866988689_workflowprocessHistory_tocItem',
        'infoPage_myTab_tab_jcaGen_866988689_notebookreference_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_866988689_historytimelineHistory',
        'wrap_infoPage_myTab_tab_jcaGen_866988689_historylegacyLCHistory',
        'wrap_infoPage_myTab_tab_jcaGen_866988689_workflowprocessHistory',
        'wrap_infoPage_myTab_tab_jcaGen_866988689_notebookreference',
      ],
      grids: [
        {
          gridId: 'lifecycleHistoryTableId',
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
        {
          gridId: 'processHistoryTableId',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Name', nativeColumnToken: 'procName' },
            { actualLabel: 'Status', nativeColumnToken: 'procStatus' },
            { actualLabel: 'Initiated By', nativeColumnToken: 'creator' },
            { actualLabel: 'Date Started', nativeColumnToken: 'startTime' },
            { actualLabel: 'Date Completed', nativeColumnToken: 'endTime' },
          ],
        },
        {
          gridId: 'taskStatusTableId',
          columns: [
            { actualLabel: 'Status', nativeColumnToken: 'ASSIGNMENT_STATUS' },
            {
              actualLabel: 'Latest action performed.',
              nativeColumnToken: 'ASSIGNMENT_REASSIGNED',
            },
            {
              actualLabel: 'Workflow Signatures',
              nativeColumnToken: 'workSigRequired',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'workIcon',
            },
            { actualLabel: 'Name', nativeColumnToken: 'workName' },
            { actualLabel: 'Assignee', nativeColumnToken: 'workAssignee' },
            { actualLabel: 'Role', nativeColumnToken: 'workRole' },
            { actualLabel: 'Vote', nativeColumnToken: 'workVote' },
            { actualLabel: 'Comments', nativeColumnToken: 'workComments' },
            {
              actualLabel: 'Completed By',
              nativeColumnToken: 'workCompletedBy',
            },
            { actualLabel: 'Due Date', nativeColumnToken: 'workDeadline' },
            {
              actualLabel: 'Date Completed',
              nativeColumnToken: 'workCompletedDate',
            },
          ],
        },
        {
          gridId: 'taskHistoryTableId',
          columns: [
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'workIcon',
            },
            { actualLabel: 'Name', nativeColumnToken: 'activityName' },
            {
              actualLabel: 'Original Assignee',
              nativeColumnToken: 'originalAssignee',
            },
            { actualLabel: 'New Assignee', nativeColumnToken: 'newAssignee' },
            { actualLabel: 'Action', nativeColumnToken: 'actionName' },
            {
              actualLabel: 'Performed By',
              nativeColumnToken: 'actionPerformedBy',
            },
            {
              actualLabel: 'Reason for Action',
              nativeColumnToken: 'reasonForAction',
            },
            {
              actualLabel: 'Performed On',
              nativeColumnToken: 'actionPerformedOn',
            },
          ],
        },
        {
          gridId: 'netmarkets.notebookfolder.referenceNotebook',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            { actualLabel: 'Name', nativeColumnToken: 'notebookNameId' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'viewInfoAction',
            },
            { actualLabel: 'New Link', nativeColumnToken: 'newLinkAction' },
            { actualLabel: 'Edit Link', nativeColumnToken: 'editLinkAction' },
          ],
        },
      ],
    },
  ],
});
// These exact notebook components preserve observed references only. No row body or historical enumeration is certified.
export function createSbNotebookValidator(model) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const exact = (v, keys) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const fail = () => {
    throw tdmsError('TDMS_COMPLETE_SB_NOTEBOOK_PURPOSE_INVALID');
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
      e.purpose !== 'MANAGEMENT_REFERENCES_AND_REQUIRED_NOTEBOOK_LINKS' ||
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
      !Array.isArray(f.embeddedReferences) ||
      f.embeddedReferences.length !== 1
    )
      fail();
    timelineReady(f.embeddedReferences[0], owner);
    const business = read.relationTables.filter((t) => t.tabId === tab.tabId);
    if (
      business.length !== 1 ||
      business[0].gridId !== model.businessGridId ||
      business[0].ownerSourceRecordId !== owner.sourceRecordId ||
      !same(business[0].ownerSourceVersion, owner.sourceVersion) ||
      read.fields.some((f) => f.tabId === tab.tabId)
    )
      fail();
    const complete =
      business[0].enumerationState === 'VALUE' &&
      business[0].rows.every((row) =>
        row.cells.every((c) => ['VALUE', 'BLANK'].includes(c.state)),
      );
    if (
      tab.required !== true ||
      tab.state !== (complete ? 'VALUE' : 'NOT_READ') ||
      tab.reasonCode !== (complete ? null : model.reasonCode)
    )
      fail();
    return {
      complete,
      reasonCode: complete ? null : model.reasonCode,
      managementBodyRead: false,
      managementEnumerationComplete: false,
    };
  }
  return { panel, validate, timelineReady };
}
const validator = createSbNotebookValidator(REVIEWED_SB_NOTEBOOK_MODEL);
export const reviewedSbNotebookPanel = validator.panel;
export const validateReviewedSbNotebookPurpose = validator.validate;
