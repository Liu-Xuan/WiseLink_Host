import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
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
    <a
      href={resolveAppUrl(
        `/api/document-management/document-versions/${encodeURIComponent(version.documentVersionId)}/original`,
      )}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`打开 ${version.originalFilename} 原件（新标签页）`}
    >
      {children}
    </a>
  );
}
