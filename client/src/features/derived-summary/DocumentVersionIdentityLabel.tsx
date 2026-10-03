import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { readDocumentParsingStatus } from '@client/src/api/canonical-host';
import { useSummaryResource } from './useSummaryResource';

export default function DocumentVersionIdentityLabel({ documentVersionId, session }: { documentVersionId: string; session: number }) {
  const load = useCallback((signal: AbortSignal) => readDocumentParsingStatus(documentVersionId, signal), [documentVersionId]);
  const identity = useSummaryResource(documentVersionId, session, load);
  return <div className="space-y-1 text-sm">
    <Link className="underline" to={`/document-versions/${encodeURIComponent(documentVersionId)}`}>确切文档版本：{documentVersionId}</Link>
    {identity.data ? <p>{identity.data.documentCode} · 业务版次 {identity.data.businessRevision || '待核'} · {identity.data.selectedVersionIsCurrent ? '库内当前文档版本' : '历史文档版本'}</p> : null}
    {identity.loading ? <p role="status">正在核对文档业务版次与现行性…</p> : null}
    {identity.error ? <p role="alert">文档版次与现行性未能重新核对：{identity.error}</p> : null}
  </div>;
}
