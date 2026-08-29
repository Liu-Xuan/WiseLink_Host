import type {
  AeoEditingActionUnit,
  AeoEditingCategory,
  AeoEditingDocumentIdentity,
  AeoEditingKnowledgeCandidate,
  AeoEditingSourceRef,
} from './aeo-editing-knowledge.types';

export function normalizeRefs(value: unknown): AeoEditingSourceRef[] {
  return arrayOrEmpty(value).map((entry: unknown, index: number) => {
    const ref: Record<string, unknown> = object(entry, `sourceRefs[${index}]`);
    return {
      sourceId: string(ref.sourceId, `sourceRefs[${index}].sourceId`),
      locator: string(ref.locator, `sourceRefs[${index}].locator`),
    };
  });
}

export function normalizeCompactRefs(value: unknown): AeoEditingSourceRef[] {
  return uniqueRefs(
    normalizeStrings(value).map((ref: string) => {
      const separator: number = ref.indexOf('#');
      if (separator <= 0 || separator === ref.length - 1) {
        throw new Error(`AEO_EDITING_SOURCE_REF_INVALID: ${ref}`);
      }
      return {
        sourceId: ref.slice(0, separator),
        locator: ref.slice(separator + 1),
      };
    }),
  );
}

export function nestedSourceRefs(values: unknown[]): AeoEditingSourceRef[] {
  return values.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    return normalizeRefs((value as Record<string, unknown>).sourceRefs);
  });
}

export function normalizeReviewMessages(value: unknown): string[] {
  return arrayOrEmpty(value).map((entry: unknown) => {
    if (typeof entry === 'string') {
      return entry;
    }
    const item: Record<string, unknown> = object(entry, 'review');
    return (
      stringOrNull(item.message) ??
      stringOrNull(item.reviewNote) ??
      stringOrNull(item.company) ??
      JSON.stringify(item)
    );
  });
}

export function recoveryConflicts(record: Record<string, unknown>): string[] {
  const recovery: unknown[] = arrayOrEmpty(record.recoveryUnits);
  return recovery.flatMap((entry: unknown) => {
    const item: Record<string, unknown> = object(entry, 'recoveryUnits');
    const status: string | null = stringOrNull(item.semanticReviewStatus);
    return status && status !== 'SAME_AS_SOURCE'
      ? [`Recovery semantics require review: ${status}.`]
      : [];
  });
}

export function companyScopeMissing(target: Record<string, unknown>): string[] {
  const scope: Record<string, unknown> | null = objectOrNull(
    target.companyExecutionScope,
  );
  return scope && stringOrNull(scope.status) === 'UNESTABLISHED'
    ? ['Company execution scope is unestablished.']
    : [];
}

export function dependencyMissingMessages(
  unitId: string,
  values: unknown[],
): string[] {
  return values.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const item: Record<string, unknown> = entry as Record<string, unknown>;
    return stringOrNull(item.reviewStatus) === 'MISSING_SOURCE'
      ? [`${unitId} has a dependency without actual source bytes.`]
      : [];
  });
}

export function inspectionFallbackBody(
  action: Record<string, unknown>,
  phase: string,
  operation: string,
): string {
  return [
    phase,
    operation,
    stringOrNull(action.object),
    stringOrNull(action.targetConfiguration),
  ]
    .filter((value: string | null): value is string => Boolean(value))
    .join(' — ');
}

export function category(value: unknown): AeoEditingCategory {
  const parsed: string = string(value, 'category');
  const supported: AeoEditingCategory[] = [
    'SOFTWARE_INSTALLATION_UPDATE',
    'HARDWARE_INSTALLATION_MODIFICATION',
    'VISUAL_INSPECTION_WITH_CONDITIONAL_CORRECTION',
    'ROUTINE_PARAMETER_REVISION_UPDATE',
    'FUTURE_CATEGORY',
  ];
  if (!supported.includes(parsed as AeoEditingCategory)) {
    throw new Error(`AEO_EDITING_CATEGORY_UNSUPPORTED: ${parsed}`);
  }
  return parsed as AeoEditingCategory;
}

export function knowledgeVersion(identity: AeoEditingDocumentIdentity): string {
  return `${identity.aeoNumber}@${identity.revision}:${String(
    identity.actualBytes,
  )}`;
}

