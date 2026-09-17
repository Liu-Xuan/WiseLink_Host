import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { saveReadingLocation } from '@client/src/features/matter/reading-location';
import { captureReadingLocation } from '@client/src/features/matter/useReadingLocation';
import {
  libraryDocumentReadingRoute,
  libraryReadingScope,
} from '@client/src/features/matter/reading-return';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';

export function DocumentVersionLink({
  version,
  children,
  familyId,
}: {
  version: CanonicalLibraryDocumentVersionSummary;
  children: ReactNode;
  familyId?: string;
}) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (familyId) params.set('familyId', familyId);
  if (params.get('mode') !== 'matter') params.set('selectedDocumentVersionId', version.documentVersionId);
  const inLibrary = location.pathname === '/library';
  return (
    <Link
      to={
        inLibrary
          ? libraryDocumentReadingRoute(version.documentVersionId, params)
          : `/document-versions/${encodeURIComponent(version.documentVersionId)}`
      }
      onClick={(event) => {
        event.stopPropagation();
        if (inLibrary)
          saveReadingLocation(
            libraryReadingScope(params),
            captureReadingLocation({
              claim: null,
              focusClaimId: null,
              discussionClaimId: null,
            }),
            getCanonicalHostClientSessionGeneration(),
          );
      }}
    >
      {children}
      <small>
        {version.parsing?.status === 'PUBLISHED'
          ? '解析可读'
          : version.parsing?.status === 'FAILED'
            ? '解析未完成'
            : version.parsing
              ? '解析处理中'
              : '查看原件与解析'}
      </small>
    </Link>
  );
}
