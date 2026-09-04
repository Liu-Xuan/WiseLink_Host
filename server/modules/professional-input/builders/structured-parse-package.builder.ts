import {
  buildSourceBoundAeoEffectivity,
  buildSourceBoundAeoProcedure,
  buildSourceBoundAeoSafetyBoundary,
  buildSourceBoundAeoSoftwareControl,
  type SourceBoundAeoEffectivity,
} from './ameco-aeo-structure.builder';
import {
  buildSourceBoundRilDocumentReferences,
  buildSourceBoundRilGeneralEvaluation,
  buildSourceBoundRilPageChrome,
  buildSourceBoundRilProcedure,
} from './airbus-ril-structure.builder';
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
import {
  buildFamilySectionTopology,
  buildSourceBoundAdDocumentRelations,
  buildSourceBoundAdObligations,
  buildSourceBoundConcurrentRequirements,
  buildSourceBoundSilDocumentReferences,
  buildSourceBoundSilPartNumberMatrix,
  buildSourceBoundSilRecommendationSectionStatus,
  buildSourceBoundSlAction,
  buildSourceBoundSlReferenceCatalog,
  buildSourceBoundSlReferenceRelations,
  type SourceBoundSlReferenceCatalog,
  type SourceBoundSectionWindow,
} from './family-section-topology.builder';

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

  const sectionTopology = buildFamilySectionTopology({ unitSet, document });
  const slReferenceCatalog =
    buildSourceBoundSlReferenceCatalog(sectionTopology);
  const silRecommendationSectionStatus =
    buildSourceBoundSilRecommendationSectionStatus(sectionTopology);
  for (const section of sectionTopology) {
    const sectionUnits = buildSectionObservationContentUnits({
      section,
      unitSet,
      documentCode: document.documentCode,
      moduleId,
      sourcePackageId,
      firstOrder: contentOrder,
      slReferenceCatalog,
      silRecommendationSectionStatus,
    });
    contentUnits.push(...sectionUnits);
    contentOrder += sectionUnits.length;
  }

  const applicability = buildDeterministicApplicability(
    unitSet,
    moduleId,
    document,
    sectionTopology,
  );

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
      ...(ref.charStart === undefined
        ? {}
        : {
            charStart: ref.charStart,
            charEnd: ref.charEnd,
            charOffsetUnit: ref.charOffsetUnit,
          }),
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

interface BoeingSbLineNumberSpec {
  start: number;
  end: number;
}

interface BoeingSbLineObservation {
  unit: SourceUnit;
  specs: BoeingSbLineNumberSpec[];
}

interface BoeingSbApplicabilityObservation {
  effectivityEvidenceUnits: SourceUnit[];
  lineObservations: BoeingSbLineObservation[];
  partNumberEvidenceUnits: SourceUnit[];
  existingPartNumber: string;
}

