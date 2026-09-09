import { z } from 'zod/v4';
import type {
  TranslationBlockCandidateV2,
  TranslationBlockCheckV2,
  TranslationBlockDependenciesV2,
  TranslationBlockProvenanceV2,
  TranslationGenerationRequestV2,
  TranslationResultManifestV2,
  TranslationSourcePlanV2,
  TranslationBlockRevisionV2,
  BilingualTranslationArtifactV2,
} from '@shared/canonical-translation-v2.interface';

export const TRANSLATION_V2_METHOD_VERSION = 'semantic-translation@2.0';
export const TRANSLATION_V2_PROMPT_VERSION =
  'wiselink-translation-block@r09.c49';
export const TRANSLATION_V2_TASK_SCHEMA = 'wiselink.3_1.translation_task.v2';

const id = z.string().min(1).max(512);
const positive = z.number().int().positive();
const ordinal = z.number().int().nonnegative();
const text = z.string().refine((value) => value.trim().length > 0);
const record = z.record(z.string(), z.unknown());
const timestamp = z.string().datetime();
const artifact = z.strictObject({
  storeRole: z.literal('UnifiedArtifactStoreCandidate'),
  ref: text,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteLength: positive,
  mediaType: z.literal('application/json'),
});
const locator = z
  .strictObject({
    sourceRefId: id,
    kind: text,
    artifactId: z.string().nullable(),
    pageStart: z.number().int().nullable(),
    pageEnd: z.number().int().nullable(),
    charStart: z.number().int().nullable(),
    charEnd: z.number().int().nullable(),
    charOffsetUnit: z.string().nullable(),
    normalizedPath: z.string().nullable(),
    xpath: z.string().nullable(),
    elementId: z.string().nullable(),
    quote: z.string().nullable(),
    bbox: z.array(z.number()).nullable(),
  })
  .transform((value) => ({
    ...value,
    artifactId: value.artifactId ?? null,
    pageStart: value.pageStart ?? null,
    pageEnd: value.pageEnd ?? null,
    charStart: value.charStart ?? null,
    charEnd: value.charEnd ?? null,
    charOffsetUnit: value.charOffsetUnit ?? null,
    normalizedPath: value.normalizedPath ?? null,
    xpath: value.xpath ?? null,
    elementId: value.elementId ?? null,
    quote: value.quote ?? null,
    bbox: value.bbox ?? null,
  }));
export const translationIssueSchemaV2 = z.strictObject({
  code: text,
  severity: z.enum(['BLOCK', 'REVIEW', 'NOTE']),
  origin: z.enum(['SOURCE', 'TRANSLATION', 'OUTPUT_CONTRACT', 'SERVICE']),
  message: text,
  blockIds: z.array(id),
  anchorIds: z.array(id),
  sourceFindingId: id.optional(),
});
export const translationSourcePlanSchemaV2 = z.strictObject({
  schemaVersion: z.literal('wiselink.3_1.translation_source_plan.v2'),
  planRevision: positive,
  source: z.strictObject({
    documentVersionId: id,
    packageId: text,
    parsedArtifact: artifact,
  }),
  anchors: z.array(
    z.strictObject({
      anchorId: id,
      sourceUnitId: id,
      payloadPath: text,
      sourceText: text,
      sourceRefIds: z.array(id).min(1),
      sourceLocators: z.array(locator),
    }),
  ),
  blocks: z
    .array(
      z.strictObject({
        blockId: id,
        order: ordinal,
        kind: z.enum([
          'heading',
          'prose',
          'list',
          'step',
          'advisory',
          'table',
          'figure',
          'reference',
          'preserved_source',
        ]),
        moduleId: id,
        sourceUnitIds: z.array(id).min(1),
        anchorIds: z.array(id),
        sourceStructure: z.array(
          z.strictObject({ sourceUnitId: id, kind: text, payload: record }),
        ),
        contextBlockIds: z.array(id),
        requiredTogetherBlockIds: z.array(id),
        sourceCharacterCount: ordinal,
        sourceIssues: z.array(translationIssueSchemaV2),
        organization: z.enum([
          'ORIGINAL_UNIT',
          'ADJACENT_PROSE_CONTEXT',
          'EXPLICIT_LIST',
          'EXPLICIT_TABLE_CONTINUATION',
        ]),
      }),
    )
    .min(1),
  inventory: z
    .array(
      z.strictObject({
        sourceUnitId: id,
        blockId: id,
        anchorIds: z.array(id),
        sourceCharacterCount: ordinal,
        textAvailability: z.enum([
          'TEXT_AVAILABLE',
          'STRUCTURE_ONLY',
          'SOURCE_REVIEW_REQUIRED',
        ]),
      }),
    )
    .min(1),
  documentContext: z.strictObject({
    revision: positive,
    title: text,
    outline: z.array(
      z.strictObject({
        blockId: id,
        anchorIds: z.array(id),
        level: positive,
      }),
    ),
    scopedConditions: z.array(
      z.strictObject({
        advisoryBlockId: id,
        targetBlockIds: z.array(id),
        anchorIds: z.array(id),
      }),
    ),
    references: z.array(record),
    conditionAnchorIds: z.array(id),
    definitionAnchorIds: z.array(id),
  }),
});
export const translationCandidateSchemaV2: z.ZodType<TranslationBlockCandidateV2> =
  z.strictObject({
    blockId: id,
    elements: z.array(
      z.strictObject({
        elementId: id,
        kind: z.enum([
          'paragraph',
          'heading',
          'list_item',
          'advisory',
          'table_cell',
          'caption',
          'label',
        ]),
        translatedText: text,
        anchorIds: z.array(id).min(1),
      }),
    ),
  });
