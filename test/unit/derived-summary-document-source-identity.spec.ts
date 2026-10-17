import { PgDialect } from 'drizzle-orm/pg-core';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DerivedSummaryMember } from '@shared/derived-summary.interface';
import { documentReadingAnchorEvidence } from '../../server/modules/canonical-host/derived-summary-document-reading';
import {
  DerivedSummaryMembersService, mergeSummaryEvidence,
} from '../../server/modules/canonical-host/derived-summary-members.service';

type Passage = Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }>;
const actor = { tenantId: 'tenant-shared-original', actorUserId: 'actor-shared-original' };
const documentVersionId = 'document_version_shared';
const original: Passage = {
  kind: 'DOCUMENT_PASSAGE',
  evidenceRef: `DOCUMENT_ORIGINAL:${documentVersionId}:PRUN-shared:SR-shared`,
  workItemId: 'WI-first', documentVersionId, sourceRefId: 'SR-shared',
  title: 'Original source', versionLabel: 'PRUN-shared',
  excerpt: 'Synthetic exact condition and negation.', locator: '{"parseRunId":"PRUN-shared","sourceRefId":"SR-shared"}',
};
const first: Extract<DerivedSummaryMember, { kind: 'WORK_ITEM_WORK' }> = {
  kind: 'WORK_ITEM_WORK', workItemId: 'WI-first', documentVersionId,
  workRef: 'JAWR-first', workRevision: 13, issueKeys: [],
};
const second: typeof first = { ...first, workItemId: 'WI-second', workRef: 'JAWR-second', workRevision: 18 };

function memberReader(deniedWorkItemId: string | null = null, includeSecondCarrierInFirst = false) {
  const dialect = new PgDialect();
  const authorizationInputs: string[][] = [];
  const database = {
    select: jest.fn((fields: Record<string, unknown>) => 'ref' in fields ? {
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ ref: 'MWR-shared' }] }) }) }),
    } : {
      from: () => ({ innerJoin: () => ({
        where: async () => [{ documentVersionId, currentDocumentVersionId: documentVersionId }],
      }) }),
    }),
    execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const { params } = dialect.sqlToQuery(statement);
      const workIds = JSON.parse(String(params[0])) as string[];
      authorizationInputs.push(workIds);
      return [{ allowed: deniedWorkItemId === null || !workIds.includes(deniedWorkItemId) }];
    }),
  };
  const readSaved = jest.fn(async (input: { workItemId: string; workRef: string }) => {
    const member = input.workItemId === first.workItemId ? first : second;
    const evidence: Passage[] = [{ ...original, workItemId: member.workItemId }];
    if (includeSecondCarrierInFirst && member.workItemId === first.workItemId)
      evidence.push({ ...original, workItemId: second.workItemId });
    return {
      current: true, revision: { workRevision: member.workRevision, documentVersionId,
        content: { headline: `Saved ${member.workRef}`, understanding: `Understanding ${member.workRef}`,
          issues: [], overviewStatus: 'CURRENT', evidence } },
    };
  });
  const matterMember: Extract<DerivedSummaryMember, { kind: 'MATTER_WORK' }> = {
    kind: 'MATTER_WORK', matterId: 'MAT-shared', workRef: 'MWR-shared', workRevision: 1, issueKeys: [],
  };
  const matters = {
    authorizeRuntimeInputs: jest.fn(async () => undefined),
    readByRef: jest.fn(async () => ({ workingRevision: 1, basedOnMatterRevisionId: 'MR-shared', state: {
      problemWork: { headline: 'Matter with shared original', understanding: 'Exact saved matter understanding',
        issues: [], overviewStatus: 'CURRENT', evidence: [original, { ...original, workItemId: second.workItemId }] },
    } })),
  };
  const service = new DerivedSummaryMembersService({ readSummaryMemberInTransaction: readSaved } as never, matters as never);
  jest.spyOn(service, 'authorizeActor').mockResolvedValue(undefined);
  return { service, database, readSaved, authorizationInputs, matterMember, matters };
}

