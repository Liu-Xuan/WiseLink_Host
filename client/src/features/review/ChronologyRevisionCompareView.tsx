import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitCompareArrows } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';

import type {
  ChronologyBodyDiffKind,
  ChronologyRevisionCompareSample,
  ChronologyRevisionEndpointSample,
} from './chronology-samples';

const BODY_DIFF_KIND_LABEL: Record<ChronologyBodyDiffKind, string> = {
  ADDED: '新增',
  REMOVED: '删除',
  MODIFIED: '修改',
  NOT_MENTIONED: '新版未提（非取消）',
  TEXT_EQUAL: '文本一致',
};

const ASSESSMENT_STATUS_LABEL: Record<'REQUIRES_REVIEW' | 'UNKNOWN', string> =
  {
    REQUIRES_REVIEW: '须复核',
    UNKNOWN: '方向未定',
  };

export interface ChronologyRevisionCompareViewProps {
  compares: ChronologyRevisionCompareSample[];
}

function EndpointCard({
  label,
  endpoint,
}: {
  label: string;
  endpoint: ChronologyRevisionEndpointSample;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{endpoint.revision}</p>
      <p className="text-xs text-muted-foreground">
        {endpoint.documentVersionId} · 收到 {endpoint.receivedAt}
      </p>
    </div>
  );
}

export default function ChronologyRevisionCompareView({
  compares,
}: ChronologyRevisionCompareViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCompare =
    compares.find(
      (item: ChronologyRevisionCompareSample) =>
        item.compareKey === searchParams.get('compare'),
    ) ??
    compares[0] ??
    null;

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (!selectedCompare) {
      if (next.has('compare')) {
        next.delete('compare');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (next.get('compare') !== selectedCompare.compareKey) {
      next.set('compare', selectedCompare.compareKey);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, selectedCompare]);

  function selectCompare(item: ChronologyRevisionCompareSample): void {
    const next = new URLSearchParams(searchParams);
    next.set('compare', item.compareKey);
    setSearchParams(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="size-4" />
          换版比较（同 family 正式换版，隔离样例）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {compares.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            暂无换版比较样例；两端 revision-reading 已交付（技术发布），生产视图未接入，完整活动历史与正式版本关系仍缺。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {compares.map((item: ChronologyRevisionCompareSample) => (
                <Button
                  key={item.compareKey}
                  variant={
                    item.compareKey === selectedCompare?.compareKey
                      ? 'default'
                      : 'outline'
                  }
                  size="sm"
                  aria-pressed={item.compareKey === selectedCompare?.compareKey}
                  onClick={() => selectCompare(item)}
                >
                  {item.baseline.revision} → {item.compareTo.revision}
                </Button>
              ))}
            </div>
            {selectedCompare ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <EndpointCard label="基线" endpoint={selectedCompare.baseline} />
                  <span className="text-muted-foreground">→</span>
                  <EndpointCard
                    label="比较目标"
                    endpoint={selectedCompare.compareTo}
                  />
                  <Badge variant="outline">
                    family：{selectedCompare.familyKey}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedCompare.documentLabel}
                </p>
                {selectedCompare.missingRevisions.length > 0 ? (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    中间版本缺口：
                    {selectedCompare.missingRevisions.join('、')}{' '}
                    未收到，两端可读但比较覆盖明确不完整。
                  </p>
                ) : null}
                {selectedCompare.uncoveredRevisions.length > 0 ? (
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    未比较范围：
                    {selectedCompare.uncoveredRevisions.join('；')}
                  </p>
                ) : null}
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    厂家修订说明
                  </h3>
                  {selectedCompare.manufacturerNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      未定位到支持的说明角色（空数组不代表无修订）。
                    </p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {selectedCompare.manufacturerNotes.map((note: string) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    正文差异（含父级条件）
                  </h3>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">章节</th>
                          <th className="px-3 py-2 font-medium">基线文本</th>
                          <th className="px-3 py-2 font-medium">比较目标文本</th>
                          <th className="px-3 py-2 font-medium">变更类型</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCompare.bodyDiffs.map(
                          (diff: (typeof selectedCompare.bodyDiffs)[number]) => (
                            <tr
                              key={`${selectedCompare.compareKey}-${diff.section}`}
                              className="border-b border-border/60 last:border-0"
                            >
                              <td className="px-3 py-2 align-top text-foreground">
                                {diff.section}
                              </td>
                              <td className="px-3 py-2 align-top text-muted-foreground">
                                {diff.baselineText}
                              </td>
                              <td className="px-3 py-2 align-top text-muted-foreground">
                                {diff.compareText}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <Badge
                                  variant={
                                    diff.changeKind === 'TEXT_EQUAL'
                                      ? 'outline'
                                      : 'secondary'
                                  }
                                >
                                  {BODY_DIFF_KIND_LABEL[diff.changeKind]}
                                </Badge>
                                {diff.changeKind === 'TEXT_EQUAL' ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    文本一致不代表工程影响或评估无变化。
                                  </p>
                                ) : null}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    对既有评估的影响
                  </h3>
                  <ul className="space-y-2">
                    {selectedCompare.assessmentImpacts.map(
                      (impact: (typeof selectedCompare.assessmentImpacts)[number]) => (
                        <li
                          key={`${selectedCompare.compareKey}-${impact.assessmentLabel}`}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <Badge variant="secondary">
                            {ASSESSMENT_STATUS_LABEL[impact.status]}
                          </Badge>
                          <span className="font-medium text-foreground">
                            {impact.assessmentLabel}
                          </span>
                          <span className="text-muted-foreground">
                            {impact.impact}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    样例不含“评估无变化”档：TEXT_EQUAL
                    与未记录覆盖均须人工复核。
                  </p>
                </section>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
