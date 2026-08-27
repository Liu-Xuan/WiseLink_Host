import {
  jcsCanonicalize,
  sha256Hex,
  sha256Urn,
  techpubEntityId,
} from '../pure/canonical-hash';
import { ProfessionalInputPureError } from '../pure/professional-input-pure.error';
import {
  PROFESSIONAL_INPUT_PURE_CONTRACT_ID,
  PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION,
  PROFESSIONAL_INPUT_PURE_PIPELINE_VERSION,
  PROFESSIONAL_INPUT_PURE_SCHEMA_ID,
  type ParsedPdfLayout,
  type ProfessionalInputDocumentIdentityInput,
  type ProfessionalInputLineageInput,
  type ProfessionalInputSourceArtifactInput,
  type SourceUnit,
  type SourceUnitSet,
  type StructuredApplicability,
  type StructuredApplicabilityExpression,
  type StructuredParsePackage,
} from '../pure/professional-input-pure.types';
import {
  pdfArtifactEntityId,
  pdfSourcePackageId,
} from './source-unit-set.builder';

/**
 * Stage 3: assemble the frozen.2 StructuredParsePackage (CANDIDATE_ONLY).
 *
 * All integrity hashes are pure functions of the package content view
 * (package minus packageId/integrity and minus lineage.generatedAt, with
 * location-bearing fields excluded), mirroring the techpub.hash.v1
 * canonicalization used by the unified reader.
 */
