import type { DocumentOriginalResult, DocumentOriginalStepResult } from '@shared/document-original.interface';
import { canonicalJson } from '../../../../unified-reader/unified-reader.utils';

export interface DocumentOriginalChange {
  kind: DocumentOriginalStepResult['changeKind'];
  previousParseRunId: string | null;
  changedUnitIds: string[];
  changedSourceRefIds: string[];
}

/** Exact content/structure comparison, independent of generated parse identities.
 * No model summary, number-set shortcut, or persistent hash is used. */
export function compareDocumentOriginal(previous: DocumentOriginalResult | null, next: DocumentOriginalResult): DocumentOriginalChange {
  const allNext = () => ({ changedUnitIds: next.source.units.map(unit => unit.unitId),
    changedSourceRefIds: [...new Set(next.source.units.flatMap(unit => unit.sourceRefIds))] });
  if (!previous) return { kind: 'INITIAL', previousParseRunId: null, ...allNext() };
  if (previous.binding.documentVersionId !== next.binding.documentVersionId ||
      previous.binding.sourceArtifactId !== next.binding.sourceArtifactId || previous.binding.sourceSha256 !== next.binding.sourceSha256)
    throw new Error('DOCUMENT_ORIGINAL_CHANGE_SOURCE_MISMATCH');
  const signatures = (result: DocumentOriginalResult) => result.source.units.map(unit => canonicalJson({
    kind: unit.kind, payload: contentValue(unit.payload, result.binding.parseRunId),
  }));
  const old = signatures(previous), current = signatures(next);
  const coverage = (result: DocumentOriginalResult) => ({ ...result.coverage,
    unresolvedRanges: result.coverage.unresolvedRanges.map(({ unitIds: _ids, ...range }) => range) });
  const sameContent = canonicalJson(old) === canonicalJson(current);
  const sameCoverage = canonicalJson(coverage(previous)) === canonicalJson(coverage(next));
  if (sameContent && sameCoverage) return { kind: 'LOCATOR_ONLY', previousParseRunId: previous.binding.parseRunId,
    changedUnitIds: [], changedSourceRefIds: [] };
  if (sameContent) return { kind: 'IMPACT_UNRESOLVED', previousParseRunId: previous.binding.parseRunId, ...allNext() };
  const positions = (values: string[]) => {
    const map = new Map<string, number[]>();
    values.forEach((value, index) => map.set(value, [...(map.get(value) ?? []), index])); return map;
  };
  const oldPositions = positions(old), newPositions = positions(current);
  const matches = old.flatMap((signature, oldIndex) => oldPositions.get(signature)!.length === 1 &&
    newPositions.get(signature)?.length === 1 ? [{ oldIndex, newIndex: newPositions.get(signature)![0] }] : []);
  // An unchanged unique unit stays unchanged after an insertion. Reordering is
  // explicitly an impact, since the sequence can change conditions and meaning.
  const before: number[] = [], after: number[] = [];
  let maximum = -1, minimum = Number.POSITIVE_INFINITY;
  matches.forEach((match, index) => { before[index] = maximum; maximum = Math.max(maximum, match.newIndex); });
  for (let index = matches.length - 1; index >= 0; index--) { after[index] = minimum; minimum = Math.min(minimum, matches[index].newIndex); }
  const stable = matches.filter((match, index) => before[index] < match.newIndex && after[index] > match.newIndex);
  const stableOld = new Set(stable.map(match => match.oldIndex));
  const stableNew = new Set(stable.map(match => match.newIndex));
  const affected = [...previous.source.units.filter((_unit, index) => !stableOld.has(index)),
    ...next.source.units.filter((_unit, index) => !stableNew.has(index))];
  const ambiguous = [...oldPositions.values(), ...newPositions.values()].some(indices => indices.length > 1);
  return { kind: ambiguous ? 'IMPACT_UNRESOLVED' : 'SOURCE_CONTENT', previousParseRunId: previous.binding.parseRunId,
    changedUnitIds: affected.map(unit => unit.unitId), changedSourceRefIds: [...new Set(affected.flatMap(unit => unit.sourceRefIds))] };
}
function contentValue(value: unknown, runId: string): unknown {
  if (Array.isArray(value)) return value.map(item => contentValue(item, runId));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    key !== 'sourceRefIds' && !(['rowId', 'cellId'].includes(key) && typeof item === 'string' && item.startsWith(`${runId}:`)))
    .map(([key, item]) => [key, contentValue(item, runId)]));
}
