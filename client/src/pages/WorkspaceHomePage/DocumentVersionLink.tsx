import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';

export function DocumentVersionLink({
  version,
  children,
}: {
  version: CanonicalLibraryDocumentVersionSummary;
  children: ReactNode;
}) {
  return (
    <Link to={`/document-versions/${encodeURIComponent(version.documentVersionId)}`}>
      {children}
      <small>{version.parsing?.status === 'PUBLISHED' ? '解析可读' :
        version.parsing?.status === 'FAILED' ? '解析未完成' : version.parsing ? '解析处理中' : '查看原件与解析'}</small>
    </Link>
  );
}