export function buildStructuredParsePackage(input: {
  layout: ParsedPdfLayout;
  unitSet: SourceUnitSet;
  artifact: ProfessionalInputSourceArtifactInput;
  document: ProfessionalInputDocumentIdentityInput;
  lineage: ProfessionalInputLineageInput;
}): StructuredParsePackage {
  const { layout, unitSet, artifact, document, lineage } = input;
  if (layout.kind !== 'pdf') {
    throw new ProfessionalInputPureError(
      'PACKAGE_LAYOUT_KIND_UNSUPPORTED',
      `Only pdf layouts can be packaged, received "${layout.kind}".`,
    );
  }

  const artifactId = pdfArtifactEntityId(layout, artifact);
  const sourcePackageId = pdfSourcePackageId(
    document.documentCode,
    layout.sourceSha256,
  );
  const metadataRefId = unitSet.sourceRefs[0]?.sourceRefId;
  if (!metadataRefId) {
    throw new ProfessionalInputPureError(
      'PACKAGE_SOURCE_REFS_EMPTY',
      'The source unit set carries no source refs; document fields cannot be anchored.',
    );
  }

  const titleValue = layout.metadata.title?.trim() || document.documentCode;
  const documentId = techpubEntityId(
    'document',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-document-id-v1',
        sourcePackageId,
      }),
    ),
  );

  /* ---------------------------- content units ------------------------ */

  const moduleId = techpubEntityId(
    'module',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-module-id-v1',
        sourcePackageId,
        continuityKey: 'logical-document',
        moduleKind: 'logical_document',
      }),
    ),
  );

  const contentUnits: Array<Record<string, unknown>> = [];
  let headingCount = 0;
  let contentOrder = 0;
  unitSet.units.forEach((unit) => {
    if (unit.kind === 'source_metadata') {
      // Document-level metadata is mapped into document.*, not contentUnits.
      return;
    }
    const isHeading = unit.expectedSemantic === 'heading';
    const kind = isHeading ? 'heading' : 'paragraph';
    const unitId = techpubEntityId(
      'unit',
      sha256Hex(
        jcsCanonicalize({
          namespace: 'techpub-unit-id-v1',
          sourcePackageId,
          moduleAnchorKey: 'logical-document',
          sourceAnchorKey: unit.continuityKey,
          kind,
        }),
      ),
    );
    const contentUnitWithoutHash: Record<string, unknown> = {
      unitId,
      continuityKey: unit.continuityKey,
      moduleId,
      kind,
      identityStability: 'revision_scoped',
      order: contentOrder,
      depth: 0,
      sourceRefIds: [...unit.sourceRefIds],
      sourceSegmentIds: [unit.sourceUnitId],
      mapping: {
        status: 'mapped_exactly',
        confidence: 'deterministic',
        findingIds: [],
      },
      payload: isHeading
        ? {
            text: unit.text,
            level: (headingCount += 1),
          }
        : {
            text: unit.text,
            role: 'body',
          },
    };
    const unitHash = `sha256:${sha256Hex(
      jcsCanonicalize(contentUnitWithoutHash),
    )}`;
    contentUnits.push({
      unitId,
      continuityKey: unit.continuityKey,
      unitHash,
      ...Object.fromEntries(
        Object.entries(contentUnitWithoutHash).filter(
          ([key]) => key !== 'unitId' && key !== 'continuityKey',
        ),
      ),
    });
    contentOrder += 1;
  });
  if (contentUnits.length === 0) {
    throw new ProfessionalInputPureError(
      'PACKAGE_CONTENT_UNITS_EMPTY',
      'No text-bearing source units were produced; refusing to emit an empty package.',
    );
  }

  const applicability = buildDeterministicApplicability(unitSet, moduleId);

  const sourceSegments = unitSet.units.map(toSourceSegment);
  const coverageEntries = unitSet.units.map((unit) => ({
    sourceSegmentId: unit.sourceUnitId,
    disposition: 'mapped_exactly',
    targetIds:
      unit.kind === 'source_metadata'
        ? [documentId]
        : contentUnits
            .filter(
              (contentUnit) =>
                Array.isArray(contentUnit.sourceSegmentIds) &&
                (contentUnit.sourceSegmentIds as string[]).includes(
                  unit.sourceUnitId,
                ),
            )
            .map((contentUnit) => contentUnit.unitId as string),
    findingIds: [],
  }));
  const requiredCount = sourceSegments.filter(
    (segment) => segment.coverageRequired,
  ).length;
  const mappedCount = coverageEntries.length;
  const coverage = {
    basis: {
      segmentSetId: unitSet.sourceUnitSetId,
      segmentSetHash: unitSet.sourceUnitSetHash,
      segmentationProfileId: unitSet.segmentationProfileId,
      segmentationProfileHash: unitSet.segmentationProfileHash,
      requiredSourceSegmentCount: requiredCount,
    },
    entries: coverageEntries,
    summary: {
      requiredSourceSegmentCount: requiredCount,
      mappedExactlyCount: mappedCount,
      mappedWithNormalizationCount: 0,
      preservedAsTextCount: 0,
      intentionallyExcludedCount: 0,
      blockedCount: 0,
      accountingComplete: mappedCount === unitSet.units.length,
      contentPreserved: true,
      structuredCoverageComplete: mappedCount === unitSet.units.length,
    },
  };

  /* ---------------------------- package skeleton --------------------- */

  const mappingProfileHash = `sha256:${sha256Hex(
    `${PROFESSIONAL_INPUT_PURE_PIPELINE_VERSION}@${PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION}`,
  )}`;
  const base: Record<string, unknown> = {
    $schema: PROFESSIONAL_INPUT_PURE_SCHEMA_ID,
    schemaVersion: PROFESSIONAL_INPUT_PURE_CONTRACT_ID,
    contractRevision: PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION,
    artifacts: [
      {
        artifactId,
        origin: 'source',
        role: 'pdf',
        artifactRef: artifact.artifactRef,
        sha256: layout.sourceSha256,
        mediaType: 'application/pdf',
        byteLength: layout.sourceByteLength,
        normalizedPath: artifact.normalizedPath,
      },
    ],
    source: {
      kind: 'pdf',
      sourcePackageId,
      sourcePackageHash: layout.sourceSha256,
      identityAuthority: 'service_observed',
      artifactIds: [artifactId],
      deliveryObjects: [],
      legacyIdentifiers: [],
    },
    profile: {
      canonicalModel: 'technical-publication-core.v1',
      sourceProfile: 'wiselink.v3_1.host_native.pdf.v1',
      mappingProfile: {
        id: 'professional-input-pure-pdf-v1',
        version: PROFESSIONAL_INPUT_PURE_CONTRACT_REVISION,
        hash: mappingProfileHash,
      },
    },
    lineage: {
      generatedAt: lineage.generatedAt,
      producer: {
        name: lineage.producerName,
        version: lineage.producerVersion,
        runtime: 'typescript',
        buildHash: sha256Urn(PROFESSIONAL_INPUT_PURE_PIPELINE_VERSION),
      },
      inputs: [
        {
          role: 'source_package',
          schemaVersion: 'application/pdf',
          id: sourcePackageId,
          hash: layout.sourceSha256,
          artifactIds: [artifactId],
        },
        {
          role: 'source_unit_set',
          schemaVersion: 'professional-input-pure.source-unit-set.v1',
          id: unitSet.sourceUnitSetId,
          hash: unitSet.sourceUnitSetHash,
          artifactIds: [artifactId],
        },
      ],
    },
    document: {
      documentId,
      documentType: {
        value: document.documentType,
        authority: 'parser_normalized',
        mappingStatus: 'normalized',
        sourceRefIds: [metadataRefId],
      },
      title: {
        value: titleValue,
        authority: layout.metadata.title
          ? 'source_asserted'
          : 'service_observed',
        mappingStatus: 'exact',
        sourceRefIds: [metadataRefId],
      },
      identifiers: [
        {
          scheme: 'oem_document_code',
          value: document.documentCode,
          authority: 'service_observed',
          completeness: 'complete',
          sourceRefIds: [metadataRefId],
        },
      ],
      language: {
        value: document.language,
        authority: 'service_observed',
        mappingStatus: 'exact',
        sourceRefIds: [metadataRefId],
      },
      relationships: [],
    },
    publicationStructures: [],
    modules: [
      {
        moduleId,
        continuityKey: 'logical-document',
        moduleKind: 'logical_document',
        informationType: 'procedural',
        authority: 'service_generated',
        identityStability: 'generated_stable',
        order: 0,
        title: {
          value: titleValue,
          authority: layout.metadata.title
            ? 'source_asserted'
            : 'service_observed',
          mappingStatus: 'exact',
          sourceRefIds: [metadataRefId],
        },
        sourceRefIds: [metadataRefId],
        contentUnitIds: contentUnits.map((unit) => unit.unitId as string),
      },
    ],
    sourceRefs: unitSet.sourceRefs.map((ref) => ({
      sourceRefId: ref.sourceRefId,
      kind: ref.kind,
      artifactId: ref.artifactId,
      pageStart: ref.pageStart,
      pageEnd: ref.pageEnd,
      bbox: [...ref.bbox],
      quote: ref.quote,
      anchorTextHash: ref.anchorTextHash,
    })),
    sourceSegments,
    contentUnits,
    references: [],
    assets: [],
    applicability,
    coverage,
    findings: [],
    extensions: [],
    result: {
      status: 'complete',
      accountingComplete: coverage.summary.accountingComplete,
      contentPreserved: coverage.summary.contentPreserved,
      structuredCoverageComplete: coverage.summary.structuredCoverageComplete,
    },
  };

  const semanticHash = hashObject(semanticView(base));
  const provenanceHash = hashObject(provenanceView(base));
  const coverageHash = hashObject(coverageHashView(base));
  const contentHash = hashObject(contentView(base));

  const pkg: Record<string, unknown> = {
    ...base,
    packageId: entityIdFromHash('package', contentHash),
    integrity: {
      hashSpecVersion: 'techpub.hash.v1',
      canonicalization: 'RFC8785-JCS',
      digestAlgorithm: 'SHA-256',
      contentHash,
      semanticHash,
      provenanceHash,
      coverageHash,
    },
  };
  // Re-order so $schema leads and result sits where consumers expect it.
  const ordered: Record<string, unknown> = {
    $schema: pkg.$schema,
    schemaVersion: pkg.schemaVersion,
    contractRevision: pkg.contractRevision,
    packageId: pkg.packageId,
    integrity: pkg.integrity,
    result: pkg.result,
  };
  for (const [key, value] of Object.entries(pkg)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered as unknown as StructuredParsePackage;
}

