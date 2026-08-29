import type {
  AeoEditingActionUnit,
  AeoEditingKnowledgeCandidate,
  AeoEditingSourceIdentity,
  AeoEditingSourceRef,
  AeoEditingValidationFinding,
  AeoEditingValidationResult,
} from './aeo-editing-knowledge.types';
import {
  add,
  isRecord,
  normalizeText,
  recordArray,
  recordValue,
  result,
  text,
  validateInputAuthorityBoundary,
} from './aeo-editing-knowledge.validation.utils';
import {
  isAeoCurrentProducerInput,
  validateAeoCurrentProducerInput,
} from './aeo-current-producer.validator';

export function validateAeoEditingInput(
  value: unknown,
  provenance?: unknown,
): AeoEditingValidationResult {
  const findings: AeoEditingValidationFinding[] = [];
  if (!isRecord(value)) {
    add(findings, 'RECORD_NOT_OBJECT', '$', 'Input must be an object.');
    return result(findings);
  }
  const currentProducer: boolean = isAeoCurrentProducerInput(value);
  const lifecycle: unknown =
    value.recordType === 'local-aeo-editing-knowledge' && !currentProducer
      ? value.lifecycleStatus
      : value.status;
  if (lifecycle !== 'CANDIDATE_ONLY') {
    add(
      findings,
      'INPUT_NOT_CANDIDATE_ONLY',
      '$.lifecycleStatus',
      'AEO editing input must be explicitly candidate-only.',
    );
  }
  validateInputAuthorityBoundary(value, findings);
  if (currentProducer) {
    validateAeoCurrentProducerInput(value, provenance, findings);
    return result(findings);
  }
  if (value.recordType !== 'local-aeo-editing-knowledge') {
    return result(findings);
  }
  const sources: Record<string, unknown>[] = recordArray(value.sources);
  const sourceMap: Map<string, Record<string, unknown>> = new Map();
  sources.forEach((source: Record<string, unknown>, index: number) => {
    const sourceId: string = text(source.sourceId);
    if (sourceMap.has(sourceId)) {
      add(
        findings,
        'DUPLICATE_SOURCE_ID',
        `$.sources[${index}].sourceId`,
        `Duplicate sourceId ${sourceId}.`,
      );
    }
    sourceMap.set(sourceId, source);
  });
  walkSourceRefs(value, (ref: Record<string, unknown>, path: string): void => {
    const sourceId: string = text(ref.sourceId);
    if (!sourceMap.has(sourceId)) {
      add(
        findings,
        'UNKNOWN_SOURCE_REF',
        `${path}.sourceId`,
        `SourceRef ${sourceId || '<missing>'} is not declared.`,
      );
    }
  });
  validateRawIdentity(value, sourceMap, findings);
  validateRawScope(value, sourceMap, findings);
  validateRawFigures(value, findings);
  validateRawActions(value, findings);
  return result(findings);
}

