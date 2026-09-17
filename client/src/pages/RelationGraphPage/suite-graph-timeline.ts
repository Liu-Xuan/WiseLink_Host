import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type { DocumentActivityStatement } from '@shared/document-activity.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { timelineItems } from '@client/src/features/trinity/document-activity-timeline';
import {
  suiteGraphDocumentNodeId,
  suiteGraphStatementNodeId,
  type SuiteGraphActivityCandidate,
  type SuiteMatterGraphRead,
} from './suite-matter-graph';

export type SuiteGraphTimelineEventKind = 'source' | 'work';

/** Exact saved identity pins; a /timeline entry must carry all of them unchanged. */
export interface SuiteGraphTimelineEventPins {
  documentVersionId: string;
  familyId: string;
  parseRunId: string;
  candidateRevision: number;
  runRef: string;
  statementId: string;
  anchorId: string | null;
}

export interface SuiteGraphTimelineEvent {
  id: string;
  kind: SuiteGraphTimelineEventKind;
  /** Display wording: raw source wording for statements, saved-at date for work records. */
  date: string;
  /** Calendar placement of fully explicit dates only; null keeps source order. */
  sortKey: number | null;
  title: string;
  detail: string;
  /** Graph node to highlight: the statement node, else its document node, else none. */
  nodeId: string | null;
  pins: SuiteGraphTimelineEventPins | null;
  statement: DocumentActivityStatement | null;
  sourceLabel: string | null;
}

export type SuiteGraphTimelineSourceStatus =
  | 'loading'
  | 'loaded'
  | 'empty'
  | 'unparsed'
  | 'unavailable'
  | 'skipped';

export interface SuiteGraphTimelineSource {
  documentVersionId: string;
  label: string;
  status: SuiteGraphTimelineSourceStatus;
  notice: string | null;
}

const eventIdentity = (...parts: string[]) => JSON.stringify(['event', ...parts]);

const sourceLabelFor = (entry: EngineeringMatterCatalogEntry): string =>
  `${entry.document.documentCode} · ${entry.document.businessRevision}`;

/**
 * Project the left timeline from authorized saved data only: source-declared
 * statements of loaded activity candidates plus the saved work record. Statements
 * keep their raw source wording; only fully explicit calendar dates are placed.
 */
export function buildSuiteGraphTimeline(input: {
  read: SuiteMatterGraphRead | null;
  catalog: EngineeringMatterCatalogEntry[];
  activities: ReadonlyMap<string, SuiteGraphActivityCandidate>;
  revision: EngineeringMatterWorkingRevisionReadModel | null;
}): { events: SuiteGraphTimelineEvent[] } {
  const events: SuiteGraphTimelineEvent[] = [];
  for (const entry of input.catalog) {
    const documentVersionId = entry.document.documentVersionId;
    const activity = input.activities.get(documentVersionId);
    if (!activity) continue;
    const label = sourceLabelFor(entry);
    for (const item of timelineItems(activity.candidate)) {
      const { statement } = item;
      const nodeId = input.read
        ? suiteGraphStatementNodeId(input.read.targets, documentVersionId, statement.statementId) ??
          suiteGraphDocumentNodeId(input.read.targets, documentVersionId)
        : null;
      events.push({
        id: eventIdentity(documentVersionId, statement.statementId),
        kind: 'source',
        date: item.displayTime,
        sortKey: item.span?.start ?? null,
        title: statement.label,
        detail: statement.statusRaw
          ? `${label} · 状态：${statement.statusRaw}`
          : label,
        nodeId,
        pins: {
          documentVersionId,
          familyId: activity.familyId,
          parseRunId: activity.candidate.sourceBinding.original.parseRunId,
          candidateRevision: activity.candidate.candidateRevision,
          runRef: activity.candidate.runRef,
          statementId: statement.statementId,
          anchorId: statement.quotes[0]?.anchorId ?? null,
        },
        statement,
        sourceLabel: label,
      });
    }
  }
  const revision = input.revision;
  if (revision) {
    const savedAt = Date.parse(revision.createdAt);
    events.push({
      id: eventIdentity('work', revision.matterWorkRevisionId),
      kind: 'work',
      date: `保存于 ${revision.createdAt.slice(0, 10)}`,
      sortKey: Number.isFinite(savedAt) ? savedAt : null,
      title: `保存工作 · 修订 ${revision.workingRevision}`,
      detail: revision.changeSummary || '该次保存未填写变化说明。',
      nodeId: input.read?.graph.id ?? null,
      pins: null,
      statement: null,
      sourceLabel: null,
    });
  }
  const placed = events.filter((event) => event.sortKey !== null);
  placed.sort((a, b) => a.sortKey! - b.sortKey!);
  const unplaced = events.filter((event) => event.sortKey === null);
  return { events: [...placed, ...unplaced] };
}
