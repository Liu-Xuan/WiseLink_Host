export type ChronologyClaimKind =
  | 'OCCURRED'
  | 'TARGET'
  | 'PUBLISHED'
  | 'EFFECTIVE'
  | 'ACQUIRED';

export type ChronologyTimePrecision =
  | 'DATE'
  | 'QUARTER'
  | 'TBD'
  | 'CONDITIONAL';

export interface ChronologySourceRefSample {
  documentVersionId: string;
  locator: string;
  sourceLabel: string;
}

export interface ChronologyClaimSample {
  claimKind: ChronologyClaimKind;
  precision: ChronologyTimePrecision;
  rawValue: string;
  sourceRef: ChronologySourceRefSample;
}

export interface ChronologyActivitySample {
  activityKey: string;
  label: string;
  claims: ChronologyClaimSample[];
  selectedClaimIndex: number;
  note?: string;
}

export const CHRONOLOGY_CLAIM_KIND_LABEL: Record<ChronologyClaimKind, string> =
  {
    OCCURRED: '发生',
    TARGET: '目标',
    PUBLISHED: '发布',
    EFFECTIVE: '生效',
    ACQUIRED: '取得',
  };

export const CHRONOLOGY_PRECISION_LABEL: Record<
  ChronologyTimePrecision,
  string
> = {
  DATE: '日历日期',
  QUARTER: '季度',
  TBD: '待定',
  CONDITIONAL: '条件期限',
};

export const CHRONOLOGY_SAMPLE_MATTER_ID = 'matter-sample-chronology';
export const CHRONOLOGY_SAMPLE_WORK_ITEM_ID = 'work-item-sample-chronology';