/**
 * Recompute and verify the integrity block of a package produced by this
 * builder. Returns true when every hash matches its content view.
 */
export function verifyStructuredParsePackageIntegrity(
  pkg: StructuredParsePackage,
): boolean {
  const base = structuredClone(pkg as unknown as Record<string, unknown>);
  const integrity = base.integrity as Record<string, string>;
  return (
    integrity.contentHash === hashObject(contentView(base)) &&
    integrity.semanticHash === hashObject(semanticView(base)) &&
    integrity.provenanceHash === hashObject(provenanceView(base)) &&
    integrity.coverageHash === hashObject(coverageHashView(base))
  );
}

function toSourceSegment(unit: SourceUnit): Record<string, unknown> {
  return {
    sourceSegmentId: unit.sourceUnitId,
    continuityKey: unit.continuityKey,
    kind: unit.kind,
    expectedSemantic: unit.expectedSemantic,
    order: unit.order,
    sourceRefIds: [...unit.sourceRefIds],
    segmentHash: unit.unitHash,
    coverageRequired: true,
  };
}

function hashObject(value: unknown): string {
  return `sha256:${sha256Hex(jcsCanonicalize(value))}`;
}

function entityIdFromHash(kind: string, digest: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new ProfessionalInputPureError(
      'PACKAGE_HASH_INVALID',
      `Cannot build ${kind} identity from invalid digest ${digest}.`,
    );
  }
  return techpubEntityId(kind, digest.slice('sha256:'.length));
}

