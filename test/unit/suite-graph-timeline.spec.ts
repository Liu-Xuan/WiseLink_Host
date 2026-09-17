import {
  appendSuiteGraphActivityStatements,
  appendSuiteGraphCatalogDocuments,
  type SuiteGraphActivityCandidate,
  type SuiteMatterGraphRead,
} from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { buildSuiteGraphTimeline } from '../../client/src/pages/RelationGraphPage/suite-graph-timeline';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type {
  DocumentActivityRevision,
  DocumentActivityStatement,
} from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';

const binding: DocumentOriginalBinding = {
  documentVersionId: 'dv-a',
  parseRunId: 'pr-1',
  parseRevision: 1,
  sourceArtifactId: 'art-1',
  sourceSha256: 'sha',
  sourceByteLength: 10,
};

function statement(statementId: string, raw: string | null, label: string): DocumentActivityStatement {
  return {
    statementKey: `key-${statementId}`,
    statementId,
    label,
    quotes: [{ anchorId: `anchor-${statementId}`, start: 0, end: 4, text: '原文' }],
    time: raw
      ? { role: 'OCCURRED', precision: 'DAY', expression: 'CALENDAR', raw, quoteIndex: 0 }
      : null,
    statusRaw: null,
    limitations: [],
  };
}

function makeCandidate(overrides?: Partial<DocumentActivityRevision>): DocumentActivityRevision {
  return {
    schemaVersion: 'wiselink.document.activity-candidate.v1',
    runRef: 'run-1',
    candidateRevision: 2,
    candidateOnly: true,
    sourceBinding: { original: binding, semanticRevision: 1 },
    producer: { skillVersion: 'skill-1', modelVersion: 'model-1' },
    savedAt: '2026-09-01T00:00:00.000Z',
    readCoverage: {
      status: 'DELIVERED_RANGES_ONLY',
      selection: { sectionIds: ['S1'] },
      deliveredRanges: [{ sectionId: 'S1', offset: 0, unitIds: ['U1'], anchorIds: ['A1'], nextOffset: null }],
      sourceCoverage: { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] },
    },
    statements: [],
    sourceAnchors: [],
    ...overrides,
  };
}

function catalogEntry(documentVersionId: string, code = 'SB-001'): EngineeringMatterCatalogEntry {
  return {
    workItemId: `wi-${documentVersionId}`,
    relationRole: 'PRIMARY',
    linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1,
    workItemChangedSinceLink: false,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: `doc-${documentVersionId}`,
      documentVersionId,
      documentCode: code,
      businessRevision: 'R02',
      normalizedFamily: code,
    },
    documentCurrentness: {
      familyId: `family-${documentVersionId}`,
      currentDocumentVersionId: documentVersionId,
      currentGeneration: 1,
      selectedVersionIsCurrent: true,
    },
    sourceNavigation: { status: 'AVAILABLE', sourceRefCount: 1, structuredContentPath: `/document-versions/${documentVersionId}` },
  };
}

function emptyRead(): SuiteMatterGraphRead {
  return {
    graph: { id: 'root', title: '事项', rootKind: 'matter', groups: [], relations: [] },
    targets: new Map(),
    relationDetails: new Map(),
    notices: [],
    workRef: null,
    overviewStatus: null,
    missingEvidenceRefs: [],
  };
}

const revision = {
  matterWorkRevisionId: 'mwr-1',
  workingRevision: 3,
  createdAt: '2026-06-15T08:00:00.000Z',
  changeSummary: '补充依据',
} as EngineeringMatterWorkingRevisionReadModel;

describe('buildSuiteGraphTimeline', () => {
  it('orders dated source events by calendar start and keeps undated events after them in source order', () => {
    const activities = new Map<string, SuiteGraphActivityCandidate>([
      ['dv-a', {
        familyId: 'family-dv-a',
        candidate: makeCandidate({
          statements: [
            statement('st-late', '2026-09-03', '晚声明'),
            statement('st-early', '2026-01-05', '早声明'),
            statement('st-undated', null, '无日期声明'),
          ],
        }),
      }],
    ]);
    const { events } = buildSuiteGraphTimeline({
      read: null,
      catalog: [catalogEntry('dv-a')],
      activities,
      revision: null,
    });
    expect(events.map((event) => event.pins?.statementId)).toEqual(['st-early', 'st-late', 'st-undated']);
    expect(events[2].sortKey).toBeNull();
  });

  it('pins each statement event to its exact saved identity and never to entry pins', () => {
    const activities = new Map<string, SuiteGraphActivityCandidate>([
      ['dv-a', { familyId: 'family-dv-a', candidate: makeCandidate({ statements: [statement('st-1', '2026-02-01', '声明')] }) }],
    ]);
    const { events } = buildSuiteGraphTimeline({ read: null, catalog: [catalogEntry('dv-a')], activities, revision: null });
    expect(events).toHaveLength(1);
    expect(events[0].pins).toEqual({
      documentVersionId: 'dv-a',
      familyId: 'family-dv-a',
      parseRunId: 'pr-1',
      candidateRevision: 2,
      runRef: 'run-1',
      statementId: 'st-1',
      anchorId: 'anchor-st-1',
    });
    expect(events[0].id.startsWith('["event",')).toBe(true);
    expect(events[0].sourceLabel).toBe('SB-001 · R02');
  });

  it('links an event to its statement node when the graph contains appended statements', () => {
    const activities = new Map<string, SuiteGraphActivityCandidate>([
      ['dv-a', { familyId: 'family-dv-a', candidate: makeCandidate({ statements: [statement('st-1', '2026-02-01', '声明')] }) }],
    ]);
    const read = appendSuiteGraphActivityStatements(
      appendSuiteGraphCatalogDocuments(emptyRead(), [catalogEntry('dv-a')]),
      activities,
    );
    const { events } = buildSuiteGraphTimeline({ read, catalog: [catalogEntry('dv-a')], activities, revision: null });
    expect(events[0].nodeId).toBeTruthy();
    const target = read.targets.get(events[0].nodeId!);
    expect(target?.kind).toBe('statement');
    if (target?.kind === 'statement') expect(target.statement.statementId).toBe('st-1');
  });

  it('appends the saved work record at its saved time with an internal identity', () => {
    const { events } = buildSuiteGraphTimeline({ read: null, catalog: [], activities: new Map(), revision });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('work');
    expect(events[0].sortKey).toBe(Date.parse('2026-06-15T08:00:00.000Z'));
    expect(events[0].pins).toBeNull();
    expect(events[0].id).toContain('mwr-1');
  });
});
