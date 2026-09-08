import { Injectable } from '@nestjs/common';

import type {
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderSourceLocator,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import type {
  TranslationStructuredSource,
  TranslationStructuredSourceUnit,
} from '@shared/canonical-translation-v2.interface';

import { UNIFIED_READER } from './unified-reader.constants';
import type { UnifiedArtifactReadScope } from './unified-artifact-read-scope';
import type {
  UnifiedReaderPackageInspection,
  UnifiedReaderPackageSummary,
  UnifiedReaderSourcePackage,
} from './unified-reader.types';
import {
  assertNoDuplicateJsonKeys,
  canonicalJson,
  contentView,
  hashValue,
  optionalRecord,
  packageIdValue,
  recordArray,
  recordValue,
  requiredText,
  sha256Prefixed,
  sha256Text,
  stringArray,
} from './unified-reader.utils';

interface ParsedContentUnit {
  unitId: string;
  kind: string;
  text: string;
  sourceRefIds: string[];
  sourceLocators: UnifiedReaderSourceLocator[];
}

interface InspectedPackage {
  inspection: UnifiedReaderPackageInspection;
  units: ParsedContentUnit[];
}

@Injectable()
export class Frozen2CandidateReaderService {
  readAllSourceUnits(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
  ): UnifiedReaderQueryResult[] {
    return this.readSourcePackage(artifact, bytes).units;
  }

  readSourcePackage(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
    readScope?: UnifiedArtifactReadScope,
  ): UnifiedReaderSourcePackage {
    return this.inspectInternal(artifact, bytes, readScope);
  }

  /** Explicit v2 access; legacy text consumers do not acquire richer payloads. */
  readStructuredSource(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
    readScope?: UnifiedArtifactReadScope,
  ): TranslationStructuredSource {
    assertArtifactBytes(artifact, bytes);
    const pkg = recordValue(readScope ? readScope.parseJson(bytes) : parsePackageJson(bytes), 'package');
    this.assertContract(pkg);
    const sourceRefById = this.sourceRefIndex(recordArray(pkg.sourceRefs, 'sourceRefs'));
    return {
      units: recordArray(pkg.contentUnits, 'contentUnits').map(structuredUnit),
      modules: recordArray(pkg.modules, 'modules').map((value) => {
        const module = recordValue(value, 'module');
        if (typeof module.order !== 'number' || !Number.isSafeInteger(module.order)) {
          throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:MODULE_ORDER');
        }
        return { moduleId: requiredText(module.moduleId, 'moduleId'), order: module.order };
      }),
      sourceLocators: [...sourceRefById.values()].map(cloneLocator),
      findings: recordArray(pkg.findings, 'findings').map((value) => structuredClone(recordValue(value, 'finding'))),
      references: recordArray(pkg.references, 'references').map((value) => structuredClone(recordValue(value, 'reference'))),
    };
  }

  read(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
    query: string,
  ): UnifiedReaderPackageSummary {
    return this.querySourcePackage(this.readSourcePackage(artifact, bytes), query);
  }

  querySourcePackage(
    sourcePackage: UnifiedReaderSourcePackage,
    query: string,
  ): UnifiedReaderPackageSummary {
    const normalizedQuery: string = normalizeQuery(query);
    const queryResults: UnifiedReaderQueryResult[] = this.queryUnits(
      sourcePackage.units,
      normalizedQuery,
    );
    if (queryResults.length === 0) {
      throw new Error('READER_QUERY_NO_RESULTS');
    }
    return { ...sourcePackage.inspection, queryResults };
  }

  inspect(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
  ): UnifiedReaderPackageInspection {
    return this.inspectInternal(artifact, bytes).inspection;
  }

  private inspectInternal(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
    readScope?: UnifiedArtifactReadScope,
  ): InspectedPackage {
    assertArtifactBytes(artifact, bytes);
    const parsed: unknown = readScope
      ? readScope.parseJson(bytes)
      : parsePackageJson(bytes);
    const pkg: Record<string, unknown> = recordValue(parsed, 'package');
    this.assertContract(pkg);
    const packageId: string = packageIdValue(pkg.packageId, 'packageId');
    const integrity: Record<string, unknown> = recordValue(
      pkg.integrity,
      'integrity',
    );
    const contentHash: string = hashValue(
      integrity.contentHash,
      'integrity.contentHash',
    );
    const recomputedContentHash: string = sha256Text(
      canonicalJson(contentView(pkg)),
    );
    if (
      packageId !== `urn:techpub:package:v1:${contentHash}` ||
      recomputedContentHash !== contentHash
    ) {
      throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:CONTENT_IDENTITY');
    }
    const semanticHash: string = hashValue(
      integrity.semanticHash,
      'integrity.semanticHash',
    );
    const provenanceHash: string = hashValue(
      integrity.provenanceHash,
      'integrity.provenanceHash',
    );
    const coverageHash: string = hashValue(
      integrity.coverageHash,
      'integrity.coverageHash',
    );
    const source: Record<string, unknown> = recordValue(pkg.source, 'source');
    const sourceKind: 'pdf' | 'native_s1000d' = sourceKindValue(
      source.kind,
    );
    const result: Record<string, unknown> = recordValue(pkg.result, 'result');
    const resultStatus: 'complete' | 'partial' = resultStatusValue(
      result.status,
    );
    if (
      resultStatus === 'complete' &&
      (result.accountingComplete !== true ||
        result.contentPreserved !== true ||
        result.structuredCoverageComplete !== true)
    ) {
      throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:FALSE_COMPLETE');
    }
    const sourceRefs: unknown[] = recordArray(pkg.sourceRefs, 'sourceRefs');
    const sourceRefById = this.sourceRefIndex(sourceRefs);
    const sourceRefIds = new Set(sourceRefById.keys());
    const units: ParsedContentUnit[] = this.contentUnits(pkg, sourceRefIds, sourceRefById);
    const document: Record<string, unknown> = recordValue(
      pkg.document,
      'document',
    );
    const title: string = sourcedString(
      recordValue(document.title, 'document.title'),
      sourceRefIds,
      'document.title',
    );
    const revision: Record<string, unknown> | null = optionalRecord(
      document.revision,
      'document.revision',
    );
    const revisionLabel: string | null = revision
      ? sourcedString(
          recordValue(revision.label, 'document.revision.label'),
          sourceRefIds,
          'document.revision.label',
        )
      : null;
    const summaryHash: string = sha256Text(
      canonicalJson({
        packageId,
        contentHash,
        semanticHash,
        provenanceHash,
        coverageHash,
        sourceKind,
        resultStatus,
        title,
        revisionLabel,
        contentUnitCount: units.length,
        sourceRefCount: sourceRefs.length,
      }),
    );
    return {
      inspection: {
        packageId,
        contractId: UNIFIED_READER.packageSchemaVersion,
        contractRevision: UNIFIED_READER.contractRevision,
        sourceKind,
        contentHash,
        semanticHash,
        provenanceHash,
        coverageHash,
        resultStatus,
        title,
        revisionLabel,
        contentUnitCount: units.length,
        sourceRefCount: sourceRefs.length,
        sourceBoundUnitCount: units.length,
        summaryHash,
      },
      units,
    };
  }

  private assertContract(pkg: Record<string, unknown>): void {
    if (
      pkg.$schema !== UNIFIED_READER.packageSchemaId ||
      pkg.schemaVersion !== UNIFIED_READER.packageSchemaVersion ||
      pkg.contractRevision !== UNIFIED_READER.contractRevision
    ) {
      throw new Error('PACKAGE_SCHEMA_VALIDATION_FAILED:CONTRACT_MISMATCH');
    }
  }

  private sourceRefIndex(sourceRefs: unknown[]): Map<string, UnifiedReaderSourceLocator> {
    const refs = new Map<string, UnifiedReaderSourceLocator>();
    sourceRefs.forEach((value: unknown, index: number) => {
      const ref: Record<string, unknown> = recordValue(
        value,
        `sourceRefs[${index}]`,
      );
      const sourceRefId: string = requiredText(
        ref.sourceRefId,
        `sourceRefs[${index}].sourceRefId`,
      );
      if (refs.has(sourceRefId)) {
        throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:DUPLICATE_SOURCE_REF');
      }
      refs.set(sourceRefId, sourceLocator(ref, sourceRefId));
    });
    if (refs.size === 0) {
      throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:SOURCE_REFS_EMPTY');
    }
    return refs;
  }

  private contentUnits(
    pkg: Record<string, unknown>,
    sourceRefIds: Set<string>,
    sourceRefById: Map<string, UnifiedReaderSourceLocator>,
  ): ParsedContentUnit[] {
    const values: unknown[] = recordArray(pkg.contentUnits, 'contentUnits');
    if (values.length === 0) {
      throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:CONTENT_UNITS_EMPTY');
    }
    return values.map((value: unknown, index: number) => {
      const unit: Record<string, unknown> = recordValue(
        value,
        `contentUnits[${index}]`,
      );
      const refs: string[] = stringArray(
        unit.sourceRefIds,
        `contentUnits[${index}].sourceRefIds`,
      );
      if (
        refs.length === 0 ||
        refs.some((sourceRefId: string) => !sourceRefIds.has(sourceRefId))
      ) {
        throw new Error(
          `PACKAGE_SEMANTIC_VALIDATION_FAILED:CONTENT_UNIT_SOURCE_REF:${index}`,
        );
      }
      hashValue(unit.unitHash, `contentUnits[${index}].unitHash`);
      return {
        unitId: requiredText(
          unit.unitId,
          `contentUnits[${index}].unitId`,
        ),
        kind: requiredText(unit.kind, `contentUnits[${index}].kind`, 100),
        text: extractText(unit),
        sourceRefIds: refs,
        sourceLocators: refs.map((sourceRefId) => sourceRefById.get(sourceRefId)!).map(cloneLocator),
      };
    });
  }

  private queryUnits(
    units: UnifiedReaderQueryResult[],
    normalizedQuery: string,
  ): UnifiedReaderQueryResult[] {
    const results: UnifiedReaderQueryResult[] = [];
    units.forEach((unit: UnifiedReaderQueryResult) => {
      if (unit.text.toLocaleLowerCase().includes(normalizedQuery)) {
        results.push({
          unitId: unit.unitId,
          kind: unit.kind,
          text: unit.text,
          sourceRefIds: [...unit.sourceRefIds],
          sourceLocators: unit.sourceLocators?.map(cloneLocator),
        });
      }
    });
    return results.slice(0, 50);
  }
}

function structuredUnit(value: unknown, index: number): TranslationStructuredSourceUnit {
  const unit = recordValue(value, `contentUnits[${index}]`);
  const integer = (field: string): number => {
    const candidate = unit[field];
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
      throw new Error(`PACKAGE_SEMANTIC_VALIDATION_FAILED:CONTENT_UNIT_${field.toUpperCase()}`);
    }
    return candidate;
  };
  return {
    unitId: requiredText(unit.unitId, 'unitId'),
    kind: requiredText(unit.kind, 'kind'),
    moduleId: requiredText(unit.moduleId, 'moduleId'),
    parentUnitId: unit.parentUnitId === undefined ? null : requiredText(unit.parentUnitId, 'parentUnitId'),
    order: integer('order'),
    depth: integer('depth'),
    continuityKey: requiredText(unit.continuityKey, 'continuityKey'),
    sourceRefIds: stringArray(unit.sourceRefIds, 'sourceRefIds'),
    sourceSegmentIds: stringArray(unit.sourceSegmentIds, 'sourceSegmentIds'),
    mapping: structuredClone(recordValue(unit.mapping, 'mapping')),
    // Do not normalize, trim, or replace any original source string here.
    payload: structuredClone(recordValue(unit.payload, 'payload')),
  };
}

