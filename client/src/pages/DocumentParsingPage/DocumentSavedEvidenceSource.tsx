import { useEffect, useState } from 'react';
import { getCanonicalHostClientSessionGeneration, readParsedDocument } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import type { DocumentParsedReading } from '@shared/document-parsing.interface';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';
import { DocumentOriginalPreview } from '../WorkspaceHomePage/DocumentOriginalPreview';
import { DocumentOriginalReader } from './DocumentOriginalReader';

/** A saved citation reads its own parse, even after the same DVI is reparsed. */
export default function DocumentSavedEvidenceSource({ evidence, onClose, onRejected }: {
  evidence: DocumentAssessmentEvidence; onClose(): void; onRejected(message: string): void;
}) {
  const route: string | null = exactDocumentSourceRoute(evidence);
  const run: string | null = route ? new URLSearchParams(route.split('?')[1]).get('parseRunId') : null;
  const identity: string = JSON.stringify([getCanonicalHostClientSessionGeneration(), evidence.documentVersionId, run]);
  const [state, setState] = useState<{ identity: string; reading: DocumentParsedReading | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!run) return;
    const controller: AbortController = new AbortController();
    const session: number = getCanonicalHostClientSessionGeneration();
    const current = (): boolean => !controller.signal.aborted && session === getCanonicalHostClientSessionGeneration();
    setState(null);
    void readParsedDocument(evidence.documentVersionId, run, controller.signal).then((reading: DocumentParsedReading) => {
      if (!current()) return;
      if (reading.documentVersionId !== evidence.documentVersionId || reading.parseRunId !== run)
        throw new Error('保存依据读回的原文版本不一致。');
      setState({ identity, reading, error: null });
    }).catch((reason: unknown) => {
      if (!current()) return;
      const message: string = reason instanceof Error ? reason.message : '原文依据读取未完成。';
      setState({ identity, reading: null, error: message });
      if (reason && typeof reason === 'object' && 'statusCode' in reason &&
        [401, 403, 404].includes(Number(reason.statusCode))) onRejected(message);
    });
    return () => controller.abort();
  }, [identity, evidence.documentVersionId, run, onRejected]);
  const value = state?.identity === identity ? state : null;
  const original = value?.reading?.original;
  const unit = original?.source.units.find(item => item.sourceRefIds.includes(evidence.sourceRefId));
  return <section className="document-saved-source" role="region" aria-label="保存依据的原文">
    <header><h3>原文依据</h3><Button size="sm" variant="outline" onClick={onClose}>返回保存内容</Button></header>
    {!run ? <p>此依据未登记解析位置，可核对该版本原件。</p> : value?.error ? <p role="alert">{value.error}</p>
      : !value ? <p role="status">正在读取保存依据的原文…</p> : original ? <>
        {!unit ? <p role="alert">此保存解析版本未返回指定段落。</p> : null}
        <DocumentOriginalReader original={original} activeUnitId={unit?.unitId ?? null} onUnitLocate={() => undefined} />
      </> : <pre className="document-saved-source-text">{value.reading?.markdown}</pre>}
    <DocumentOriginalPreview documentVersionId={evidence.documentVersionId}>打开该版本原件</DocumentOriginalPreview>
  </section>;
}
