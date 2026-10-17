// Frozen H272 pure consumer; does not grant source or body admission.
import { tdmsError } from './tdms-source.types';
// Native component metadata only; no row text, query scope or body absence is inferred.
export const REVIEWED_AD_HANDLING_REQUIRED_SURFACE_MODEL = Object.freeze({
  modelRevision: 'tdms-reviewed-ad-handling-required-native-surfaces@1',
  schemaVersion: 'wiselink.tdms-ad-handling-required-native-surfaces.v1',
  scopeId: 'AD_HANDLING_FORM',
  nativeClass: 'wt.change2.WTChangeRequest2',
  nativeHeaderType: 'AD处理单',
  nativeInputSha256:
    '32bcf8a0f5972836b6dbbf27fd44aaef302fa2232587c741ad737fc97b6e9e39',
  nativeInputRef:
    'TDMS_AD_CHAIN_IDENTITY_CLOSURE_ROOT_20261014/native-input-batch-root-20261015/H_SIX_NATIVE_PANELS_INPUT.json',
  bodyCoverage: 'UNPROVEN',
  queryDefinition: 'UNKNOWN',
  terminalEvidence: 'UNKNOWN',
  stopReason: 'TDMS_COMPLETE_AD_HANDLING_SURFACE_QUERY_AND_END_UNREVIEWED',
  panels: [
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_changeRequestProcessTab',
      label: 'Process',
      panelLocator: '#infoPage_myTab_object_changeRequestProcessTab',
      grids: [
        {
          gridId: 'windchill.enterprise.team.commonTeam',
          requiredClassTokens: [
            'x-panel',
            'x-panel-noborder',
            'x-grid-panel',
            'ux-maximgb-tg-panel',
          ],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'teamMemberImage',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Roles/Members',
              nativeColumnToken: 'name_proj',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'team_infoPageAction',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Description',
              nativeColumnToken: 'description',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'E-mail',
              nativeColumnToken: 'email',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Phone',
              nativeColumnToken: 'phoneNumber',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'netmarkets.change.assignments.list',
          requiredClassTokens: [
            'x-panel',
            'x-panel-noborder',
            'x-grid-panel',
            'ux-maximgb-tg-panel',
          ],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Change Object/Related Tasks',
              nativeColumnToken: 'ASSIGNMENT_OBJECT',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageAction',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Reassigned',
              nativeColumnToken: 'ASSIGNMENT_REASSIGNED',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Assignee',
              nativeColumnToken: 'workitem_assignee',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Status',
              nativeColumnToken: 'ASSIGNMENT_STATUS',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Process',
              nativeColumnToken: 'workitem_processname',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Process Status',
              nativeColumnToken: 'workitem_processStatus',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Actions',
              nativeColumnToken: 'ASSIGNMENT_ROWACTIONS',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Due Date',
              nativeColumnToken: 'ASSIGNMENT_DEADLINE',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date Started',
              nativeColumnToken: 'workitem_startTime',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date Completed',
              nativeColumnToken: 'workitem_endTime',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'processHistoryTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Name',
              nativeColumnToken: 'procName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Status',
              nativeColumnToken: 'procStatus',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Initiated By',
              nativeColumnToken: 'creator',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date Started',
              nativeColumnToken: 'startTime',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date Completed',
              nativeColumnToken: 'endTime',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'taskStatusTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: 'Status',
              nativeColumnToken: 'ASSIGNMENT_STATUS',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Latest action performed.',
              nativeColumnToken: 'ASSIGNMENT_REASSIGNED',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Workflow Signatures',
              nativeColumnToken: 'workSigRequired',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'workIcon',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Name',
              nativeColumnToken: 'workName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Assignee',
              nativeColumnToken: 'workAssignee',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Role',
              nativeColumnToken: 'workRole',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Vote',
              nativeColumnToken: 'workVote',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Comments',
              nativeColumnToken: 'workComments',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Completed By',
              nativeColumnToken: 'workCompletedBy',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Due Date',
              nativeColumnToken: 'workDeadline',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date Completed',
              nativeColumnToken: 'workCompletedDate',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'taskHistoryTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'workIcon',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Name',
              nativeColumnToken: 'activityName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Original Assignee',
              nativeColumnToken: 'originalAssignee',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'New Assignee',
              nativeColumnToken: 'newAssignee',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Action',
              nativeColumnToken: 'actionName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Performed By',
              nativeColumnToken: 'actionPerformedBy',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Reason for Action',
              nativeColumnToken: 'reasonForAction',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Performed On',
              nativeColumnToken: 'actionPerformedOn',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'netmarkets.forum.discussion',
          requiredClassTokens: [
            'x-panel',
            'x-panel-noborder',
            'x-grid-panel',
            'ux-maximgb-tg-panel',
          ],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Name',
              nativeColumnToken: 'name',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Actions',
              nativeColumnToken: 'action',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: '',
              nativeColumnToken: 'subscribe',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Created By',
              nativeColumnToken: 'ownership_owner',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'createTimestamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
      ],
      controlIds: [
        'windchill.enterprise.team.commonTeamfilterSelect',
        'windchill.enterprise.team.commonTeam.fitTextField',
        'netmarkets.change.assignments.listfilterSelect',
        'netmarkets.change.assignments.list.fitTextField',
        'processHistoryTableId.searchInListTextBox',
        'taskStatusTableId.searchInListTextBox',
        'taskHistoryTableId.searchInListTextBox',
        'netmarkets.forum.discussionfilterSelect',
        'netmarkets.forum.discussion.fitTextField',
      ],
      maskIds: [
        'header_processHistoryTableId_titleBarMask',
        'processHistoryTableId.searchInListLoadingWheel',
        'footer_processHistoryTableId_titleBarMask',
        'header_taskStatusTableId_titleBarMask',
        'taskStatusTableId.searchInListLoadingWheel',
        'footer_taskStatusTableId_titleBarMask',
        'header_taskHistoryTableId_titleBarMask',
        'taskHistoryTableId.searchInListLoadingWheel',
        'footer_taskHistoryTableId_titleBarMask',
      ],
      frameIds: [],
    },
    {
      tabId:
        'infoPageinfoPanelID__infoPage_myTab_object_changeObjectsHistoryTab',
      label: 'History',
      panelLocator: '#infoPage_myTab_object_changeObjectsHistoryTab',
      grids: [
        {
          gridId: 'maturity.historyVersioned',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Revision',
              nativeColumnToken: 'revision',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'State',
              nativeColumnToken: 'state',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Promoted By',
              nativeColumnToken: 'promotedBy',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Promoted On',
              nativeColumnToken: 'promotedOn',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
      ],
      controlIds: [
        'maturity.historyVersionedfilterSelect',
        'maturity.historyVersioned.searchInListTextBox',
      ],
      maskIds: [
        'header_maturity.historyVersioned_titleBarMask',
        'maturity.historyVersioned.searchInListLoadingWheel',
        'footer_maturity.historyVersioned_titleBarMask',
      ],
      frameIds: ['timelineIFrame'],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_265293102',
      label: '附件',
      panelLocator: '#infoPage_myTab_tab_jcaGen_265293102',
      grids: [
        {
          gridId: 'attachments.table.secondary',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Label or File Name',
              nativeColumnToken: 'attachmentsName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageActionAttachment',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Format Icon',
              nativeColumnToken: 'formatIcon',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Format',
              nativeColumnToken: 'formatName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Attachment Description',
              nativeColumnToken: 'description',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Last Modified',
              nativeColumnToken: 'thePersistInfo_modifyStamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Modified By',
              nativeColumnToken: 'modifier',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
      ],
      controlIds: ['attachments.table.secondary.searchInListTextBox'],
      maskIds: [
        'header_attachments.table.secondary_titleBarMask',
        'attachments.table.secondary.searchInListLoadingWheel',
        'footer_attachments.table.secondary_titleBarMask',
      ],
      frameIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_1995075121',
      label: '成员',
      panelLocator: '#infoPage_myTab_tab_jcaGen_1995075121',
      grids: [
        {
          gridId: 'windchill.enterprise.team.commonTeam',
          requiredClassTokens: [
            'x-panel',
            'x-panel-noborder',
            'x-grid-panel',
            'ux-maximgb-tg-panel',
          ],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'teamMemberImage',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Roles/Members',
              nativeColumnToken: 'name_proj',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'team_infoPageAction',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Description',
              nativeColumnToken: 'description',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'E-mail',
              nativeColumnToken: 'email',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Phone',
              nativeColumnToken: 'phoneNumber',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'lifecycleHistoryTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Life Cycle Name',
              nativeColumnToken: 'lifeCycleName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Team',
              nativeColumnToken: 'teamTemplateIdentity',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'State',
              nativeColumnToken: 'state',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Action',
              nativeColumnToken: 'lifecyclehistoryaction',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'User',
              nativeColumnToken: 'lifeCycleUserName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'votingHistoryTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Role',
              nativeColumnToken: 'roleName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Signer',
              nativeColumnToken: 'signerFullName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Vote',
              nativeColumnToken: 'lcVote',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Comment',
              nativeColumnToken: 'comments',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
      ],
      controlIds: [
        'windchill.enterprise.team.commonTeamfilterSelect',
        'windchill.enterprise.team.commonTeam.fitTextField',
        'lifecycleHistoryTableId.searchInListTextBox',
        'votingHistoryTableId.searchInListTextBox',
      ],
      maskIds: [
        'header_lifecycleHistoryTableId_titleBarMask',
        'lifecycleHistoryTableId.searchInListLoadingWheel',
        'footer_lifecycleHistoryTableId_titleBarMask',
        'header_votingHistoryTableId_titleBarMask',
        'votingHistoryTableId.searchInListLoadingWheel',
        'footer_votingHistoryTableId_titleBarMask',
      ],
      frameIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_ad_ADHistory',
      label: 'History Table',
      panelLocator: '#infoPage_myTab_ad_ADHistory',
      grids: [
        {
          gridId: 'ad.adhistory.list',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'AD处理单编号',
              nativeColumnToken: 'IBA|BizNo',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'AD处理单版本',
              nativeColumnToken: 'IBA|BizVersion',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Name',
              nativeColumnToken: 'name',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Context',
              nativeColumnToken: 'containerName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'State',
              nativeColumnToken: 'state',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Last Modified',
              nativeColumnToken: 'thePersistInfo_modifyStamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
      ],
      controlIds: ['ad.adhistory.list.searchInListTextBox'],
      maskIds: ['ad.adhistory.list.searchInListLoadingWheel'],
      frameIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_5754962897',
      label: '新建选项卡 1',
      panelLocator: '#infoPage_myTab_tab_jcaGen_5754962897',
      grids: [
        {
          gridId: 'lifecycleHistoryTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Life Cycle Name',
              nativeColumnToken: 'lifeCycleName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Team',
              nativeColumnToken: 'teamTemplateIdentity',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'State',
              nativeColumnToken: 'state',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Action',
              nativeColumnToken: 'lifecyclehistoryaction',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'User',
              nativeColumnToken: 'lifeCycleUserName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
        {
          gridId: 'votingHistoryTableId',
          requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
          columns: [
            {
              actualLabel: '',
              nativeColumnToken: 'checker',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Role',
              nativeColumnToken: 'roleName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Signer',
              nativeColumnToken: 'signerFullName',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Vote',
              nativeColumnToken: 'lcVote',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Comment',
              nativeColumnToken: 'comments',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
            {
              actualLabel: 'Date',
              nativeColumnToken: 'thePersistInfo_createStamp',
              valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
            },
          ],
        },
      ],
      controlIds: [
        'lifecycleHistoryTableId.searchInListTextBox',
        'votingHistoryTableId.searchInListTextBox',
      ],
      maskIds: [
        'header_lifecycleHistoryTableId_titleBarMask',
        'lifecycleHistoryTableId.searchInListLoadingWheel',
        'footer_lifecycleHistoryTableId_titleBarMask',
        'header_votingHistoryTableId_titleBarMask',
        'votingHistoryTableId.searchInListLoadingWheel',
        'footer_votingHistoryTableId_titleBarMask',
      ],
      frameIds: [],
    },
  ],
  adjacentDetailInputSha256:
    '53fcce2b2929c6762e178bb3d90d68601896ad517a6b6f721e6578ccb16adc04',
  adjacentDetailInputRef:
    'TDMS_AD_CHAIN_IDENTITY_CLOSURE_ROOT_20261014/native-input-batch-root-20261015/H_DETAILS_ADJACENT_ATTACHMENT_INPUT.json',
  adjacentDetails: {
    tabId: 'infoPageinfoPanelID__infoPage_myTab_object_changeRequestDetailsTab',
    label: 'Details',
    panelLocator: '#infoPage_myTab_object_changeRequestDetailsTab',
    adjacentOnly: true,
    grids: [
      {
        gridId: 'attachments.table.secondary',
        requiredClassTokens: ['x-panel', 'x-panel-noborder', 'x-grid-panel'],
        columns: [
          {
            actualLabel: '',
            nativeColumnToken: 'checker',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'Label or File Name',
            nativeColumnToken: 'attachmentsName',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'View Information',
            nativeColumnToken: 'infoPageActionAttachment',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'Format Icon',
            nativeColumnToken: 'formatIcon',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'Format',
            nativeColumnToken: 'formatName',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'Attachment Description',
            nativeColumnToken: 'description',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'Last Modified',
            nativeColumnToken: 'thePersistInfo_modifyStamp',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
          {
            actualLabel: 'Modified By',
            nativeColumnToken: 'modifier',
            valuePolicy: 'NOT_READ_ROW_CONTEXT_UNREVIEWED',
          },
        ],
      },
    ],
    controlIds: ['attachments.table.secondary.searchInListTextBox'],
    maskIds: [
      'header_attachments.table.secondary_titleBarMask',
      'attachments.table.secondary.searchInListLoadingWheel',
      'footer_attachments.table.secondary_titleBarMask',
    ],
    frameIds: [],
  },
});
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
freeze(REVIEWED_AD_HANDLING_REQUIRED_SURFACE_MODEL);
const m = REVIEWED_AD_HANDLING_REQUIRED_SURFACE_MODEL;
// Object serialization may reorder keys; native arrays retain their order.
const stable = (value) =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? '[' + value.map(stable).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
          .join(',') +
        '}';
const same = (a, b) => stable(a) === stable(b);
const exact = (v, keys) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const reject = () => {
  throw tdmsError('TDMS_COMPLETE_AD_HANDLING_SURFACE_MODEL_INVALID');
};
const string = (v, max = 700, nullable = false) => {
  if (nullable && v === null) return;
  if (typeof v !== 'string' || v.length > max) reject();
};
const array = (v, max) => {
  if (!Array.isArray(v) || v.length > max) reject();
};
export function reviewedAdHandlingRequiredSurface({
  scopeId,
  owner,
  tab,
} = {}) {
  if (
    scopeId !== m.scopeId ||
    owner?.rawHeaderType !== m.nativeHeaderType ||
    owner.nativeTypeId !== null ||
    owner.nativeTypeEvidence?.state !== 'NOT_READ' ||
    owner.rawHeaderIdentifier !== owner.number ||
    !/^(?:OR|VR):wt\.change2\.WTChangeRequest2:\d{1,24}$/u.test(
      owner.sourceRecordId || '',
    )
  )
    return null;
  return (
    [...m.panels, m.adjacentDetails].find(
      (p) =>
        p.tabId === tab?.tabId &&
        p.label === tab.label &&
        p.panelLocator === tab.panelLocator,
    ) || null
  );
}
export const adHandlingRequiredTableId = (tabId, gridId) =>
  tabId + '::' + gridId;
function validateWindow(w, p, owner) {
  if (
    !exact(w, [
      'panelId',
      'activeTabId',
      'fieldLabels',
      'controls',
      'frames',
      'loading',
      'grids',
    ])
  )
    reject();
  if (w.panelId !== p.panelLocator.slice(1) || w.activeTabId !== p.tabId)
    reject();
  array(w.fieldLabels, 1000);
  for (const f of w.fieldLabels) {
    if (!exact(f, ['label', 'locator'])) reject();
    string(f.label, 200);
    string(f.locator);
    if (!f.locator.startsWith(p.panelLocator + ' ')) reject();
  }
  array(w.controls, 100);
  const controlIds = new Set();
  for (const c of w.controls) {
    if (
      !exact(c, [
        'id',
        'tag',
        'rawClassName',
        'disabled',
        'readOnly',
        'valueState',
      ])
    )
      reject();
    string(c.id, 300);
    string(c.tag, 30);
    string(c.rawClassName, 1000);
    if (controlIds.has(c.id) || c.valueState !== 'NOT_READ') reject();
    controlIds.add(c.id);
    if (
      !['INPUT', 'SELECT', 'TEXTAREA'].includes(c.tag) ||
      typeof c.disabled !== 'boolean' ||
      (c.readOnly !== null && typeof c.readOnly !== 'boolean')
    )
      reject();
  }
  if (p.controlIds.some((id) => !controlIds.has(id))) reject();
  array(w.frames, 20);
  for (const f of w.frames) {
    if (!exact(f, ['id', 'tag', 'rawSrc', 'contentState'])) reject();
    string(f.id, 300, true);
    string(f.rawSrc, 2000, true);
    if (f.tag !== 'IFRAME' || f.contentState !== 'NOT_READ') reject();
    if (p.frameIds.includes(f.id)) {
      let u;
      try {
        u = new URL(f.rawSrc, 'http://tdms.airchina.com/Windchill/');
      } catch {
        reject();
      }
      if (
        !f.rawSrc ||
        !['http:', 'https:'].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.searchParams.get('oid') !== owner.sourceRecordId
      )
        reject();
    }
  }
  if (p.frameIds.some((id) => !w.frames.some((f) => f.id === id))) reject();
  array(w.loading, 100);
  for (const l of w.loading) {
    if (!exact(l, ['id', 'rawClassName', 'active'])) reject();
    string(l.id, 300, true);
    string(l.rawClassName, 1000);
    if (typeof l.active !== 'boolean') reject();
  }
  array(w.grids, 20);
  if (w.grids.length !== p.grids.length) reject();
  const ids = new Set();
  for (const g of w.grids) {
    if (
      !exact(g, [
        'gridId',
        'rawClassName',
        'columns',
        'rows',
        'loadingPresent',
        'pagerPresent',
        'pagerEnabled',
      ])
    )
      reject();
    const spec = p.grids.find((s) => s.gridId === g.gridId);
    if (!spec || ids.has(g.gridId)) reject();
    ids.add(g.gridId);
    string(g.rawClassName, 1000);
    if (
      spec.requiredClassTokens.some(
        (token) => !g.rawClassName.split(/\s+/u).includes(token),
      )
    )
      reject();
    if (
      !same(
        g.columns,
        spec.columns.map((c) => ({
          actualLabel: c.actualLabel,
          nativeColumnToken: c.nativeColumnToken,
        })),
      )
    )
      reject();
    for (const key of ['loadingPresent', 'pagerPresent', 'pagerEnabled'])
      if (typeof g[key] !== 'boolean') reject();
    if (!g.pagerPresent && g.pagerEnabled) reject();
    array(g.rows, 1000);
    for (const r of g.rows) {
      if (
        !exact(r, [
          'nativeRowId',
          'rawClassName',
          'cellColumnTokens',
          'represented',
        ])
      )
        reject();
      string(r.nativeRowId, 500, true);
      string(r.rawClassName, 1000);
      array(r.cellColumnTokens, 80);
      for (const token of r.cellColumnTokens) string(token, 160, true);
      if (
        !r.rawClassName.split(/\s+/u).includes('x-grid3-row') ||
        typeof r.represented !== 'boolean' ||
        (r.represented &&
          (g.loadingPresent ||
            !same(
              r.cellColumnTokens,
              spec.columns.map((c) => c.nativeColumnToken),
            )))
      )
        reject();
    }
  }
}
export function validateReviewedAdHandlingRequiredTable({
  scopeId,
  owner,
  table,
  window,
} = {}) {
  const tab = {
    tabId: table?.tabId,
    panelLocator: table?.panelLocator,
    label: [...m.panels, m.adjacentDetails].find(
      (p) => p.tabId === table?.tabId,
    )?.label,
  };
  const p = reviewedAdHandlingRequiredSurface({ scopeId, owner, tab });
  if (!p) return false;
  const g = p.grids.find((s) => s.gridId === table.gridId);
  if (!g) return false;
  const t = table;
  if (
    t.tableId !== adHandlingRequiredTableId(p.tabId, g.gridId) ||
    t.tableTitle !== g.gridId ||
    t.relationshipRole !== 'UNKNOWN' ||
    t.direction !== 'UNKNOWN' ||
    !same(
      t.rawHeaders,
      g.columns.map((c) => c.actualLabel),
    ) ||
    t.ownerSourceRecordId !== owner.sourceRecordId ||
    !same(t.ownerSourceVersion, owner.sourceVersion) ||
    t.reportedTotal !== null ||
    t.countEvidence?.rawText !== null ||
    t.countEvidence.exact !== false ||
    t.countEvidence.locator !== p.panelLocator + ' [id="' + g.gridId + '"]' ||
    t.scanMode !== 'DOM_ROWS' ||
    !['NOT_READ', 'NOT_LOADED'].includes(t.enumerationState) ||
    t.stopReason !== m.stopReason ||
    t.treeExpansions?.length ||
    t.terminal?.kind !== 'UNCONFIRMED' ||
    t.terminal.total !== null ||
    t.terminal.nativeTerminal !== false ||
    t.terminal.trueZero !== false ||
    t.terminal.allGlobalIndices !== false ||
    t.terminal.allTreeNodesExpanded !== false ||
    t.terminal.settledReads !== 2 ||
    [
      'nativeStatusProof',
      'sourceViewEvidence',
      'nativeRowSlotEvidence',
      'nativeTreeEvidence',
      'efQueryEvidence',
      'relatedSurfaceEvidence',
      'relatedQueryEvidence',
    ].some((k) => Object.hasOwn(t, k))
  )
    reject();
  array(t.rows, 1000);
  for (const row of t.rows) {
    if (
      row.globalIndex !== null ||
      row.treeDepth !== null ||
      row.treePath?.length ||
      row.nativeRelationId !== null ||
      row.rawRole !== null ||
      row.rawDirection !== null ||
      row.sourceLinks?.length ||
      row.observedVersion?.confirmation !== 'VERSION_UNCONFIRMED' ||
      row.observedVersion.rawRevision !== null ||
      row.observedVersion.rawIteration !== null ||
      row.cells?.length !== g.columns.length
    )
      reject();
    for (const [index, c] of row.cells.entries())
      if (
        !exact(c, [
          'actualLabel',
          'rawValue',
          'state',
          'observedTotalCodepoints',
        ]) ||
        c.actualLabel !== g.columns[index].actualLabel ||
        c.state !== 'NOT_READ' ||
        c.rawValue !== null ||
        c.observedTotalCodepoints !== 0
      )
        reject();
  }
  if (t.terminal.captured !== t.rows.length || t.windows?.length !== 1)
    reject();
  const w = t.windows[0];
  if (
    w.ordinal !== 0 ||
    w.reportedTotal !== null ||
    w.pageRaw !== null ||
    w.scroll !== null ||
    w.globalIndices?.length ||
    w.stableReads !== 2 ||
    w.treePending !== 0 ||
    w.nextControl?.terminalDeclared !== false ||
    !same(
      w.rowOccurrenceIds,
      t.rows.map((r) => r.occurrenceId),
    )
  )
    reject();
  if (window) {
    const current = window.grids.find((x) => x.gridId === g.gridId);
    if (!current) reject();
    const represented = current.rows
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.represented);
    if (
      t.enumerationState !==
        (current.loadingPresent ? 'NOT_LOADED' : 'NOT_READ') ||
      t.rows.length !== represented.length ||
      w.nextControl.present !== current.pagerPresent ||
      w.nextControl.enabled !== current.pagerEnabled
    )
      reject();
    for (const [index, { r, i }] of represented.entries())
      if (
        t.rows[index].occurrenceId !== t.tableId + ':ROW-' + i ||
        t.rows[index].nativeRowId !== r.nativeRowId
      )
        reject();
  }
  return true;
}
export function validateReviewedAdHandlingSurfaceEvidence(
  evidence,
  { scopeId, owner, tab, read } = {},
) {
  if (evidence === undefined) return null;
  const p = reviewedAdHandlingRequiredSurface({ scopeId, owner, tab });
  if (!p) reject();
  if (
    !exact(evidence, [
      'schemaVersion',
      'modelRevision',
      'tabId',
      'panelLocator',
      'ownerSourceRecordId',
      'ownerSourceVersion',
      'ownerBusinessVersion',
      'ownStateRaw',
      'ownModifiedRaw',
      'queryDefinition',
      'bodyCoverage',
      'terminalEvidence',
      'windows',
    ]) ||
    evidence.schemaVersion !== m.schemaVersion ||
    evidence.modelRevision !== m.modelRevision ||
    evidence.tabId !== p.tabId ||
    evidence.panelLocator !== p.panelLocator ||
    evidence.ownerSourceRecordId !== owner.sourceRecordId ||
    !same(evidence.ownerSourceVersion, owner.sourceVersion) ||
    !same(evidence.ownerBusinessVersion, owner.businessVersion) ||
    evidence.ownStateRaw !== owner.stateRaw ||
    evidence.ownModifiedRaw !== owner.sourceModifiedRaw ||
    evidence.queryDefinition !== 'UNKNOWN' ||
    evidence.bodyCoverage !== 'UNPROVEN' ||
    evidence.terminalEvidence !== 'UNKNOWN' ||
    tab.required !== true ||
    tab.state !== 'NOT_READ' ||
    tab.reasonCode !== m.stopReason
  )
    reject();
  array(evidence.windows, 2);
  if (evidence.windows.length !== 2) reject();
  for (const w of evidence.windows) validateWindow(w, p, owner);
  if (!same(evidence.windows[0], evidence.windows[1])) reject();
  if (read) {
    const tables =
      read.relationTables?.filter((t) => t.tabId === p.tabId) || [];
    if (tables.length !== p.grids.length) reject();
    for (const table of tables)
      if (
        !validateReviewedAdHandlingRequiredTable({
          scopeId,
          owner,
          table,
          window: evidence.windows[1],
        })
      )
        reject();
    const grids = new Set(tables.map((t) => t.gridId));
    if (grids.size !== p.grids.length) reject();
    for (const field of read.fields || [])
      if (
        !p.adjacentOnly &&
        field.tabId === p.tabId &&
        (field.value?.state !== 'NOT_READ' ||
          field.value.rawValue !== null ||
          field.value.observedTotalCodepoints !== 0 ||
          field.links?.length ||
          Object.hasOwn(field, 'rawTextQualification'))
      )
        reject();
    if (
      !read.rosterEvidence?.unknownRequiredSurfaces?.includes(
        p.panelLocator + ' [native-body-coverage-unproven]',
      )
    )
      reject();
  }
  return {
    complete: false,
    structureCaptured: true,
    queryKnown: false,
    bodyCoverage: 'UNPROVEN',
    reasonCode: m.stopReason,
  };
}