export function structureSkeleton(
  actions: AeoEditingActionUnit[],
): AeoEditingKnowledgeSkeleton {
  return {
    sectionKeys: unique(
      actions.map((action: AeoEditingActionUnit) => action.phase),
    ),
    performerRolePlaceholders: unique(
      actions.flatMap((action: AeoEditingActionUnit) => action.performerRoles),
    ),
    inspectorRolePlaceholders: unique(
      actions.flatMap((action: AeoEditingActionUnit) => action.inspectorRoles),
    ),
    signatureGranularities: unique(
      actions.flatMap((action: AeoEditingActionUnit) =>
        action.signatureGranularity ? [action.signatureGranularity] : [],
      ),
    ),
    safetyNoteUnitIds: actions
      .filter((action: AeoEditingActionUnit) => action.safetyNotes.length > 0)
      .map((action: AeoEditingActionUnit) => action.unitId),
    parameterizedUnitIds: actions
      .filter((action: AeoEditingActionUnit) => action.parameters.length > 0)
      .map((action: AeoEditingActionUnit) => action.unitId),
  };
}

interface AeoEditingKnowledgeSkeleton {
  sectionKeys: string[];
  performerRolePlaceholders: string[];
  inspectorRolePlaceholders: string[];
  signatureGranularities: string[];
  safetyNoteUnitIds: string[];
  parameterizedUnitIds: string[];
}

export function safetyNotes(
  action: Record<string, unknown>,
  textValue: Record<string, unknown>,
): unknown[] {
  const explicit: unknown[] = [
    ...arrayOrEmpty(action.safetyNotes),
    ...arrayOrEmpty(action.warnings),
    ...arrayOrEmpty(action.cautions),
  ];
  const body: string = `${stringOrNull(textValue.zh) ?? ''} ${
    stringOrNull(textValue.en) ?? ''
  }`;
  return explicit.length === 0 &&
    /警告|注意|安全|warning|caution|safety/iu.test(body)
    ? [{ text: body.trim(), provenance: 'EXPLICIT_ACTION_TEXT' }]
    : explicit;
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`AEO_EDITING_EXPECTED_OBJECT: ${path}`);
  }
  return value as Record<string, unknown>;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`AEO_EDITING_EXPECTED_ARRAY: ${path}`);
  }
  return value;
}

export function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`AEO_EDITING_EXPECTED_STRING: ${path}`);
  }
  return value.trim();
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`AEO_EDITING_EXPECTED_POSITIVE_INTEGER: ${path}`);
  }
  return Number(value);
}

export function normalizeStrings(value: unknown): string[] {
  return arrayOrEmpty(value).flatMap((entry: unknown) => {
    const parsed: string | null = stringOrNull(entry);
    return parsed ? [parsed] : [];
  });
}

export function compactStrings(values: unknown[]): string[] {
  return values.flatMap((value: unknown) => {
    const parsed: string | null = stringOrNull(value);
    return parsed ? [parsed] : [];
  });
}

export function compactDefined(values: unknown[]): unknown[] {
  return values.filter(
    (value: unknown) => value !== undefined && value !== null,
  );
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function uniqueRefs(
  values: AeoEditingSourceRef[],
): AeoEditingSourceRef[] {
  const seen: Set<string> = new Set<string>();
  return values.filter((ref: AeoEditingSourceRef) => {
    const key: string = `${ref.sourceId}#${ref.locator}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function missingLike(message: string): boolean {
  return /missing|unestablished|not present|not established/iu.test(message);
}

export function isCompanyStepDisposition(disposition: string): boolean {
  return (
    disposition.startsWith('COMPANY_ADDED') ||
    disposition === 'COMPANY_ADDITION' ||
    disposition === 'COMPANY_EXECUTION_CLOSEOUT' ||
    disposition === 'OPERATOR_DEFINED_STAGING_IMPLEMENTATION'
  );
}

export function emptyProducerEvidence(): AeoEditingKnowledgeCandidate['producerEvidence'] {
  return {
    sourceSelection: null,
    figureUnits: [],
    reviewFlags: [],
    companyAddedOrSpecializedControls: [],
    sourceCandidatesRequiringDecision: [],
    nonGeneralizable: [],
  };
}
