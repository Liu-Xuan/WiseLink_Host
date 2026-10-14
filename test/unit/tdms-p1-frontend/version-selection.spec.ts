import { libraryFamily } from '../fixtures/canonical-library';
import {
  libraryCurrentVersion,
  libraryDocumentSelection,
} from '@client/src/pages/WorkspaceHomePage/library-document-selection';

describe('TDMS library exact business version selection', () => {
  it('keeps a historical pin even when a newer version was received later', () => {
    const document = libraryFamily('version-selection');
    const historicalId = document.versions[1].documentVersionId;
    const selected = libraryDocumentSelection(document,
      new URLSearchParams({ selectedDocumentVersionId: historicalId }));
    expect(selected.status).toBe('HISTORY');
    expect(selected.version?.documentVersionId).toBe(historicalId);
    expect(selected.version?.originalFilename).toBe('old.pdf');
  });

  it('does not replace an absent or malformed version pin with the current version', () => {
    const document = libraryFamily('version-selection');
    expect(libraryDocumentSelection(document,
      new URLSearchParams('selectedDocumentVersionId=unreturned')).version).toBeNull();
    expect(libraryDocumentSelection(document,
      new URLSearchParams('selectedDocumentVersionId=&selectedDocumentVersionId=DV-version-selection-2'))
      .status).toBe('PIN_INVALID');
    expect(libraryDocumentSelection(document,
      new URLSearchParams({ selectedDocumentVersionId: ' DV-version-selection-2 ' })).version).toBeNull();
  });

  it('does not turn import order into currentness when Host has no unique current version', () => {
    const document = libraryFamily('version-selection');
    document.versions[0].selectedVersionIsCurrent = false;
    expect(libraryDocumentSelection(document, new URLSearchParams())).toEqual({
      version: null, status: 'CURRENT_UNCONFIRMED',
    });
    document.versions.forEach(version => { version.selectedVersionIsCurrent = true; });
    expect(libraryCurrentVersion(document)).toBeNull();
  });
});
