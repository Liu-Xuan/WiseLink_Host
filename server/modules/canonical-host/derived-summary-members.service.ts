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
import { contextWorkNotices } from './derived-summary-current-context';
import { summaryError, summaryMemberRef } from './derived-summary.validation';

export interface SummaryActor { tenantId: string; actorUserId: string }

/** The source consumer supplies these exact capabilities. Their absence must
 * reject statement-bearing evidence while leaving ordinary saved work usable. */
interface SummarySourceStatementVerifier {
  assertSourceStatementReferences(evidence: AssessmentEvidence[], actor: SummaryActor,
    database?: PostgresJsDatabase): Promise<void>;
  readSourceStatementProjections(evidence: AssessmentEvidence[], actor: SummaryActor): Promise<unknown[]>;
}

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
    if (member.kind === 'DERIVED_SUMMARY') {
      if (ancestors.has(member.summaryId)) throw summaryError('DERIVED_SUMMARY_LINEAGE_CYCLE');
      return this.readSummary(member, actor, database, path.add(member.summaryId));
    }
    let headline: string;
    let understanding: string;
    let body: string;
    let issues: JobAidProblemIssue[];
    let evidence: AssessmentEvidence[];
    let current: boolean;
    let correctionLimitations: string[] = [];
    let overviewStatus: DerivedSummaryMemberReading['overviewStatus'];
    if (member.kind === 'WORK_ITEM_WORK') {
      const saved = await this.jobAid.readSummaryMemberInTransaction({ ...actor,
        workItemId: member.workItemId, workRef: member.workRef }, database);
      if (saved.revision.workRevision !== member.workRevision ||
        saved.revision.documentVersionId !== member.documentVersionId) throw summaryError('DERIVED_SUMMARY_MEMBER_VERSION_MISMATCH');
      const content = saved.revision.content;
      headline = content.headline;
      issues = selectIssues(content.issues, member.issueKeys);
      understanding = content.understanding;
      body = completeBody(understanding, issues);
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
      const notices = contextWorkNotices(saved);
      correctionLimitations = [
        ...notices.correctionNotices.map(notice => `已登记问题更正请求${notice.attemptRef}（${notice.attemptStatus}）：${notice.reason}；${notice.correctedWorkRef ? '已有精确更正工作，不能默认本成员已覆盖。' : notice.unchanged ? '对照后保留原工作。' : '本成员尚无已核更正结果。'}`),
        ...notices.overviewCorrectionNotices.map(notice => `已登记概述复核请求${notice.attemptRef}（${notice.attemptStatus}）：${notice.reason}；${notice.savedWorkRef ? '已有保存工作，覆盖需按准确引用核对。' : '尚无已保存复核结果。'}`),
        ...notices.referenceWorkNotices.flatMap(notice => [
          ...notice.correctionNotices.map(correction => `引用工作${notice.evidenceRef}有更正请求${correction.attemptRef}（${correction.attemptStatus}）：${correction.reason}。`),
          ...(notice.overviewCorrectionNotices ?? []).map(correction => `引用工作${notice.evidenceRef}有概述复核请求${correction.attemptRef}（${correction.attemptStatus}）：${correction.reason}。`),
        ]),
      ];
      const content = saved.state.problemWork;
      if (!content) throw summaryError('DERIVED_SUMMARY_COMPLETE_MEMBER_WORK_UNAVAILABLE');
      headline = content.headline;
      issues = selectIssues(content.issues, member.issueKeys);
      understanding = content.understanding;
      body = completeBody(understanding, issues);
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
      ...correctionLimitations,
      ...await this.sourceVersionNotices(evidence, actor, database),
    ];
    return { member, evidenceRef, headline, understanding, body, issues, evidence, rootRefs: roots.rootRefs,
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
    const evidence = mergeSummaryEvidence(children.flatMap(item => item.evidence));
    const ordered = (items: AssessmentEvidence[]) => [...items].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef));
    const refs = new Set([...children.map(item => item.evidenceRef), ...evidence.map(item => item.evidenceRef)]);
    if (canonicalJson(ordered(saved.evidence)) !== canonicalJson(ordered(evidence)) ||
        saved.usedEvidenceRefs.some(ref => !refs.has(ref))) throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
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
        notices.push(`来源版本${id}的本地目录选择指针未确定；发布方现行有效状态未核。`);
      } else if (row.currentDocumentVersionId !== id) {
        const [access] = await database.execute<{ allowed: boolean }>(sql`SELECT
          engineering_matter_document_owned_by_actor(${actor.tenantId}, ${row.currentDocumentVersionId}) AS allowed`);
        notices.push(access?.allowed === true
          ? `来源版本${id}与本地目录当前选择${row.currentDocumentVersionId}不同；${selected.includes(row.currentDocumentVersionId) ? '另有显式选取来源，两个版本保持分开。' : '目录所选版本未被本成员覆盖。'}发布方现行有效状态未核。`
          : `来源版本${id}与本地目录选择不同；目录所选版本未被本成员覆盖，且本次无权展开其来源。发布方现行有效状态未核。`);
      } else notices.push(`来源版本${id}是本地目录当前选择；发布方现行有效状态未核，不代表适用性、正式采用或其他版本覆盖。`);
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
    const statementVerifier = this.sourceStatementVerifier(evidence);
    if (statementVerifier) await statementVerifier.assertSourceStatementReferences(evidence, actor, database);
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
    const statementVerifier = this.sourceStatementVerifier(evidence);
    if (!originals.length && !statementVerifier) return;
    if (originals.length && !this.originalReader) throw summaryError('DERIVED_SUMMARY_ORIGINAL_READER_UNAVAILABLE', 503);
    const loaded = new Map<string, Awaited<ReturnType<UnifiedReaderService['readDocumentOriginal']>>>();
    await this.matters.withActorScope(actor.actorUserId, async () => {
      if (statementVerifier) assertSourceStatementProjections(evidence,
        await statementVerifier.readSourceStatementProjections(evidence, actor));
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
  private sourceStatementVerifier(evidence: AssessmentEvidence[]): SummarySourceStatementVerifier | null {
    const statements = evidence.filter(item => item.kind === 'PRIOR_RESULT' && Object.hasOwn(item, 'sourceStatement'));
    if (!statements.length) return null;
    for (const item of statements) {
      const statement = (item as AssessmentEvidence & { sourceStatement: unknown }).sourceStatement;
      if (statement === null || typeof statement !== 'object' || Array.isArray(statement))
        throw summaryError('DERIVED_SUMMARY_SOURCE_STATEMENT_INVALID');
    }
    const verifier = this.jobAid as CanonicalJobAidProblemService & Partial<SummarySourceStatementVerifier>;
    if (typeof verifier.assertSourceStatementReferences !== 'function' ||
        typeof verifier.readSourceStatementProjections !== 'function')
      throw summaryError('DERIVED_SUMMARY_SOURCE_STATEMENT_VERIFIER_UNAVAILABLE', 503);
    return verifier as SummarySourceStatementVerifier;
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
  for (const reading of [before, after]) {
    if (Object.hasOwn(reading, 'understanding') && (reading.member.kind === 'DERIVED_SUMMARY' ||
        typeof reading.understanding !== 'string' || reading.body !== completeBody(reading.understanding, reading.issues)))
      throw summaryError('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
  }
  const immutable = ({ current: _current, overviewStatus: _overviewStatus, limitations: _limitations,
    understanding, ...content }: DerivedSummaryMemberReading) =>
    Object.hasOwn(before, 'understanding') ? { ...content, understanding } : content;
  if (canonicalJson(immutable(before)) !== canonicalJson(immutable(after)))
    throw summaryError('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
}

/** Consumer has already validated fresh original ACL, UTF-16 quotes and the full
 * candidate/materialized SAVED value. This boundary checks exact output binding
 * and version-dispatched completeness without converting or mutating its data. */
function assertSourceStatementProjections(evidence: AssessmentEvidence[], projections: unknown[]): void {
  const fail = (): never => { throw summaryError('DERIVED_SUMMARY_SOURCE_STATEMENT_PROJECTION_INVALID'); };
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!Array.isArray(projections)) fail();
  const selected = evidence.filter(item => item.kind === 'PRIOR_RESULT' && Object.hasOwn(item, 'sourceStatement'));
  for (const item of selected) {
    const carrier = (item as AssessmentEvidence & { sourceStatement: { reference: Record<string, unknown>; sourceBinding: unknown } }).sourceStatement;
    const matches = projections.filter(object).flatMap(projection => {
      if (projection.schemaVersion !== 'wiselink.document.activity-assessment-projection.v1' || projection.availability !== 'AVAILABLE' ||
          canonicalJson(projection.sourceBinding) !== canonicalJson(carrier.sourceBinding) || !Array.isArray(projection.records) ||
          !Array.isArray(projection.activityContexts)) return [];
      return projection.records.filter(object).filter(record => record.ref === item.evidenceRef).map(record => ({ projection, record }));
    });
    if (matches.length !== 1) fail();
    const { projection, record } = matches[0]!;
    const statement = record.statement;
    if (!object(statement)) throw summaryError('DERIVED_SUMMARY_SOURCE_STATEMENT_PROJECTION_INVALID');
    if (record.candidateOnly !== true || canonicalJson(record.reference) !== canonicalJson(carrier.reference) ||
        canonicalJson(record.sourceBinding) !== canonicalJson(carrier.sourceBinding) || !object(statement) ||
        statement.statementId !== carrier.reference.statementId || statement.label !== item.excerpt ||
        !Array.isArray(record.requiredContextRootRefs) ||
        canonicalJson([...record.requiredContextRootRefs].sort()) !==
          canonicalJson([...(item as Extract<AssessmentEvidence, { kind: 'PRIOR_RESULT' }>).originalEvidenceRefs].sort())) fail();
    const context = (projection.activityContexts as unknown[]).filter(object).filter(value =>
      value.runRef === carrier.reference.runRef && value.candidateRevision === carrier.reference.candidateRevision);
    if (context.length !== 1 || !object(context[0]!.readCoverage)) fail();
    if (record.sourceSchemaVersion === 'wiselink.document.activity-candidate.v1') {
      if (record.semanticFieldsAvailability !== 'LEGACY_PARTIAL' || record.scopeBasis !== 'LEGACY_RUN_SCOPE') fail();
    } else if (record.sourceSchemaVersion === 'wiselink.document.activity-candidate.v2') {
      const sourceContext = context[0]!.sourceContext;
      if (record.semanticFieldsAvailability !== 'V2_CAPTURED_FIELDS_ONLY' || record.scopeBasis !== 'ACTUAL_DELIVERED_RUN_SCOPE' ||
          !object(sourceContext) || sourceContext.schemaVersion !== 'wiselink.document.activity-source-context.v1' ||
          canonicalJson(sourceContext.sourceBinding) !== canonicalJson(carrier.sourceBinding) ||
          !Array.isArray(sourceContext.sections) || !Array.isArray(sourceContext.organizationWarnings) ||
          !['statementId','statementKey','label','quotes','subject','action','modality','status','times','technicalIds','scope','limitations']
            .every(key => Object.hasOwn(statement, key)) || !Array.isArray(statement.quotes) || !statement.quotes.length ||
          !Array.isArray(statement.times) || !Array.isArray(statement.technicalIds) || !Array.isArray(statement.limitations) ||
          !object(statement.scope) || !Array.isArray(statement.scope.conditions) || !Array.isArray(statement.scope.sectionIds)) fail();
    } else fail();
  }
}
