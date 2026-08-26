import { createHash } from 'node:crypto';

import type {
  DocumentVersionUnifiedArtifactBinding,
  UnifiedParsedPackageArtifactRecord,
  UnifiedParsedPackageReadback,
} from './unified-parsed-package-reader';
import type {
  StructuredAssessmentContext,
  StructuredSourceBinding,
} from '@shared/assessment-host.interface';
import {
  readFrozenUnifiedParsedPackageForSbAssessment,
} from './unified-parsed-package-reader';

export const UNIFIED_ASSESSMENT_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid_assessment_input.v4';

interface UnifiedSourceRef {
  sourceRefId: string;
  artifactId: string;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  charOffsetUnit: string;
  quote: string;
  anchorTextHash: string;
  kind: string;
  bbox?: number[];
}

interface UnifiedContentUnit {
  unitId: string;
  unitHash: string;
  kind: string;
  sourceRefIds: string[];
  payload: Record<string, unknown>;
  continuityKey?: string;
  order?: number;
}

interface UnifiedPackage {
  sourceRefs: UnifiedSourceRef[];
  contentUnits: UnifiedContentUnit[];
  document: Record<string, any>;
  coverage: {
    summary: {
      accountingComplete: boolean;
      contentPreserved: boolean;
      structuredCoverageComplete: boolean;
    };
  };
}

interface NativeSectionWindow {
  heading: string;
  unit: UnifiedContentUnit;
  rawText: string;
}

export interface BuildUnifiedAssessmentInputOptions {
  documentVersionBinding: DocumentVersionUnifiedArtifactBinding;
  artifactBytes: Uint8Array;
  assessmentAsOf: string;
}

