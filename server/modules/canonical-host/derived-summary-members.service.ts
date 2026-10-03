import { Injectable, Optional } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { assessmentEvidenceRoots } from '@shared/assessment-evidence-roots';
import type { DerivedSummaryMember, DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import type { JobAidProblemIssue } from '@shared/jobaid-problem-assessment.interface';
import { derivedSummary, derivedSummaryRevision } from '../../database/derived-summary.schema';
import { dmDocumentVersion, dmPublicationFamily, engineeringMatterWorkRevision, identitySubjectMapping } from '../../database/schema';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { findDocumentOriginalEvidence } from './document-original-engineering-reading';
import { buildMatterWorkReference } from './matter-work-reference';
import { summaryError, summaryMemberRef } from './derived-summary.validation';

export interface SummaryActor { tenantId: string; actorUserId: string }

@Injectable()
export class DerivedSummaryMembersService {
  constructor(
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly matters: EngineeringMatterWorkingRepository,
    @Optional() private readonly originalReader?: UnifiedReaderService,
  ) {}

  async authorizeActor(actor: SummaryActor, database: PostgresJsDatabase): Promise<void> {
    const [mapping] = await database.select({ id: identitySubjectMapping.id }).from(identitySubjectMapping)
      .where(and(eq(identitySubjectMapping.miaodaUserId, actor.actorUserId),
        eq(identitySubjectMapping.miaodaTenantId, actor.tenantId),
        eq(identitySubjectMapping.expectedClientId, 'cli_aadde8b579f95bc9'),
        eq(identitySubjectMapping.status, 'ACTIVE'))).limit(1);
    if (!mapping) throw summaryError('DERIVED_SUMMARY_ACTOR_UNAVAILABLE', 404);
  }

  /** Every branch uses the handed connection, including nested saved-summary lineage. */
  async readAll(members: DerivedSummaryMember[], actor: SummaryActor, database: PostgresJsDatabase,
    ancestors = new Set<string>()): Promise<DerivedSummaryMemberReading[]> {
    await this.authorizeActor(actor, database);
    const result: DerivedSummaryMemberReading[] = [];
    for (const member of members) result.push(await this.read(member, actor, database, ancestors));
    return result;
  }

  private async read(member: DerivedSummaryMember, actor: SummaryActor, database: PostgresJsDatabase,
    ancestors: Set<string>): Promise<DerivedSummaryMemberReading> {
    const evidenceRef = summaryMemberRef(member);
    if (ancestors.has(evidenceRef)) throw summaryError('DERIVED_SUMMARY_LINEAGE_CYCLE');
    const path = new Set(ancestors).add(evidenceRef);
    if (member.kind === 'DERIVED_SUMMARY') return this.readSummary(member, actor, database, path);
    let headline: string;
    let body: string;
    let issues: JobAidProblemIssue[];
    let evidence: AssessmentEvidence[];
    let current: boolean;
    let overviewStatus: DerivedSummaryMemberReading['overviewStatus'];
    if (member.kind === 'WORK_ITEM_WORK') {
      const saved = await this.jobAid.readSummaryMemberInTransaction({ ...actor,
        workItemId: member.workItemId, workRef: member.workRef }, database);
      if (saved.revision.workRevision !== member.workRevision ||
        saved.revision.documentVersionId !== member.documentVersionId) throw summaryError('DERIVED_SUMMARY_MEMBER_VERSION_MISMATCH');
      const content = saved.revision.content;
      headline = content.headline;
      issues = selectIssues(content.issues, member.issueKeys);
      body = completeBody(content.understanding, issues);
      // An Overall projection can be regenerated for the same work ref. This member
      // freezes the immutable work body; it must not splice in a mutable latest projection.
      evidence = content.evidence;
      current = saved.current;
      overviewStatus = content.overviewStatus;
    } else {
      await this.matters.authorizeRuntimeInputs({ ...actor, matterId: member.matterId }, database);
      const saved = await this.matters.readByRef({ tenantId: actor.tenantId,
        matterId: member.matterId, workRef: member.workRef }, database);
      if (!saved || saved.workingRevision !== member.workRevision) throw summaryError('DERIVED_SUMMARY_MEMBER_VERSION_MISMATCH');
      await this.matters.authorizeRuntimeInputs({ ...actor, matterId: member.matterId,
        basedOnMatterRevisionId: saved.basedOnMatterRevisionId }, database);
      const content = saved.state.problemWork;
      if (!content) throw summaryError('DERIVED_SUMMARY_COMPLETE_MEMBER_WORK_UNAVAILABLE');
      headline = content.headline;
      issues = selectIssues(content.issues, member.issueKeys);
      body = completeBody(content.understanding, issues);
      evidence = content.evidence;
      overviewStatus = content.overviewStatus;
      const [latest] = await database.select({ ref: engineeringMatterWorkRevision.matterWorkRevisionId })
        .from(engineeringMatterWorkRevision).where(and(eq(engineeringMatterWorkRevision.tenantId, actor.tenantId),
          eq(engineeringMatterWorkRevision.matterId, member.matterId)))
        .orderBy(desc(engineeringMatterWorkRevision.workingRevision)).limit(1);
      current = latest?.ref === member.workRef;
    }
    evidence = mergeSummaryEvidence(evidence);
    await this.authorizeEvidence(evidence, actor, database, path);
    // Each root keeps its carrier/version; a prior candidate is never counted as a new source.
    const roots = assessmentEvidenceRoots(evidence.map(item => item.evidenceRef), evidence);
    if (roots.unresolvedRefs.length) throw summaryError('DERIVED_SUMMARY_ROOT_LINEAGE_UNAVAILABLE');
    const limitations = [
      '本成员为已保存候选工作；同一根来源在其他成员中出现时只计一次，不继承其正式采用、适用性或执行状态。',
      ...(!current ? ['固定成员已有较新的保存工作；本次仍使用明确选取的版本。'] : []),
      ...(overviewStatus !== 'CURRENT' ? [`成员概述状态为${overviewStatus}，不能视为现行完整概述。`] : []),
      ...(member.issueKeys.length ? [`只选取问题：${member.issueKeys.join('、')}；其余问题不在本次覆盖内。`] : []),
      ...await this.sourceVersionNotices(evidence, actor, database),
    ];
    return { member, evidenceRef, headline, body, issues, evidence, rootRefs: roots.rootRefs,
      limitations, current, overviewStatus, leaves: [member] };
  }

  private async readSummary(member: Extract<DerivedSummaryMember, { kind: 'DERIVED_SUMMARY' }>, actor: SummaryActor,
    database: PostgresJsDatabase, path: Set<string>): Promise<DerivedSummaryMemberReading> {
    const [head] = await database.select().from(derivedSummary).where(and(eq(derivedSummary.tenantId, actor.tenantId),
      eq(derivedSummary.actorUserId, actor.actorUserId), eq(derivedSummary.summaryId, member.summaryId))).limit(1);
    const [row] = await database.select().from(derivedSummaryRevision).where(and(
      eq(derivedSummaryRevision.tenantId, actor.tenantId), eq(derivedSummaryRevision.actorUserId, actor.actorUserId),
      eq(derivedSummaryRevision.summaryId, member.summaryId), eq(derivedSummaryRevision.summaryRef, member.summaryRef))).limit(1);
    if (!head || !row || row.revision !== member.summaryRevision) throw summaryError('DERIVED_SUMMARY_MEMBER_UNAVAILABLE', 404);
    const saved = row.contentJson;
    if (saved.summaryId !== member.summaryId || saved.summaryRef !== member.summaryRef || saved.revision !== member.summaryRevision)
      throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
    const children = await this.readAll(saved.members.map(item => item.member), actor, database, path);
    for (let i = 0; i < children.length; i++) assertMemberSnapshot(saved.members[i]!, children[i]!);
    const leaves = uniqueMembers(children.flatMap(item => item.leaves));
    return { member, evidenceRef: summaryMemberRef(member), headline: saved.content.headline, body: saved.content.body,
      issues: [], evidence: saved.evidence, rootRefs: [...new Set(children.flatMap(item => item.rootRefs))],
      limitations: ['这是派生候选摘要，不是新增独立证据。仅覆盖已保存的精确成员。', ...saved.content.limitations,
        ...children.flatMap(item => item.limitations),
        ...(head.currentSummaryRef !== member.summaryRef ? ['该摘要已有较新的保存版本。'] : [])],
      current: head.currentSummaryRef === member.summaryRef && children.every(item => item.current),
      overviewStatus: children.every(item => item.current && item.overviewStatus === 'CURRENT') ? 'CURRENT' : 'STALE', leaves };
  }

  /** Publication currentness is separate from saved-work currentness. */
  private async sourceVersionNotices(evidence: AssessmentEvidence[], actor: SummaryActor, database: PostgresJsDatabase): Promise<string[]> {
    const selected = [...new Set(evidence.flatMap(item => item.kind === 'DOCUMENT_PASSAGE' ||
      item.kind === 'ENGINEER_ATTACHMENT' ? [item.documentVersionId] : []))];
    if (!selected.length) return [];
    const rows = await database.select({ documentVersionId: dmDocumentVersion.documentVersionId,
      currentDocumentVersionId: dmPublicationFamily.currentDocumentVersionId }).from(dmDocumentVersion)
      .innerJoin(dmPublicationFamily, eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId))
      .where(inArray(dmDocumentVersion.documentVersionId, selected));
    const notices: string[] = [];
    for (const id of selected) {
      const row = rows.find(item => item.documentVersionId === id);
      if (!row) throw summaryError('DERIVED_SUMMARY_SOURCE_VERSION_UNAVAILABLE', 404);
      if (!row.currentDocumentVersionId) {
        notices.push(`来源版本${id}的当前正式版指针未确定；不能将选中版本视为当前正式版。`);
      } else if (row.currentDocumentVersionId !== id) {
        const [access] = await database.execute<{ allowed: boolean }>(sql`SELECT
          engineering_matter_document_owned_by_actor(${actor.tenantId}, ${row.currentDocumentVersionId}) AS allowed`);
        notices.push(access?.allowed === true
          ? `来源版本${id}为历史正式版；当前正式版${row.currentDocumentVersionId}${selected.includes(row.currentDocumentVersionId) ? '另有显式选取来源，两个版本保持分开。' : '未被本成员覆盖。'}`
          : `来源版本${id}为历史正式版；当前正式版未被本成员覆盖，且本次无权展开其来源。`);
      } else notices.push(`来源版本${id}是当前正式版；此标记不代表适用性、正式采用或其他版本覆盖。`);
    }
    return notices;
  }

  private async authorizeEvidence(evidence: AssessmentEvidence[], actor: SummaryActor, database: PostgresJsDatabase,
    ancestors: Set<string>) {
    const workItemIds = [...new Set(evidence.flatMap(item => 'workItemId' in item && item.workItemId ? [item.workItemId] : []))];
    const documentIds = [...new Set(evidence.flatMap(item => item.kind === 'DOCUMENT_PASSAGE' ||
      item.kind === 'ENGINEER_ATTACHMENT' ? [item.documentVersionId] : []))];
    const [access] = await database.execute<{ allowed: boolean }>(sql`SELECT
      NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(workItemIds)}::jsonb) w(id)
        WHERE engineering_matter_work_item_owned_by_actor(${actor.tenantId}, w.id::varchar) IS NOT TRUE)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(documentIds)}::jsonb) d(id)
        WHERE engineering_matter_document_owned_by_actor(${actor.tenantId}, d.id::varchar) IS NOT TRUE) AS allowed`);
    if (access?.allowed !== true) throw summaryError('DERIVED_SUMMARY_SOURCE_UNAVAILABLE', 404);
    for (const item of evidence) {
      if (item.kind !== 'PRIOR_RESULT' || !item.sourceWork) continue;
      const source = item.sourceWork;
      const reference = `MATTER_WORK:${source.subjectId}:${source.workRef}:${source.issueKey}`;
      if (ancestors.has(reference)) throw summaryError('DERIVED_SUMMARY_LINEAGE_CYCLE');
      await this.matters.authorizeRuntimeInputs({ ...actor, matterId: source.subjectId }, database);
      const saved = await this.matters.readByRef({ tenantId: actor.tenantId,
        matterId: source.subjectId, workRef: source.workRef }, database);
      if (!saved || saved.workingRevision !== item.resultRevision || item.resultRef !== source.workRef)
        throw summaryError('DERIVED_SUMMARY_SOURCE_WORK_UNAVAILABLE', 404);
      await this.matters.authorizeRuntimeInputs({ ...actor, matterId: source.subjectId,
        basedOnMatterRevisionId: saved.basedOnMatterRevisionId }, database);
      const expected = buildMatterWorkReference({ matterId: source.subjectId, workRef: source.workRef,
        issueKey: source.issueKey, purpose: 'Reauthorize exact saved lineage' }, saved)[0];
      if (canonicalJson(item) !== canonicalJson(expected)) throw summaryError('DERIVED_SUMMARY_SOURCE_WORK_CHANGED');
    }
  }

  /** Original artifact IO happens after the caller has released its transaction. */
  async verifyOriginalEvidence(evidence: AssessmentEvidence[], actor: SummaryActor): Promise<void> {
    const originals = evidence.filter((item): item is Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }> =>
      item.kind === 'DOCUMENT_PASSAGE' && item.evidenceRef.startsWith('DOCUMENT_ORIGINAL:'));
    if (!originals.length) return;
    if (!this.originalReader) throw summaryError('DERIVED_SUMMARY_ORIGINAL_READER_UNAVAILABLE', 503);
    const loaded = new Map<string, Awaited<ReturnType<UnifiedReaderService['readDocumentOriginal']>>>();
    await this.matters.withActorScope(actor.actorUserId, async () => {
      for (const item of originals) {
        const prefix = `DOCUMENT_ORIGINAL:${item.documentVersionId}:`;
        const suffix = `:${item.sourceRefId}`;
        const parseRunId = item.evidenceRef.slice(prefix.length, -suffix.length);
        if (!item.evidenceRef.startsWith(prefix) || !item.evidenceRef.endsWith(suffix) ||
          !/^[A-Za-z0-9_-]{1,96}$/u.test(parseRunId)) throw summaryError('DERIVED_SUMMARY_SOURCE_IDENTITY_INVALID');
        const key = `${item.documentVersionId}:${parseRunId}`;
        if (!loaded.has(key)) loaded.set(key, await this.originalReader!.readDocumentOriginal(item.documentVersionId,
          parseRunId, { tenantId: actor.tenantId, actorUserId: actor.actorUserId, roles: [] }));
        const actual = { ...findDocumentOriginalEvidence(loaded.get(key)!, item.sourceRefId), workItemId: item.workItemId };
        if (canonicalJson(item) !== canonicalJson(actual)) throw summaryError('DERIVED_SUMMARY_ORIGINAL_CHANGED');
      }
    });
  }
}

