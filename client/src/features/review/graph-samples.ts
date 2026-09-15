/**
 * DEV/QA harness：T2 图谱联动隔离样例的数据与缺失字段清单。
 * 假 ID 仅演示交互骨架；关系真实读取合同待主控交付，不进入生产读取。
 * 生产入口禁止引用本文件。
 */
import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';

import type { ChronologyClaimSample } from './chronology-samples';

export const GRAPH_RELATION_SAMPLE_MATTER_ID = 'matter-sample-graph-a';
export const GRAPH_RELATION_SAMPLE_WORK_ITEM_ID = 'wi-sample-graph-a';

export type GraphRelationSampleRelationStatus =
  | 'REAL_CONTRACT_PENDING'
  | 'SOURCE_ONLY';

export interface GraphRelationSampleRelation {
  relationKey: string;
  label: string;
  status: GraphRelationSampleRelationStatus;
  note: string;
}

export interface GraphRelationSampleEntry {
  entryKey: string;
  label: string;
  nodeId: string;
  scenarioNote: string;
  claims: ChronologyClaimSample[];
  relations: GraphRelationSampleRelation[];
}

export const GRAPH_RELATION_SAMPLE_PROJECTION: CanonicalLibraryIndexReadResponse =
  {
    schemaVersion: 'wiselink.3_1.library_index_read.v0.candidate',
    scope: 'CURRENT_WORKITEM_ONLY',
    workItem: {
      workItemId: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
      revision: 1,
      phase: 'SAMPLE',
    },
    document: {
      documentId: 'doc-sample-graph-a',
      documentVersionId: 'dv-sample-b',
      documentCode: 'SB-A',
      businessRevision: 'R2',
      normalizedFamily: 'sample-family',
    },
    currentness: {
      familyId: 'family-sample-graph',
      currentDocumentVersionId: 'dv-sample-b',
      currentGeneration: 2,
      selectedVersionIsCurrent: true,
    },
    libraryIndex: {
      schemaVersion: 'wiselink.3_1.library_index_projection.v0.candidate',
      scope: 'CURRENT_WORKITEM_ONLY',
      workItemId: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
      rootLabel: '样例事项（隔离）',
      nodes: [
        {
          id: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
          parentId: null,
          kind: 'WORK_ITEM',
          label: '样例事项',
          detail: '振动监测升级评估（样例）',
          state: 'SAMPLE',
          targetNode: 'assessment',
          authority: 'HOST_WORKITEM_PROJECTION',
        },
        {
          id: 'doc-sample-graph-a',
          parentId: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
          kind: 'DOCUMENT',
          label: 'SB-A 厂家服务通告',
          detail: '同一文件，多时间条目保留稳定身份',
          state: 'SAMPLE',
          targetNode: 'reader',
          authority: 'HOST_WORKITEM_PROJECTION',
        },
        {
          id: 'dv-sample-a',
          parentId: 'doc-sample-graph-a',
          kind: 'DOCUMENT_VERSION',
          label: 'SB-A（R1）',
          detail: '目标 2025-Q3',
          state: 'SAMPLE',
          targetNode: 'reader',
          authority: 'HOST_READER_PROJECTION',
        },
        {
          id: 'dv-sample-b',
          parentId: 'doc-sample-graph-a',
          kind: 'DOCUMENT_VERSION',
          label: 'SB-A（R2 换版）',
          detail: '目标 2025-Q4',
          state: 'SAMPLE',
          targetNode: 'reader',
          authority: 'HOST_READER_PROJECTION',
        },
        {
          id: 'pkg-sample-a',
          parentId: 'dv-sample-b',
          kind: 'PARSED_PACKAGE',
          label: 'R2 解析包',
          detail: '结构化内容（样例）',
          state: 'SAMPLE',
          targetNode: 'package',
          authority: 'HOST_READER_PROJECTION',
        },
        {
          id: 'rq-sample-a',
          parentId: 'pkg-sample-a',
          kind: 'READER_QUERY',
          label: '来源定位 sec-4.2',
          detail: '纯来源节点：详情保留原活动与声明',
          state: 'SAMPLE',
          targetNode: 'reader',
          authority: 'HOST_READER_PROJECTION',
        },
        {
          id: 'de-sample-a',
          parentId: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
          kind: 'DYNAMIC_EVALUATION',
          label: '升级影响问题评估',
          detail: 'USED 关系使用主体与来源版待交付',
          state: 'SAMPLE',
          targetNode: 'assessment',
          authority: 'HOST_WORKITEM_PROJECTION',
        },
        {
          id: 'er-sample-a',
          parentId: 'de-sample-a',
          kind: 'ENGINEER_REVIEW',
          label: '工程师复核（样例）',
          detail: '复核意见',
          state: 'SAMPLE',
          targetNode: 'assessment',
          authority: 'HOST_ENGINEER_REVIEW_CONTEXT',
        },
        {
          id: 'os-sample-a',
          parentId: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
          kind: 'OVERALL_SYNTHESIS',
          label: '整体综合（样例）',
          detail: '综合认识',
          state: 'SAMPLE',
          targetNode: 'overall',
          authority: 'HOST_WORKITEM_PROJECTION',
        },
      ],
      completeness: {
        crossWorkItemLibraryAvailable: false,
        relatedDocumentIndexAvailable: false,
        note: '隔离样例投影，不是真实读取。',
      },
    },
    readAuthorization: {
      action: 'READ_LIBRARY_INDEX',
      decisionId: 'sample-decision',
      permissionSnapshotVersion: 'sample',
    },
  };