export const translationDependenciesSchemaV2: z.ZodType<TranslationBlockDependenciesV2> =
  z.strictObject({
    planRevision: positive,
    contextRevision: positive,
    sourceAnchorIds: z.array(id),
    contextAnchorIds: z.array(id),
    methodVersion: text,
  });
export const translationProvenanceSchemaV2: z.ZodType<TranslationBlockProvenanceV2> =
  z
    .strictObject({
      authorKind: z.enum(['MODEL', 'ENGINEER']),
      authorUserId: text,
      executionModel: z
        .strictObject({
          modelRef: text,
          displayName: text,
          providerKind: z.enum(['BUILT_IN', 'CUSTOM']),
          settingsRevision: ordinal,
          selectedAt: timestamp,
        })
        .nullable(),
      modelVersion: text.nullable(),
      skillVersion: text.nullable(),
      promptVersion: text.nullable(),
      generationRequestRef: id,
      originAttemptId: id.nullable(),
      providerRequestId: text.nullable(),
      usage: z.strictObject({
        inputTokens: ordinal.nullable(),
        outputTokens: ordinal.nullable(),
      }),
    })
    .transform((value) => ({
      ...value,
      executionModel: value.executionModel ?? null,
      modelVersion: value.modelVersion ?? null,
      skillVersion: value.skillVersion ?? null,
      promptVersion: value.promptVersion ?? null,
      originAttemptId: value.originAttemptId ?? null,
      providerRequestId: value.providerRequestId ?? null,
      usage: {
        inputTokens: value.usage.inputTokens ?? null,
        outputTokens: value.usage.outputTokens ?? null,
      },
    }));
export const translationCheckSchemaV2: z.ZodType<TranslationBlockCheckV2> = z
  .strictObject({
    schemaVersion: z.literal('wiselink.3_1.translation_block_check.v2'),
    checkVersion: text,
    issues: z.array(translationIssueSchemaV2),
    semanticCheck: z.enum(['NOT_REQUIRED', 'PENDING', 'COMPLETED']),
    semanticReview: translationProvenanceSchemaV2.nullable(),
  })
  .transform((value) => ({
    ...value,
    semanticReview: value.semanticReview ?? null,
  }));