export function validateAeoEditingKnowledgeCandidate(
  candidate: AeoEditingKnowledgeCandidate,
): AeoEditingValidationResult {
  const findings: AeoEditingValidationFinding[] = [];
  if (candidate.lifecycleStatus !== 'CANDIDATE_ONLY') {
    add(
      findings,
      'LIFECYCLE_NOT_CANDIDATE_ONLY',
      '$.lifecycleStatus',
      'Editing knowledge must remain candidate-only.',
    );
  }
  if (candidate.authority !== 'EDITING_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE') {
    add(
      findings,
      'AUTHORITY_INVALID',
      '$.authority',
      'Editing knowledge cannot claim approval or release authority.',
    );
  }
  const sourceMap: Map<string, AeoEditingSourceIdentity> = new Map();
  candidate.sources.forEach(
    (source: AeoEditingSourceIdentity, index: number) => {
      if (sourceMap.has(source.sourceId)) {
        add(
          findings,
          'DUPLICATE_SOURCE_ID',
          `$.sources[${index}].sourceId`,
          `Duplicate sourceId ${source.sourceId}.`,
        );
      }
      sourceMap.set(source.sourceId, source);
    },
  );
  const primary: AeoEditingSourceIdentity | undefined = sourceMap.get(
    candidate.documentIdentity.primarySourceId,
  );
  if (!primary) {
    add(
      findings,
      'PRIMARY_SOURCE_MISSING',
      '$.documentIdentity.primarySourceId',
      'Primary source must be declared.',
    );
  } else {
    if (!primary.role.includes('AEO')) {
      add(
        findings,
        'PRIMARY_SOURCE_NOT_AEO',
        '$.documentIdentity.primarySourceId',
        'Primary source role must identify an AEO artifact.',
      );
    }
    if (primary.actualBytes !== candidate.documentIdentity.actualBytes) {
      add(
        findings,
        'DOCUMENT_BYTES_MISMATCH',
        '$.documentIdentity.actualBytes',
        'Document actualBytes must equal the primary source actualBytes.',
      );
    }
    if (
      normalizeText(primary.observedIdentity) !==
      normalizeText(candidate.documentIdentity.expectedHeader)
    ) {
      add(
        findings,
        'PRIMARY_SOURCE_IDENTITY_MISMATCH',
        '$.sources',
        'Primary source observed identity must match the expected AEO header.',
      );
    }
  }
  if (
    normalizeText(candidate.documentIdentity.observedHeader) !==
    normalizeText(candidate.documentIdentity.expectedHeader)
  ) {
    add(
      findings,
      'DOCUMENT_HEADER_MISMATCH',
      '$.documentIdentity.observedHeader',
      'Observed AEO header must match the expected header.',
    );
  }
  validateActionUnits(candidate.actionUnits, sourceMap, findings);
  return result(findings);
}

export function assertAeoEditingKnowledgeCandidate(
  candidate: AeoEditingKnowledgeCandidate,
): void {
  const validation: AeoEditingValidationResult =
    validateAeoEditingKnowledgeCandidate(candidate);
  if (!validation.valid) {
    throw new Error(
      `AEO_EDITING_KNOWLEDGE_INVALID: ${validation.findings
        .map((finding: AeoEditingValidationFinding) => finding.code)
        .join(', ')}`,
    );
  }
}

function validateActionUnits(
  actions: AeoEditingActionUnit[],
  sourceMap: Map<string, AeoEditingSourceIdentity>,
  findings: AeoEditingValidationFinding[],
): void {
  const unitIds: Set<string> = new Set<string>();
  const sequences: Set<number> = new Set<number>();
  actions.forEach((action: AeoEditingActionUnit, index: number) => {
    if (unitIds.has(action.unitId)) {
      add(
        findings,
        'DUPLICATE_ACTION_ID',
        `$.actionUnits[${index}].unitId`,
        `Duplicate action unitId ${action.unitId}.`,
      );
    }
    unitIds.add(action.unitId);
    if (sequences.has(action.sequence)) {
      add(
        findings,
        'DUPLICATE_ACTION_SEQUENCE',
        `$.actionUnits[${index}].sequence`,
        `Duplicate action sequence ${action.sequence}.`,
      );
    }
    sequences.add(action.sequence);
    if (!action.bodyZh && !action.bodyEn) {
      add(
        findings,
        'ACTION_BODY_MISSING',
        `$.actionUnits[${index}]`,
        'An action candidate requires editable text.',
      );
    }
    if (action.sourceRefs.length === 0) {
      add(
        findings,
        'ACTION_SOURCE_REF_MISSING',
        `$.actionUnits[${index}].sourceRefs`,
        'Every generated paragraph must remain grounded in at least one SourceRef.',
      );
    }
    action.sourceRefs.forEach((ref: AeoEditingSourceRef, refIndex: number) => {
      if (!sourceMap.has(ref.sourceId)) {
        add(
          findings,
          'UNKNOWN_SOURCE_REF',
          `$.actionUnits[${index}].sourceRefs[${refIndex}]`,
          `SourceRef ${ref.sourceId} is not declared.`,
        );
      }
    });
  });
}

