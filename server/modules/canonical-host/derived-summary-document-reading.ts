import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { DocumentReadingRevision } from '@shared/document-reading.interface';
import type {
  DerivedSummaryMember,
  DerivedSummaryMemberReading,
} from '@shared/derived-summary.interface';
import type { SummaryActor } from './derived-summary-members.service';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { summaryError, summaryMemberRef } from './derived-summary.validation';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

/** Exact SAVED reading, governed by the handed actor transaction and source RLS.
 * The reading producer is deliberately not required to be the reading actor. */
export async function readDocumentSummaryMember(
  member: Extract<DerivedSummaryMember, { kind: 'DOCUMENT_READING' }>,
  actor: SummaryActor,
  database: PostgresJsDatabase,
): Promise<DerivedSummaryMemberReading> {
  const rows = await database.execute<{
    result: DocumentReadingRevision;
    current: boolean;
    manifestSha256: string;
  }>(sql`
    SELECT r.result_json AS result,p.manifest_artifact->>'sha256' AS "manifestSha256",
      r.reading_revision=(SELECT max(h.reading_revision) FROM dm_document_reading_run h
        WHERE h.tenant_id=r.tenant_id AND h.document_version_id=r.document_version_id
          AND h.parse_run_id=r.parse_run_id AND h.semantic_revision=r.semantic_revision AND h.status='SAVED') AS current
    FROM dm_document_reading_run r JOIN dm_document_parse_run p ON p.tenant_id=r.tenant_id
      AND p.document_version_id=r.document_version_id AND p.parse_run_id=r.parse_run_id
      AND p.parse_revision=r.parse_revision AND p.status='PUBLISHED'
      AND p.manifest_artifact->>'sha256'=r.original_manifest_sha256
    JOIN dm_document_semantic_revision s ON s.tenant_id=r.tenant_id AND s.document_version_id=r.document_version_id
      AND s.parse_run_id=r.parse_run_id AND s.parse_revision=r.parse_revision
      AND s.semantic_revision=r.semantic_revision AND s.original_manifest_sha256=r.original_manifest_sha256
    WHERE r.tenant_id=${actor.tenantId} AND r.document_version_id=${member.documentVersionId}
      AND r.run_ref=${member.readingRunRef} AND r.reading_revision=${member.readingRevision}
      AND r.parse_run_id=${member.parseRunId} AND r.semantic_revision=${member.semanticRevision} AND r.status='SAVED'
      AND ${actor.readScope === 'TENANT'
        ? sql`native_app_document_readable(r.tenant_id,r.document_version_id)`
        : sql`document_translation_attempt_owned(r.tenant_id,${actor.actorUserId},r.document_version_id,r.parse_run_id,r.parse_revision)`}
      AND NOT EXISTS (SELECT 1 FROM dm_document_reading_retraction x WHERE x.tenant_id=r.tenant_id AND x.run_ref=r.run_ref)`);
  const row = rows[0];
  if (!row)
    throw summaryError('DERIVED_SUMMARY_DOCUMENT_READING_UNAVAILABLE', 404);
  const reading = row.result;
  if (
    reading.readingRunRef !== member.readingRunRef ||
    reading.readingRevision !== member.readingRevision ||
    reading.sourceBinding.original.documentVersionId !==
      member.documentVersionId ||
    reading.sourceBinding.original.parseRunId !== member.parseRunId ||
    reading.sourceBinding.semanticRevision !== member.semanticRevision
  )
    throw summaryError('DERIVED_SUMMARY_MEMBER_VERSION_MISMATCH');
  // Exact anchors were validated against the original by DocumentReading SAVE.
  // They have their own bounded passage identity, and are never represented as
  // the existing full DOCUMENT_ORIGINAL passage. Original I/O verification stays
  // outside transactions, so a one-connection pool cannot deadlock itself.
  const evidence = reading.sourceAnchors.map((anchor) =>
    documentReadingAnchorEvidence(member, anchor),
  );
  const roots: string[] = [
    ...new Set(
      reading.sourceAnchors.flatMap((anchor) =>
        anchor.sourceRefIds.map(
          (ref) =>
            `DOCUMENT_ORIGINAL:${member.documentVersionId}:${member.parseRunId}:${ref}`,
        ),
      ),
    ),
  ].sort();
  if (!evidence.length)
    throw summaryError('DERIVED_SUMMARY_ROOT_LINEAGE_UNAVAILABLE');
  const statements = [
    reading.brief,
    ...reading.explanation,
    ...reading.criticalConditions,
  ];
  const body = [
    reading.headline,
    ...statements.map((statement) =>
      [
        statement.text,
        ...statement.quotes.map((quote) => `原文引用：${quote.text}`),
      ].join('\n'),
    ),
    ...reading.limitations,
  ].join('\n\n');
  return {
    member,
    evidenceRef: summaryMemberRef(member),
    headline: reading.headline,
    body,
    issues: [],
    evidence,
    rootRefs: roots,
    current: row.current,
    overviewStatus: row.current ? 'CURRENT' : 'STALE',
    leaves: [member],
    limitations: [
      `原件交付范围：${reading.readCoverage.status}，${reading.readCoverage.deliveredUnitIds.length}/${reading.readCoverage.totalUnitCount}。`,
      ...reading.limitations,
      ...reading.readCoverage.sourceCoverage.unresolvedRanges.map(
        (range) => range.message,
      ),
    ],
  };
}

export function documentReadingAnchorEvidence(
  member: Pick<
    Extract<DerivedSummaryMember, { kind: 'DOCUMENT_READING' }>,
    'documentVersionId' | 'parseRunId' | 'readingRunRef'
  >,
  anchor: TranslationSourceAnchorV2,
): Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }> {
  if (!anchor.sourceRefIds.length || !anchor.sourceText.trim())
    throw summaryError('DERIVED_SUMMARY_SOURCE_IDENTITY_INVALID');
  return {
    kind: 'DOCUMENT_PASSAGE',
    evidenceRef: `DOCUMENT_READING_ORIGINAL:${member.documentVersionId}:${encodeURIComponent(member.parseRunId)}:${encodeURIComponent(member.readingRunRef)}:${encodeURIComponent(anchor.anchorId)}`,
    workItemId: null,
    documentVersionId: member.documentVersionId,
    sourceRefId: anchor.sourceRefIds[0]!,
    title: '原文 · 文档解读引用范围',
    versionLabel: member.parseRunId,
    excerpt: anchor.sourceText,
    locator: canonicalJson({
      parseRunId: member.parseRunId,
      anchorId: anchor.anchorId,
      sourceRefIds: anchor.sourceRefIds,
      sourceLocators: anchor.sourceLocators,
    }),
  };
}