export const GRAPH_RELATION_SAMPLE_ENTRIES: GraphRelationSampleEntry[] = [
  {
    entryKey: 'entry:sb-a-revision-history',
    label: 'SB-A 换版历史（同文件多时间条目）',
    nodeId: 'doc-sample-graph-a',
    scenarioNote:
      '同一文件保留稳定身份与各来源声明；新版未提不等于取消，晚收到旧事件不等于新发生。',
    claims: [
      {
        claimKind: 'TARGET',
        precision: 'QUARTER',
        rawValue: '2025-Q3',
        sourceRef: {
          documentVersionId: 'dv-sample-a',
          locator: 'sec-4.1',
          sourceLabel: '厂家服务通告 A（R1）',
        },
      },
      {
        claimKind: 'TARGET',
        precision: 'QUARTER',
        rawValue: '2025-Q4',
        sourceRef: {
          documentVersionId: 'dv-sample-b',
          locator: 'sec-4.2',
          sourceLabel: '厂家服务通告 A（R2 换版）',
        },
      },
      {
        claimKind: 'TARGET',
        precision: 'TBD',
        rawValue: 'TBD',
        sourceRef: {
          documentVersionId: 'dv-sample-c',
          locator: 'sec-5.0',
          sourceLabel: '工程评估备忘（当前版）',
        },
      },
    ],
    relations: [
      {
        relationKey: 'rel:sb-a-r1-r2-revision',
        label: 'R1 → R2 换版',
        status: 'REAL_CONTRACT_PENDING',
        note: '换版关系的真实读取合同待主控交付；计划、发布、执行、效果不互代。',
      },
    ],
  },
  {
    entryKey: 'entry:upgrade-impact-issue',
    label: '升级影响问题评估（USED 关系）',
    nodeId: 'de-sample-a',
    scenarioNote:
      'USED 关系须有实际使用主体及来源版；没有保存依据的支持、因果、执行或效果关系不制造。',
    claims: [
      {
        claimKind: 'TARGET',
        precision: 'CONDITIONAL',
        rawValue: '累计 500 飞行小时后',
        sourceRef: {
          documentVersionId: 'dv-sample-d',
          locator: 'para-12',
          sourceLabel: '维修提示 H（R1）',
        },
      },
    ],
    relations: [
      {
        relationKey: 'rel:issue-uses-r2-sec-4-2',
        label: '评估引用 SB-A（R2）sec-4.2',
        status: 'REAL_CONTRACT_PENDING',
        note: '实际使用主体与来源版待交付；当前仅演示关系条目形态。',
      },
    ],
  },
  {
    entryKey: 'entry:source-only-locator',
    label: '来源定位（图只有来源节点）',
    nodeId: 'rq-sample-a',
    scenarioNote: '图只有来源节点时，在详情保留原活动与声明并支持准确返回。',
    claims: [
      {
        claimKind: 'OCCURRED',
        precision: 'DATE',
        rawValue: '2025-08-12',
        sourceRef: {
          documentVersionId: 'dv-sample-b',
          locator: 'sec-4.2',
          sourceLabel: '厂家服务通告 A（R2 换版）',
        },
      },
    ],
    relations: [
      {
        relationKey: 'rel:locator-source-only',
        label: '来源定位（无关系读取）',
        status: 'SOURCE_ONLY',
        note: '仅有来源节点；关系范围与「未加载 / 不存在」的区分待交付。',
      },
    ],
  },
];

export const GRAPH_RELATION_NARROW_READ_MISSING_FIELDS = [
  '关系类型语义读取合同（计划 / 发布 / 执行 / 效果分开，不互代）',
  'USED 关系的实际使用主体及来源版',
  '同文件多时间条目的稳定身份与往返锚点（activityKey 来源）',
  '关系来源范围，及「未加载」与「不存在」的区分',
  '真实阅读器与样例页之间的返回合同尚未接通；隔离来源示意仅保留本页 URL 选择，不写 readingReturnTarget',
] as const;