interface BoeingSbModelLineApplicabilityObservation {
  effectivityEvidenceUnits: SourceUnit[];
  models: string[];
  lineObservations: BoeingSbLineObservation[];
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
  document: ProfessionalInputDocumentIdentityInput,
  sectionTopology: readonly SourceBoundSectionWindow[],
): StructuredApplicability {
  const refsById = new Map(
    unitSet.sourceRefs.map((sourceRef) => [sourceRef.sourceRefId, sourceRef]),
  );
  if (document.documentType === 'engineering_order') {
    const effectivitySection = sectionTopology.find(
      (section) =>
        section.family === 'AEO' && section.sectionKey === 'engineering_basis',
    );
    const effectivity = effectivitySection
      ? buildSourceBoundAeoEffectivity(effectivitySection)
      : null;
    return effectivity?.effectivityStructured
      ? buildAeoDeterministicApplicability(effectivity, moduleId)
      : emptyApplicability();
  }
  if (
    document.documentCode === '777-34-0425' &&
    document.documentType === 'service_bulletin'
  ) {
    return buildBoeing777SbDeterministicApplicability(
      unitSet,
      moduleId,
      refsById,
    );
  }
  if (document.documentType !== 'fleet_team_digest') {
    if (
      document.documentType === 'service_bulletin' &&
      document.documentCode === '737-34-3830'
    ) {
      return buildBoeingSbDeterministicApplicability(
        unitSet,
        moduleId,
        refsById,
      );
    }
    return emptyApplicability();
  }
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
  if (observations.length === 0) {
    return emptyApplicability();
  }
  if (observations.length !== 1) {
    return emptyApplicability();
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

function buildAeoDeterministicApplicability(
  effectivity: SourceBoundAeoEffectivity,
  moduleId: string,
): StructuredApplicability {
  const models = uniqueStrings(
    effectivity.groups.map((group) => group.aircraftModel),
  );
  const registrations = uniqueStrings(
    effectivity.groups.flatMap((group) => group.aircraftRegistrations),
  );
  const sourceUnitIds = uniqueStrings(
    effectivity.groups.flatMap(
      (group) => group.applicabilitySourceUnitIds,
    ),
  );
  const sourceRefIds = uniqueStrings(
    effectivity.groups.flatMap(
      (group) => group.applicabilitySourceRefIds,
    ),
  );
  if (
    models.length === 0 ||
    models.length > 200 ||
    registrations.length === 0 ||
    registrations.length > 200 ||
    sourceUnitIds.length === 0 ||
    sourceRefIds.length === 0
  ) {
    return emptyApplicability();
  }
  const text = effectivity.groups
    .map(
      (group) =>
        `${group.groupId} ${group.aircraftModel}: ` +
        group.aircraftRegistrations.join(', '),
    )
    .join('; ');
  const expressionId = techpubEntityId(
    'applicability-source',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-applicability-source-id-v1',
        sourceUnitIds,
        sourceRefIds,
        text,
      }),
    ),
  );
  const expression: StructuredApplicabilityExpression = {
    operator: 'all',
    children: [
      {
        operator: 'predicate',
        predicate: {
          property: 'model',
          comparator: 'in',
          values: models,
        },
      },
      {
        operator: 'predicate',
        predicate: {
          property: 'registrationNumber',
          comparator: 'in',
          values: registrations,
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
        expression,
      }),
    ),
  );
  const target = {
    kind: 'module' as const,
    targetId: moduleId,
    sourceRefIds,
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
        text,
        form: 'logical_expression',
        authority: 'source_asserted',
        sourceRefIds,
      },
    ],
    normalizedCandidates: [
      {
        candidateId,
        language: 'techpub-applicability-expr.v1',
        confidence: 'deterministic',
        sourceExpressionIds: [expressionId],
        expression,
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

function buildSectionObservationContentUnits(input: {
  section: SourceBoundSectionWindow;
  unitSet: SourceUnitSet;
  documentCode: string;
  moduleId: string;
  sourcePackageId: string;
  firstOrder: number;
  slReferenceCatalog: SourceBoundSlReferenceCatalog | null;
  silRecommendationSectionStatus: ReturnType<
    typeof buildSourceBoundSilRecommendationSectionStatus
  >;
}): Array<Record<string, unknown>> {
  const {
    section,
    unitSet,
    documentCode,
    moduleId,
    sourcePackageId,
    firstOrder,
    slReferenceCatalog,
    silRecommendationSectionStatus,
  } = input;
  const authority = {
    candidateOnly: true,
    canDecideApplicability: false,
    canCreateEvidenceRef: false,
    canCreateClosureDecision: false,
    canCreateActionReadiness: false,
  };
  const windowId = `NSW-${sha256Hex(
    jcsCanonicalize({
      namespace: 'wiselink-native-section-window-v1',
      sourcePackageId,
      family: section.family,
      sectionKey: section.sectionKey,
      occurrence: section.occurrence,
      sourceUnitIds: section.bodyUnits.map((unit) => unit.sourceUnitId),
    }),
  )
    .slice(0, 24)
    .toUpperCase()}`;
  const scope = {
    ...(section.nodeKind ? { nodeKind: section.nodeKind } : {}),
    ...(section.scopeKey ? { scopeKey: section.scopeKey } : {}),
    ...(section.ordinal ? { ordinal: section.ordinal } : {}),
  };
  const sectionContinuityPrefix = section.scopeKey
    ? `section:${section.family}:${section.scopeKey}:${section.sectionKey}:${section.occurrence}`
    : `section:${section.family}:${section.sectionKey}:${section.occurrence}`;
  const units = [
    buildStructuredObservationContentUnit({
      sourcePackageId,
      moduleId,
      order: firstOrder,
      continuityKey: `${sectionContinuityPrefix}:anchor`,
      sourceRefIds: section.headingUnit.sourceRefIds,
      sourceSegmentIds: [section.headingUnit.sourceUnitId],
      payload: {
        observationType: 'SECTION_ANCHOR',
        value: {
          family: section.family,
          sectionKey: section.sectionKey,
          occurrence: section.occurrence,
          matchedHeading: section.matchedHeading,
          ...scope,
        },
        authority,
      },
    }),
    buildStructuredObservationContentUnit({
      sourcePackageId,
      moduleId,
      order: firstOrder + 1,
      continuityKey: `${sectionContinuityPrefix}:window`,
      sourceRefIds: section.sourceRefIds,
      sourceSegmentIds:
        section.bodyUnits.length > 0
          ? section.bodyUnits.map((unit) => unit.sourceUnitId)
          : [section.headingUnit.sourceUnitId],
      payload: {
        observationType: 'SECTION_WINDOW',
        value: {
          windowId,
          family: section.family,
          sectionKey: section.sectionKey,
          occurrence: section.occurrence,
          semanticBodyState: section.semanticBodyState,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          ...scope,
        },
        authority,
      },
    }),
  ];
  const aeoEffectivity = buildSourceBoundAeoEffectivity(section);
  if (aeoEffectivity) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:aeo-effectivity-groups`,
        sourceRefIds: sourceBoundIds(
          aeoEffectivity.groups.flatMap((group) => group.sourceRefIds),
          section.sourceRefIds,
        ),
        sourceSegmentIds: sourceBoundIds(
          aeoEffectivity.groups.flatMap((group) => group.sourceUnitIds),
          section.bodyUnits.map((unit) => unit.sourceUnitId),
        ),
        payload: {
          observationType: 'AEO_EFFECTIVITY_GROUPS',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...aeoEffectivity,
          },
          authority,
        },
      }),
    );
  }
  const aeoProcedure = buildSourceBoundAeoProcedure(section);
  if (aeoProcedure) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:aeo-procedure-graph`,
        sourceRefIds: sourceBoundIds([
          ...aeoProcedure.actions.flatMap((action) => action.sourceRefIds),
          ...aeoProcedure.branches.flatMap((branch) => branch.sourceRefIds),
          ...aeoProcedure.references.flatMap(
            (reference) => reference.sourceRefIds,
          ),
        ], section.sourceRefIds),
        sourceSegmentIds: sourceBoundIds([
          ...aeoProcedure.actions.flatMap((action) => action.sourceUnitIds),
          ...aeoProcedure.branches.flatMap((branch) => branch.sourceUnitIds),
          ...aeoProcedure.references.flatMap(
            (reference) => reference.sourceUnitIds,
          ),
        ], section.bodyUnits.map((unit) => unit.sourceUnitId)),
        payload: {
          observationType: 'AEO_PROCEDURE_GRAPH',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...aeoProcedure,
          },
          authority,
        },
      }),
    );
  }
  const aeoSoftwareControl = buildSourceBoundAeoSoftwareControl(section);
  if (aeoSoftwareControl) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:aeo-software-control`,
        sourceRefIds: sourceBoundIds([
          ...aeoSoftwareControl.assignments.flatMap(
            (assignment) => assignment.sourceRefIds,
          ),
          ...aeoSoftwareControl.invalidSoftwareParts.flatMap(
            (part) => part.sourceRefIds,
          ),
        ], section.sourceRefIds),
        sourceSegmentIds: sourceBoundIds([
          ...aeoSoftwareControl.assignments.flatMap(
            (assignment) => assignment.sourceUnitIds,
          ),
          ...aeoSoftwareControl.invalidSoftwareParts.flatMap(
            (part) => part.sourceUnitIds,
          ),
        ], section.bodyUnits.map((unit) => unit.sourceUnitId)),
        payload: {
          observationType: 'AEO_SOFTWARE_CONTROL',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...aeoSoftwareControl,
          },
          authority,
        },
      }),
    );
  }
  const aeoSafetyBoundary = buildSourceBoundAeoSafetyBoundary(section);
  if (aeoSafetyBoundary) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:aeo-safety-boundary`,
        sourceRefIds: sourceBoundIds(
          aeoSafetyBoundary.items.flatMap((item) => item.sourceRefIds),
          section.sourceRefIds,
        ),
        sourceSegmentIds: sourceBoundIds(
          aeoSafetyBoundary.items.flatMap((item) => item.sourceUnitIds),
          section.bodyUnits.map((unit) => unit.sourceUnitId),
        ),
        payload: {
          observationType: 'AEO_SAFETY_BOUNDARY',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...aeoSafetyBoundary,
          },
          authority,
        },
      }),
    );
  }
  if (
    section.family === 'SB' &&
    section.scopeKey === 'retrofit_information_letter' &&
    section.sectionKey === 'general_evaluation'
  ) {
    const chrome = buildSourceBoundRilPageChrome(unitSet);
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: 'section:SB:retrofit_information_letter:page-chrome',
        sourceRefIds: chrome.sourceRefIds,
        sourceSegmentIds: chrome.sourceUnitIds,
        payload: {
          observationType: 'RIL_PAGE_CHROME',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            ...chrome,
          },
          authority,
        },
      }),
    );
  }
  const rilEvaluation = buildSourceBoundRilGeneralEvaluation(section, unitSet);
  if (rilEvaluation) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:ril-general-evaluation`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds: section.bodyUnits.map((unit) => unit.sourceUnitId),
        payload: {
          observationType: 'RIL_GENERAL_EVALUATION',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...rilEvaluation,
          },
          authority,
        },
      }),
    );
  }
  const rilReferences = buildSourceBoundRilDocumentReferences(
    section,
    documentCode,
    unitSet,
  );
  if (rilReferences) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:ril-document-references`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds: section.bodyUnits.map((unit) => unit.sourceUnitId),
        payload: {
          observationType: 'RIL_DOCUMENT_REFERENCES',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...rilReferences,
          },
          authority,
        },
      }),
    );
  }
  const rilProcedure = buildSourceBoundRilProcedure(section, unitSet);
  if (rilProcedure) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:ril-procedure`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds: section.bodyUnits.map((unit) => unit.sourceUnitId),
        payload: {
          observationType: 'RIL_RETROFIT_PROCEDURE',
          value: {
            family: section.family,
            scopeKey: section.scopeKey,
            sectionKey: section.sectionKey,
            ...rilProcedure,
          },
          authority,
        },
      }),
    );
  }
  const concurrentRequirements =
    buildSourceBoundConcurrentRequirements(section);
  if (concurrentRequirements) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey:
          `section:${section.family}:${section.scopeKey ?? 'document'}:` +
          `${section.sectionKey}:${section.occurrence}:concurrent-requirements`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'CONCURRENT_REQUIREMENTS',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            occurrence: section.occurrence,
            ...concurrentRequirements,
          },
          authority,
        },
      }),
    );
  }
  const adObligations = buildSourceBoundAdObligations(section);
  if (adObligations) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:ad-obligations`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'AD_OBLIGATIONS',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            sectionOrdinal: section.ordinal ?? null,
            semanticState: adObligations.semanticState,
            obligationsStructured: adObligations.obligationsStructured,
            unstructuredReason: adObligations.unstructuredReason,
            obligationCount: adObligations.obligations.length,
          },
          authority,
        },
      }),
    );
  }
  for (const obligation of adObligations?.obligations ?? []) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey:
          `${sectionContinuityPrefix}:ad-obligation:` + obligation.itemOrdinal,
        sourceRefIds: obligation.sourceRefIds,
        sourceSegmentIds: obligation.sourceUnitIds,
        payload: {
          observationType: 'AD_OBLIGATION',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            sectionOrdinal: section.ordinal ?? null,
            ...obligation,
          },
          authority,
        },
      }),
    );
  }
  const adRelations = buildSourceBoundAdDocumentRelations(section);
  if (adRelations) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:ad-document-relations`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'AD_DOCUMENT_RELATIONS',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            sectionOrdinal: section.ordinal ?? null,
            ...adRelations,
          },
          authority,
        },
      }),
    );
  }
  if (section.family === 'SL' && section.sectionKey === 'references') {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:sl-reference-catalog`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'SL_REFERENCE_CATALOG',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            semanticState:
              slReferenceCatalog?.semanticState ?? section.semanticBodyState,
            referencesStructured:
              slReferenceCatalog?.referencesStructured ?? false,
            unstructuredReason:
              slReferenceCatalog === null
                ? 'NO_REFERENCE_ENTRIES'
                : slReferenceCatalog.unstructuredReason,
            entries: slReferenceCatalog?.entries ?? [],
          },
          authority,
        },
      }),
    );
  }
  const slReferenceRelations = buildSourceBoundSlReferenceRelations(
    section,
    slReferenceCatalog,
  );
  if (slReferenceRelations) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:sl-reference-relations`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'SL_REFERENCE_RELATIONS',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            ...slReferenceRelations,
          },
          authority,
        },
      }),
    );
  }
  const slAction = buildSourceBoundSlAction(section);
  if (slAction) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:sl-action`,
        sourceRefIds: slAction.sourceRefIds,
        sourceSegmentIds: slAction.sourceUnitIds,
        payload: {
          observationType: 'SL_ACTION',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            ...slAction,
          },
          authority,
        },
      }),
    );
  }
  const silPartNumberMatrix = buildSourceBoundSilPartNumberMatrix(section);
  if (silPartNumberMatrix) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:sil-part-number-matrix`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'SIL_PART_NUMBER_MATRIX',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            ...silPartNumberMatrix,
          },
          authority,
        },
      }),
    );
  }
  const silDocumentReferences = buildSourceBoundSilDocumentReferences(section);
  if (silDocumentReferences) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey: `${sectionContinuityPrefix}:sil-document-references`,
        sourceRefIds: section.sourceRefIds,
        sourceSegmentIds:
          section.bodyUnits.length > 0
            ? section.bodyUnits.map((unit) => unit.sourceUnitId)
            : [section.headingUnit.sourceUnitId],
        payload: {
          observationType: 'SIL_DOCUMENT_REFERENCES',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            sectionKey: section.sectionKey,
            ...silDocumentReferences,
          },
          authority,
        },
      }),
    );
  }
  if (
    silRecommendationSectionStatus &&
    section.family === 'SIL' &&
    section.sectionKey === 'revision_history'
  ) {
    units.push(
      buildStructuredObservationContentUnit({
        sourcePackageId,
        moduleId,
        order: firstOrder + units.length,
        continuityKey:
          'section:SIL:service_information_letter:recommendation-section-status',
        sourceRefIds: silRecommendationSectionStatus.sourceRefIds,
        sourceSegmentIds: silRecommendationSectionStatus.sourceUnitIds,
        payload: {
          observationType: 'SIL_RECOMMENDATION_SECTION_STATUS',
          value: {
            family: section.family,
            scopeKey: section.scopeKey ?? 'document',
            ...silRecommendationSectionStatus,
          },
          authority,
        },
      }),
    );
  }
  return units;
}

function buildStructuredObservationContentUnit(input: {
  sourcePackageId: string;
  moduleId: string;
  order: number;
  continuityKey: string;
  sourceRefIds: readonly string[];
  sourceSegmentIds: readonly string[];
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const kind = 'paragraph';
  const unitId = techpubEntityId(
    'unit',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-unit-id-v1',
        sourcePackageId: input.sourcePackageId,
        moduleAnchorKey: 'logical-document',
        sourceAnchorKey: input.continuityKey,
        kind,
      }),
    ),
  );
  const contentUnitWithoutHash: Record<string, unknown> = {
    unitId,
    continuityKey: input.continuityKey,
    moduleId: input.moduleId,
    kind,
    identityStability: 'revision_scoped',
    order: input.order,
    depth: 0,
    sourceRefIds: [...input.sourceRefIds],
    sourceSegmentIds: [...input.sourceSegmentIds],
    mapping: {
      status: 'mapped_with_normalization',
      confidence: 'deterministic',
      findingIds: [],
    },
    payload: {
      text: JSON.stringify(input.payload),
      role: 'body',
    },
  };
  return {
    unitId,
    continuityKey: input.continuityKey,
    unitHash: `sha256:${sha256Hex(jcsCanonicalize(contentUnitWithoutHash))}`,
    ...Object.fromEntries(
      Object.entries(contentUnitWithoutHash).filter(
        ([key]) => key !== 'unitId' && key !== 'continuityKey',
      ),
    ),
  };
}

/**
 * Recognize the actual 737-34-3830 Boeing SB line-list form without widening
 * its scope. The 308 singleton values become two bounded `in` predicates and
 * all 242 source ranges remain exact inclusive `range` predicates. Three
 * nested `any` groups keep the single source-bound candidate below the Host's
 * 200-value / 100-child / 500-node contract limits without truncating gaps.
 *
 * The installed P/N is accepted only when the fixed left-to-right table
 * header and all three row lines agree on the new/existing column ordering.
 * Missing, duplicated, reordered, overlapping, or ambiguous evidence yields
 * an empty applicability block.
 */
function buildBoeingSbDeterministicApplicability(
  unitSet: SourceUnitSet,
  moduleId: string,
  refsById: ReadonlyMap<string, SourceUnitSet['sourceRefs'][number]>,
): StructuredApplicability {
  const observations = collectBoeingSbApplicabilityObservations(
    unitSet,
    refsById,
  );
  if (observations.length !== 1) return emptyApplicability();

  const observation = observations[0];
  return buildBoeingModelLineStructuredApplicability({
    moduleId,
    evidenceUnits: [
      ...observation.effectivityEvidenceUnits,
      ...observation.partNumberEvidenceUnits,
    ],
    models: ['737-8', '737-9', '737-8200'],
    lineObservations: observation.lineObservations,
    preserveSourceLineTokens: false,
    additionalPredicates: [
      {
        operator: 'predicate',
        predicate: {
          property: 'pnInstalled',
          comparator: 'eq',
          values: [observation.existingPartNumber],
        },
      },
    ],
  });
}

/**
 * Recognize only the native-text effectivity form proven by actual
 * 777-34-0425 bytes. The exact document/profile guard is applied by the
 * caller; every expected source line must be contiguous, uniquely bound to
 * page 7, ordered, and accompanied by the source's through/inclusive rule.
 * The later AIMS group table is intentionally not a configuration predicate:
 * the effectivity sentence itself assigns all listed airplanes to one group.
 */
function buildBoeing777SbDeterministicApplicability(
  unitSet: SourceUnitSet,
  moduleId: string,
  refsById: ReadonlyMap<string, SourceUnitSet['sourceRefs'][number]>,
): StructuredApplicability {
  const observations = collectBoeing777SbApplicabilityObservations(
    unitSet,
    refsById,
  );
  if (observations.length !== 1) return emptyApplicability();
  const observation = observations[0];
  return buildBoeingModelLineStructuredApplicability({
    moduleId,
    evidenceUnits: observation.effectivityEvidenceUnits,
    models: observation.models,
    lineObservations: observation.lineObservations,
    preserveSourceLineTokens: true,
    additionalPredicates: [],
  });
}

function buildBoeingModelLineStructuredApplicability(input: {
  moduleId: string;
  evidenceUnits: readonly SourceUnit[];
  models: readonly string[];
  lineObservations: readonly BoeingSbLineObservation[];
  preserveSourceLineTokens: boolean;
  additionalPredicates: readonly StructuredApplicabilityExpression[];
}): StructuredApplicability {
  const evidenceUnits = uniqueSourceUnits(input.evidenceUnits);
  const sourceRefIds = uniqueText(
    evidenceUnits.flatMap((unit) => [...unit.sourceRefIds]),
  );
  const sourceText = evidenceUnits.map((unit) => unit.text).join('\n');
  const expressionId = techpubEntityId(
    'applicability-source',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-applicability-source-id-v1',
        sourceUnitIds: evidenceUnits.map((unit) => unit.sourceUnitId),
        sourceRefIds,
        text: sourceText,
      }),
    ),
  );
  const lineSpecs = input.lineObservations.flatMap((line) => line.specs);
  const lineExpression = input.preserveSourceLineTokens
    ? sourceTokenLineNumberExpression(lineSpecs)
    : lineNumberExpression(lineSpecs);
  if (!lineExpression) return emptyApplicability();
  const normalizedExpression: StructuredApplicabilityExpression = {
    operator: 'all',
    children: [
      {
        operator: 'predicate',
        predicate: {
          property: 'model',
          comparator: 'in',
          values: [...input.models],
        },
      },
      lineExpression,
      ...input.additionalPredicates,
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
    targetId: input.moduleId,
    sourceRefIds,
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
        text: sourceText,
        form: 'logical_expression',
        authority: 'source_asserted',
        sourceRefIds,
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

function collectBoeing777SbApplicabilityObservations(
  unitSet: SourceUnitSet,
  refsById: ReadonlyMap<string, SourceUnitSet['sourceRefs'][number]>,
): BoeingSbModelLineApplicabilityObservation[] {
  const observations: BoeingSbModelLineApplicabilityObservation[] = [];
  const units = unitSet.units;
  const models = ['777-200', '777-200LR', '777-300', '777-300ER', '777F'];
  const modelText =
    'This bulletin is applicable to 777-200, 777-200LR, 777-300, 777-300ER, 777F Airplane(s), line';
  const expectedLineTokenCounts = [7, 8, 10, 8, 9, 10];
  for (let index = 2; index < units.length - 8; index += 1) {
    const modelUnit = units[index];
    if (modelUnit.text !== modelText) continue;
    const effectivityHeading = units[index - 2];
    const airplanesHeading = units[index - 1];
    const lineUnits = units.slice(index + 1, index + 7);
    const inclusiveEvidenceUnits = units.slice(index + 7, index + 9);
    const evidenceUnits = units.slice(index - 2, index + 9);
    if (
      effectivityHeading.text !== 'A.Effectivity' ||
      airplanesHeading.text !== '1.Airplanes' ||
      lineUnits.length !== 6 ||
      inclusiveEvidenceUnits.length !== 2 ||
      evidenceUnits.length !== 11 ||
      evidenceUnits.some(
        (unit, offset) => unit.order !== effectivityHeading.order + offset,
      ) ||
      inclusiveEvidenceUnits[0].text !==
        'Where the effectivity is presented with hyphens between line numbers, the airplane applicability' ||
      inclusiveEvidenceUnits[1].text !==
        'means "through" and "inclusive", e.g. line numbers 1-9 means line numbers 1 through 9 inclusive.'
    ) {
      continue;
    }
    const evidenceRefs = evidenceUnits.map((unit) =>
      sourceRefForUnit(unit, refsById),
    );
    const evidencePage = evidenceRefs[0]?.pageStart;
    if (
      evidencePage === undefined ||
      evidenceRefs.some(
        (sourceRef, offset) =>
          !sourceRef ||
          sourceRef.pageStart !== evidencePage ||
          sourceRef.pageEnd !== evidencePage ||
          sourceRef.quote !== evidenceUnits[offset].text,
      )
    ) {
      continue;
    }

    const lineObservations: BoeingSbLineObservation[] = [];
    let previousEnd = -1;
    let invalid = false;
    for (let offset = 0; offset < lineUnits.length; offset += 1) {
      const unit = lineUnits[offset];
      const specs = parseBoeing777LineNumberSpecs(unit.text, {
        first: offset === 0,
        terminal: offset === lineUnits.length - 1,
      });
      if (
        !specs ||
        specs.length !== expectedLineTokenCounts[offset] ||
        specs[0].start <= previousEnd
      ) {
        invalid = true;
        break;
      }
      for (const spec of specs) {
        if (spec.start <= previousEnd) {
          invalid = true;
          break;
        }
        previousEnd = spec.end;
      }
      if (invalid) break;
      lineObservations.push({ unit, specs });
    }
    const allSpecs = lineObservations.flatMap((line) => line.specs);
    const singletonCount = allSpecs.filter(
      (spec) => spec.start === spec.end,
    ).length;
    const rangeCount = allSpecs.length - singletonCount;
    const expandedCount = allSpecs.reduce(
      (count, spec) => count + spec.end - spec.start + 1,
      0,
    );
    if (
      invalid ||
      lineObservations.length !== 6 ||
      allSpecs.length !== 52 ||
      singletonCount !== 12 ||
      rangeCount !== 40 ||
      expandedCount !== 1783 ||
      allSpecs[0]?.start !== 1 ||
      allSpecs.at(-1)?.end !== 1834
    ) {
      continue;
    }
    observations.push({
      effectivityEvidenceUnits: evidenceUnits,
      models: [...models],
      lineObservations,
    });
  }
  return observations;
}

function collectBoeingSbApplicabilityObservations(
  unitSet: SourceUnitSet,
  refsById: ReadonlyMap<string, SourceUnitSet['sourceRefs'][number]>,
): BoeingSbApplicabilityObservation[] {
  const observations: BoeingSbApplicabilityObservation[] = [];
  const units = unitSet.units;
  for (let index = 2; index < units.length; index += 1) {
    const modelUnit = units[index];
    const prefix =
      'This bulletin is applicable to 737-8, 737-9, 737-8200 Airplane(s), line number(s) ';
    if (!modelUnit.text.startsWith(prefix)) continue;
    const effectivityHeading = units[index - 2];
    const airplanesHeading = units[index - 1];
    if (
      effectivityHeading.text !== 'A.Effectivity' ||
      airplanesHeading.text !== '1.Airplanes' ||
      airplanesHeading.order !== effectivityHeading.order + 1 ||
      modelUnit.order !== airplanesHeading.order + 1
    ) {
      continue;
    }
    const headingRef = sourceRefForUnit(effectivityHeading, refsById);
    const airplanesRef = sourceRefForUnit(airplanesHeading, refsById);
    const modelRef = sourceRefForUnit(modelUnit, refsById);
    if (
      !headingRef ||
      !airplanesRef ||
      !modelRef ||
      headingRef.pageStart !== modelRef.pageStart ||
      airplanesRef.pageStart !== modelRef.pageStart
    ) {
      continue;
    }
    const firstSpecs = parseBoeingLineNumberSpecs(
      modelUnit.text.slice(prefix.length),
      false,
    );
    if (!firstSpecs) continue;

    const lineObservations: BoeingSbLineObservation[] = [
      { unit: modelUnit, specs: firstSpecs },
    ];
    let previousEnd = firstSpecs[firstSpecs.length - 1].end;
    let reachedTerminator = false;
    let terminatorIndex = -1;
    let invalid = false;
    let sawPageFooter = false;
    for (
      let cursor = index + 1;
      cursor < units.length && cursor <= index + 100;
      cursor += 1
    ) {
      const unit = units[cursor];
      const sourceRef = sourceRefForUnit(unit, refsById);
      if (!sourceRef) {
        invalid = true;
        break;
      }
      const isTerminator = unit.text.endsWith(' in 1');
      const specs = parseBoeingLineNumberSpecs(unit.text, isTerminator);
      if (specs) {
        if (
          sourceRef.pageStart < modelRef.pageStart ||
          sourceRef.pageStart > modelRef.pageStart + 1 ||
          specs[0].start <= previousEnd ||
          (sawPageFooter && sourceRef.pageStart === modelRef.pageStart)
        ) {
          invalid = true;
          break;
        }
        for (const spec of specs) {
          if (spec.start <= previousEnd) {
            invalid = true;
            break;
          }
          previousEnd = spec.end;
        }
        if (invalid) break;
        lineObservations.push({ unit, specs });
        if (isTerminator) {
          reachedTerminator = true;
          terminatorIndex = cursor;
          if (sourceRef.pageStart !== modelRef.pageStart + 1) invalid = true;
          break;
        }
        continue;
      }
      if (
        sourceRef.pageStart === modelRef.pageStart &&
        isBoeingPageFooter(unit.text)
      ) {
        sawPageFooter = true;
        continue;
      }
      invalid = true;
      break;
    }
    const allSpecs = lineObservations.flatMap((line) => line.specs);
    const singletonCount = allSpecs.filter(
      (spec) => spec.start === spec.end,
    ).length;
    const rangeCount = allSpecs.length - singletonCount;
    const expandedCount = allSpecs.reduce(
      (count, spec) => count + spec.end - spec.start + 1,
      0,
    );
    const linePageCounts = lineObservations.reduce((counts, line) => {
      const page = sourceRefForUnit(line.unit, refsById)?.pageStart;
      if (page !== undefined) counts.set(page, (counts.get(page) ?? 0) + 1);
      return counts;
    }, new Map<number, number>());
    if (
      invalid ||
      !reachedTerminator ||
      lineObservations.length !== 52 ||
      linePageCounts.size !== 2 ||
      linePageCounts.get(modelRef.pageStart) !== 35 ||
      linePageCounts.get(modelRef.pageStart + 1) !== 17 ||
      allSpecs.length !== 550 ||
      singletonCount !== 308 ||
      rangeCount !== 242 ||
      expandedCount !== 2468 ||
      allSpecs[0]?.start !== 5602 ||
      allSpecs.at(-1)?.end !== 9820
    ) {
      continue;
    }

    const inclusiveEvidenceUnits = units.slice(
      terminatorIndex + 1,
      terminatorIndex + 4,
    );
    const inclusiveEvidenceRefs = inclusiveEvidenceUnits.map((unit) =>
      sourceRefForUnit(unit, refsById),
    );
    if (
      inclusiveEvidenceUnits.length !== 3 ||
      inclusiveEvidenceUnits[0].text !==
        'Group(s). Where the effectivity is presented with hyphens between line numbers, the airplane' ||
      inclusiveEvidenceUnits[1].text !==
        'applicability means "through" and "inclusive", e.g. line numbers 1-9 means line numbers 1 through' ||
      inclusiveEvidenceUnits[2].text !== '9 inclusive.' ||
      inclusiveEvidenceUnits.some(
        (unit, offset) =>
          unit.order !== units[terminatorIndex].order + offset + 1,
      ) ||
      inclusiveEvidenceRefs.some(
        (sourceRef) =>
          !sourceRef || sourceRef.pageStart !== modelRef.pageStart + 1,
      )
    ) {
      continue;
    }

    const partNumberObservations = collectBoeingExistingPartNumberEvidence(
      units,
      refsById,
      index,
    );
    if (partNumberObservations.length !== 1) continue;
    observations.push({
      effectivityEvidenceUnits: [
        effectivityHeading,
        airplanesHeading,
        ...lineObservations.map((line) => line.unit),
        ...inclusiveEvidenceUnits,
      ],
      lineObservations,
      ...partNumberObservations[0],
    });
  }
  return observations;
}

function collectBoeingExistingPartNumberEvidence(
  units: SourceUnitSet['units'],
  refsById: ReadonlyMap<string, SourceUnitSet['sourceRefs'][number]>,
  afterIndex: number,
): Array<{
  partNumberEvidenceUnits: SourceUnit[];
  existingPartNumber: string;
}> {
  const observations: Array<{
    partNumberEvidenceUnits: SourceUnit[];
    existingPartNumber: string;
  }> = [];
  for (let index = afterIndex + 1; index < units.length - 4; index += 1) {
    const header = units[index];
    if (
      header.text !== 'Part Number / Specifica-QTYNameExisting Part NumberNotes'
    ) {
      continue;
    }
    const headerContinuation = units[index + 1];
    const partNumberRow = units[index + 2];
    const modelRow = units[index + 3];
    const manufacturerPartNumberRow = units[index + 4];
    const partNumberMatch = partNumberRow.text.match(
      /^(\d{2}-\d{5}-\d{3}) \(GE model2FLIGHT MANAGEMENT(\d{2}-\d{5}-\d{3}) \(GE model\(a\)\(b\)\(c\)\(d\)\(e\)\(f\)\(g\)\(h\)$/u,
    );
    const modelMatch = modelRow.text.match(
      /^number ([A-Z0-9]+), GE partCOMPUTERnumber ([A-Z0-9]+), GE part$/u,
    );
    const manufacturerPartNumberMatch = manufacturerPartNumberRow.text.match(
      /^number (\d{6}-\d{2}-\d{2})\)number (\d{6}-\d{2}-\d{2})\)$/u,
    );
    const context = units.slice(Math.max(afterIndex + 1, index - 10), index);
    const sections = context.filter(
      (unit) => unit.text === 'C.Parts Necessary for Each Airplane',
    );
    const operatorPartsHeadings = context.filter(
      (unit) => unit.text === '2.Parts and Materials Supplied by the Operator',
    );
    const section = sections[0];
    const operatorParts = operatorPartsHeadings[0];
    const evidenceUnits = [
      section,
      operatorParts,
      header,
      headerContinuation,
      partNumberRow,
      modelRow,
      manufacturerPartNumberRow,
    ];
    if (
      headerContinuation.text !== 'tion' ||
      !partNumberMatch ||
      !modelMatch ||
      !manufacturerPartNumberMatch ||
      sections.length !== 1 ||
      operatorPartsHeadings.length !== 1 ||
      context.indexOf(section) >= context.indexOf(operatorParts) ||
      partNumberMatch[1] === partNumberMatch[2] ||
      modelMatch[1] === modelMatch[2] ||
      manufacturerPartNumberMatch[1] === manufacturerPartNumberMatch[2] ||
      evidenceUnits.some((unit) => !unit)
    ) {
      continue;
    }
    const boundEvidenceUnits = evidenceUnits as SourceUnit[];
    const evidenceRefs = boundEvidenceUnits.map((unit) =>
      sourceRefForUnit(unit, refsById),
    );
    if (
      evidenceRefs.some((sourceRef) => !sourceRef) ||
      evidenceRefs.some(
        (sourceRef) =>
          sourceRef!.pageStart !== evidenceRefs[0]!.pageStart ||
          sourceRef!.pageEnd !== sourceRef!.pageStart,
      )
    ) {
      continue;
    }
    observations.push({
      partNumberEvidenceUnits: boundEvidenceUnits,
      existingPartNumber: partNumberMatch[2],
    });
  }
  return observations;
}

function parseBoeing777LineNumberSpecs(
  value: string,
  position: { first: boolean; terminal: boolean },
): BoeingSbLineNumberSpec[] | null {
  const prefix = 'number(s) ';
  const suffix = ' in 1 Group(s).';
  let listText = value;
  if (position.first) {
    if (!listText.startsWith(prefix)) return null;
    listText = listText.slice(prefix.length);
  } else if (listText.startsWith(prefix)) {
    return null;
  }
  if (position.terminal) {
    if (!listText.endsWith(suffix)) return null;
    listText = listText.slice(0, -suffix.length);
  } else {
    if (!listText.endsWith(',') || listText.endsWith(suffix)) return null;
    listText = listText.slice(0, -1);
  }
  if (!listText) return null;
  const tokens = listText.split(', ');
  if (tokens.length === 0 || tokens.length > 100) return null;
  const specs: BoeingSbLineNumberSpec[] = [];
  let previousEnd = -1;
  for (const token of tokens) {
    const match = token.match(/^([1-9]\d{0,3})(?:-([1-9]\d{0,3}))?$/u);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      end < start ||
      start <= previousEnd
    ) {
      return null;
    }
    specs.push({ start, end });
    previousEnd = end;
  }
  return specs;
}

function parseBoeingLineNumberSpecs(
  value: string,
  requireTerminator: boolean,
): BoeingSbLineNumberSpec[] | null {
  if (requireTerminator !== value.endsWith(' in 1')) return null;
  const listText = requireTerminator ? value.slice(0, -' in 1'.length) : value;
  const normalized = listText.endsWith(',') ? listText.slice(0, -1) : listText;
  if (!normalized) return null;
  const tokens = normalized.split(', ');
  if (tokens.length === 0 || tokens.length > 100) return null;
  const specs: BoeingSbLineNumberSpec[] = [];
  let previousEnd = -1;
  for (const token of tokens) {
    const match = token.match(/^(\d{4})(?:-(\d{4}))?$/u);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      end < start ||
      start <= previousEnd
    ) {
      return null;
    }
    specs.push({ start, end });
    previousEnd = end;
  }
  return specs;
}

function sourceTokenLineNumberExpression(
  specs: readonly BoeingSbLineNumberSpec[],
): StructuredApplicabilityExpression | null {
  if (specs.length === 0 || specs.length > 100) return null;
  return {
    operator: 'any',
    children: specs.map(
      (spec): StructuredApplicabilityExpression => ({
        operator: 'predicate',
        predicate: {
          property: 'lineNumber',
          comparator: spec.start === spec.end ? 'eq' : 'range',
          values:
            spec.start === spec.end ? [spec.start] : [spec.start, spec.end],
        },
      }),
    ),
  };
}

function lineNumberExpression(
  specs: readonly BoeingSbLineNumberSpec[],
): StructuredApplicabilityExpression | null {
  const singletons = specs
    .filter((spec) => spec.start === spec.end)
    .map((spec) => spec.start);
  const linePredicates: StructuredApplicabilityExpression[] = [];
  for (let index = 0; index < singletons.length; index += 200) {
    linePredicates.push({
      operator: 'predicate',
      predicate: {
        property: 'lineNumber',
        comparator: 'in',
        values: singletons.slice(index, index + 200),
      },
    });
  }
  for (const spec of specs) {
    if (spec.start === spec.end) continue;
    linePredicates.push({
      operator: 'predicate',
      predicate: {
        property: 'lineNumber',
        comparator: 'range',
        values: [spec.start, spec.end],
      },
    });
  }
  if (linePredicates.length === 0 || linePredicates.length > 297) return null;
  const groups: StructuredApplicabilityExpression[] = [];
  for (let index = 0; index < linePredicates.length; index += 99) {
    groups.push({
      operator: 'any',
      children: linePredicates.slice(index, index + 99),
    });
  }
  return { operator: 'any', children: groups };
}

function sourceRefForUnit(
  unit: SourceUnit,
  refsById: ReadonlyMap<string, SourceUnitSet['sourceRefs'][number]>,
): SourceUnitSet['sourceRefs'][number] | null {
  if (unit.sourceRefIds.length !== 1) return null;
  const sourceRef = refsById.get(unit.sourceRefIds[0]);
  if (
    !sourceRef ||
    sourceRef.pageStart !== sourceRef.pageEnd ||
    !sourceRef.quote.includes(unit.text)
  ) {
    return null;
  }
  return sourceRef;
}

function isBoeingPageFooter(value: string): boolean {
  return (
    /^Original Issue: .+$/u.test(value) ||
    /^\d{3}-\d{2}-\d{4}$/u.test(value) ||
    /^Export Controlled ECCN: [A-Z0-9]+$/u.test(value) ||
    /^BOEING PROPRIETARY - See page 1 for details\d+ of \d+$/u.test(value)
  );
}

function uniqueSourceUnits(values: readonly SourceUnit[]): SourceUnit[] {
  const seen = new Set<string>();
  return values.filter((unit) => {
    if (seen.has(unit.sourceUnitId)) return false;
    seen.add(unit.sourceUnitId);
    return true;
  });
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function emptyApplicability(): StructuredApplicability {
  return { sourceExpressions: [], normalizedCandidates: [], assignments: [] };
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sourceBoundIds(
  primary: readonly string[],
  fallback: readonly string[],
): string[] {
  const values = uniqueStrings(primary);
  return values.length > 0 ? values : uniqueStrings(fallback);
}