const FTD_AIMS_2_APPLICABILITY_TEXT =
  'All777modelsequippedwithAirplaneInformationManagementSystem2(AIMS-2)Platform.';

interface DeterministicApplicabilityObservation {
  sourceUnitId: string;
  sourceRefId: string;
  text: string;
  aircraftModel: '777';
  equipmentModel: 'AIMS-2';
}

/**
 * Recognize only the directly source-bound FTD form proven by the actual-byte
 * pipeline. A single Applicability label must be followed immediately
 * on the same page by the complete expression in one SourceUnit/SourceRef.
 * Any absent, split, duplicate, or ambiguous observation remains empty.
 */
function buildDeterministicApplicability(
  unitSet: SourceUnitSet,
  moduleId: string,
): StructuredApplicability {
  const refsById = new Map(
    unitSet.sourceRefs.map((sourceRef) => [sourceRef.sourceRefId, sourceRef]),
  );
  const observations: DeterministicApplicabilityObservation[] = [];
  for (let index = 0; index < unitSet.units.length - 1; index += 1) {
    const heading = unitSet.units[index];
    const expression = unitSet.units[index + 1];
    if (
      heading.text !== 'Applicability' ||
      expression.order !== heading.order + 1 ||
      expression.text !== FTD_AIMS_2_APPLICABILITY_TEXT ||
      heading.sourceRefIds.length !== 1 ||
      expression.sourceRefIds.length !== 1
    ) {
      continue;
    }
    const headingRef = refsById.get(heading.sourceRefIds[0]);
    const expressionRef = refsById.get(expression.sourceRefIds[0]);
    if (
      !headingRef ||
      !expressionRef ||
      headingRef.pageStart !== expressionRef.pageStart ||
      headingRef.quote !== heading.text ||
      expressionRef.quote !== expression.text
    ) {
      continue;
    }
    observations.push({
      sourceUnitId: expression.sourceUnitId,
      sourceRefId: expressionRef.sourceRefId,
      text: expression.text,
      aircraftModel: '777',
      equipmentModel: 'AIMS-2',
    });
  }
  if (observations.length !== 1) {
    return {
      sourceExpressions: [],
      normalizedCandidates: [],
      assignments: [],
    };
  }

  const observation = observations[0];
  const expressionId = techpubEntityId(
    'applicability-source',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-applicability-source-id-v1',
        sourceUnitId: observation.sourceUnitId,
        sourceRefId: observation.sourceRefId,
        text: observation.text,
      }),
    ),
  );
  const normalizedExpression: StructuredApplicabilityExpression = {
    operator: 'all',
    children: [
      {
        operator: 'predicate',
        predicate: {
          property: 'model',
          comparator: 'eq',
          values: [observation.aircraftModel],
        },
      },
      {
        operator: 'predicate',
        predicate: {
          property: 'equipmentModelInstalled',
          comparator: 'eq',
          values: [observation.equipmentModel],
        },
      },
    ],
  };
  const candidateId = techpubEntityId(
    'applicability-candidate',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-applicability-candidate-id-v1',
        expressionId,
        expression: normalizedExpression,
      }),
    ),
  );
  const target = {
    kind: 'module' as const,
    targetId: moduleId,
    sourceRefIds: [observation.sourceRefId],
  };
  const assignmentId = techpubEntityId(
    'applicability-assignment',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-applicability-assignment-id-v1',
        expressionId,
        target,
      }),
    ),
  );
  return {
    sourceExpressions: [
      {
        expressionId,
        text: observation.text,
        form: 'logical_expression',
        authority: 'source_asserted',
        sourceRefIds: [observation.sourceRefId],
      },
    ],
    normalizedCandidates: [
      {
        candidateId,
        language: 'techpub-applicability-expr.v1',
        confidence: 'deterministic',
        sourceExpressionIds: [expressionId],
        expression: normalizedExpression,
        authority: 'parser_candidate',
      },
    ],
    assignments: [
      {
        assignmentId,
        expressionId,
        target,
        authority: 'source_asserted',
      },
    ],
  };
}