function validateRawIdentity(
  record: Record<string, unknown>,
  sourceMap: Map<string, Record<string, unknown>>,
  findings: AeoEditingValidationFinding[],
): void {
  const documentIdentity: Record<string, unknown> = recordValue(
    record.documentIdentity,
  );
  const primary: Record<string, unknown> | undefined = sourceMap.get(
    text(documentIdentity.primarySourceId),
  );
  if (!primary) {
    add(
      findings,
      'PRIMARY_SOURCE_MISSING',
      '$.documentIdentity.primarySourceId',
      'Primary source must exist in sources.',
    );
    return;
  }
  if (primary.actualBytes !== documentIdentity.actualBytes) {
    add(
      findings,
      'DOCUMENT_BYTES_MISMATCH',
      '$.documentIdentity.actualBytes',
      'Document actualBytes must equal primary source actualBytes.',
    );
  }
  if (!text(primary.role).includes('AEO')) {
    add(
      findings,
      'PRIMARY_SOURCE_NOT_AEO',
      '$.documentIdentity.primarySourceId',
      'Primary source role must identify an AEO artifact.',
    );
  }
  if (
    normalizeText(primary.observedIdentity) !==
    normalizeText(documentIdentity.expectedHeader)
  ) {
    add(
      findings,
      'PRIMARY_SOURCE_IDENTITY_MISMATCH',
      '$.sources',
      'Primary source observed identity must match expected AEO header.',
    );
  }
  if (
    normalizeText(documentIdentity.expectedHeader) !==
    normalizeText(documentIdentity.observedHeader)
  ) {
    add(
      findings,
      'DOCUMENT_HEADER_MISMATCH',
      '$.documentIdentity.observedHeader',
      'Observed header does not match expected AEO identity.',
    );
  }
}

function validateRawScope(
  record: Record<string, unknown>,
  sourceMap: Map<string, Record<string, unknown>>,
  findings: AeoEditingValidationFinding[],
): void {
  const target: Record<string, unknown> = recordValue(record.targetIdentity);
  const manufacturer: Record<string, unknown> = recordValue(
    target.manufacturerScope,
  );
  const company: Record<string, unknown> = recordValue(
    target.companyExecutionScope,
  );
  if (company.status === 'UNESTABLISHED') {
    if (
      company.statement !== undefined ||
      arrayValue(company.sourceRefs).length > 0
    ) {
      add(
        findings,
        'UNESTABLISHED_COMPANY_SCOPE_HAS_VALUE',
        '$.targetIdentity.companyExecutionScope',
        'Unestablished company scope cannot carry a statement or SourceRefs.',
      );
    }
    return;
  }
  if (company.status !== 'EXPLICIT_CANDIDATE') {
    return;
  }
  const companyRefs: Record<string, unknown>[] = recordArray(
    company.sourceRefs,
  );
  if (!company.statement || companyRefs.length === 0) {
    add(
      findings,
      'COMPANY_SCOPE_BASIS_MISSING',
      '$.targetIdentity.companyExecutionScope',
      'Explicit company scope requires a statement and SourceRefs.',
    );
    return;
  }
  const basisSources: Record<string, unknown>[] = companyRefs.flatMap(
    (ref: Record<string, unknown>) => {
      const source: Record<string, unknown> | undefined = sourceMap.get(
        text(ref.sourceId),
      );
      return source ? [source] : [];
    },
  );
  if (
    basisSources.length > 0 &&
    basisSources.every((source: Record<string, unknown>) =>
      text(source.role).startsWith('MANUFACTURER_'),
    )
  ) {
    add(
      findings,
      'MANUFACTURER_SCOPE_PROMOTED_TO_COMPANY_SCOPE',
      '$.targetIdentity.companyExecutionScope.sourceRefs',
      'Manufacturer scope alone cannot establish company execution scope.',
    );
  }
  if (
    normalizeText(company.statement) ===
      normalizeText(manufacturer.statement) &&
    target.scopeRelationship !== 'IDENTICAL_WITH_EXPLICIT_COMPANY_BASIS'
  ) {
    add(
      findings,
      'SCOPE_RELATIONSHIP_UNMARKED',
      '$.targetIdentity.scopeRelationship',
      'Identical manufacturer/company scope requires explicit company basis.',
    );
  }
}

