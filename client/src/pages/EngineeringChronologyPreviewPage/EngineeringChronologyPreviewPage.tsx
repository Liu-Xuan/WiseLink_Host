import { useSearchParams } from 'react-router-dom';

import EngineeringChronologyView from '@client/src/features/review/EngineeringChronologyView';
import {
  CHRONOLOGY_REVISION_COMPARE_SAMPLES,
  CHRONOLOGY_SAMPLE_ACTIVITIES,
  type ChronologyActivitySample,
  type ChronologyRevisionCompareSample,
} from '@client/src/features/review/chronology-samples';

const EMPTY_CLAIMS_FIXTURE_ACTIVITIES: ChronologyActivitySample[] = [
  {
    activityKey: 'act:fixture-empty-claims',
    label: 'Fixture：空声明活动',
    claims: [],
    selectedClaimIndex: 0,
    note: '隔离 fixture：活动存在但无声明，用于验证 claim 与来源状态被清除且有效活动保留。',
  },
];

/**
 * DEV/QA harness：T1 工程历程同组件隔离样例。
 * 生产导航不链接此页；样例数据仅演示组件形态，不进入生产读取。
 */
export default function EngineeringChronologyPreviewPage() {
  const [searchParams] = useSearchParams();
  const fixture = searchParams.get('fixture');
  const activities: ChronologyActivitySample[] =
    fixture === 'empty-activities'
      ? []
      : fixture === 'empty-claims'
        ? EMPTY_CLAIMS_FIXTURE_ACTIVITIES
        : CHRONOLOGY_SAMPLE_ACTIVITIES;
  const compares: ChronologyRevisionCompareSample[] =
    fixture === 'empty-compares' ? [] : CHRONOLOGY_REVISION_COMPARE_SAMPLES;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          工程历程视图（隔离样例）
        </h1>
        <p className="text-sm text-muted-foreground">
          技术过程时间线保留原用途；活动/声明与改版比较以样例演示。两端
          revision-reading 已交付，生产视图未接入；完整活动历史与正式版本关系仍缺。
        </p>
      </header>
      <EngineeringChronologyView
        technicalTimeline={null}
        activities={activities}
        compares={compares}
      />
    </div>
  );
}