export function buildUnifiedSbJobAidAssessmentInput({
  documentVersionBinding,
  artifactBytes,
  assessmentAsOf,
}: BuildUnifiedAssessmentInputOptions): Record<string, unknown> {
  if (!Number.isFinite(Date.parse(assessmentAsOf))) {
    throw new Error('assessmentAsOf must be an ISO date or date-time.');
  }
  const readback = readFrozenUnifiedParsedPackageForSbAssessment(
    documentVersionBinding,
    artifactBytes,
  );
  const pkg = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(artifactBytes)) as UnifiedPackage;
  const refs = new Map(pkg.sourceRefs.map((ref) => [ref.sourceRefId, ref]));
  const document = pkg.document;
  const identifier = document.identifiers.find(
    (entry: Record<string, unknown>) => entry.scheme === 'oem_document_code',
  );
  const documentType = sourcedBinding({
    fieldPath: 'coreFields.documentFamily.value',
    value: 'SB',
    unitType: 'document_identity',
    sourceRefIds: document.documentType.sourceRefIds,
    refs,
  });
  const documentCode = sourcedBinding({
    fieldPath: 'coreFields.documentCode.value',
    value: readback.documentCode,
    unitType: 'document_identity',
    sourceRefIds: identifier.sourceRefIds,
    refs,
  });
  const title = sourcedBinding({
    fieldPath: 'coreFields.title.value',
    value: readback.title,
    unitType: 'document_identity',
    sourceRefIds: document.title.sourceRefIds,
    refs,
  });
  const revision = readback.revisionLabel
    ? sourcedBinding({
        fieldPath: 'coreFields.revisionLabel.value',
        value: readback.revisionLabel,
        unitType: 'document_identity',
        sourceRefIds: document.revision?.label?.sourceRefIds
          ?? firstRefsContaining(pkg.sourceRefs, /Original Issue:/u),
        refs,
      })
    : extractSourcedTextBinding({
        pkg,
        refs,
        fieldPath: 'coreFields.revisionLabel.value',
        unitType: 'document_identity',
        pattern: /(Original Issue):\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}/u,
        transform: () => 'ORIGINAL ISSUE',
      });
  const issueDate = extractSourcedTextBinding({
    pkg,
    refs,
    fieldPath: 'coreFields.issuedAt.value',
    unitType: 'document_identity',
    pattern: /Original Issue:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/u,
    transform: isoDate,
  });
  const issuer = extractSourcedTextBinding({
    pkg,
    refs,
    fieldPath: 'coreFields.issuer.value',
    unitType: 'document_identity',
    pattern: /\bBOEING\b/u,
    transform: () => 'BOEING',
  });
  const ata = extractSourcedTextBinding({
    pkg,
    refs,
    fieldPath: 'coreFields.ataChapters.value',
    unitType: 'document_identity',
    pattern: /ATA System:\s*(\d{2})\d*/u,
    transform: (value) => [value],
  });
  const nativeStructured = buildNativeStructuredAssessmentContext(pkg, refs);
  const sourceBindings = [
    documentType, documentCode, title, revision, issueDate, issuer, ata,
    ...nativeStructured.sourceBindings,
  ].filter(Boolean) as Array<Record<string, unknown>>;
  const readerReceiptHash = hashCanonical(readback);

  return deepFreeze({
    schemaVersion: UNIFIED_ASSESSMENT_INPUT_SCHEMA,
    documentIdentity: {
      documentId: readback.documentId,
      revisionId: readback.documentVersionId,
      documentFamily: 'SB',
    },
    assessmentAsOf,
    upstreamBinding: {
      unifiedParsedPackage: {
        readerSchemaVersion: readback.schemaVersion,
        contractRevision: documentVersionBinding.artifactRecord.contractRevision,
        documentId: readback.documentId,
        documentVersionId: readback.documentVersionId,
        packageId: readback.packageId,
        packageContentHash: readback.packageContentHash,
        packageSemanticHash: readback.packageSemanticHash,
        packageProvenanceHash: readback.packageProvenanceHash,
        packageCoverageHash: readback.packageCoverageHash,
        artifactRef: readback.artifactRef,
        artifactHash: readback.artifactHash,
        sourceKind: readback.sourceKind,
        sourcePackageId: readback.sourcePackageId,
        sourceArtifactHash: readback.sourceArtifactHash,
        resultStatus: readback.resultStatus,
        lifecycleStatus: 'FROZEN',
        selectionStatus: 'SELECTED',
        currentness: 'current',
        currentConsumptionAllowed: true,
        classification: structuredClone(readback.classification),
        readerReceipt: structuredClone(readback),
        readerReceiptHash,
      },
      sourceBindings,
    },
    parsedResult: {
      documentId: readback.documentId,
      revisionId: readback.documentVersionId,
      docFamily: 'SB',
      coreFields: Object.fromEntries(sourceBindings
        .filter((binding) => String(binding.fieldPath).startsWith('coreFields.'))
        .map((binding) => {
        const fieldName = String(binding.fieldPath).split('.')[1];
        return [fieldName, { value: binding.structuredValue }];
        })),
    },
    controlledContext: {},
    sourceDerivation: { facts: [] },
    structuredAssessmentContext: nativeStructured.context,
    publicPackageObservation: {
      resultStatus: readback.resultStatus,
      contentUnitCount: readback.contentUnitCount,
      sourceRefCount: readback.sourceRefCount,
      applicabilitySourceExpressions:
        structuredClone(readback.applicabilitySourceExpressions),
      contentUnitIds: pkg.contentUnits.map((unit) => unit.unitId),
      pageSourceRefs: selectPageSourceRefs(pkg.sourceRefs),
      sourceCoverage: {
        accountingComplete: pkg.coverage.summary.accountingComplete === true,
        contentPreserved: pkg.coverage.summary.contentPreserved === true,
        structuredCoverageComplete:
          pkg.coverage.summary.structuredCoverageComplete === true,
      },
    },
  });
}

