import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentVersionSummary,
} from '@shared/api.interface';

export interface LibraryDocumentSelection {
  version: CanonicalLibraryDocumentVersionSummary | null;
  status: 'CURRENT' | 'HISTORY' | 'CURRENT_UNCONFIRMED' | 'PIN_NOT_VISIBLE' | 'PIN_INVALID';
}

/** Host's explicit current selection is authoritative. Observation order is not a version rule. */
export function libraryCurrentVersion(
  document: CanonicalLibraryDocumentSummary | null,
): CanonicalLibraryDocumentVersionSummary | null {
  const current: CanonicalLibraryDocumentVersionSummary[] = document?.versions
    .filter((version: CanonicalLibraryDocumentVersionSummary) => version.selectedVersionIsCurrent) ?? [];
  return current.length === 1 ? current[0] : null;
}

/** A broken historical pin remains broken; never substitute the current PDF or opinions. */
export function libraryDocumentSelection(
  document: CanonicalLibraryDocumentSummary | null,
  params: URLSearchParams,
): LibraryDocumentSelection {
  const pins: string[] = params.getAll('selectedDocumentVersionId');
  if (pins.length) {
    if (pins.length !== 1 || !pins[0].trim() || pins[0] !== pins[0].trim()) {
      return { version: null, status: 'PIN_INVALID' };
    }
    const version: CanonicalLibraryDocumentVersionSummary | undefined = document?.versions
      .find((candidate: CanonicalLibraryDocumentVersionSummary) => candidate.documentVersionId === pins[0]);
    return version
      ? { version, status: version.selectedVersionIsCurrent ? 'CURRENT' : 'HISTORY' }
      : { version: null, status: 'PIN_NOT_VISIBLE' };
  }
  const version: CanonicalLibraryDocumentVersionSummary | null = libraryCurrentVersion(document);
  return { version, status: version ? 'CURRENT' : 'CURRENT_UNCONFIRMED' };
}
