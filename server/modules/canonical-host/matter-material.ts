import type { MatterMaterialLink } from '@shared/matter-material.interface';
import type { EngineeringMatterDocumentInputBinding } from '@shared/matter-working.interface';

export function materialInputBindings(
  materials: MatterMaterialLink[],
): EngineeringMatterDocumentInputBinding[] {
  return materials
    .filter((item) => item.disposition === 'INCLUDED')
    .flatMap((item) => {
      const sources =
        item.kind === 'EXPECTED'
          ? item.expected.fulfilledBy.map((source) => ({
              inputId: `${item.materialId}:${source.documentVersionId}`,
              ...source,
            }))
          : [
              {
                inputId: item.materialId,
                familyId: item.familyId,
                documentVersionId: item.documentVersionId,
              },
            ];
      return sources.map((source) => ({
        kind: 'DOCUMENT_VERSION' as const,
        inputId: source.inputId,
        familyId: source.familyId,
        documentVersionId: source.documentVersionId,
        workItemId: null,
        workItemRevision: null,
        resultRef: null,
        resultRevision: null,
      }));
    });
}

/** Validate stored and incoming material semantics at the same boundary. */
export function parseMatterMaterial(value: unknown): MatterMaterialLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  required(item.materialId, 96);
  required(item.scope, 2000);
  required(item.contribution, 4000);
  if (
    !['DOCUMENT', 'ENGINEER', 'DEFAULT_INTAKE'].includes(String(item.origin)) ||
    !['INCLUDED', 'EXCLUDED'].includes(String(item.disposition)) ||
    !Array.isArray(item.basis) ||
    item.basis.length > 96
  )
    invalid();
  for (const basis of item.basis) {
    if (!basis || typeof basis !== 'object') invalid();
    required(basis.documentVersionId, 96);
    required(basis.sourceRefId, 512);
  }
  if (item.kind === 'MEMBER' || item.kind === 'RELATED') {
    required(item.familyId, 96);
    required(item.documentVersionId, 96);
    if ('expected' in item) invalid();
  } else if (item.kind === 'EXPECTED') {
    if (
      item.familyId !== null ||
      item.documentVersionId !== null ||
      item.origin === 'DEFAULT_INTAKE' ||
      item.basis.length === 0 ||
      !item.expected ||
      typeof item.expected !== 'object'
    )
      invalid();
    const expected = item.expected as Record<string, unknown>;
    for (const key of ['issuer', 'documentNumber', 'expectedDate']) {
      if (expected[key] !== null) required(expected[key], 255);
    }
    required(expected.description, 2000);
    required(expected.expectedContribution, 4000);
    required(expected.sourceAsOf, 64);
    if (
      !['PLANNED', 'REPORTED_PUBLISHED', 'CANCELLED', 'UNKNOWN'].includes(
        String(expected.publicationStatus),
      ) ||
      !['NOT_ACQUIRED', 'PARTIALLY_ACQUIRED', 'ACQUIRED'].includes(
        String(expected.acquisitionStatus),
      ) ||
      !Array.isArray(expected.fulfilledBy) ||
      expected.fulfilledBy.length > 96
    )
      invalid();
    for (const fulfilled of expected.fulfilledBy) {
      if (!fulfilled || typeof fulfilled !== 'object') invalid();
      required(fulfilled.familyId, 96);
      required(fulfilled.documentVersionId, 96);
      required(fulfilled.scope, 2000);
    }
    if (
      (expected.acquisitionStatus === 'NOT_ACQUIRED') !==
      (expected.fulfilledBy.length === 0)
    )
      invalid();
  } else invalid();
  if (item.origin === 'DOCUMENT' && item.basis.length === 0) invalid();
  return structuredClone(value) as MatterMaterialLink;
}

export function mergeMatterMaterials(
  previous: MatterMaterialLink[],
  upserts: MatterMaterialLink[],
): MatterMaterialLink[] {
  const next = new Map(
    previous.map((item) => [item.materialId, parseMatterMaterial(item)]),
  );
  const supplied = new Set<string>();
  for (const raw of upserts) {
    const item = parseMatterMaterial(raw);
    if (supplied.has(item.materialId)) invalid();
    supplied.add(item.materialId);
    const before = next.get(item.materialId);
    if (before?.origin === 'ENGINEER' && item.origin !== 'ENGINEER') {
      throw new Error('MATTER_MATERIAL_ENGINEER_DECISION_CONFLICT');
    }
    next.set(item.materialId, item);
  }
  return [...next.values()];
}

export function matterMaterialDocumentVersions(
  item: MatterMaterialLink,
): string[] {
  return [
    ...new Set([
      ...(item.kind === 'EXPECTED'
        ? item.expected.fulfilledBy.map((entry) => entry.documentVersionId)
        : [item.documentVersionId]),
      ...item.basis.map((basis) => basis.documentVersionId),
    ]),
  ];
}

function required(value: unknown, max: number): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value.includes('\0')
  )
    invalid();
}
function invalid(): never {
  throw new Error('MATTER_MATERIAL_INVALID');
}