function coverageHashView(pkg: Record<string, unknown>): unknown {
  const coverage = structuredClone(pkg.coverage as Record<string, unknown>);
  const entries = coverage.entries as Array<Record<string, unknown>>;
  entries.sort((left, right) =>
    compareText(String(left.sourceSegmentId), String(right.sourceSegmentId)),
  );
  return coverage;
}

function provenanceView(pkg: Record<string, unknown>): unknown {
  const lineage = pkg.lineage as Record<string, unknown>;
  const contentUnits = pkg.contentUnits as Array<Record<string, unknown>>;
  const extensions = (pkg.extensions as Array<Record<string, unknown>>)
    .map((item) => ({
      namespace: item.namespace,
      schemaId: item.schemaId,
      version: item.version,
      targetIds: [...(item.targetIds as string[])].sort(compareText),
      semanticImpact: item.semanticImpact,
      payloadHash: item.payloadHash,
    }))
    .sort((left, right) =>
      compareText(
        `${left.namespace}\n${left.version}\n${left.schemaId}`,
        `${right.namespace}\n${right.version}\n${right.schemaId}`,
      ),
    );
  return stripLocationFields({
    artifacts: pkg.artifacts,
    source: pkg.source,
    profile: pkg.profile,
    lineage: Object.fromEntries(
      Object.entries(lineage).filter(([key]) => key !== 'generatedAt'),
    ),
    sourceRefs: pkg.sourceRefs,
    sourceSegments: pkg.sourceSegments,
    mappings: contentUnits.map((unit) => ({
      unitId: unit.unitId,
      sourceRefIds: unit.sourceRefIds,
      sourceSegmentIds: unit.sourceSegmentIds,
      mapping: unit.mapping,
    })),
    coverage: pkg.coverage,
    extensions,
  });
}

function contentView(pkg: Record<string, unknown>): unknown {
  const base = structuredClone(pkg);
  delete base.packageId;
  delete base.integrity;
  const lineage = base.lineage as Record<string, unknown>;
  delete lineage.generatedAt;
  return stripLocationFields(base);
}

function semanticView(pkg: Record<string, unknown>): unknown {
  const modules = (pkg.modules as Array<Record<string, unknown>>)
    .map((item) => structuredClone(item))
    .sort(
      (left, right) =>
        Number(left.order) - Number(right.order) ||
        compareText(String(left.moduleId), String(right.moduleId)),
    );
  const moduleOrder = new Map(
    modules.map((module) => [String(module.moduleId), Number(module.order)]),
  );
  const units = pkg.contentUnits as Array<Record<string, unknown>>;
  const unitsByParent = new Map<string, Array<Record<string, unknown>>>();
  for (const unit of units) {
    const parent = String(unit.parentUnitId ?? '');
    const values = unitsByParent.get(parent) ?? [];
    values.push(unit);
    unitsByParent.set(parent, values);
  }
  for (const values of unitsByParent.values()) {
    values.sort(
      (left, right) =>
        (moduleOrder.get(String(left.moduleId)) ?? -1) -
          (moduleOrder.get(String(right.moduleId)) ?? -1) ||
        Number(left.order) - Number(right.order) ||
        compareText(String(left.kind), String(right.kind)) ||
        compareText(String(left.unitId), String(right.unitId)),
    );
  }
  const structural = new Map<string, string>();
  const walk = (parent: string, prefix: string): void => {
    (unitsByParent.get(parent) ?? []).forEach((unit, index) => {
      const key =
        `${prefix}/${moduleOrder.get(String(unit.moduleId))}:` +
        `${unit.order}:${unit.kind}:${index}`;
      structural.set(String(unit.unitId), key);
      walk(String(unit.unitId), key);
    });
  };
  walk('', 'doc');
  for (const unit of units) {
    if (!structural.has(String(unit.unitId))) {
      structural.set(String(unit.unitId), `orphan/${String(unit.kind)}`);
    }
  }
  const semanticUnits = units
    .map((unit) => ({
      key: structural.get(String(unit.unitId)),
      kind: unit.kind,
      order: unit.order,
      depth: unit.depth,
      parent: unit.parentUnitId
        ? (structural.get(String(unit.parentUnitId)) ?? null)
        : null,
      payload: structuredClone(unit.payload),
    }))
    .sort((left, right) => compareText(String(left.key), String(right.key)));
  const document = pkg.document as Record<string, unknown>;
  const documentType = document.documentType as Record<string, unknown>;
  const title = document.title as Record<string, unknown>;
  const language = document.language as Record<string, unknown>;
  const identifiers = document.identifiers as Array<Record<string, unknown>>;
  const relationships = document.relationships as Array<
    Record<string, unknown>
  >;
  return {
    document: {
      documentType: documentType.value,
      title: title.value,
      identifiers: identifiers.map((item) => ({
        scheme: item.scheme,
        value: item.value,
        completeness: item.completeness,
        missingComponents: item.missingComponents ?? [],
      })),
      language: language.value,
      revision: null,
      relationships: relationships.map((item) => {
        const target = item.targetIdentifier as Record<string, unknown>;
        return {
          type: item.relationshipType,
          target: {
            scheme: target.scheme,
            value: target.value,
          },
        };
      }),
    },
    publicationStructures: [],
    modules: modules.map((module) => ({
      moduleKind: module.moduleKind,
      informationType: module.informationType,
      order: module.order,
      title: (module.title as Record<string, unknown>).value,
      standardIdentity: null,
    })),
    contentUnits: semanticUnits,
    applicability: semanticApplicabilityView(pkg, moduleOrder, structural),
    semanticExtensions: [],
  };
}

