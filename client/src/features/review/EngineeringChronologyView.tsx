import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, GitCommitHorizontal, Milestone } from 'lucide-react';

import type { CanonicalTimelineProjection } from '@shared/api.interface';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import RevisionTimeline from '@client/src/features/review/RevisionTimeline';
import { matterDocumentRoute } from '@client/src/features/matter/matter-navigation';

import {
  CHRONOLOGY_CLAIM_KIND_LABEL,
  CHRONOLOGY_DELIVERED_READING_CAPABILITIES,
  CHRONOLOGY_NARROW_READ_MISSING_FIELDS,
  CHRONOLOGY_PRECISION_LABEL,
  CHRONOLOGY_SAMPLE_MATTER_ID,
  CHRONOLOGY_SAMPLE_WORK_ITEM_ID,
  type ChronologyActivitySample,
  type ChronologyClaimSample,
  type ChronologyRevisionCompareSample,
} from './chronology-samples';
import ChronologyRevisionCompareView from './ChronologyRevisionCompareView';

export interface EngineeringChronologyViewProps {
  technicalTimeline: CanonicalTimelineProjection | null;
  activities: ChronologyActivitySample[];
  compares: ChronologyRevisionCompareSample[];
}

function claimKey(claim: ChronologyClaimSample): string {
  return JSON.stringify([
    claim.sourceRef.documentVersionId,
    claim.sourceRef.locator,
    claim.claimKind,
    claim.precision,
    claim.rawValue,
  ]);
}

