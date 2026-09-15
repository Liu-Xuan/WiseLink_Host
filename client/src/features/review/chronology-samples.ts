export type ChronologyClaimKind =
  | 'OCCURRED'
  | 'TARGET'
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
}

export const CHRONOLOGY_CLAIM_KIND_LABEL: Record<ChronologyClaimKind, string> =
  {
    OCCURRED: '发生',
    TARGET: '目标',
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

export const CHRONOLOGY_SAMPLE_ACTIVITIES: ChronologyActivitySample[] = [
  {
    activityKey: 'act:vibration-monitor-upgrade',
    label: '发动机振动监测软件升级',
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
    selectedClaimIndex: 2,
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
];

export const CHRONOLOGY_NARROW_READ_MISSING_FIELDS = [
  'activityKey（跨来源稳定活动身份）',
  'sourceRef（DV + 章节定位 + 来源标签）',
  'claimKind（发生 / 目标 / 生效 / 取得）',
  'precision（date / quarter / TBD / 条件期限，不补成日历日期）',
  'rawValue（保留原精度文本）',
  'claim 历史序列与当前选择指针',
] as const;
