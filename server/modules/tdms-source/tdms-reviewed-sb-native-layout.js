// Pure consumer selected from complete Source0.2.83 / handoff @13.
import { tdmsError } from './tdms-source.types';
export const REVIEWED_SB_NATIVE_LAYOUT_MODEL = Object.freeze({
  schemaVersion: 'wiselink.tdms-sb-native-layout.v1',
  modelRevision: 'tdms-reviewed-sb-native-layout@1',
  panels: [
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docInfoDefaultDetails',
      label: 'Details',
      panelLocator: '#infoPage_myTab_object_docInfoDefaultDetails',
      componentIds: [
        'infoPage_myTab_object_docInfoDefaultDetails_objectvisualizationAndAttributes_tocItem',
        'infoPage_myTab_object_docInfoDefaultDetails_objectattributes_tocItem',
        'wrap_infoPage_myTab_object_docInfoDefaultDetails_objectvisualizationAndAttributes',
        'wrap_infoPage_myTab_object_docInfoDefaultDetails_objectattributes',
      ],
      grids: [],
      sections: [
        {
          sectionId: 'General',
          label: 'General',
          dataStoreId: 'dataStoreGeneral',
          labels: [
            'Name:',
            'Status:',
            'Primary Content:',
            'Modified By:',
            'Last Modified:',
          ],
        },
        {
          sectionId: 'BusinessAttributesGroup',
          label: 'Business',
          dataStoreId: 'dataStoreBusinessAttributesGroup',
          labels: [
            'SB/SL文档编号:',
            'SB/SL版本:',
            'OEM厂商类型:',
            'OEM厂商:',
            '类型:',
            'SB/SL标题:',
            '是否紧急:',
            '颁发日期:',
            '原创建者:',
            '原创建时间:',
          ],
        },
        {
          sectionId: 'MoreAttributesGroup',
          label: 'System',
          dataStoreId: 'dataStoreMoreAttributesGroup',
          labels: [
            'Description:',
            '',
            'Format Name:',
            'State:',
            'Context:',
            'Location:',
            'Life Cycle Template:',
            'Team Template:',
            'Created By:',
            'Modified By:',
            'Created On:',
            'Last Modified:',
          ],
        },
      ],
      embeddedIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_docsb_docStructureGWT',
      label: 'Structure',
      panelLocator: '#infoPage_myTab_docsb_docStructureGWT',
      componentIds: [],
      grids: [],
      sections: [],
      embeddedIds: ['docsbIFrame'],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docContentInfoDetails',
      label: 'Content',
      panelLocator: '#infoPage_myTab_object_docContentInfoDetails',
      componentIds: [
        'infoPage_myTab_object_docContentInfoDetails_objectprimaryContent_tocItem',
        'infoPage_myTab_object_docContentInfoDetails_objectattachments_tocItem',
        'wrap_infoPage_myTab_object_docContentInfoDetails_objectprimaryContent',
        'wrap_infoPage_myTab_object_docContentInfoDetails_objectattachments',
      ],
      grids: [
        {
          gridId: 'attachments.table.primary',
          columns: [
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
              actualLabel: 'Last Modified',
              nativeColumnToken: 'thePersistInfo_modifyStamp',
            },
            { actualLabel: 'Modified By', nativeColumnToken: 'modifier' },
          ],
          queryControls: [
            {
              id: 'attachments.table.primary.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
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
          queryControls: [
            {
              id: 'attachments.table.secondary.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_docRelatedObjectsInfo',
      label: 'Related Objects',
      panelLocator: '#infoPage_myTab_object_docRelatedObjectsInfo',
      componentIds: [
        'infoPage_myTab_object_docRelatedObjectsInfo_objectrelatedDocumentTable_tocItem',
        'infoPage_myTab_object_docRelatedObjectsInfo_objectwhereUsed_tocItem',
        'infoPage_myTab_object_docRelatedObjectsInfo_documentrelatedDocumentsDocuments_tocItem',
        'infoPage_myTab_object_docRelatedObjectsInfo_documentrelatedDocumentsReferencedBy_tocItem',
        'infoPage_myTab_object_docRelatedObjectsInfo_documentrelatedDocumentsParts_tocItem',
        'wrap_infoPage_myTab_object_docRelatedObjectsInfo_objectrelatedDocumentTable',
        'wrap_infoPage_myTab_object_docRelatedObjectsInfo_objectwhereUsed',
        'wrap_infoPage_myTab_object_docRelatedObjectsInfo_documentrelatedDocumentsDocuments',
        'wrap_infoPage_myTab_object_docRelatedObjectsInfo_documentrelatedDocumentsReferencedBy',
        'wrap_infoPage_myTab_object_docRelatedObjectsInfo_documentrelatedDocumentsParts',
      ],
      grids: [
        {
          gridId: 'document.relatedDoc.list',
          columns: [
            { actualLabel: 'Document Number', nativeColumnToken: 'docNumber' },
            {
              actualLabel: 'Document Version',
              nativeColumnToken: 'docVersion',
            },
            {
              actualLabel: 'Related Document Operation',
              nativeColumnToken: 'linkType',
            },
            { actualLabel: 'Document Type', nativeColumnToken: 'docType' },
            { actualLabel: 'Document Title', nativeColumnToken: 'docName' },
          ],
          queryControls: [
            {
              id: 'document.relatedDoc.list.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
        {
          gridId: 'whereUsed.view',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            { actualLabel: 'Number', nativeColumnToken: 'number' },
            { actualLabel: 'Version', nativeColumnToken: 'groupedVersions' },
            { actualLabel: 'Name', nativeColumnToken: 'name' },
            { actualLabel: 'Context', nativeColumnToken: 'containerName' },
          ],
          queryControls: [
            {
              id: 'whereUsed.viewfilterSelect',
              type: 'text',
              value: 'Latest',
              emptyClass: false,
            },
            {
              id: 'whereUsed.view.fitTextField',
              type: 'text',
              value: 'Find in tree',
              emptyClass: true,
            },
          ],
          visible: true,
        },
        {
          gridId: 'document.relatedDocsReferencesDocuments.list',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Number', nativeColumnToken: 'number' },
            { actualLabel: 'Version', nativeColumnToken: 'version' },
            { actualLabel: 'editComment', nativeColumnToken: 'editComment' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageAction',
            },
            { actualLabel: 'Name', nativeColumnToken: 'name' },
            { actualLabel: 'Context', nativeColumnToken: 'containerName' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            { actualLabel: 'Last Modified', nativeColumnToken: 'last_updated' },
            { actualLabel: 'Comments', nativeColumnToken: 'linkDescription' },
          ],
          queryControls: [
            {
              id: 'document.relatedDocsReferencesDocuments.listfilterSelect',
              type: 'text',
              value: 'Default',
              emptyClass: false,
            },
            {
              id: 'document.relatedDocsReferencesDocuments.list.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
        {
          gridId: 'document.relatedDocsReferencedByDocuments.list',
          columns: [
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Number', nativeColumnToken: 'number' },
            { actualLabel: 'Version', nativeColumnToken: 'version' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageAction',
            },
            { actualLabel: 'Name', nativeColumnToken: 'name' },
            { actualLabel: 'Context', nativeColumnToken: 'containerName' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            { actualLabel: 'Last Modified', nativeColumnToken: 'last_updated' },
          ],
          queryControls: [
            {
              id: 'document.relatedDocsReferencedByDocuments.listfilterSelect',
              type: 'text',
              value: 'Default',
              emptyClass: false,
            },
            {
              id: 'document.relatedDocsReferencedByDocuments.list.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
        {
          gridId: 'part.relatedDocumentsDescribesParts.list',
          columns: [
            { actualLabel: '', nativeColumnToken: 'checker' },
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Number', nativeColumnToken: 'number' },
            { actualLabel: 'Version', nativeColumnToken: 'version' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageAction',
            },
            { actualLabel: 'Name', nativeColumnToken: 'name' },
            { actualLabel: 'Context', nativeColumnToken: 'containerName' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            { actualLabel: 'Last Modified', nativeColumnToken: 'last_updated' },
          ],
          queryControls: [
            {
              id: 'part.relatedDocumentsDescribesParts.listfilterSelect',
              type: 'text',
              value: 'Default',
              emptyClass: false,
            },
            {
              id: 'part.relatedDocumentsDescribesParts.list.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
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
          queryControls: [
            {
              id: 'version.history.documentfilterSelect',
              type: 'text',
              value: ' General',
              emptyClass: false,
            },
            {
              id: 'version.history.document.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: ['timelineIFrame'],
    },
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
          queryControls: [
            {
              id: 'attachments.table.secondary.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
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
          queryControls: [
            {
              id: 'processHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'taskStatusTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'taskHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
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
          queryControls: [
            {
              id: 'windchill.enterprise.team.commonTeamfilterSelect',
              type: 'text',
              value: 'Shared Team Roles and Members',
              emptyClass: false,
            },
            {
              id: 'windchill.enterprise.team.commonTeam.fitTextField',
              type: 'text',
              value: null,
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_sbRelatedTab',
      label: 'SB Relate Tab',
      panelLocator: '#infoPage_myTab_object_sbRelatedTab',
      componentIds: [
        'infoPage_myTab_object_sbRelatedTab_sbsbTreeReport_tocItem',
        'wrap_infoPage_myTab_object_sbRelatedTab_sbsbTreeReport',
      ],
      grids: [
        {
          gridId: 'mytreetable',
          columns: [
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Number', nativeColumnToken: 'number' },
            {
              actualLabel: 'View Information',
              nativeColumnToken: 'infoPageAction',
            },
            {
              actualLabel: 'Primary Content',
              nativeColumnToken: 'primaryAttachmentProperties',
            },
            { actualLabel: 'Name', nativeColumnToken: 'name' },
            { actualLabel: 'SB处理单编号', nativeColumnToken: 'IBA|BizNo' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            { actualLabel: 'Created By', nativeColumnToken: 'creator' },
            {
              actualLabel: 'Last Modified',
              nativeColumnToken: 'thePersistInfo_modifyStamp',
            },
          ],
          queryControls: [],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_object_sbStatusLink',
      label: 'SB Status Link',
      panelLocator: '#infoPage_myTab_object_sbStatusLink',
      componentIds: [
        'infoPage_myTab_object_sbStatusLink_sbsbStatusLinkList_tocItem',
        'wrap_infoPage_myTab_object_sbStatusLink_sbsbStatusLinkList',
      ],
      grids: [
        {
          gridId: 'document.sbstatuslink.list',
          columns: [
            {
              actualLabel: 'Object Type Indicator',
              nativeColumnToken: 'type_icon',
            },
            { actualLabel: 'Number', nativeColumnToken: 'number' },
            { actualLabel: 'Name', nativeColumnToken: 'name' },
            { actualLabel: '业务对象编号', nativeColumnToken: 'BizNo' },
            { actualLabel: 'State', nativeColumnToken: 'state' },
            { actualLabel: 'Stand Alone', nativeColumnToken: 'Standalone' },
            { actualLabel: 'Status Link', nativeColumnToken: 'SBStatus' },
          ],
          queryControls: [
            {
              id: 'document.sbstatuslink.list.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
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
          queryControls: [
            {
              id: 'lifecycleHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'votingHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'processHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'taskStatusTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'taskHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'netmarkets.notebookfolder.referenceNotebook.fitTextField',
              type: 'text',
              value: null,
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: ['timelineIFrame'],
    },
    {
      tabId: 'infoPageinfoPanelID__infoPage_myTab_tab_jcaGen_1902225244',
      label: '新建选项卡 1',
      panelLocator: '#infoPage_myTab_tab_jcaGen_1902225244',
      componentIds: [
        'infoPage_myTab_tab_jcaGen_1902225244_objectattributes_tocItem',
        'infoPage_myTab_tab_jcaGen_1902225244_historylegacyLCHistory_tocItem',
        'wrap_infoPage_myTab_tab_jcaGen_1902225244_objectattributes',
        'wrap_infoPage_myTab_tab_jcaGen_1902225244_historylegacyLCHistory',
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
          queryControls: [
            {
              id: 'lifecycleHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'votingHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [
        {
          sectionId: 'BusinessAttributesGroup',
          label: 'Business',
          dataStoreId: 'dataStoreBusinessAttributesGroup',
          labels: [
            'SB/SL文档编号:',
            'SB/SL版本:',
            'OEM厂商类型:',
            'OEM厂商:',
            '类型:',
            'SB/SL标题:',
            '是否紧急:',
            '颁发日期:',
            '原创建者:',
            '原创建时间:',
          ],
        },
        {
          sectionId: 'MoreAttributesGroup',
          label: 'System',
          dataStoreId: 'dataStoreMoreAttributesGroup',
          labels: [
            'Description:',
            '',
            'Format Name:',
            'State:',
            'Context:',
            'Location:',
            'Life Cycle Template:',
            'Team Template:',
            'Created By:',
            'Modified By:',
            'Created On:',
            'Last Modified:',
          ],
        },
      ],
      embeddedIds: [],
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
          queryControls: [
            {
              id: 'lifecycleHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
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
          queryControls: [
            {
              id: 'votingHistoryTableId.searchInListTextBox',
              type: 'text',
              value: 'Search in table',
              emptyClass: true,
            },
          ],
          visible: true,
        },
      ],
      sections: [],
      embeddedIds: [],
    },
  ],
});
export function createSbNativeLayoutValidator(model) {
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
    },
    exact = (v, ks) =>
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === ks.length &&
      ks.every((k) => Object.hasOwn(v, k));
  const fail = () => {
    throw tdmsError('TDMS_COMPLETE_SB_NATIVE_LAYOUT_INVALID');
  };
  const ownerKnown = (scopeId, owner) =>
    ['SB', 'SL', 'SIL', 'SB-IN', 'MT'].includes(scopeId) &&
    owner?.scopeEvidence?.businessType === scopeId &&
    owner.nativeTypeId === 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument' &&
    owner.nativeTypeEvidence?.state === 'VALUE' &&
    owner.nativeTypeEvidence.rawValue === owner.nativeTypeId &&
    owner.rawHeaderType === 'SB文档';
  // Only this observed column of the SB relation tree has three native captions.
  // Preserve raw frames; this copy is used exclusively for model admission.
  function canonicalGrids(grids, tabId) {
    if (
      tabId !== 'infoPageinfoPanelID__infoPage_myTab_object_sbRelatedTab' ||
      !Array.isArray(grids)
    )
      return grids;
    return grids.map((g) =>
      g?.gridId !== 'mytreetable' || !Array.isArray(g.columns)
        ? g
        : {
            ...g,
            columns: g.columns.map((c, i) =>
              i === 5 &&
              c?.nativeColumnToken === 'IBA|BizNo' &&
              ['SB评估单编号', 'SB/SL文档编号'].includes(c.actualLabel)
                ? { ...c, actualLabel: 'SB处理单编号' }
                : c,
            ),
          },
    );
  }
  function validate({ scopeId, owner, read }) {
    const e = read.sbNativeLayoutEvidence;
    if (e === undefined) return false;
    if (
      !ownerKnown(scopeId, owner) ||
      !exact(e, [
        'schemaVersion',
        'modelRevision',
        'ownerSourceRecordId',
        'sourceVersion',
        'sourceModifiedRaw',
        'sourceContext',
        'panels',
      ]) ||
      e.schemaVersion !== model.schemaVersion ||
      e.modelRevision !== model.modelRevision ||
      e.ownerSourceRecordId !== owner.sourceRecordId ||
      !same(e.sourceVersion, owner.sourceVersion) ||
      e.sourceModifiedRaw !== owner.sourceModifiedRaw ||
      !same(e.sourceContext, read.sourceContext) ||
      !Array.isArray(e.panels) ||
      e.panels.length !== model.panels.length ||
      !same(
        read.tabs.map((t) => t.tabId),
        model.panels.map((p) => p.tabId),
      )
    )
      fail();
    for (const [i, record] of e.panels.entries()) {
      const p = model.panels[i],
        f = record.before;
      if (
        !exact(record, ['tabId', 'before', 'after', 'settledReads']) ||
        record.tabId !== p.tabId ||
        record.settledReads !== 2 ||
        !same(record.before, record.after) ||
        !exact(f, [
          'activeTabId',
          'panelId',
          'visible',
          'componentIds',
          'grids',
          'sections',
          'embeddedIds',
          'loading',
          'blockingMarkerCount',
          'unknownControlCount',
        ]) ||
        f.activeTabId !== p.tabId ||
        f.panelId !== p.panelLocator.slice(1) ||
        f.visible !== true ||
        !same(f.componentIds, p.componentIds) ||
        !same(canonicalGrids(f.grids, p.tabId), p.grids) ||
        !same(f.sections, p.sections) ||
        !same(f.embeddedIds, p.embeddedIds) ||
        f.loading !== false ||
        f.blockingMarkerCount !== 0 ||
        f.unknownControlCount !== 0
      )
        fail();
      if (
        p.tabId === 'infoPageinfoPanelID__infoPage_myTab_object_sbRelatedTab'
      ) {
        const table = read.relationTables?.find(
          (t) => t.gridId === 'mytreetable',
        );
        if (
          table &&
          (!same(table.nativeTreeEvidence?.columns, f.grids[0].columns) ||
            !same(
              table.rawHeaders,
              f.grids[0].columns.map((c) => c.actualLabel),
            ))
        )
          fail();
      }
    }
    return true;
  }
  return { model, ownerKnown, canonicalGrids, validate };
}
export const SB_NATIVE_LAYOUT = createSbNativeLayoutValidator(
  REVIEWED_SB_NATIVE_LAYOUT_MODEL,
);
