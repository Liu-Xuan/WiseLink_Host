import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { DocumentExtractedMetadata } from '@shared/api.interface';
import type {
  DerivedSummaryMember,
  DerivedSummaryScopeSelection,
} from '@shared/derived-summary.interface';
import type { EngineeringMatterWorkingState } from '@shared/matter-working.interface';
import type {
  HierarchicalWikiEnableRequest,
  HierarchicalWikiStatus,
} from '@shared/hierarchical-wiki.interface';
import { libraryAircraftMentionAliases } from '@shared/library-aircraft-mentions';
import type { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import type { SummaryActor } from './derived-summary-members.service';
import { engineeringMatterPendingInputs } from './engineering-matter-working-state';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export interface WikiInventoryMember {
  member: DerivedSummaryMember | null;
  sourceKind: 'DOCUMENT' | 'MATTER' | 'WORK_ITEM';
  sourceId: string;
  memberKey: string;
  ata: string | null;
  basis: Record<string, unknown>;
}
export type WikiInventoryWaiting = HierarchicalWikiStatus['waiting'][number] & {
  ata: string | null;
};

interface DocumentRow extends Record<string, unknown> {
  familyId: string;
  documentVersionId: string;
  metadata: DocumentExtractedMetadata | null;
  sourceSha256: string;
  sourceByteLength: number;
  member: DerivedSummaryMember | null;
}

export function wikiClassifications(
  metadata: DocumentExtractedMetadata | null,
  scope: HierarchicalWikiEnableRequest,
  source: { sourceSha256: string; sourceByteLength: number },
): Array<string | null> {
  if (
    !metadata ||
    metadata.source !== 'ACTUAL_PDF_TEXT' ||
    metadata.sourceSha256 !== source.sourceSha256 ||
    metadata.sourceByteLength !== source.sourceByteLength
  )
    return [];
  const mentions: string[] = metadata.mentionedAircraftModels.observations
    .filter((item) => item.evidence.length)
    .map((item) => item.value.trim().toUpperCase());
  const aliases = libraryAircraftMentionAliases(
    scope.fleetModelId ?? scope.fleetFamilyId,
  );
  if (
    !aliases.some((alias) => mentions.includes(alias)) &&
    (scope.fleetModelId !== null ||
      !mentions.some(
        (mention) =>
          mention.startsWith(`${scope.fleetFamilyId.toUpperCase()}-`) ||
          libraryAircraftMentionAliases(mention).some((alias) =>
            alias.startsWith(`${scope.fleetFamilyId.toUpperCase()}-`),
          ),
      ))
  )
    return [];
  const ata = metadata.ata.observations
    .filter((item) => item.evidence.length)
    .map((item) =>
      item.value
        .trim()
        .replace(/^ATA\s*/iu, '')
        .replace(/^(\d{2})(\d{2})$/u, '$1-$2'),
    )
    .filter((item) => /^\d{2}(?:-\d{2})?$/u.test(item));
  return ata.length ? [...new Set(ata)].sort() : [null];
}

export function wikiScopeFor(
  scope: HierarchicalWikiEnableRequest,
  ata: string | null,
): DerivedSummaryScopeSelection {
  const kind = ata === null ? 'FLEET' : ata.length === 2 ? 'ATA2' : 'ATA4';
  return {
    kind,
    title: `${scope.fleetModelId ?? scope.fleetFamilyId}${ata ? ` · ATA ${ata}` : ''} Wiki`,
    fleetFamilyId: scope.fleetFamilyId,
    fleetModelIds: scope.fleetModelId ? [scope.fleetModelId] : [],
    ata2: ata?.slice(0, 2) ?? null,
    ata4: kind === 'ATA4' ? ata : null,
    selectionReason:
      '按本人确认的机型与ATA归类汇集可读材料；原文机型提及只作归类建议，未分类及未完成材料另示，综合正文仍是候选认识。',
  };
}

/** Bounded inventory reads metadata and exact saved heads, never model previews.
 * Normal ticks restrict reads to journal changes; full reconciliation uses a cursor. */
export async function readWikiInventory(
  database: PostgresJsDatabase,
  owner: SummaryActor,
  scope: HierarchicalWikiEnableRequest,
  changes: Array<{ kind: string; subjectId: string }> | null,
  cursor: string | null,
  transactions: EngineeringMatterWorkingRepository,
): Promise<{
  items: WikiInventoryMember[];
  removed: Array<{ kind: string; id: string }>;
  waiting: WikiInventoryWaiting[];
  cursor: string | null;
  complete: boolean;
}> {
  const position: {
    document: string | null;
    matter: string | null;
    documentDone: boolean;
    matterDone: boolean;
  } = cursor
    ? JSON.parse(cursor)
    : { document: null, matter: null, documentDone: false, matterDone: false };
  const assignments = await database.execute<{
    familyId: string;
    ata: string | null;
    status: string;
  }>(sql`
    SELECT DISTINCT m.source_id AS "familyId",COALESCE(w.scope_json->>'ata4',w.scope_json->>'ata2') AS ata,
      m.basis_json->>'classificationStatus' AS status
    FROM hierarchical_wiki_membership m JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id
    WHERE m.tenant_id=${owner.tenantId} AND m.actor_user_id=${owner.actorUserId} AND m.source_kind='DOCUMENT'
      AND m.basis_json->>'classificationStatus' IN ('CONFIRMED','EXCLUDED') AND w.scope_json->>'fleetFamilyId'=${scope.fleetFamilyId}
      AND w.scope_json->'fleetModelIds'=${JSON.stringify(scope.fleetModelId ? [scope.fleetModelId] : [])}::jsonb`);
  const workItemIds =
    changes
      ?.filter((item) => item.kind === 'WORK_ITEM')
      .map((item) => item.subjectId) ?? [];
  const workDocuments = workItemIds.length
    ? await database.execute<{
        id: string;
      }>(sql`SELECT document_version_id AS id
    FROM work_item WHERE tenant_id=${owner.tenantId} AND work_item_id IN
      (SELECT jsonb_array_elements_text(${JSON.stringify(workItemIds)}::jsonb))`)
    : [];
  const documentIds = changes
    ? [
        ...new Set([
          ...changes
            .filter((item) => item.kind === 'DOCUMENT')
            .map((item) => item.subjectId),
          ...workDocuments.map((item) => item.id),
        ]),
      ]
    : null;
  const documents =
    await database.execute<DocumentRow>(sql`SELECT d.family_id AS "familyId",d.document_version_id AS "documentVersionId",
    d.pdf_sha256 AS "sourceSha256",d.byte_length::float8 AS "sourceByteLength",x.extracted_metadata AS metadata,
    CASE WHEN r.run_ref IS NULL THEN NULL ELSE jsonb_build_object('kind','DOCUMENT_READING',
      'documentVersionId',r.document_version_id,'parseRunId',r.parse_run_id,'semanticRevision',r.semantic_revision,
      'readingRunRef',r.run_ref,'readingRevision',r.reading_revision) END AS member
    FROM dm_document_version d JOIN dm_publication_family f ON f.family_id=d.family_id AND f.current_document_version_id=d.document_version_id
    LEFT JOIN LATERAL (SELECT extracted_metadata FROM dm_document_version_metadata WHERE document_version_id=d.document_version_id
      ORDER BY metadata_revision DESC LIMIT 1) x ON true
    LEFT JOIN LATERAL (SELECT a.* FROM dm_document_reading_run a JOIN dm_document_parse_run p ON p.tenant_id=a.tenant_id
      AND p.document_version_id=a.document_version_id AND p.parse_run_id=a.parse_run_id AND p.status='PUBLISHED'
      WHERE a.tenant_id=${owner.tenantId} AND a.document_version_id=d.document_version_id AND a.status='SAVED'
      AND a.parse_run_id=(SELECT parse_run_id FROM dm_document_parse_run WHERE tenant_id=a.tenant_id
        AND document_version_id=a.document_version_id AND status='PUBLISHED' ORDER BY parse_revision DESC LIMIT 1)
      AND a.semantic_revision=(SELECT max(semantic_revision) FROM dm_document_semantic_revision s WHERE s.tenant_id=a.tenant_id
        AND s.document_version_id=a.document_version_id AND s.parse_run_id=a.parse_run_id)
      ORDER BY a.reading_revision DESC LIMIT 1) r ON NOT EXISTS (
        SELECT 1 FROM dm_document_reading_retraction z WHERE z.tenant_id=r.tenant_id AND z.run_ref=r.run_ref)
    WHERE engineering_matter_document_owned_by_actor(${owner.tenantId},d.document_version_id)
      AND (${documentIds === null} OR d.family_id IN (SELECT family_id FROM dm_document_version
        WHERE document_version_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(documentIds ?? [])}::jsonb))))
      AND NOT ${position.documentDone} AND (${position.document}::text IS NULL OR d.document_version_id>${position.document})
    ORDER BY d.document_version_id LIMIT 100`);
  const items: WikiInventoryMember[] = [];
  const waiting: WikiInventoryWaiting[] = [];
  for (const row of documents) {
    const assigned = assignments
      .filter(
        (item) => item.familyId === row.familyId && item.status === 'CONFIRMED',
      )
      .map((item) => item.ata);
    const excluded = assignments
      .filter(
        (item) => item.familyId === row.familyId && item.status === 'EXCLUDED',
      )
      .map((item) => item.ata);
    const candidates = wikiClassifications(row.metadata, scope, row).filter(
      (ata) => !assigned.includes(ata) && !excluded.includes(ata),
    );
    for (const ata of [...assigned, ...candidates]) {
      const confirmed = assigned.includes(ata);
      items.push({
        member: row.member,
        sourceKind: 'DOCUMENT',
        sourceId: row.familyId,
        memberKey: `DOCUMENT_FAMILY:${row.familyId}`,
        ata,
        basis: {
          kind: confirmed ? 'USER_WIKI_CLASSIFICATION' : 'DOCUMENT_MENTION',
          familyId: row.familyId,
          documentVersionId: row.documentVersionId,
          ata,
          classificationStatus: confirmed ? 'CONFIRMED' : 'CANDIDATE',
          sourceSha256: row.sourceSha256,
          sourceByteLength: row.sourceByteLength,
        },
      });
      if (confirmed && !row.member)
        waiting.push({
          kind: 'DOCUMENT',
          subjectId: row.familyId,
          requestId: null,
          ata,
          documentVersionId: row.documentVersionId,
          status: 'READING_NOT_READY',
        });
    }
  }
  const matterIds =
    changes
      ?.filter((item) => item.kind === 'MATTER')
      .map((item) => item.subjectId) ?? null;
  const matters = await database.execute<{
    matterId: string;
    workRef: string | null;
    revision: number;
    state: string | null;
    familyId: string | null;
    matterRevisionId: string;
    basedOnMatterRevisionId: string | null;
  }>(sql`
    SELECT m.matter_id AS "matterId",m.default_family_id AS "familyId",m.current_matter_revision_id AS "matterRevisionId",
      w.based_on_matter_revision_id AS "basedOnMatterRevisionId",w.matter_work_revision_id AS "workRef",
      w.working_revision AS revision,w.state_json AS state FROM engineering_matter m
    LEFT JOIN LATERAL (SELECT r.* FROM engineering_matter_work_revision r WHERE r.tenant_id=m.tenant_id AND r.matter_id=m.matter_id
      AND r.created_by_user_id=${owner.actorUserId} ORDER BY r.working_revision DESC LIMIT 1) w ON true
    WHERE m.tenant_id=${owner.tenantId} AND engineering_matter_owned_by_actor(m.tenant_id,m.matter_id)
      AND (${changes === null} OR m.matter_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(matterIds ?? [])}::jsonb))
        OR EXISTS (SELECT 1 FROM engineering_matter_material_link l WHERE l.matter_revision_id=m.current_matter_revision_id
          AND (l.document_version_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(documentIds ?? [])}::jsonb))
            OR l.family_id IN (SELECT family_id FROM dm_document_version WHERE document_version_id IN
              (SELECT jsonb_array_elements_text(${JSON.stringify(documentIds ?? [])}::jsonb)))
            OR l.material_json::jsonb->'fulfilledBy'->>'documentVersionId' IN
              (SELECT jsonb_array_elements_text(${JSON.stringify(documentIds ?? [])}::jsonb))))
        OR EXISTS (SELECT 1 FROM engineering_matter_revision_work_item l JOIN work_item wi ON wi.work_item_id=l.work_item_id
          WHERE l.matter_revision_id=m.current_matter_revision_id AND wi.document_version_id IN
            (SELECT jsonb_array_elements_text(${JSON.stringify(documentIds ?? [])}::jsonb))))
      AND NOT ${position.matterDone} AND (${position.matter}::text IS NULL OR m.matter_id>${position.matter}) ORDER BY m.matter_id LIMIT 100`);
  for (const matter of matters) {
    const state: EngineeringMatterWorkingState | null = matter.state
      ? JSON.parse(matter.state)
      : null;
    const primaryFamilies = await database.execute<{
      familyId: string;
    }>(sql`SELECT l.family_id AS "familyId"
      FROM engineering_matter_material_link l JOIN engineering_matter m ON m.current_matter_revision_id=l.matter_revision_id
      WHERE m.matter_id=${matter.matterId} AND m.tenant_id=${owner.tenantId} AND l.kind='MEMBER'
        AND l.material_json::jsonb->>'disposition'='INCLUDED' AND l.family_id IS NOT NULL`);
    const parentFamilies = new Set([
      ...(matter.familyId ? [matter.familyId] : []),
      ...primaryFamilies.map((item) => item.familyId),
    ]);
    const inherited = assignments
      .filter(
        (item) =>
          parentFamilies.has(item.familyId) && item.status === 'CONFIRMED',
      )
      .map((item) => item.ata);
    const explicit = await database.execute<{
      ata: string | null;
      status: string;
    }>(sql`SELECT COALESCE(w.scope_json->>'ata4',w.scope_json->>'ata2') AS ata,
      l.basis_json->>'classificationStatus' AS status
      FROM hierarchical_wiki_membership l JOIN hierarchical_wiki_scope w ON w.wiki_id=l.wiki_id
      WHERE l.tenant_id=${owner.tenantId} AND l.actor_user_id=${owner.actorUserId} AND l.source_kind='MATTER'
        AND l.source_id=${matter.matterId} AND l.basis_json->>'classificationStatus' IN ('CONFIRMED','EXCLUDED')
        AND l.basis_json->>'kind'='USER_WIKI_CLASSIFICATION'
        AND w.scope_json->>'fleetFamilyId'=${scope.fleetFamilyId}
        AND w.scope_json->'fleetModelIds'=${JSON.stringify(scope.fleetModelId ? [scope.fleetModelId] : [])}::jsonb`);
    const atas = [
      ...new Set([
        ...inherited,
        ...explicit
          .filter((item) => item.status === 'CONFIRMED')
          .map((item) => item.ata),
      ]),
    ].filter(
      (ata) =>
        !explicit.some(
          (item) => item.ata === ata && item.status === 'EXCLUDED',
        ),
    );
    let authorized: Awaited<
      ReturnType<EngineeringMatterWorkingRepository['authorizeRuntimeInputs']>
    >;
    try {
      authorized = await transactions.authorizeRuntimeInputs(
        { ...owner, matterId: matter.matterId },
        database,
      );
    } catch (reason) {
      const code =
        reason instanceof Error && /^[A-Z][A-Z0-9_:-]+$/u.test(reason.message)
          ? reason.message
          : 'WIKI_SOURCE_UNAVAILABLE';
      for (const ata of atas) {
        items.push({
          member: null,
          sourceKind: 'MATTER',
          sourceId: matter.matterId,
          memberKey: `MATTER:${matter.matterId}`,
          ata,
          basis: {
            kind: explicit.some((item) => item.ata === ata)
              ? 'USER_WIKI_CLASSIFICATION'
              : 'CONFIRMED_MEMBER_FAMILY',
            classificationStatus: 'CONFIRMED',
            ata,
            matterRevisionId: matter.matterRevisionId,
            sourceErrorCode: code,
          },
        });
        waiting.push({
          kind: 'MATTER',
          subjectId: matter.matterId,
          ata,
          requestId: null,
          documentVersionId: null,
          status: code,
        });
      }
      continue;
    }
    for (const ata of atas)
      items.push({
        member:
          state?.problemWork && matter.workRef
            ? {
                kind: 'MATTER_WORK',
                matterId: matter.matterId,
                workRef: matter.workRef,
                workRevision: matter.revision,
                issueKeys: [],
              }
            : null,
        sourceKind: 'MATTER',
        sourceId: matter.matterId,
        memberKey: `MATTER:${matter.matterId}`,
        ata,
        basis: {
          kind: explicit.some((item) => item.ata === ata)
            ? 'USER_WIKI_CLASSIFICATION'
            : 'CONFIRMED_MEMBER_FAMILY',
          classificationStatus: 'CONFIRMED',
          primaryFamilyIds: [...parentFamilies],
          matterRevisionId: matter.matterRevisionId,
          ata,
        },
      });
    const attempts = await database.execute<{
      requestId: string;
      binding: import('@shared/matter-working.interface').EngineeringMatterWorkingInputBinding;
      status: string;
    }>(sql`
      SELECT a.trigger_request_id AS "requestId",b AS binding,a.status FROM action_attempt a
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.task_envelope_json::jsonb->'workingBasis'->'inputs','[]'::jsonb)) b
      WHERE a.tenant_id=${owner.tenantId} AND a.actor_user_id=${owner.actorUserId} AND a.matter_id=${matter.matterId}
        AND a.subject_kind='ENGINEERING_MATTER'
        AND b IN (SELECT jsonb_array_elements(${JSON.stringify(authorized.currentInputs)}::jsonb))
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${JSON.stringify(state?.coverage ?? [])}::jsonb) c
          WHERE c->'binding'=b AND c->>'contribution' IN ('SUBSTANTIVE','NO_MATERIAL_CHANGE'))
      ORDER BY a.created_at DESC`);
    const pending = engineeringMatterPendingInputs(
      state,
      authorized.currentInputs,
    );
    for (const ata of atas)
      waiting.push(
        ...pending.map((gap) => {
          const binding = gap.current;
          const attempt = attempts.find(
            (row) => canonicalJson(row.binding) === canonicalJson(binding),
          );
          return {
            kind: 'MATTER' as const,
            subjectId: matter.matterId,
            ata,
            requestId: attempt?.requestId ?? null,
            documentVersionId: binding.documentVersionId,
            status: !attempt
              ? 'NOT_ADMITTED'
              : attempt.status === 'SUCCEEDED'
                ? 'PARTIAL_SAVED'
                : attempt.status,
          };
        }),
      );
    if (
      matter.workRef &&
      matter.matterRevisionId !== matter.basedOnMatterRevisionId
    )
      for (const ata of atas)
        waiting.push({
          kind: 'MATTER',
          subjectId: matter.matterId,
          ata,
          requestId: null,
          documentVersionId: null,
          status: 'COMPOSITION_NOT_ADMITTED',
        });
  }
  // Only replace sources actually processed on this page. Other event pages
  // retain their candidates and waiting until their own exact reconciliation.
  // Vanished/revoked retained sources are handled separately, even though the
  // authorized document/Matter discovery queries cannot return them.
  const unavailable = await database.execute<{
    kind: string;
    id: string;
  }>(sql`SELECT DISTINCT m.source_kind AS kind,m.source_id AS id
    FROM hierarchical_wiki_membership m JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id
    LEFT JOIN dm_publication_family f ON m.source_kind='DOCUMENT' AND f.family_id=m.source_id
    WHERE m.tenant_id=${owner.tenantId} AND m.actor_user_id=${owner.actorUserId}
      AND w.scope_json->>'fleetFamilyId'=${scope.fleetFamilyId}
      AND w.scope_json->'fleetModelIds'=${JSON.stringify(scope.fleetModelId ? [scope.fleetModelId] : [])}::jsonb
      AND CASE m.source_kind
        WHEN 'DOCUMENT' THEN engineering_matter_document_owned_by_actor(${owner.tenantId},f.current_document_version_id) IS NOT TRUE
        WHEN 'MATTER' THEN engineering_matter_owned_by_actor(${owner.tenantId},m.source_id) IS NOT TRUE
        ELSE false END`);
  const removed = [
    ...new Map(
      [
        ...documents.map((row) => ({ kind: 'DOCUMENT', id: row.familyId })),
        ...matters.map((row) => ({ kind: 'MATTER', id: row.matterId })),
        ...unavailable,
      ].map((row) => [JSON.stringify(row), row]),
    ).values(),
  ];
  const complete =
    (position.documentDone || documents.length < 100) &&
    (position.matterDone || matters.length < 100);
  return {
    items,
    removed,
    waiting: [
      ...new Map(waiting.map((row) => [JSON.stringify(row), row])).values(),
    ],
    cursor: complete
      ? null
      : JSON.stringify({
          document: documents.at(-1)?.documentVersionId ?? position.document,
          matter: matters.at(-1)?.matterId ?? position.matter,
          documentDone: position.documentDone || documents.length < 100,
          matterDone: position.matterDone || matters.length < 100,
        }),
    complete,
  };
}
