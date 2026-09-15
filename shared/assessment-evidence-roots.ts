import type { AssessmentEvidence, AssessmentSourceWork } from './assessment-reading.interface';

export function parseAssessmentSourceWork(value: unknown): AssessmentSourceWork {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ASSESSMENT_SOURCE_WORK_INVALID');
  const input = value as Record<string, unknown>;
  if (input.subjectKind !== 'ENGINEERING_MATTER' ||
      ['subjectId', 'workRef', 'issueKey'].some(key =>
        typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 255) ||
      Object.keys(input).some(key => !['subjectKind', 'subjectId', 'workRef', 'issueKey'].includes(key)))
    throw new Error('ASSESSMENT_SOURCE_WORK_INVALID');
  return { subjectKind: input.subjectKind, subjectId: input.subjectId as string,
    workRef: input.workRef as string, issueKey: input.issueKey as string };
}

/** Resolve existing lineage without treating a saved explanation as an independent source. */
export function assessmentEvidenceRoots(refs: string[], evidence: AssessmentEvidence[]): {
  rootRefs: string[]; unresolvedRefs: string[];
} {
  const registry = new Map(evidence.map(item => [item.evidenceRef, item]));
  const roots = new Set<string>();
  const unresolved = new Set<string>();
  const visited = new Set<string>();
  const visit = (ref: string, path: Set<string>) => {
    if (path.has(ref)) { unresolved.add(ref); return; }
    if (visited.has(ref)) return;
    const item = registry.get(ref);
    if (!item) { unresolved.add(ref); return; }
    if (item.kind !== 'PRIOR_RESULT') { roots.add(ref); visited.add(ref); return; }
    if (!item.originalEvidenceRefs.length) unresolved.add(ref);
    const next = new Set(path).add(ref);
    for (const original of item.originalEvidenceRefs) visit(original, next);
    visited.add(ref);
  };
  for (const ref of refs) visit(ref, new Set());
  return { rootRefs: [...roots], unresolvedRefs: [...unresolved] };
}