export default function EngineeringChronologyView({
  technicalTimeline,
  activities,
  compares,
}: EngineeringChronologyViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedActivity =
    activities.find(
      (item: ChronologyActivitySample) =>
        item.activityKey === searchParams.get('activity'),
    ) ??
    activities[0] ??
    null;
  const selectedClaim =
    selectedActivity?.claims.find(
      (claim: ChronologyClaimSample) =>
        claimKey(claim) === searchParams.get('claim'),
    ) ??
    selectedActivity?.claims[selectedActivity.selectedClaimIndex] ??
    selectedActivity?.claims[0] ??
    null;
  const sourceOpen = searchParams.get('view') === 'source' && !!selectedClaim;

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const view = next.get('view');
    if (view !== null && view !== 'source') {
      next.delete('view');
      changed = true;
    }
    if (!selectedActivity) {
      if (next.has('activity') || next.has('claim') || next.has('view')) {
        next.delete('activity');
        next.delete('claim');
        next.delete('view');
        changed = true;
      }
    } else {
      if (next.get('activity') !== selectedActivity.activityKey) {
        next.set('activity', selectedActivity.activityKey);
        changed = true;
      }
      if (!selectedClaim) {
        if (next.has('claim') || next.get('view') === 'source') {
          next.delete('claim');
          next.delete('view');
          changed = true;
        }
      } else if (next.get('claim') !== claimKey(selectedClaim)) {
        next.set('claim', claimKey(selectedClaim));
        changed = true;
      }
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, selectedActivity, selectedClaim]);

  function selectClaim(
    activity: ChronologyActivitySample,
    claim: ChronologyClaimSample,
  ): void {
    const next = new URLSearchParams(searchParams);
    next.set('activity', activity.activityKey);
    next.set('claim', claimKey(claim));
    next.delete('view');
    setSearchParams(next);
  }

  function openSource(): void {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'source');
    setSearchParams(next);
  }

  function closeSource(): void {
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        隔离样例：来源仅在本页示意，不向真实阅读器发送假 ID，不触发业务
        API；真实活动/声明读取合同待主控与 P 交付。本页不代表真实业务验收。
      </section>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCommitHorizontal className="size-4" />
            技术过程时间线
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {technicalTimeline ? (
            <RevisionTimeline timeline={technicalTimeline} />
          ) : (
            <p className="flex items-center gap-2">
              <CalendarClock className="size-4" />
              当前没有可展示的技术过程时间线；该投影记录工作修订、绑定与读取等技术状态，不充作工程历程。
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Milestone className="size-4" />
            源绑定活动与声明（同组件隔离样例）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {activities.map((activity: ChronologyActivitySample) => {
            const isActive =
              activity.activityKey === selectedActivity?.activityKey;
            return (
              <section
                key={activity.activityKey}
                className="space-y-2 rounded-md border border-border/60 p-3"
              >
                <h3 className="text-sm font-medium text-foreground">
                  {activity.label}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {activity.activityKey}
                  </span>
                </h3>
                {activity.note ? (
                  <p className="text-xs text-muted-foreground">
                    {activity.note}
                  </p>
                ) : null}
                {activity.claims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    暂无声明；真实合同交付后按活动读取。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {activity.claims.map((claim: ChronologyClaimSample) => {
                      const selected =
                        isActive && selectedClaim
                          ? claimKey(claim) === claimKey(selectedClaim)
                          : false;
                      return (
                        <li
                          key={claimKey(claim)}
                          className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                            selected
                              ? 'border-primary bg-primary/5'
                              : 'border-border bg-background'
                          }`}
                        >
                          <Button
                            variant={selected ? 'default' : 'outline'}
                            size="sm"
                            aria-pressed={selected}
                            onClick={() => selectClaim(activity, claim)}
                          >
                            选择
                          </Button>
                          <Badge variant={selected ? 'default' : 'secondary'}>
                            {CHRONOLOGY_CLAIM_KIND_LABEL[claim.claimKind]}
                          </Badge>
                          <Badge variant="outline">
                            {CHRONOLOGY_PRECISION_LABEL[claim.precision]}
                          </Badge>
                          <span className="font-medium text-foreground">
                            {claim.rawValue}
                          </span>
                          <span className="text-muted-foreground">
                            来源：{claim.sourceRef.sourceLabel}（
                            {claim.sourceRef.locator}）
                          </span>
                          {selected ? (
                            <span className="ml-auto text-xs text-muted-foreground">
                              当前选择
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          {sourceOpen && selectedClaim && selectedActivity ? (
            <section
              aria-label="隔离来源示意"
              className="rounded-lg border border-border p-4 space-y-2"
            >
              <h3 className="font-medium">来源示意（隔离，非真实阅读器）</h3>
              <p className="text-sm">
                {selectedActivity.label} · {selectedClaim.rawValue}
              </p>
              <p className="text-sm text-muted-foreground">
                {selectedClaim.sourceRef.sourceLabel} ·{' '}
                {selectedClaim.sourceRef.locator}
              </p>
              <p className="text-sm text-muted-foreground">
                仅展示生产路由合同构造的 QA
                目标路径，不导航真实阅读器、不发送假 ID、不触发业务 API。
              </p>
              <code className="block break-all text-xs">
                {matterDocumentRoute(CHRONOLOGY_SAMPLE_MATTER_ID, {
                  workItemId: CHRONOLOGY_SAMPLE_WORK_ITEM_ID,
                  documentVersionId:
                    selectedClaim.sourceRef.documentVersionId,
                  sourceRefId: selectedClaim.sourceRef.locator,
                })}
              </code>
              <Button onClick={closeSource}>返回所选声明</Button>
            </section>
          ) : selectedClaim ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={openSource}>
                打开来源示意
              </Button>
              <span className="text-xs text-muted-foreground">
                当前选择：{CHRONOLOGY_CLAIM_KIND_LABEL[selectedClaim.claimKind]}{' '}
                · {selectedClaim.rawValue}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              没有可选声明；等待真实活动读取合同交付。
            </p>
          )}
        </CardContent>
      </Card>
      <ChronologyRevisionCompareView compares={compares} />
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium text-foreground">
          后端读取合同状态
        </h2>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-muted-foreground">
              已交付并技术发布（本样例不调用）
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {CHRONOLOGY_DELIVERED_READING_CAPABILITIES.map(
                (item: string) => (
                  <li key={item}>{item}</li>
                ),
              )}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground">
              仍缺字段（待主控 / P 交付，未造数）
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {CHRONOLOGY_NARROW_READ_MISSING_FIELDS.map((field: string) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