describe('Document original identity across exact saved Wiki members', () => {
  it('shares the exact original once while retaining the first immutable carrier and both input identities', () => {
    const other: Passage = { ...original, workItemId: second.workItemId };
    const before = JSON.stringify([original, other]);
    expect(mergeSummaryEvidence([original, other])).toEqual([original]);
    expect(JSON.stringify([original, other])).toBe(before);
    expect(mergeSummaryEvidence([other, original])).toEqual([other]);
  });

  it('also reuses the existing canonical document SourceRef identity without introducing a new source', () => {
    const source: Passage = { ...original, evidenceRef: `source:${documentVersionId}:${original.sourceRefId}` };
    expect(mergeSummaryEvidence([source, { ...source, workItemId: second.workItemId }])).toEqual([source]);
  });

  it('preserves the real original namespace when its SourceRef itself contains parse/unit coordinates', () => {
    const sourceRefId = 'PRUN-shared:u1:p0';
    const source: Passage = { ...original, sourceRefId,
      evidenceRef: `DOCUMENT_ORIGINAL:${documentVersionId}:PRUN-shared:${sourceRefId}` };
    expect(mergeSummaryEvidence([source, { ...source, workItemId: second.workItemId }])).toEqual([source]);
  });

  it('accepts a direct null carrier of the exact same original while keeping the selected first carrier', () => {
    const direct: Passage = { ...original, workItemId: null };
    expect(mergeSummaryEvidence([direct, original])).toEqual([direct]);
    expect(mergeSummaryEvidence([original, direct])).toEqual([original]);
  });

  it('keeps DocumentReading anchor evidence and other original versions as distinct exact identities', () => {
    const reading = documentReadingAnchorEvidence({ documentVersionId, parseRunId: 'PRUN-shared', readingRunRef: 'DRR-shared' },
      { anchorId: 'anchor-1', sourceUnitId: 'unit-1', payloadPath: '/text', sourceText: original.excerpt,
        sourceRefIds: [original.sourceRefId], sourceLocators: [] });
    expect(reading.evidenceRef).toBe(`DOCUMENT_READING_ORIGINAL:${documentVersionId}:PRUN-shared:DRR-shared:anchor-1`);
    const newer: Passage = { ...original, evidenceRef: `DOCUMENT_ORIGINAL:${documentVersionId}:PRUN-new:${original.sourceRefId}`,
      versionLabel: 'PRUN-new' };
    expect(mergeSummaryEvidence([reading, original, { ...original, workItemId: second.workItemId }, newer]))
      .toEqual([reading, original, newer]);
  });

  it('reads and authorizes each immutable WI independently before registry deduplication', async () => {
    const f = memberReader();
    const readings = await f.service.readAll([first, second], actor, f.database as never);
    expect(readings.map(item => item.member)).toEqual([first, second]);
    expect(readings.map(item => item.evidence[0])).toEqual([
      original, { ...original, workItemId: second.workItemId },
    ]);
    expect(readings.map(item => item.understanding)).toEqual(['Understanding JAWR-first', 'Understanding JAWR-second']);
    expect(readings.map(item => item.rootRefs)).toEqual([[original.evidenceRef], [original.evidenceRef]]);
    expect(f.readSaved).toHaveBeenNthCalledWith(1, { ...actor, workItemId: first.workItemId, workRef: first.workRef }, f.database);
    expect(f.readSaved).toHaveBeenNthCalledWith(2, { ...actor, workItemId: second.workItemId, workRef: second.workRef }, f.database);
    expect(f.authorizationInputs).toEqual([[first.workItemId], [second.workItemId]]);
    expect(mergeSummaryEvidence(readings.flatMap(item => item.evidence))).toEqual([original]);
  });

  it('still rejects a revoked second WI instead of hiding it behind an authorized identical source', async () => {
    const f = memberReader(second.workItemId);
    await expect(f.service.readAll([first, second], actor, f.database as never))
      .rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
    expect(f.readSaved).toHaveBeenCalledTimes(2);
    expect(f.authorizationInputs).toEqual([[first.workItemId], [second.workItemId]]);
  });

  it('authorizes both raw carriers inside one member before any registry deduplication', async () => {
    const f = memberReader(second.workItemId, true);
    await expect(f.service.readAll([first], actor, f.database as never))
      .rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
    expect(f.authorizationInputs).toEqual([[first.workItemId, second.workItemId]]);
  });

  it('retains both original WI carriers in an allowed saved leaf while its registry stores one body', async () => {
    const f = memberReader(null, true);
    const [reading] = await f.service.readAll([first], actor, f.database as never);
    expect(reading!.evidence).toEqual([original, { ...original, workItemId: second.workItemId }]);
    expect(reading!.leaves).toEqual([first]);
    expect(mergeSummaryEvidence(reading!.evidence)).toEqual([original]);
    expect(f.authorizationInputs).toEqual([[first.workItemId, second.workItemId]]);
  });

  it.each([null, 'WI-second'])('keeps Matter authorization and each raw WI check when denied=%s', async denied => {
    const f = memberReader(denied);
    const result = f.service.readAll([f.matterMember], actor, f.database as never);
    if (denied) await expect(result).rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
    else {
      const readings = await result;
      expect(readings[0]).toMatchObject({ member: f.matterMember,
        evidence: [original, { ...original, workItemId: second.workItemId }],
        understanding: 'Exact saved matter understanding', rootRefs: [original.evidenceRef] });
    }
    expect(f.matters.authorizeRuntimeInputs).toHaveBeenNthCalledWith(1, { ...actor, matterId: f.matterMember.matterId }, f.database);
    expect(f.matters.authorizeRuntimeInputs).toHaveBeenNthCalledWith(2, { ...actor,
      matterId: f.matterMember.matterId, basedOnMatterRevisionId: 'MR-shared' }, f.database);
    expect(f.authorizationInputs).toEqual([[first.workItemId, second.workItemId]]);
  });

  it('does not discard a non-document execution identity under the same ref', () => {
    const fact: AssessmentEvidence = { kind: 'HOST_FACT', evidenceRef: 'HOST_FACT:shared',
      title: 'Host execution fact', versionLabel: null, excerpt: 'Synthetic fact',
      workItemId: first.workItemId, workItemRevision: 1, factRef: 'FACT-shared', recordedAt: '2026-10-17T00:00:00Z' };
    expect(() => mergeSummaryEvidence([fact, { ...fact, workItemId: second.workItemId }]))
      .toThrow('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
    expect(() => mergeSummaryEvidence([original, { ...fact, evidenceRef: original.evidenceRef }]))
      .toThrow('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
  });

  it.each([
    { excerpt: 'Changed source condition.' },
    { locator: 'Different original locator' },
    { sourceRefId: 'SR-different' },
    { documentVersionId: 'document_version_different' },
    { versionLabel: 'PRUN-different' },
    { title: 'Changed original title' },
  ])('rejects a real source-body/version mismatch %j', change => {
    expect(() => mergeSummaryEvidence([original, { ...original, workItemId: second.workItemId, ...change }]))
      .toThrow('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
  });

  it.each(['legacy-ref', 'DOCUMENT_READING_ORIGINAL:shared', 'DOCUMENT_ORIGINAL:wrong:PRUN-shared:SR-shared'])(
    'does not reinterpret an unrelated or malformed identity %s', evidenceRef => {
      expect(() => mergeSummaryEvidence([{ ...original, evidenceRef },
        { ...original, evidenceRef, workItemId: second.workItemId }]))
        .toThrow('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
    },
  );
});
