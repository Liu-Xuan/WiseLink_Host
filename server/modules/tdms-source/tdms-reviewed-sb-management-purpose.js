// Pure SB consumer model selectively vendored from Source 0.2.73 / handoff @8.
import { tdmsError } from './tdms-source.types';
export const REVIEWED_SB_MANAGEMENT_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-management-reference.v1',
  modelRevision: 'tdms-reviewed-sb-management-reference@1',
  reasonCode: 'TDMS_COMPLETE_SB_MANAGEMENT_REFERENCE_ONLY',
  panels: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_45658671',
      label: '工作流进程',
      panelLocator: '#infoPage_myTab_tab_jcaGen_45658671',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_45658671_workflowprocessHistory_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_45658671_workflowprocessHistory',
      ],
      grids: [
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
      ],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_866988688',
      label: '成员',
      panelLocator: '#infoPage_myTab_tab_jcaGen_866988688',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_866988688_teamlistTeamCC_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_866988688_teamlistTeamCC',
      ],
      grids: [
        {
          gridId: 'windchill.enterprise.team.commonTeam',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'teamMemberImage',
            },
            { actualLabel: 'Roles/Members', nativeColumnToken: 'name_proj' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'team_infoPageAction',
            },
            { actualLabel: 'Description', nativeColumnToken: 'description' },
            { actualLabel: 'E-mail', nativeColumnToken: 'email' },
            { actualLabel: 'Phone', nativeColumnToken: 'phoneNumber' },
          ],
        },
      ],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_5831746073',
      label: '新建选项卡 2',
      panelLocator: '#infoPage_myTab_tab_jcaGen_5831746073',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_5831746073_historylegacyLCHistory_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_5831746073_historylegacyLCHistory',
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
      ],
    },
  ],
});
// These exact management components preserve observed references only. No row body or historical enumeration is certified.
export function createSbManagementValidator(model) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const exact = (v, keys) =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const fail = () => {
    throw tdmsError('TDMS_COMPLETE_SB_MANAGEMENT_PURPOSE_INVALID');
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
      e.purpose !== 'MANAGEMENT_REFERENCE_ONLY' ||
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
  return { panel, validate };
}
const validator = createSbManagementValidator(REVIEWED_SB_MANAGEMENT_MODEL);
export const reviewedSbManagementPanel = validator.panel;
export const validateReviewedSbManagementPurpose = validator.validate;