function parsePackageJson(bytes: Uint8Array): unknown {
  const rawText: string = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(rawText);
  return JSON.parse(rawText) as unknown;
}

function assertArtifactBytes(
  artifact: UnifiedPackageArtifactDescriptor,
  bytes: Uint8Array,
): void {
  if (
    artifact.storeRole !== UNIFIED_READER.artifactStoreRole ||
    artifact.mediaType !== 'application/json' ||
    artifact.byteLength !== bytes.byteLength ||
    artifact.sha256 !== sha256Prefixed(bytes).slice('sha256:'.length)
  ) {
    throw new Error('ARTIFACT_READBACK_MISMATCH:DESCRIPTOR_OR_BYTES');
  }
}

function sourceLocator(
  ref: Record<string, unknown>,
  sourceRefId: string,
): UnifiedReaderSourceLocator {
  return {
    sourceRefId,
    kind: optionalText(ref.kind),
    artifactId: optionalTextOrNull(ref.artifactId),
    pageStart: optionalIntegerOrNull(ref.pageStart),
    pageEnd: optionalIntegerOrNull(ref.pageEnd),
    charStart: optionalIntegerOrNull(ref.charStart),
    charEnd: optionalIntegerOrNull(ref.charEnd),
    charOffsetUnit: optionalTextOrNull(ref.charOffsetUnit),
    normalizedPath: optionalTextOrNull(ref.normalizedPath),
    xpath: optionalTextOrNull(ref.xpath),
    elementId: optionalTextOrNull(ref.elementId),
    quote: typeof ref.quote === 'string' ? ref.quote : null,
    bbox: optionalNumberArrayOrNull(ref.bbox),
  };
}

