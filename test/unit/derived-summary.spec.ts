import { z } from 'zod/v4';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import { parseSummaryRequest, parseSummaryContent, summaryCitations, summaryMemberRef } from '../../server/modules/canonical-host/derived-summary.validation';
import { DerivedSummaryMembersService, assertMemberSnapshot, mergeSummaryEvidence } from '../../server/modules/canonical-host/derived-summary-members.service';
import { registerDerivedSummaryAttemptMcpTools } from '../../server/modules/canonical-host/derived-summary-attempt-mcp-tools';

const member = { kind: 'WORK_ITEM_WORK' as const, workItemId: 'WI-selected', documentVersionId: 'DV-old',
  workRef: 'JA-work23', workRevision: 23, issueKeys: ['tls-cause', 'tls-measure'] };
const request = { requestId: 'summary-request', scope: { kind: 'ATA4' as const, title: '选定资料的46-00短概述',
  fleetFamilyId: 'B787', fleetModelIds: ['B787-9'], ata2: '46', ata4: '46-00', selectionReason: '用户明确选取，归属未核' },
  members: [member], instruction: '保留旧版历史和新版未覆盖限制', modelRef: 'miaoda/glm-5.3' };
const source: AssessmentEvidence = { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source-old', title: '旧正式版',
  versionLabel: 'R1', excerpt: '条件未确认时不得推定低风险', workItemId: member.workItemId,
  documentVersionId: member.documentVersionId, sourceRefId: 'SR-one', locator: '正文第一段' };