function selectIssues(issues: JobAidProblemIssue[], keys: string[]): JobAidProblemIssue[] {
  if (keys.some(key => !issues.some(issue => issue.issueKey === key))) throw summaryError('DERIVED_SUMMARY_ISSUE_UNAVAILABLE', 404);
  return structuredClone(keys.length ? issues.filter(issue => keys.includes(issue.issueKey)) : issues);
}
function completeBody(overview: string, issues: JobAidProblemIssue[]): string {
  return `${overview}\n\n${issues.map(issue => `问题 ${issue.issueKey}：${issue.question}\n${issue.body}`).join('\n\n')}`;
}
function uniqueMembers(members: DerivedSummaryMember[]): DerivedSummaryMember[] {
  return [...new Map(members.map(member => [summaryMemberRef(member), member])).values()];
}
export function mergeSummaryEvidence(evidence: AssessmentEvidence[]): AssessmentEvidence[] {
  const registry = new Map<string, AssessmentEvidence>();
  for (const item of evidence) {
    const old = registry.get(item.evidenceRef);
    if (old && canonicalJson(old) !== canonicalJson(item)) throw summaryError('DERIVED_SUMMARY_EVIDENCE_IDENTITY_CONFLICT');
    registry.set(item.evidenceRef, structuredClone(item));
  }
  return [...registry.values()];
}
/** Currentness can change; exact saved content and roots cannot. */
export function assertMemberSnapshot(before: DerivedSummaryMemberReading, after: DerivedSummaryMemberReading): void {
  if (canonicalJson({ member: before.member, body: before.body, evidence: before.evidence, rootRefs: before.rootRefs }) !==
    canonicalJson({ member: after.member, body: after.body, evidence: after.evidence, rootRefs: after.rootRefs }))
    throw summaryError('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
}