export const translationGenerationSchemaV2: z.ZodType<TranslationGenerationRequestV2> =
  z
    .strictObject({
      generationRequestRef: id,
      clientRequestId: id,
      attemptId: id,
      leaseGeneration: positive,
      blockIds: z.array(id).min(1),
      dependencies: translationDependenciesSchemaV2,
      purpose: z.enum(['GENERATE', 'CORRECT', 'CHECK', 'CHECK_BATCH']),
      targetBlockRevisionId: id.nullable(),
      checkTargets: z
        .array(
          z.strictObject({
            blockId: id,
            blockRevisionId: id,
            rowVersion: positive,
          }),
        )
        .min(2)
        .max(32)
        .optional(),
      status: z.enum(['REGISTERED', 'SAVED', 'SUPERSEDED', 'FAILED']),
      registeredAt: timestamp,
      finishedAt: timestamp.nullable(),
      error: z
        .strictObject({
          origin: z.enum([
            'TRANSPORT',
            'UPSTREAM',
            'OUTPUT_CONTRACT',
            'SOURCE',
            'TRANSLATION',
          ]),
          code: text,
          outcome: z.enum(['KNOWN_FAILURE', 'GENERATION_UNKNOWN']),
          retryable: z.boolean(),
        })
        .nullable(),
    })
    .transform((value) => ({
      ...value,
      targetBlockRevisionId: value.targetBlockRevisionId ?? null,
      finishedAt: value.finishedAt ?? null,
      error: value.error ?? null,
    }));
export const translationManifestSchemaV2: z.ZodType<TranslationResultManifestV2> =
  z.strictObject({
    workspaceId: id,
    planRevision: positive,
    contextRevision: positive,
    workspaceRowVersion: positive,
    blockRevisions: z.array(
      z.strictObject({
        blockId: id,
        blockRevisionId: id,
        contentRevision: positive,
      }),
    ),
  });

export const translationBlockRevisionSchemaV2: z.ZodType<TranslationBlockRevisionV2> =
  z
    .strictObject({
      blockRevisionId: id,
      workspaceId: id,
      blockId: id,
      planRevision: positive,
      contentRevision: positive,
      rowVersion: positive,
      candidate: translationCandidateSchemaV2,
      dependencies: translationDependenciesSchemaV2,
      provenance: translationProvenanceSchemaV2,
      generatedAt: timestamp.nullable(),
      savedAt: timestamp,
      check: translationCheckSchemaV2.nullable(),
      checkedAt: timestamp.nullable(),
      selectedForReading: z.boolean(),
    })
    .transform((value) => ({
      ...value,
      generatedAt: value.generatedAt ?? null,
      check: value.check ?? null,
      checkedAt: value.checkedAt ?? null,
    }));
export const translationReadingBlockSchemaV2 = z
  .strictObject({
    source: translationSourcePlanSchemaV2.shape.blocks.element,
    readingStatus: z.enum(['MISSING', 'PENDING_CHECK', 'READABLE', 'BLOCKED']),
    selected: translationBlockRevisionSchemaV2.nullable(),
    issues: z.array(translationIssueSchemaV2),
  })
  .transform((value) => ({ ...value, selected: value.selected ?? null }));
export const translationCoverageSchemaV2 = z.strictObject({
  registeredSourceCharacters: ordinal,
  savedSourceCharacters: ordinal,
  readableSourceCharacters: ordinal,
  sourceUnitCount: ordinal,
  unresolvedSourceUnitCount: ordinal,
  missingBlockCount: ordinal,
  pendingCheckBlockCount: ordinal,
  blockedBlockCount: ordinal,
});
export const bilingualTranslationArtifactSchemaV2: z.ZodType<BilingualTranslationArtifactV2> =
  z.strictObject({
    schemaVersion: z.literal('wiselink.3_1.bilingual_translation_artifact.v2'),
    candidateOnly: z.literal(true),
    source: translationSourcePlanSchemaV2.shape.source,
    methodVersion: text,
    manifest: translationManifestSchemaV2,
    completeness: z.enum(['PARTIAL', 'COMPLETE_WITH_ISSUES', 'COMPLETE']),
    anchors: translationSourcePlanSchemaV2.shape.anchors,
    blocks: z.array(translationReadingBlockSchemaV2).min(1),
    coverage: translationCoverageSchemaV2,
  });

export function parseTranslationJson<T>(
  json: string,
  schema: z.ZodType<T>,
  code: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(code);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(code);
  return parsed.data;
}

export const translationArtifactDescriptorSchema = artifact;