describe('Explicit candidate aggregate admission', () => {
  it('keeps exact saved work, issues and user-selected scope, with an explicit Hosted route', () => {
    expect(parseSummaryRequest(request)).toEqual(request);
    expect(parseSummaryRequest({ ...request, expectedSummaryRevision: 1 }, true)).toMatchObject({ expectedSummaryRevision: 1 });
  });
  it.each(['tenantId', 'actorUserId', 'modelInput', 'producer', 'authority'])('rejects caller %s authority/content', key => {
    expect(() => parseSummaryRequest({ ...request, [key]: 'forged' })).toThrow('DERIVED_SUMMARY_INPUT_INVALID');
  });
  it('rejects node/Matter impersonation, invalid ATA parentage and duplicate exact members', () => {
    expect(() => parseSummaryRequest({ ...request, members: [{ kind: 'ATA_NODE', ata4: '46-00' }] })).toThrow();
    expect(() => parseSummaryRequest({ ...request, scope: { ...request.scope, ata2: '34' } })).toThrow();
    expect(() => parseSummaryRequest({ ...request, members: [member, member] })).toThrow('DERIVED_SUMMARY_DUPLICATE_MEMBER');
    expect(() => parseSummaryRequest({ ...request, members: [{ ...member, body: 'model supplied source' }] })).toThrow();
    const { modelRef: _ignored, ...missingModel } = request;
    expect(() => parseSummaryRequest(missingModel)).toThrow();
  });
  it('uses one immutable source carrier and rejects conflicting content under the same ref', () => {
    expect(mergeSummaryEvidence([source, source])).toEqual([source]);
    expect(() => mergeSummaryEvidence([source, { ...source, excerpt: 'changed' }])).toThrow('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
  });
  it('uses unambiguous typed member refs for an issue subset rather than delimiter or sentinel collisions', () => {
    expect(summaryMemberRef({ ...member, issueKeys: ['a,b'] })).not.toBe(summaryMemberRef({ ...member, issueKeys: ['a', 'b'] }));
    expect(summaryMemberRef({ ...member, issueKeys: ['ALL_ISSUES'] })).not.toBe(summaryMemberRef({ ...member, issueKeys: [] }));
    expect(() => parseSummaryRequest({ ...request, members: [member, { ...member, issueKeys: [...member.issueKeys].reverse() }] }))
      .toThrow('DERIVED_SUMMARY_DUPLICATE_MEMBER');
  });
  it('allows fresh currentness notices but never substitutes a new saved body/source', () => {
    const before: DerivedSummaryMemberReading = { member, evidenceRef: 'member-ref', headline: 'TLS', body: '已保存正文',
      issues: [], evidence: [source], rootRefs: [source.evidenceRef], limitations: [], current: true,
      overviewStatus: 'CURRENT', leaves: [member] };
    expect(() => assertMemberSnapshot(before, { ...before, current: false, limitations: ['有新版未覆盖'] })).not.toThrow();
    expect(() => assertMemberSnapshot(before, { ...before, body: 'latest silently substituted' })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
  });
  it('accepts source/member citations only from the Host registry', () => {
    const content = parseSummaryContent({ headline: 'TLS候选', listBrief: '有限覆盖', body: '依据[[member-ref]]与[[source-old]]', limitations: [] });
    expect(summaryCitations(content, new Set(['member-ref', 'source-old']))).toEqual(['member-ref', 'source-old']);
    expect(() => summaryCitations(content, new Set(['member-ref']))).toThrow('DERIVED_SUMMARY_CITATION_INVALID');
    expect(() => parseSummaryContent({ ...content, members: ['forged'] })).toThrow();
  });
});

describe('Derived summary MCP exact subject and transport', () => {
  function fixture() {
    const registerTool = jest.fn();
    const claim = jest.fn().mockResolvedValue({ status: 'RUNNING' });
    const authorization = { authorizeOpenClawAutoWorkItemQueue: jest.fn().mockResolvedValue({
      tenantId: 'tenant', principalId: 'service', appId: 'app_17bzc551rsg', authorizationFingerprint: 'host-issued' }) };
    registerDerivedSummaryAttemptMcpTools({ registerTool } as never, { claim } as never, authorization as never);
    const [name, definition, handler] = registerTool.mock.calls[0]!;
    return { name, definition, claim, authorization, call: (input: unknown) => handler(definition.inputSchema.parse(input)) };
  }
  it('registers a real summary subject with strict branches and candidate write annotations', async () => {
    const f = fixture();
    const input = { summaryId: 'DS-selected', attemptRef: 'AQ-selected', operation: 'CLAIM' };
    expect(f.name).toBe('derived_summary_attempt');
    expect(f.definition.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    await f.call(input);
    expect(f.claim).toHaveBeenCalledWith({ ...input, scope: await f.authorization.authorizeOpenClawAutoWorkItemQueue() });
    for (const extra of [{ actorUserId: 'forged' }, { workItemId: 'WI-fake' }, { matterId: 'MAT-fake' }])
      expect(() => f.call({ ...input, ...extra })).toThrow();
  });
  it('requires save/finish fences and accurate request fields, and exposes exact metadata schema', () => {
    const f = fixture();
    const target = { summaryId: 'DS-selected', attemptRef: 'AQ-selected' };
    expect(() => f.call({ ...target, operation: 'SAVE_SUMMARY', requestId: 'request', expectedSummaryRevision: 0,
      contentJson: '{}' })).toThrow();
    const schema = z.toJSONSchema(f.definition.inputSchema) as { oneOf?: unknown[]; anyOf?: unknown[] };
    expect((schema.oneOf ?? schema.anyOf)?.length).toBe(10);
    expect(() => f.call({ ...target, operation: 'FINISH', result: { fakeSuccess: true } })).toThrow();
  });
});


describe('Exact optional work understanding', () => {
  const understanding = '条件与尾部前提保持原样\nOnly if BOTH conditions hold; effect is unverified.\n';
  const issues: DerivedSummaryMemberReading['issues'] = [
    { issueKey: 'first', question: '条件一？', body: '完整问题一与[[source-old]]' },
    { issueKey: 'second', question: 'Condition two?', body: 'Tail premise: not implemented or verified.' },
  ] as never;
  const body = `${understanding}\n\n${issues.map(issue => `问题 ${issue.issueKey}：${issue.question}\n${issue.body}`).join('\n\n')}`;
  const split: DerivedSummaryMemberReading = { member, evidenceRef: 'member-ref', headline: 'Complete selected work',
    understanding, body, issues, evidence: [source], rootRefs: [source.evidenceRef], leaves: [member],
    limitations: ['Selected only'], current: false, overviewStatus: 'STALE' };

  it('requires exact reconstruction and split content while allowing fresh notices', () => {
    expect(() => assertMemberSnapshot(split, { ...split, current: true, overviewStatus: 'CURRENT', limitations: ['Fresh notice'] })).not.toThrow();
    expect(() => assertMemberSnapshot(split, { ...split, understanding: understanding + 'changed' })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    expect(() => assertMemberSnapshot(split, { ...split, body: body + 'changed' })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    expect(() => assertMemberSnapshot(split, { ...split, issues: [...issues].reverse() })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    const { understanding: ignored, ...missing } = split;
    expect(() => assertMemberSnapshot(split, missing)).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
  });
  it('keeps old complete body exact when the reader adds a valid understanding', () => {
    const { understanding: ignored, ...old } = split;
    expect(() => assertMemberSnapshot(old, split)).not.toThrow();
    expect(() => assertMemberSnapshot(old, { ...split, headline: 'New headline' })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    expect(() => assertMemberSnapshot(old, { ...split, rootRefs: [] })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    expect(() => assertMemberSnapshot(old, { ...split, leaves: [] })).toThrow('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
  });
  it.each(['WORK_ITEM_WORK', 'MATTER_WORK'] as const)('reads %s persisted understanding on the handed transaction', async kind => {
    const selected = kind === 'WORK_ITEM_WORK' ? { ...member, issueKeys: [] } :
      { kind, matterId: 'MAT-exact', workRef: 'MWR-exact', workRevision: 7, issueKeys: [] };
    const persisted = { headline: 'Saved headline', understanding, issues, evidence: [], overviewStatus: 'STALE' };
    const jobAid = { readSummaryMemberInTransaction: jest.fn().mockResolvedValue({ current: false,
      revision: { workRevision: member.workRevision, documentVersionId: member.documentVersionId, content: persisted } }) };
    const matters = { authorizeRuntimeInputs: jest.fn().mockResolvedValue(undefined), readByRef: jest.fn().mockResolvedValue({
      workingRevision: 7, basedOnMatterRevisionId: 'MR-exact', state: { problemWork: persisted } }) };
    const chain = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([{ ref: 'MWR-later' }]) };
    const database = { select: jest.fn().mockReturnValue(chain), execute: jest.fn().mockResolvedValue([{ allowed: true }]) };
    const service = new DerivedSummaryMembersService(jobAid as never, matters as never);
    jest.spyOn(service, 'authorizeActor').mockResolvedValue(undefined);
    const actor = { tenantId: 'tenant-exact', actorUserId: 'actor-exact' };
    const [actual] = await service.readAll([selected], actor, database as never);
    expect(actual).toMatchObject({ member: selected, headline: persisted.headline, understanding, body, issues,
      current: false, overviewStatus: 'STALE', evidence: [], rootRefs: [], leaves: [selected] });
    if (kind === 'WORK_ITEM_WORK') expect(jobAid.readSummaryMemberInTransaction).toHaveBeenCalledWith({ ...actor,
      workItemId: member.workItemId, workRef: member.workRef }, database);
    else {
      expect(matters.readByRef).toHaveBeenCalledWith({ tenantId: actor.tenantId, matterId: 'MAT-exact', workRef: 'MWR-exact' }, database);
      expect(matters.authorizeRuntimeInputs).toHaveBeenLastCalledWith({ ...actor, matterId: 'MAT-exact', basedOnMatterRevisionId: 'MR-exact' }, database);
    }
  });
});