export const CHRONOLOGY_SAMPLE_ACTIVITIES: ChronologyActivitySample[] = [
  {
    activityKey: 'act:vibration-monitor-upgrade',
    label: '发动机振动监测软件升级（跨文件引用）',
    claims: [
      {
        claimKind: 'PUBLISHED',
        precision: 'DATE',
        rawValue: '2026-03-18 通告发布',
        sourceRef: {
          documentVersionId: 'dv-sample-notice',
          locator: 'sec-1.2',
          sourceLabel: '厂家服务通告 A（当前版）',
        },
      },
      {
        claimKind: 'EFFECTIVE',
        precision: 'DATE',
        rawValue: '2026-05-02 备忘生效',
        sourceRef: {
          documentVersionId: 'dv-sample-memo',
          locator: 'sec-2.1',
          sourceLabel: '工程评估备忘 M（R1）',
        },
      },
      {
        claimKind: 'TARGET',
        precision: 'TBD',
        rawValue: 'TBD（待排产）',
        sourceRef: {
          documentVersionId: 'dv-sample-memo',
          locator: 'sec-3.4',
          sourceLabel: '工程评估备忘 M（R1）',
        },
      },
    ],
    selectedClaimIndex: 2,
    note: '跨文件引用序列：厂家通告与工程备忘属同一活动的不同声明，不标注为同一文件的 R1→R2→当前版。',
  },
  {
    activityKey: 'act:avionics-suite-target-drift',
    label: '航电套件改装完成目标漂移（Q3→Q4→TBD）',
    claims: [
      {
        claimKind: 'TARGET',
        precision: 'QUARTER',
        rawValue: '2026-Q3',
        sourceRef: {
          documentVersionId: 'dv-sample-plan-r1',
          locator: 'table-2',
          sourceLabel: '改装计划（R1）',
        },
      },
      {
        claimKind: 'TARGET',
        precision: 'QUARTER',
        rawValue: '2026-Q4',
        sourceRef: {
          documentVersionId: 'dv-sample-plan-r2',
          locator: 'table-2',
          sourceLabel: '改装计划（R2）',
        },
      },
      {
        claimKind: 'TARGET',
        precision: 'TBD',
        rawValue: 'TBD（待厂家排产确认）',
        sourceRef: {
          documentVersionId: 'dv-sample-plan-r3',
          locator: 'table-2',
          sourceLabel: '改装计划（当前版）',
        },
      },
    ],
    selectedClaimIndex: 2,
    note: '目标漂移到 TBD 表示尚未确定，不是延期完成，也不是取消。',
  },
  {
    activityKey: 'act:cabin-sensor-not-mentioned',
    label: '客舱传感器改造（新版未提）',
    claims: [
      {
        claimKind: 'TARGET',
        precision: 'QUARTER',
        rawValue: '2026-Q2',
        sourceRef: {
          documentVersionId: 'dv-sample-req-old',
          locator: 'sec-3.1',
          sourceLabel: '改造需求（R2，旧版提及）',
        },
      },
    ],
    selectedClaimIndex: 0,
    note: '当前版未提及该目标：新版未提不等于取消，保留旧版声明与来源，等待人工核对。',
  },
  {
    activityKey: 'act:late-reported-event',
    label: '航前检查异常事件（晚收到旧事件）',
    claims: [
      {
        claimKind: 'OCCURRED',
        precision: 'DATE',
        rawValue: '2026-04-12',
        sourceRef: {
          documentVersionId: 'dv-sample-event',
          locator: 'para-4',
          sourceLabel: '事件记录 E（事件发生来源）',
        },
      },
      {
        claimKind: 'ACQUIRED',
        precision: 'DATE',
        rawValue: '2026-08-30',
        sourceRef: {
          documentVersionId: 'dv-sample-intake',
          locator: 'entry-17',
          sourceLabel: '迟到登记台账（取得来源）',
        },
      },
    ],
    selectedClaimIndex: 1,
    note: '发生时间与取得时间分开保留，各有独立来源；迟报不充作新近事件。',
  },
  {
    activityKey: 'act:sil-review-cycle',
    label: '软件完整性等级复核',
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
    selectedClaimIndex: 0,
  },
  {
    activityKey: 'act:formal-revision-target',
    label: '服务通告 SB-2026-114 合规目标（同 family 正式改版）',
    claims: [
      {
        claimKind: 'TARGET',
        precision: 'DATE',
        rawValue: '2026-06-30',
        sourceRef: {
          documentVersionId: 'dv-sample-sb-r3',
          locator: 'sec-2.0',
          sourceLabel: '服务通告 SB-2026-114（R3）',
        },
      },
    ],
    selectedClaimIndex: 0,
    note: '正式改版比较要求同一 family 的不同 DV；对应下方改版比较样例。',
  },
];

export type ChronologyBodyDiffKind =
  | 'ADDED'
  | 'REMOVED'
  | 'MODIFIED'
  | 'NOT_MENTIONED'
  | 'TEXT_EQUAL';

export interface ChronologyRevisionEndpointSample {
  revision: string;
  documentVersionId: string;
  receivedAt: string;
}

export interface ChronologyRevisionCompareSample {
  compareKey: string;
  familyKey: string;
  documentLabel: string;
  baseline: ChronologyRevisionEndpointSample;
  compareTo: ChronologyRevisionEndpointSample;
  missingRevisions: string[];
  uncoveredRevisions: string[];
  manufacturerNotes: string[];
  bodyDiffs: {
    section: string;
    baselineText: string;
    compareText: string;
    changeKind: ChronologyBodyDiffKind;
  }[];
  assessmentImpacts: {
    assessmentLabel: string;
    impact: string;
    status: 'REQUIRES_REVIEW' | 'UNKNOWN';
  }[];
}

