import { z } from 'zod/v4';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import { assertSummaryReplay, parseSummaryRequest, parseSummaryContent, summaryCitations, summaryMemberRef } from '../../server/modules/canonical-host/derived-summary.validation';
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
  it('keeps legacy purpose absent, accepts explicit synthesis, and restricts revision to an existing update', () => {
    expect(Object.hasOwn(parseSummaryRequest(request), 'purpose')).toBe(false);
    expect(parseSummaryRequest({ ...request, purpose: 'SYNTHESIZE' })).toMatchObject({ purpose: 'SYNTHESIZE' });
    expect(parseSummaryRequest({ ...request, purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 1 }, true))
      .toMatchObject({ purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 1 });
    expect(() => parseSummaryRequest({ ...request, purpose: 'REVISE_SAVED_SUMMARY' })).toThrow('DERIVED_SUMMARY_PRIOR_REQUIRED');
    expect(() => parseSummaryRequest({ ...request, purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 0 }, true))
      .toThrow('DERIVED_SUMMARY_PRIOR_REQUIRED');
  });
  it.each([null, undefined, 'REVISE', 1, {}])('rejects explicitly malformed purpose %s without defaulting', purpose => {
    expect(() => parseSummaryRequest({ ...request, purpose })).toThrow('DERIVED_SUMMARY_PURPOSE_INVALID');
  });
  it('normalizes absent/synthesis only for replay comparison and preserves old bytes', () => {
    const before = JSON.stringify(request);
    expect(() => assertSummaryReplay(request, { ...request, purpose: 'SYNTHESIZE' })).not.toThrow();
    expect(JSON.stringify(request)).toBe(before);
    expect(() => assertSummaryReplay(request, { ...request, purpose: 'REVISE_SAVED_SUMMARY' }))
      .toThrow('DERIVED_SUMMARY_REQUEST_ID_REUSED');
    expect(() => assertSummaryReplay(request, { ...request, instruction: 'Altered request' }))
      .toThrow('DERIVED_SUMMARY_REQUEST_ID_REUSED');
  });
  it('keeps exact saved work, issues and user-selected scope, with an explicit Hosted route', () => {
    expect(parseSummaryRequest(request)).toEqual(request);
    expect(parseSummaryRequest({ ...request, expectedSummaryRevision: 1 }, true)).toMatchObject({ expectedSummaryRevision: 1 });
  });
  it.each(['tenantId', 'actorUserId', 'readScope', 'modelInput', 'producer', 'authority', 'contextBasis'])('rejects caller %s authority/content', key => {
    expect(() => parseSummaryRequest({ ...request, [key]: 'forged' })).toThrow('DERIVED_SUMMARY_INPUT_INVALID');
  });
  it('rejects node/Matter impersonation, invalid ATA parentage and duplicate exact members', () => {
    expect(() => parseSummaryRequest({ ...request, members: [{ kind: 'ATA_NODE', ata4: '46-00' }] })).toThrow();
    expect(() => parseSummaryRequest({ ...request, scope: { ...request.scope, ata2: '34' } })).toThrow();
    expect(() => parseSummaryRequest({ ...request, members: [member, member] })).toThrow('DERIVED_SUMMARY_DUPLICATE_MEMBER');
    expect(() => parseSummaryRequest({ ...request, members: [{ ...member, body: 'model supplied source' }] })).toThrow();
    const { modelRef: _ignored, ...missingModel } = request;
    expect(parseSummaryRequest(missingModel)).not.toHaveProperty('modelRef');
    expect(() => parseSummaryRequest({ ...missingModel, modelRef: null })).toThrow();
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
  it('validates registered headline/listBrief refs while retaining only body/limitation refs for use', () => {
    const allowed = new Set(['member-ref', 'source-old']);
    const content = parseSummaryContent({ headline: '成员标题 [[member-ref]]', listBrief: '摘要 [[member-ref]]',
      body: '原文依据 [[source-old]]', limitations: [] });
    expect(summaryCitations(content, allowed)).toEqual(['source-old']);
    const bodyRefs = summaryCitations({ ...content, limitations: [] }, allowed);
    expect(bodyRefs.includes('member-ref')).toBe(false);
    expect(summaryCitations({ ...content, limitations: ['限制 [[member-ref]]'] }, allowed)).toEqual(['source-old', 'member-ref']);
  });
  it.each(['headline', 'listBrief'] as const)('rejects an unregistered %s citation without changing the content', field => {
    const content = parseSummaryContent({ headline: '成员标题', listBrief: '有限范围', body: '依据 [[source-old]]', limitations: [] });
    content[field] = '未知引用 [[foreign-header]]';
    const before = JSON.stringify(content);
    expect(() => summaryCitations(content, new Set(['member-ref', 'source-old'])))
      .toThrow('DERIVED_SUMMARY_CITATION_INVALID');
    expect(JSON.stringify(content)).toBe(before);
  });
  it('does not let registered header citations satisfy the runtime body-support check', () => {
    const content = parseSummaryContent({ headline: '标题 [[member-ref]]', listBrief: '摘要 [[source-old]]',
      body: '没有正文支持引用', limitations: ['限制 [[member-ref]]'] });
    const allowed = new Set(['member-ref', 'source-old']);
    // Runtime checks body separately from the preserved body/limitations union.
    expect(summaryCitations(content, allowed)).toEqual(['member-ref']);
    expect(() => summaryCitations({ ...content, limitations: [] }, allowed)).toThrow('DERIVED_SUMMARY_CITATION_INVALID');
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


describe('Selected catalog notices and summary identity cycles', () => {
  const actor = { tenantId: 'tenant-notice', actorUserId: 'actor-notice' };
  function service() { return new DerivedSummaryMembersService({} as never, {} as never); }
  it('rejects the same summary identity even when its exact revision differs', async () => {
    const reader = service(); jest.spyOn(reader, 'authorizeActor').mockResolvedValue(undefined);
    await expect(reader.readAll([{ kind: 'DERIVED_SUMMARY', summaryId: 'DS-cycle', summaryRef: 'DSR-old',
      summaryRevision: 1 }], actor, {} as never, new Set(['DS-cycle'])))
      .rejects.toThrow('DERIVED_SUMMARY_LINEAGE_CYCLE');
  });
  it.each([null, 'DV-old', 'DV-new'])('qualifies local catalog selection %s without publisher authority', async head => {
    const rows = [{ documentVersionId: 'DV-old', currentDocumentVersionId: head }];
    const chain = { from: jest.fn().mockReturnThis(), innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue(rows) };
    const database = { select: jest.fn().mockReturnValue(chain), execute: jest.fn().mockResolvedValue([{ allowed: false }]) };
    const reader = service() as unknown as { sourceVersionNotices: (evidence: AssessmentEvidence[], owner: typeof actor, db: unknown) => Promise<string[]> };
    const notices = await reader.sourceVersionNotices([source], actor, database);
    expect(notices.join('')).toContain('本地目录'); expect(notices.join('')).toContain('发布方现行有效状态未核');
    expect(notices.join('')).not.toContain('当前正式版'); expect(notices.join('')).not.toContain('DV-new');
  });
});
