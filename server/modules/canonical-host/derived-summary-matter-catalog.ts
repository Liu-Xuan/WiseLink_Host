import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { DerivedSummaryContent, DerivedSummaryMatterCatalog, DerivedSummaryMember,
  DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import type { MatterMaterialLink } from '@shared/matter-material.interface';
import { summaryMarkdownStructure, summaryMatterHeading } from '@shared/summary-markdown-structure';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import type { DerivedSummaryMembersService, SummaryActor } from './derived-summary-members.service';
import type { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { parseMatterMaterial } from './matter-material';
import { summaryCitations, summaryError, summaryMemberRef } from './derived-summary.validation';

export interface SummaryMatterAssociation {
  matterId: string; matterRevisionId: string; title: string;
  materials: MatterMaterialLink[];
  links: Array<{ workItemId: string; documentVersionId: string }>;
}
type CatalogBinding = DerivedSummaryMatterCatalog['entries'][number]['bindings'][number];
const readingLeaves = (reading: DerivedSummaryMemberReading): DerivedSummaryMember[] =>
  reading.member.kind === 'DERIVED_SUMMARY' ? reading.leaves : [reading.member];

type MatterSubject = { kind: 'DOCUMENT_READING'; documentVersionId: string }
  | { kind: 'WORK_ITEM_WORK'; workItemId: string; documentVersionId: string }
  | { kind: 'MATTER_WORK'; matterId: string };

/** Exact relation projection, also usable before reading/work bodies exist.
 * Legacy PRIMARY/RELATED WorkItem roles are both formal explicit links. */
export function summaryMatterAssociations(leaf: MatterSubject, associations: SummaryMatterAssociation[]):
  Array<{ row: SummaryMatterAssociation; association: CatalogBinding['association'] }> {
  const directLinks = leaf.kind === 'WORK_ITEM_WORK'
    ? associations.filter(row => row.links.some(link => link.workItemId === leaf.workItemId)) : [];
  return associations.flatMap(row => {
    let association: CatalogBinding['association'] | undefined;
    if (leaf.kind === 'MATTER_WORK' && leaf.matterId === row.matterId) association = { kind: 'MATTER_WORK' };
    if (leaf.kind === 'WORK_ITEM_WORK' && directLinks.includes(row))
      association = { kind: 'WORK_ITEM_LINK', workItemId: leaf.workItemId };
    if (leaf.kind === 'DOCUMENT_READING' || leaf.kind === 'WORK_ITEM_WORK' && !directLinks.length) {
      const material = row.materials.find(item => item.kind === 'MEMBER' && item.disposition === 'INCLUDED' &&
        item.documentVersionId === leaf.documentVersionId);
      if (material) association = { kind: 'MEMBER_MATERIAL', material };
      // Explicit semantics for this document take precedence. Materials for a
      // different source do not erase this exact legacy WorkItem context.
      else if (leaf.kind === 'DOCUMENT_READING' && !row.materials.some(item => item.documentVersionId === leaf.documentVersionId)) {
        const link = row.links.find(item => item.documentVersionId === leaf.documentVersionId);
        if (link) association = { kind: 'LINKED_DOCUMENT', workItemId: link.workItemId };
      }
    }
    return association ? [{ row, association }] : [];
  });
}

/** Relational identities only. A document's family, title, status or a shared
 * source never merges two Matters or chooses another DocumentVersion. */
export function buildSummaryMatterCatalog(readings: DerivedSummaryMemberReading[],
  leaves: DerivedSummaryMemberReading[], associations: SummaryMatterAssociation[]): DerivedSummaryMatterCatalog {
  const entries = new Map<string, DerivedSummaryMatterCatalog['entries'][number]>();
  const selectedBindings: DerivedSummaryMatterCatalog['unbound'] = [];
  const leafReadings = new Map(leaves.map(reading => [summaryMemberRef(reading.member), reading]));
  for (const reading of readings) for (const leaf of readingLeaves(reading)) {
    if (leaf.kind === 'DERIVED_SUMMARY') throw summaryError('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    const exact = leafReadings.get(summaryMemberRef(leaf));
    if (!exact) throw summaryError('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    const registry = new Set(reading.evidence.map(item => item.evidenceRef));
    const sourceRefs = [...new Set(exact.evidence.map(item => item.evidenceRef).filter(ref => registry.has(ref)))].sort();
    selectedBindings.push({ memberRef: reading.evidenceRef, leaf, sourceRefs });
    for (const { row, association } of summaryMatterAssociations(leaf, associations)) {
      const entry = entries.get(row.matterId) ?? { matterId: row.matterId,
        matterRevisionId: row.matterRevisionId, title: row.title, bindings: [] };
      entry.bindings.push({ memberRef: reading.evidenceRef, leaf, sourceRefs, association });
      entries.set(row.matterId, entry);
    }
  }
  const bindingKey = (binding: { memberRef: string; leaf: DerivedSummaryMember }) =>
    `${binding.memberRef}:${summaryMemberRef(binding.leaf)}`;
  const retainedUnbound: DerivedSummaryMatterCatalog['unbound'] = [];
  for (const binding of selectedBindings) {
    const leaf = binding.leaf;
    let referenced: boolean = [...entries.values()].some(entry => entry.bindings.some(item => bindingKey(item) === bindingKey(binding)));
    if (leaf.kind !== 'DOCUMENT_READING' && leaf.kind !== 'WORK_ITEM_WORK') {
      if (!referenced) retainedUnbound.push(binding);
      continue;
    }
    for (const entry of entries.values()) {
      if (entry.bindings.some(item => bindingKey(item) === bindingKey(binding))) continue;
      const material = associations.find(row => row.matterId === entry.matterId)?.materials.find(item =>
        item.kind === 'RELATED' && item.disposition === 'INCLUDED' && item.documentVersionId === leaf.documentVersionId);
      if (!material) continue;
      const supportingLeafRefs = entry.bindings.filter(item => {
        // Only existing saved assessment/Matter work provides this context.
        // A source reading referencing itself is no evidence of Matter ownership.
        if (item.association.kind === 'REFERENCE_CONTEXT' ||
          item.leaf.kind !== 'WORK_ITEM_WORK' && item.leaf.kind !== 'MATTER_WORK') return false;
        return leafReadings.get(summaryMemberRef(item.leaf))?.evidence.some(evidence =>
          (evidence.kind === 'DOCUMENT_PASSAGE' || evidence.kind === 'ENGINEER_ATTACHMENT') &&
            evidence.documentVersionId === leaf.documentVersionId || evidence.kind === 'PRIOR_RESULT' &&
            evidence.sourceStatement?.sourceBinding.original.documentVersionId === leaf.documentVersionId);
      }).map(item => summaryMemberRef(item.leaf));
      if (!supportingLeafRefs.length) continue;
      entry.bindings.push({ ...binding, association: { kind: 'REFERENCE_CONTEXT', material,
        supportingLeafRefs: [...new Set(supportingLeafRefs)].sort() } });
      referenced = true;
    }
    if (!referenced) retainedUnbound.push(binding);
  }
  return { schemaVersion: 'wiselink.wiki-matter-catalog.v1',
    entries: [...entries.values()].sort((a, b) => a.matterId.localeCompare(b.matterId)).map(entry => ({ ...entry,
      bindings: [...new Map(entry.bindings.map(binding => [bindingKey(binding), binding])).values()]
        .sort((a, b) => bindingKey(a).localeCompare(bindingKey(b))) })),
    unbound: [...new Map(retainedUnbound.map(binding => [bindingKey(binding), binding])).values()]
      .sort((a, b) => bindingKey(a).localeCompare(bindingKey(b))) };
}

export async function authorizeSummaryMatterCatalog(catalog: DerivedSummaryMatterCatalog,
  owner: SummaryActor, database: PostgresJsDatabase, matters: EngineeringMatterWorkingRepository): Promise<void> {
  for (const entry of catalog.entries) {
    const input = { ...owner, matterId: entry.matterId, basedOnMatterRevisionId: entry.matterRevisionId };
    if (owner.readScope === 'TENANT') await matters.authorizeReadInputs(input, database);
    else await matters.authorizeRuntimeInputs(input, database);
  }
}

/** Called inside the existing authorized transaction, then repeated after source
 * and Matter row locks. No unselected body or new formal association is created. */
export async function readSummaryMatterCatalog(readings: DerivedSummaryMemberReading[], owner: SummaryActor,
  database: PostgresJsDatabase, members: DerivedSummaryMembersService,
  matters: EngineeringMatterWorkingRepository): Promise<DerivedSummaryMatterCatalog> {
  const selected = [...new Map(readings.flatMap(readingLeaves)
    .map(leaf => [summaryMemberRef(leaf), leaf])).values()];
  const rows = await database.execute<{ matterId: string; matterRevisionId: string; title: string;
    materials: string[]; links: SummaryMatterAssociation['links'] }>(sql`
    SELECT m.matter_id AS "matterId", m.current_matter_revision_id AS "matterRevisionId", m.title,
      (SELECT COALESCE(jsonb_agg(l.material_json ORDER BY l.material_id), '[]'::jsonb)
        FROM engineering_matter_material_link l WHERE l.tenant_id=m.tenant_id
          AND l.matter_revision_id=m.current_matter_revision_id) AS materials,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('workItemId', l.work_item_id,
        'documentVersionId', w.document_version_id) ORDER BY l.work_item_id), '[]'::jsonb)
        FROM engineering_matter_revision_work_item l JOIN work_item w
          ON w.tenant_id=l.tenant_id AND w.work_item_id=l.work_item_id
        WHERE l.tenant_id=m.tenant_id AND l.matter_revision_id=m.current_matter_revision_id) AS links
    FROM engineering_matter m WHERE m.tenant_id=${owner.tenantId}
      AND (${owner.readScope === 'TENANT'} OR m.created_by_user_id=${owner.actorUserId})
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(${canonicalJson(selected)}::jsonb) selected
        WHERE selected->>'matterId'=m.matter_id OR EXISTS (
          SELECT 1 FROM engineering_matter_material_link l WHERE l.tenant_id=m.tenant_id
            AND l.matter_revision_id=m.current_matter_revision_id AND l.kind='MEMBER'
            AND l.material_json::jsonb->>'disposition'='INCLUDED'
            AND l.document_version_id=selected->>'documentVersionId') OR EXISTS (
          SELECT 1 FROM engineering_matter_revision_work_item l JOIN work_item w
            ON w.tenant_id=l.tenant_id AND w.work_item_id=l.work_item_id
          WHERE l.tenant_id=m.tenant_id AND l.matter_revision_id=m.current_matter_revision_id
            AND (l.work_item_id=selected->>'workItemId' OR w.document_version_id=selected->>'documentVersionId')))
    ORDER BY m.matter_id`);
  // Reuse exact reading authorization and provenance; never enrich immutable
  // member text with associations or pick a different saved revision.
  const leafReadings = await members.readAll(selected, owner, database);
  const catalog = buildSummaryMatterCatalog(readings, leafReadings, rows.map(row => ({ ...row,
    materials: row.materials.map(material => parseMatterMaterial(JSON.parse(material))) })));
  await authorizeSummaryMatterCatalog(catalog, owner, database, matters);
  return catalog;
}

const catalogStart = '\n\n<HOST_WIKI_MATTER_CATALOG>\n';
const catalogEnd = '\n</HOST_WIKI_MATTER_CATALOG>';
/** Remains inside the existing instruction string. Native's strict modelInput
 * and member schemas stay unchanged. This is Host control metadata, not source. */
export function summaryMatterInstruction(instruction: string, catalog?: DerivedSummaryMatterCatalog): string {
  return catalog ? instruction + catalogStart + canonicalJson(catalog) + catalogEnd : instruction;
}

export function assertSummaryMatterCatalog(catalog: DerivedSummaryMatterCatalog): void {
  if (!catalog || catalog.schemaVersion !== 'wiselink.wiki-matter-catalog.v1' ||
    !Array.isArray(catalog.entries) || !Array.isArray(catalog.unbound) ||
    new Set(catalog.entries.map(entry => entry.matterId)).size !== catalog.entries.length ||
    catalog.entries.some(entry => !/^[A-Za-z0-9_-]+$/u.test(entry.matterId) || !entry.matterRevisionId ||
      typeof entry.title !== 'string' || !entry.title.trim() || !Array.isArray(entry.bindings) || !entry.bindings.length) ||
    [...catalog.entries.flatMap(entry => entry.bindings), ...catalog.unbound].some(binding =>
      !binding.memberRef || !binding.leaf || binding.leaf.kind === 'DERIVED_SUMMARY' ||
      !Array.isArray(binding.sourceRefs) || binding.sourceRefs.some(ref => typeof ref !== 'string' || !ref)))
    throw summaryError('DERIVED_SUMMARY_MATTER_CATALOG_INVALID');
}

/** Formal membership comes from the seal, never a model-selected heading. Exact
 * citations remain in the existing registry; this only checks their attribution. */
export function assertSummaryMatterContent(content: DerivedSummaryContent, catalog: DerivedSummaryMatterCatalog): void {
  assertSummaryMatterCatalog(catalog);
  const headings = summaryMarkdownStructure(content.body).headings.filter(heading => heading.depth === 2);
  const seen = new Set<string>();
  if (!headings.length || content.body.slice(0, headings[0].start).trim())
    throw summaryError('DERIVED_SUMMARY_MATTER_CONTENT_INVALID');
  for (const [index, heading] of headings.entries()) {
    const identity = summaryMatterHeading(heading.title);
    const entry = identity ? catalog.entries.find(item => item.matterId === identity.matterId) : undefined;
    const unbound = heading.title === '未归属资料' && catalog.unbound.length > 0;
    const key = entry?.matterId ?? (unbound ? 'UNBOUND' : null);
    if (!key || seen.has(key)) throw summaryError('DERIVED_SUMMARY_MATTER_CONTENT_INVALID');
    seen.add(key);
    const bindings = entry?.bindings ?? catalog.unbound;
    const allowed = new Set(bindings.flatMap(binding => [...binding.sourceRefs, binding.memberRef]));
    const body = content.body.slice(heading.start, headings[index + 1]?.start ?? content.body.length);
    const refs = summaryCitations({ headline: '', listBrief: '', body, limitations: [] }, allowed);
    // A parent summary can carry several Matters. Its shared summary reference
    // alone cannot demonstrate which exact material supports this Matter.
    const supports = bindings.flatMap(binding => [...binding.sourceRefs,
      ...(binding.leaf.kind !== 'DERIVED_SUMMARY' && summaryMemberRef(binding.leaf) === binding.memberRef
        ? [binding.memberRef] : [])]);
    if (!refs.some(ref => supports.includes(ref))) throw summaryError('DERIVED_SUMMARY_MATTER_SOURCE_REQUIRED');
  }
  if (catalog.entries.some(entry => !seen.has(entry.matterId)) || catalog.unbound.length > 0 && !seen.has('UNBOUND'))
    throw summaryError('DERIVED_SUMMARY_MATTER_CONTENT_INVALID');
}