export const CHRONOLOGY_REVISION_COMPARE_SAMPLES: ChronologyRevisionCompareSample[] =
  [
    {
      compareKey: 'cmp:sb-2026-114-r1-r3',
      familyKey: 'fam:sb-2026-114',
      documentLabel: '服务通告 SB-2026-114（同 family）',
      baseline: {
        revision: 'R1',
        documentVersionId: 'dv-sample-sb-r1',
        receivedAt: '2026-01-15',
      },
      compareTo: {
        revision: 'R3',
        documentVersionId: 'dv-sample-sb-r3',
        receivedAt: '2026-06-02',
      },
      missingRevisions: ['R2'],
      uncoveredRevisions: [],
      manufacturerNotes: [
        '厂家修订说明（R3）：合并适航指令要求，调整执行时限表述。',
        '厂家修订说明（R3）：第 4 节维护步骤按新工装重写。',
      ],
      bodyDiffs: [
        {
          section: '第 2 节 执行时限',
          baselineText: '自收文之日起 12 个月内完成',
          compareText: '自收文之日起 18 个月内完成',
          changeKind: 'MODIFIED',
        },
        {
          section: '第 5 节 记录要求',
          baselineText: '（R1 未包含）',
          compareText: '完工后 30 日内提交执行记录',
          changeKind: 'ADDED',
        },
        {
          section: '第 3 节 特殊工装',
          baselineText: '需使用厂家指定工装 T-7',
          compareText: '（新版未提）',
          changeKind: 'NOT_MENTIONED',
        },
      ],
      assessmentImpacts: [
        {
          assessmentLabel: '既有适航符合性评估',
          impact: '时限放宽后需核对机队剩余窗口',
          status: 'REQUIRES_REVIEW',
        },
        {
          assessmentLabel: '工装准备评估',
          impact: '新版未提工装要求，影响方向未定',
          status: 'UNKNOWN',
        },
      ],
    },
    {
      compareKey: 'cmp:sb-2026-114-r3-r4',
      familyKey: 'fam:sb-2026-114',
      documentLabel: '服务通告 SB-2026-114（相邻版）',
      baseline: {
        revision: 'R3',
        documentVersionId: 'dv-sample-sb-r3',
        receivedAt: '2026-06-02',
      },
      compareTo: {
        revision: 'R4',
        documentVersionId: 'dv-sample-sb-r4',
        receivedAt: '2026-08-20',
      },
      missingRevisions: [],
      uncoveredRevisions: ['第 6 节附件（本次未选择，未比较）'],
      manufacturerNotes: ['厂家修订说明（R4）：勘误，无实质内容变化（厂家自述）。'],
      bodyDiffs: [
        {
          section: '第 2 节 执行时限',
          baselineText: '自收文之日起 18 个月内完成',
          compareText: '自收文之日起 18 个月内完成',
          changeKind: 'TEXT_EQUAL',
        },
        {
          section: '第 4 节 维护步骤',
          baselineText: '按工装 K-2 执行扭矩检查',
          compareText: '按工装 K-2A 执行扭矩检查',
          changeKind: 'MODIFIED',
        },
      ],
      assessmentImpacts: [
        {
          assessmentLabel: '既有适航符合性评估',
          impact: '文本归一化一致不代表工程影响不变，仍须人工复核',
          status: 'UNKNOWN',
        },
      ],
    },
  ];

export const CHRONOLOGY_DELIVERED_READING_CAPABILITIES = [
  '两端准确读取（readDocumentRevisionReading，技术发布 e5cdf5b96b；本样例不调用，无真实两端身份）',
  '厂家修订说明与原文定位（publisherRevisionDescriptions）',
  '正文及父级条件（selectedSections / sections）',
  '来源定位（各自 binding 与 SourceRef，不共用 after 身份）',
  '未比较范围（unselectedUnitIds）与 NOT_COMPARED 原因',
] as const;

export const CHRONOLOGY_NARROW_READ_MISSING_FIELDS = [
  '完整活动历史（活动级声明序列与当前选择指针的真实读取）',
  '正式版本关系（publicationRelationship 仅 NOT_VERIFIED，无证明最新/相邻/完整修订跨度）',
  '工程影响（TEXT_EQUAL 不可映射为评估无变化）',
  '评估覆盖（assessmentCoverage 仅 NOT_RECORDED_BY_THIS_READ）',
] as const;