function semanticApplicabilityView(
  pkg: Record<string, unknown>,
  moduleOrder: ReadonlyMap<string, number>,
  structural: ReadonlyMap<string, string>,
): unknown {
  const applicability = pkg.applicability as StructuredApplicability;
  const sourceExpressionOrder = new Map(
    applicability.sourceExpressions.map((item, index) => [
      item.expressionId,
      index,
    ]),
  );
  const sourceRefs = new Map(
    (pkg.sourceRefs as Array<Record<string, unknown>>).map((item) => [
      String(item.sourceRefId),
      item,
    ]),
  );
  const cleanSourceLocator = (sourceRefId: string): Record<string, unknown> => {
    const sourceRef = sourceRefs.get(sourceRefId);
    if (!sourceRef) return { kind: 'missing' };
    return {
      kind: 'pdf',
      pageStart: sourceRef.pageStart,
      pageEnd: sourceRef.pageEnd,
      bbox: sourceRef.bbox ?? null,
      charStart: sourceRef.charStart ?? null,
      charEnd: sourceRef.charEnd ?? null,
      charOffsetUnit: sourceRef.charOffsetUnit ?? null,
    };
  };
  const semanticAssignments = applicability.assignments
    .map((assignment) => {
      const targetKind = assignment.target.kind;
      let target: unknown;
      if (targetKind === 'module') {
        target = moduleOrder.get(assignment.target.targetId ?? '') ?? 'missing';
      } else if (targetKind === 'content_unit') {
        target = structural.get(assignment.target.targetId ?? '') ?? 'missing';
      } else {
        target = assignment.target.sourceRefIds
          .map(cleanSourceLocator)
          .sort(compareCanonicalValues);
      }
      return {
        sourceExpressionOrder:
          sourceExpressionOrder.get(assignment.expressionId) ?? 'missing',
        targetKind,
        target,
        sourceLocators: assignment.target.sourceRefIds
          .map(cleanSourceLocator)
          .sort(compareCanonicalValues),
        sourceReferenceId: assignment.sourceReferenceId ?? null,
        authority: assignment.authority,
      };
    })
    .sort(compareCanonicalValues);
  return {
    sourceExpressions: applicability.sourceExpressions.map((item) => ({
      form: item.form,
      text: item.text,
    })),
    normalizedCandidates: applicability.normalizedCandidates.map((item) => ({
      language: item.language,
      sourceExpressionOrders: item.sourceExpressionIds
        .map(
          (expressionId): number | 'missing' =>
            sourceExpressionOrder.get(expressionId) ?? 'missing',
        )
        .sort((left, right) => compareText(String(left), String(right))),
      expression: structuredClone(item.expression),
    })),
    assignments: semanticAssignments,
  };
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  return compareText(jcsCanonicalize(left), jcsCanonicalize(right));
}

function stripLocationFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripLocationFields);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key, item]) =>
        key !== 'artifactRef' && key !== 'originalPath' && item !== undefined,
    );
    return Object.fromEntries(
      entries.map(([key, item]) => [key, stripLocationFields(item)]),
    );
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