function cloneLocator(locator: UnifiedReaderSourceLocator): UnifiedReaderSourceLocator {
  return { ...locator, bbox: locator.bbox ? [...locator.bbox] : null };
}

function optionalText(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'unknown';
}

function optionalTextOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function optionalIntegerOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:SOURCE_LOCATOR_INTEGER');
  }
  return Number(value);
}

function optionalNumberArrayOrNull(value: unknown): number[] | null {
  if (value === undefined || value === null) return null;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:SOURCE_LOCATOR_BBOX');
  }
  return value.map(Number);
}

function sourceKindValue(value: unknown): 'pdf' | 'native_s1000d' {
  if (value !== 'pdf' && value !== 'native_s1000d') {
    throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:SOURCE_KIND');
  }
  return value;
}

function resultStatusValue(value: unknown): 'complete' | 'partial' {
  if (value !== 'complete' && value !== 'partial') {
    throw new Error('PACKAGE_SEMANTIC_VALIDATION_FAILED:RESULT_STATUS');
  }
  return value;
}

function normalizeQuery(value: unknown): string {
  const normalized: string = requiredText(value, 'query', 200).toLocaleLowerCase();
  if (normalized.length < 2) {
    throw new Error('READER_QUERY_TOO_SHORT');
  }
  return normalized;
}

function sourcedString(
  value: Record<string, unknown>,
  knownSourceRefIds: Set<string>,
  field: string,
): string {
  const refs: string[] = stringArray(value.sourceRefIds, `${field}.sourceRefIds`);
  if (
    refs.length === 0 ||
    refs.some((sourceRefId: string) => !knownSourceRefIds.has(sourceRefId))
  ) {
    throw new Error(`PACKAGE_SEMANTIC_VALIDATION_FAILED:SOURCED_VALUE:${field}`);
  }
  return requiredText(value.value, `${field}.value`);
}

function extractText(unit: Record<string, unknown>): string {
  const payload: Record<string, unknown> = recordValue(
    unit.payload,
    'contentUnit.payload',
  );
  for (const field of ['text', 'instructionText', 'title', 'label']) {
    const value: unknown = payload[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().normalize('NFC');
    }
  }
  return canonicalJson(payload);
}
