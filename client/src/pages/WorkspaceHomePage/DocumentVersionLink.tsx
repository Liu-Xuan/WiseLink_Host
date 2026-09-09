import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DocumentOriginalPreview } from './DocumentOriginalPreview';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';

export function DocumentVersionLink({
  version,
  children,
}: {
  version: CanonicalLibraryDocumentVersionSummary;
  children: ReactNode;
}) {
  if (version.readerWorkItemId) {
    return (
      <Link
        to={`/work-items/${encodeURIComponent(version.readerWorkItemId)}/documents?node=reader&tab=reader`}
      >
        {children}
      </Link>
    );
  }
  return (
    <DocumentOriginalPreview key={version.documentVersionId} documentVersionId={version.documentVersionId}>
      打开 {version.originalFilename} 原件（新标签页）
    </DocumentOriginalPreview>
  );
}