function validateRawFigures(
  record: Record<string, unknown>,
  findings: AeoEditingValidationFinding[],
): void {
  const extension: Record<string, unknown> = recordValue(
    record.categoryExtension,
  );
  const hardware: Record<string, unknown> = recordValue(extension.hardware);
  recordArray(hardware.figureUnits).forEach(
    (figure: Record<string, unknown>, index: number) => {
      if (figure.expectedSheets !== figure.observedSheets) {
        add(
          findings,
          'FIGURE_SHEETS_INCOMPLETE',
          `$.categoryExtension.hardware.figureUnits[${index}].observedSheets`,
          `${text(figure.figureId)} has incomplete observed sheets.`,
        );
      }
    },
  );
}

function validateRawActions(
  record: Record<string, unknown>,
  findings: AeoEditingValidationFinding[],
): void {
  const unitIds: Set<string> = new Set<string>();
  const sequences: Set<unknown> = new Set<unknown>();
  recordArray(record.actions).forEach(
    (action: Record<string, unknown>, actionIndex: number) => {
      const unitId: string = text(action.unitId);
      if (unitIds.has(unitId)) {
        add(
          findings,
          'DUPLICATE_ACTION_ID',
          `$.actions[${actionIndex}].unitId`,
          `Duplicate action ${unitId}.`,
        );
      }
      unitIds.add(unitId);
      if (sequences.has(action.sequence)) {
        add(
          findings,
          'DUPLICATE_ACTION_SEQUENCE',
          `$.actions[${actionIndex}].sequence`,
          `Duplicate action sequence ${String(action.sequence)}.`,
        );
      }
      sequences.add(action.sequence);
      recordArray(action.closeout).forEach(
        (closeout: Record<string, unknown>, closeoutIndex: number) => {
          if (closeout.kind !== 'RESTORE') {
            return;
          }
          const comparison: Record<string, unknown> = recordValue(
            closeout.sourceComparison,
          );
          const path: string = `$.actions[${actionIndex}].closeout[${closeoutIndex}]`;
          if (Object.keys(comparison).length === 0) {
            add(
              findings,
              'RESTORE_SOURCE_COMPARISON_MISSING',
              path,
              'Restore wording requires an explicit source comparison.',
            );
            return;
          }
          const differs: boolean =
            normalizeText(comparison.manufacturerText) !==
            normalizeText(comparison.companyText);
          if (differs && comparison.relation !== 'SEMANTIC_CHANGE') {
            add(
              findings,
              'RESTORE_SEMANTIC_CHANGE_UNMARKED',
              `${path}.sourceComparison.relation`,
              'Different restore wording must be marked as a semantic change.',
            );
          }
        },
      );
    },
  );
}

function walkSourceRefs(
  value: unknown,
  callback: (ref: Record<string, unknown>, path: string) => void,
  path: string = '$',
): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) =>
      walkSourceRefs(item, callback, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  Object.entries(value).forEach(([key, child]: [string, unknown]) => {
    const childPath: string = `${path}.${key}`;
    if (key === 'sourceRefs' && Array.isArray(child)) {
      recordArray(child).forEach(
        (ref: Record<string, unknown>, index: number) =>
          callback(ref, `${childPath}[${index}]`),
      );
      return;
    }
    walkSourceRefs(child, callback, childPath);
  });
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