function buildNativeStructuredAssessmentContext(
  pkg: UnifiedPackage,
  refs: Map<string, UnifiedSourceRef>,
): {
  context: StructuredAssessmentContext;
  sourceBindings: Array<Record<string, unknown>>;
} {
  const windows = nativeSectionWindows(pkg, refs);
  const applicabilityWindow = shortestWindow(windows, 'effectivity');
  const concurrentWindow = shortestWindow(windows, 'concurrent requirements');
  const workInstructionsWindow = firstSourceRefOnly(
    shortestWindow(windows, 'work instructions'),
    refs,
  );

  const applicabilityBinding = applicabilityWindow
    ? sourcedBinding({
        fieldPath: 'coreFields.applicabilityRaw.value',
        value: applicabilityWindow.rawText,
        unitType: 'native_section_window',
        sourceRefIds: applicabilityWindow.unit.sourceRefIds,
        refs,
      })
    : null;
  const concurrentBinding = concurrentWindow
    ? sourcedBinding({
        fieldPath:
          'familyFields.groupSpecificConcurrentRequirements.value[0]',
        value: {
          requirementState: 'PRESENT',
          documentRequirements: [],
          nonDocumentRequirements: [],
          retrievalEvaluationLoopRequired: null,
          rawText: concurrentWindow.rawText,
        },
        unitType: 'native_section_window',
        sourceRefIds: concurrentWindow.unit.sourceRefIds,
        refs,
      })
    : null;
  const workInstructionsBinding = workInstructionsWindow
    ? sourcedBinding({
        fieldPath: 'familyFields.workInstructionSteps.value[0]',
        value: {
          stepPath: 'WP3.1',
          stepLabel: 'B. WORK INSTRUCTIONS',
          instructionText: workInstructionsWindow.rawText,
          workPackageNumber: null,
          workPackageLabel: null,
          workPackageTitle: null,
          sourcePage: firstPage(workInstructionsWindow, refs),
        },
        unitType: 'native_section_window',
        sourceRefIds: workInstructionsWindow.unit.sourceRefIds,
        refs,
      })
    : null;

  const applicabilitySource = applicabilityBinding
    ? structuredSourceBinding(
        applicabilityBinding,
        'coreFields.applicabilityRaw.value',
      )
    : null;
  const concurrentSource = concurrentBinding
    ? structuredSourceBinding(
        concurrentBinding,
        'familyFields.groupSpecificConcurrentRequirements.value[0]',
      )
    : null;
  const workInstructionsSource = workInstructionsBinding
    ? structuredSourceBinding(
        workInstructionsBinding,
        'familyFields.workInstructionSteps.value[0]',
      )
    : null;

  return {
    context: {
      schemaVersion:
        'wiselink.v3_1.sb_job_aid.structured_assessment_context.v1',
      applicability: applicabilitySource
        ? {
            availability: 'AVAILABLE_CANDIDATE',
            rawText: applicabilityWindow!.rawText,
            source: applicabilitySource,
          }
        : { availability: 'MISSING', rawText: null, source: null },
      concurrentRequirements: concurrentSource
        ? {
            availability: 'AVAILABLE_CANDIDATE',
            entries: [{
              requirementState: 'PRESENT',
              normalizedPresence: 'PRESENT',
              requirementsStructured: false,
              documentRequirements: [],
              nonDocumentRequirements: [],
              retrievalEvaluationLoopRequired: null,
              rawText: concurrentWindow!.rawText,
              source: concurrentSource,
            }],
          }
        : { availability: 'MISSING', entries: [] },
      workInstructions: workInstructionsSource
        ? {
            availability: 'AVAILABLE_CANDIDATE',
            stepCount: 1,
            stepIds: ['WP3.1'],
            steps: [{
              stepId: 'WP3.1',
              stepPath: 'WP3.1',
              stepLabel: 'B. WORK INSTRUCTIONS',
              instructionText: workInstructionsWindow!.rawText,
              workPackageNumber: null,
              workPackageLabel: null,
              workPackageTitle: null,
              sourcePage: firstPage(workInstructionsWindow!, refs),
              source: workInstructionsSource,
            }],
          }
        : {
            availability: 'MISSING',
            stepCount: 0,
            stepIds: [],
            steps: [],
          },
      authorityBoundary: {
        sourceBoundParserCandidateOnly: true,
        documentApplicabilityProvesFleetApplicability: false,
        createsFleetFact: false,
        createsEvidenceRef: false,
        createsEngineerDecision: false,
      },
    },
    sourceBindings: [
      applicabilityBinding,
      concurrentBinding,
      workInstructionsBinding,
    ].filter((binding): binding is Record<string, unknown> => binding !== null),
  };
}

