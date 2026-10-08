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

/** Decode exact source provenance without manufacturing missing semantic fields. */
export function parseAssessmentSourceStatement(value: unknown): NonNullable<Extract<AssessmentEvidence,{kind:'PRIOR_RESULT'}>['sourceStatement']> {
  const fail = (): never => { throw new Error('ASSESSMENT_SOURCE_STATEMENT_INVALID'); };
  const obj = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(k=>!keys.includes(k))) fail();
    return v as Record<string, unknown>;
  };
  const input=obj(value,['reference','sourceBinding']);
  const ref=obj(input.reference,['runRef','candidateRevision','statementId']);
  const binding=obj(input.sourceBinding,['original','semanticRevision']);
  const original=obj(binding.original,['documentVersionId','parseRunId','parseRevision','sourceArtifactId','sourceSha256','sourceByteLength']);
  for(const key of ['runRef','statementId']) if(typeof ref[key]!=='string'||!ref[key]||ref[key].includes(':')) fail();
  for(const key of ['documentVersionId','parseRunId','sourceArtifactId']) if(typeof original[key]!=='string'||!original[key]) fail();
  for(const v of [ref.candidateRevision,binding.semanticRevision,original.parseRevision]) if(!Number.isSafeInteger(v)||Number(v)<1) fail();
  if(!Number.isSafeInteger(original.sourceByteLength)||Number(original.sourceByteLength)<1||typeof original.sourceSha256!=='string'||!/^[a-f0-9]{64}$/u.test(original.sourceSha256)) fail();
  return {reference:{runRef:ref.runRef as string,candidateRevision:ref.candidateRevision as number,statementId:ref.statementId as string},
    sourceBinding:{semanticRevision:binding.semanticRevision as number,original:{documentVersionId:original.documentVersionId as string,parseRunId:original.parseRunId as string,parseRevision:original.parseRevision as number,sourceArtifactId:original.sourceArtifactId as string,sourceSha256:original.sourceSha256 as string,sourceByteLength:original.sourceByteLength as number}}};
}
