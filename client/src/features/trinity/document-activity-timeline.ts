import type {
  DocumentActivityRevision,
  DocumentActivityStatement,
  DocumentActivityTime,
} from '@shared/document-activity.interface';

export type ActivityTimelineLane = 'materials' | 'execution' | 'observation' | 'knowledge';

export interface ActivityTimelineItem {
  statement: DocumentActivityStatement;
  lane: ActivityTimelineLane;
  time: DocumentActivityTime | null;
  displayTime: string;
}

export const ACTIVITY_TIMELINE_LANES: ReadonlyArray<{
  id: ActivityTimelineLane;
  label: string;
}> = [
  { id: 'materials', label: '资料与厂家进展' },
  { id: 'execution', label: '我方工程执行' },
  { id: 'observation', label: '运行观察' },
  { id: 'knowledge', label: '认识知识更新' },
];

function laneFor(_time: DocumentActivityTime | null): ActivityTimelineLane {
  // The current activity DTO carries source declarations only. A role is a
  // property of the wording, not evidence of execution or runtime observation.
  return 'materials';
}

export function timelineItems(candidate: DocumentActivityRevision | null): ActivityTimelineItem[] {
  if (!candidate) return [];
  return candidate.statements.map((statement) => ({
    statement,
    lane: laneFor(statement.time),
    time: statement.time,
    displayTime: statement.time?.raw ?? '时间未提取',
  }));
}

export function timelineLaneItems(
  candidate: DocumentActivityRevision | null,
  lane: ActivityTimelineLane,
): ActivityTimelineItem[] {
  return timelineItems(candidate).filter((item) => item.lane === lane);
}
