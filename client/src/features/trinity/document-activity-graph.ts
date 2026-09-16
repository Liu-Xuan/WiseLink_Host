import type { ElementDefinition } from 'cytoscape';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';

export type ActivityGraphNodeKind = 'statement' | 'quote' | 'anchor' | 'sourceRef';
export interface ActivityGraphSelection { statementId: string | null; anchorId: string | null }

export function activityGraphNodeId(
  reading: DocumentActivityReadingResponse,
  kind: ActivityGraphNodeKind,
  exactId: string,
  index = 0,
): string {
  const candidate = reading.candidate;
  return JSON.stringify([
    reading.binding.documentVersionId,
    reading.binding.parseRunId,
    candidate?.runRef ?? '',
    candidate?.candidateRevision ?? '',
    kind,
    exactId,
    index,
  ]);
}

export function buildActivityGraphElements(
  reading: DocumentActivityReadingResponse | null,
): ElementDefinition[] {
  const candidate = reading?.candidate;
  if (!reading || !candidate) return [];
  const elements: ElementDefinition[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const pushNode = (element: ElementDefinition): void => {
    const id = String(element.data.id);
    if (!nodeIds.has(id)) { nodeIds.add(id); elements.push(element); }
  };
  const pushEdge = (source: string, target: string, kind: string): void => {
    const id = JSON.stringify([source, target, kind]);
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      elements.push({ data: { id, source, target, kind } });
    }
  };
  candidate.statements.forEach((statement) => {
    const statementId = activityGraphNodeId(reading, 'statement', statement.statementId);
    pushNode({ data: { id: statementId, kind: 'statement', label: statement.label, statementId: statement.statementId } });
    statement.quotes.forEach((quote, quoteIndex) => {
      const quoteIdentity = JSON.stringify([statement.statementId, quote.anchorId, quote.start, quote.end, quoteIndex]);
      const quoteId = activityGraphNodeId(reading, 'quote', quoteIdentity);
      pushNode({ data: { id: quoteId, kind: 'quote', label: quote.text, statementId: statement.statementId, anchorId: quote.anchorId } });
      pushEdge(statementId, quoteId, 'statement-quote');
      const anchor = candidate.sourceAnchors.find((item) => item.anchorId === quote.anchorId);
      if (!anchor) return;
      const anchorId = activityGraphNodeId(reading, 'anchor', anchor.anchorId);
      pushNode({ data: { id: anchorId, kind: 'anchor', label: anchor.anchorId, anchorId: anchor.anchorId } });
      pushEdge(quoteId, anchorId, 'quote-anchor');
      [...new Set(anchor.sourceRefIds)].forEach((sourceRefId) => {
        const sourceId = activityGraphNodeId(reading, 'sourceRef', sourceRefId);
        pushNode({ data: { id: sourceId, kind: 'sourceRef', label: sourceRefId, sourceRefId } });
        pushEdge(anchorId, sourceId, 'anchor-sourceRef');
      });
    });
  });
  return elements;
}

export function selectionForGraphNode(
  reading: DocumentActivityReadingResponse,
  node: { kind: ActivityGraphNodeKind; statementId?: string; anchorId?: string },
): ActivityGraphSelection | null {
  if (!reading.candidate) return { statementId: null, anchorId: null };
  if (node.kind === 'statement') return { statementId: node.statementId ?? null, anchorId: null };
  if (node.kind === 'quote') return { statementId: node.statementId ?? null, anchorId: node.anchorId ?? null };
  if (node.kind === 'anchor') return { statementId: null, anchorId: node.anchorId ?? null };
  return null;
}
