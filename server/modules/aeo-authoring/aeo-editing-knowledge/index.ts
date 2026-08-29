export * from './aeo-editing-knowledge.types';
export * from './aeo-editing-knowledge.normalizer';
export * from './aeo-editing-knowledge.validator';
export * from './aeo-editing-knowledge.diff';
export * from './aeo-draft-assistance';
export * from './aeo-routine-revision-assistance';

import type { AeoEditingKnowledgeCandidate } from './aeo-editing-knowledge.types';
import { normalizeAeoEditingKnowledge } from './aeo-editing-knowledge.normalizer';
import { assertAeoEditingKnowledgeCandidate } from './aeo-editing-knowledge.validator';

export function ingestAeoEditingKnowledgeCandidate(
  value: unknown,
  provenance?: unknown,
): AeoEditingKnowledgeCandidate {
  const candidate: AeoEditingKnowledgeCandidate = normalizeAeoEditingKnowledge(
    value,
    provenance,
  );
  assertAeoEditingKnowledgeCandidate(candidate);
  return candidate;
}
