jest.mock('../../client/src/api/canonical-host', () => ({}));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  projectJobAidActivity,
  JOBAID_ACTIVITY_WINDOW,
} from '../../server/modules/canonical-host/jobaid-activity';
import JobAidExecutionActivity from '../../client/src/pages/DocumentParsingPage/JobAidExecutionActivity';
import { preserveJobAidRead } from '../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const attempt = {
  attemptId: 'private-attempt',
  attemptRef: 'AQ-visible',
  status: 'RUNNING',
  activityJson: null,
};
const saved = {
  workRevisionRef: 'JAWR-one',
  workRevision: 1,
  createdAt: new Date('2026-09-23T00:00:00Z'),
};
function event() {
  return {
    kind: 'ASSESSMENT_SOURCES_READ',
    sourceRefs: ['private-source-one', 'private-source-two'],
    purpose: 'private prompt',
    observedAt: '2026-09-23T00:00:00Z',
    leaseToken: 'private-token',
  };
}

it('projects only delivered counts, real timestamps and saved revision identity', () => {
  const result = projectJobAidActivity(
    { ...attempt, activityJson: JSON.stringify([event()]) },
    [saved],
  );
  expect(result.sourceReads).toEqual([
    { sequence: 1, sourceCount: 2, observedAt: '2026-09-23T00:00:00Z' },
  ]);
  expect(result.savedRevisions).toEqual([
    {
      workRevisionRef: 'JAWR-one',
      workRevision: 1,
      savedAt: '2026-09-23T00:00:00.000Z',
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('private');
  expect(result.candidateOnly).toBe(true);
});

it('retains repeated reads, original sequence and missing timestamps without inventing events', () => {
  const noTime = { kind: 'ASSESSMENT_SOURCES_READ', sourceRefs: ['ref'] };
  const result = projectJobAidActivity(
    {
      ...attempt,
      activityJson: JSON.stringify([
        event(),
        { kind: 'OTHER', raw: 'private' },
        noTime,
        noTime,
      ]),
    },
    [],
  );
  expect(result.sourceReads.map((read) => read.sequence)).toEqual([1, 3, 4]);
  expect(result.sourceReads[1].observedAt).toBeNull();
  expect(result.unknownRecordCount).toBe(1);
});

it('reports malformed records and broken arrays without discarding save receipts', () => {
  for (const raw of ['{invalid', '{}']) {
    const result = projectJobAidActivity({ ...attempt, activityJson: raw }, [
      saved,
    ]);
    expect(result.error).toBe('ACTIVITY_RECORDS_INVALID');
    expect(result.savedRevisions).toHaveLength(1);
  }
  const result = projectJobAidActivity(
    {
      ...attempt,
      activityJson: JSON.stringify([
        null,
        { kind: 'ASSESSMENT_SOURCES_READ', sourceRefs: [42] },
        { ...event(), observedAt: 'bad date' },
      ]),
    },
    [],
  );
  expect(result.malformedRecordCount).toBe(3);
  expect(result.sourceReads).toHaveLength(0);
});

it('bounds both lists and reports omitted history without creating a shared invented ordering', () => {
  const result = projectJobAidActivity(
    {
      ...attempt,
      activityJson: JSON.stringify(Array.from({ length: 55 }, event)),
    },
    Array.from({ length: 51 }, (_, index) => ({
      ...saved,
      workRevisionRef: `JAWR-${51 - index}`,
      workRevision: 51 - index,
    })),
  );
  expect(result.sourceReads).toHaveLength(JOBAID_ACTIVITY_WINDOW);
  expect(result.sourceReads[0].sequence).toBe(6);
  expect(result.omittedEarlierRecordCount).toBe(5);
  expect(result.hasEarlierSavedRevisions).toBe(true);
  expect(result.savedRevisions).toHaveLength(50);
  expect(result.savedRevisions[0].workRevision).toBe(2);
});

it('renders actual reads and exact saved versions even if the reading log is broken', () => {
  const result = projectJobAidActivity(
    { ...attempt, activityJson: JSON.stringify([event()]) },
    [saved],
  );
  const html = renderToStaticMarkup(
    createElement(JobAidExecutionActivity, { activity: result }),
  );
  expect(html).toContain('已登记读取 2 项材料');
  expect(html).toContain('data-work-revision-ref="JAWR-one"');
  expect(html).not.toContain('private');
  expect(html).toContain('不代表正式采用');
  const broken = renderToStaticMarkup(
    createElement(JobAidExecutionActivity, {
      activity: { ...result, error: 'ACTIVITY_RECORDS_INVALID' },
    }),
  );
  expect(broken).toContain('role="alert"');
  expect(broken).toContain('JAWR-one');
});

it('new activity updates the mounted view even when saved work and task status are unchanged', () => {
  const previous = jobAidReadingFixture();
  previous.activity = projectJobAidActivity(attempt, []);
  const next = {
    ...previous,
    activity: projectJobAidActivity(
      { ...attempt, activityJson: JSON.stringify([event()]) },
      [],
    ),
  };
  expect(preserveJobAidRead(previous, next)).toBe(next);
  expect(preserveJobAidRead(next, structuredClone(next))).toBe(next);
});


it('shows knowledge tool observations through the actual view without exposing private receipt fields', () => {
  const states = ['REQUESTED', 'STARTING', 'RUNNING', 'COMPLETED', 'FAILED', 'UNKNOWN', 'UNAVAILABLE'];
  const result = projectJobAidActivity({ ...attempt, activityJson: JSON.stringify(states.map(status => ({
    kind: 'ASSESSMENT_KNOWLEDGE_OBSERVED', status, observedAt: '2026-09-23T00:00:00Z',
    queryRef: 'private-ref', query: 'private-query', error: 'private-error', answer: 'private-answer',
  }))) }, []);
  expect(result.knowledgeObservations?.map(item => item.status)).toEqual(states);
  expect(result.sourceReads).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('private');
  const html = renderToStaticMarkup(createElement(JobAidExecutionActivity, { activity: result }));
  expect(html).toContain('检索进行中'); expect(html).toContain('检索失败');
  expect(html).toContain('不证明工具当前仍在运行'); expect(html).toContain('不代表原始文档已核实');
  expect(html).not.toContain('private');
  const previous = jobAidReadingFixture(); previous.activity = projectJobAidActivity(attempt, []);
  const next = { ...previous, activity: result };
  expect(preserveJobAidRead(previous, next)).toBe(next);
});

it('counts invalid knowledge observations, preserves missing time and uses the existing bounded activity window', () => {
  const record = { kind: 'ASSESSMENT_KNOWLEDGE_OBSERVED', status: 'RUNNING' };
  const result = projectJobAidActivity({ ...attempt, activityJson: JSON.stringify([
    ...Array.from({ length: 51 }, () => record), { ...record, status: 'private-status' },
    { ...record, observedAt: 'not-a-date' },
  ]) }, [saved]);
  expect(result.omittedEarlierRecordCount).toBe(3);
  expect(result.knowledgeObservations).toHaveLength(48);
  expect(result.knowledgeObservations?.[0]).toEqual({ sequence: 4, status: 'RUNNING', observedAt: null });
  expect(result.malformedRecordCount).toBe(2);
  expect(result.savedRevisions).toHaveLength(1);
});