function nativeSectionWindows(
  pkg: UnifiedPackage,
  refs: Map<string, UnifiedSourceRef>,
): NativeSectionWindow[] {
  const units = [...pkg.contentUnits]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  let heading: string | null = null;
  const windows: NativeSectionWindow[] = [];
  for (const unit of units) {
    if (unit.kind !== 'paragraph' || typeof unit.payload.text !== 'string') {
      continue;
    }
    const observation = parseNativeObservation(unit.payload.text);
    if (!observation) continue;
    if (observation.observationType === 'SECTION_ANCHOR') {
      heading = optionalText(observation.value?.matchedHeading);
      continue;
    }
    if (
      observation.observationType !== 'SECTION_WINDOW' ||
      observation.value?.semanticBodyState !== 'CONTENT' ||
      !heading
    ) {
      continue;
    }
    const rawText = unit.sourceRefIds
      .map((sourceRefId) => refs.get(sourceRefId)?.quote ?? '')
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (rawText) windows.push({ heading, unit, rawText });
    heading = null;
  }
  return windows;
}

function parseNativeObservation(value: string): {
  observationType?: string;
  value?: Record<string, unknown>;
} | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as {
          observationType?: string;
          value?: Record<string, unknown>;
        }
      : null;
  } catch {
    return null;
  }
}

function shortestWindow(
  windows: NativeSectionWindow[],
  heading: string,
): NativeSectionWindow | null {
  const normalizedHeading = heading.trim().toLowerCase();
  return windows
    .filter((window) => window.heading.trim().toLowerCase() === normalizedHeading)
    .sort((left, right) => left.rawText.length - right.rawText.length
      || (left.unit.order ?? 0) - (right.unit.order ?? 0))[0] ?? null;
}

function firstSourceRefOnly(
  window: NativeSectionWindow | null,
  refs: Map<string, UnifiedSourceRef>,
): NativeSectionWindow | null {
  if (!window || window.unit.sourceRefIds.length === 0) return null;
  const sourceRefIds = window.unit.sourceRefIds.slice(0, 1);
  const rawText = trimGeneratedPageFooter(
    refs.get(sourceRefIds[0])?.quote ?? '',
  );
  if (!rawText) return null;
  return {
    ...window,
    unit: { ...window.unit, sourceRefIds },
    rawText,
  };
}

function trimGeneratedPageFooter(value: string): string {
  return value
    .replace(/\n(?:Export Controlled ECCN:|BOEING PROPRIETARY\b)[\s\S]*$/u, '')
    .trim();
}

function firstPage(
  window: NativeSectionWindow,
  refs: Map<string, UnifiedSourceRef>,
): number | null {
  const pages = window.unit.sourceRefIds
    .map((sourceRefId) => refs.get(sourceRefId)?.pageStart)
    .filter((page): page is number => Number.isInteger(page));
  return pages.length > 0 ? Math.min(...pages) : null;
}

function structuredSourceBinding(
  binding: Record<string, unknown>,
  structurePath: string,
): StructuredSourceBinding {
  return {
    structurePath,
    objectId: String(binding.unitId),
    objectHash: String(binding.unitHash),
    sourceUnitIds: [String(binding.unitId)],
    sourceRefs: structuredClone(
      binding.sourceRefs as Array<Record<string, unknown>>,
    ),
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readUnifiedArtifactRecord(
  value: unknown,
): UnifiedParsedPackageArtifactRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unified artifact record must be an object.');
  }
  return value as UnifiedParsedPackageArtifactRecord;
}

function sourcedBinding({
  fieldPath,
  value,
  unitType,
  sourceRefIds,
  refs,
}: {
  fieldPath: string;
  value: unknown;
  unitType: string;
  sourceRefIds: string[];
  refs: Map<string, UnifiedSourceRef>;
}): Record<string, unknown> {
  const rawSourceRefs = sourceRefIds.map((id) => {
    const ref = refs.get(id);
    if (!ref) throw new Error(`Unified source ref is missing: ${id}.`);
    return {
      sourceRefId: ref.sourceRefId,
      artifactId: ref.artifactId,
      artifactKind: ref.kind,
      sha256: ref.anchorTextHash,
      locator: {
        pageStart: ref.pageStart,
        pageEnd: ref.pageEnd,
        charStart: ref.charStart,
        charEnd: ref.charEnd,
        charOffsetUnit: ref.charOffsetUnit,
        ...(ref.bbox ? { bbox: ref.bbox } : {}),
      },
      quote: ref.quote,
    };
  });
  const unitHash = hashCanonical({ fieldPath, value, sourceRefs: rawSourceRefs });
  const unitId = `UO-${unitHash.slice('sha256:'.length, 'sha256:'.length + 24).toUpperCase()}`;
  const sourceRefs = rawSourceRefs.map((ref) => ({
    schemaVersion: 'techpub.source-ref.v1',
    sourceUnitId: unitId,
    sourceUnitHash: unitHash,
    artifactRef: ref.artifactId,
    anchorTextHash: ref.sha256,
    locator: ref.locator,
    anchorPreview: ref.quote,
    normalizedAnchorText: ref.quote,
    sourceRefId: ref.sourceRefId,
  }));
  return {
    unitId,
    unitHash,
    fieldPath,
    unitType,
    parentUnitId: null,
    pageRange: {
      startPage: Math.min(...rawSourceRefs.map((ref) => ref.locator.pageStart)),
      endPage: Math.max(...rawSourceRefs.map((ref) => ref.locator.pageEnd)),
    },
    sourceRefs,
    sourceBounded: true,
    structuredValue: structuredClone(value),
  };
}

function selectPageSourceRefs(
  sourceRefs: UnifiedSourceRef[],
): Array<Record<string, unknown>> {
  const byPage = new Map<number, UnifiedSourceRef>();
  for (const ref of sourceRefs) {
    const isWholePage = ref.pageStart === ref.pageEnd
      && ref.charStart === 0
      && ref.bbox?.length === 4
      && ref.bbox[0] === 0
      && ref.bbox[1] === 0
      && ref.bbox[2] === 1000000
      && ref.bbox[3] === 1000000;
    if (!isWholePage) continue;
    const current = byPage.get(ref.pageStart);
    if (!current || ref.quote.length > current.quote.length) {
      byPage.set(ref.pageStart, ref);
    }
  }
  if (byPage.size === 0) {
    throw new Error('Unified package has no whole-page source context.');
  }
  return [...byPage.values()]
    .sort((left, right) => left.pageStart - right.pageStart)
    .map((ref) => ({
      sourceRefId: ref.sourceRefId,
      artifactRef: ref.artifactId,
      pageStart: ref.pageStart,
      pageEnd: ref.pageEnd,
      quote: ref.quote,
      anchorTextHash: ref.anchorTextHash,
    }));
}

function extractSourcedTextBinding({
  pkg,
  refs,
  fieldPath,
  unitType,
  pattern,
  transform,
}: {
  pkg: UnifiedPackage;
  refs: Map<string, UnifiedSourceRef>;
  fieldPath: string;
  unitType: string;
  pattern: RegExp;
  transform: (value: string) => unknown;
}): Record<string, unknown> | null {
  for (const ref of pkg.sourceRefs) {
    const match = pattern.exec(ref.quote);
    if (match) return sourcedBinding({
      fieldPath,
      value: transform(match[1] ?? match[0]),
      unitType,
      sourceRefIds: [ref.sourceRefId],
      refs,
    });
  }
  return null;
}

function firstRefsContaining(refs: UnifiedSourceRef[], pattern: RegExp): string[] {
  const ref = refs.find((candidate) => pattern.test(candidate.quote));
  if (!ref) throw new Error(`No source ref matches ${String(pattern)}.`);
  return [ref.sourceRefId];
}

function isoDate(value: string): string {
  const millis = Date.parse(`${value} UTC`);
  if (!Number.isFinite(millis)) throw new Error(`Invalid issue date: ${value}.`);
  return new Date(millis).toISOString().slice(0, 10);
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
