import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import {
  deriveShellUrlIdentity,
  selectMatterTimelineSources,
} from '../../client/src/features/navigation/shell-utils';

function entry(
  documentVersionId: string,
  selectedVersionIsCurrent: boolean,
): EngineeringMatterCatalogEntry {
  return {
    workItemId: 'WI-1',
    relationRole: 'PRIMARY',
    linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1,
    workItemChangedSinceLink: false,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: `DOC-${documentVersionId}`,
      documentVersionId,
      documentCode: `CODE-${documentVersionId}`,
      businessRevision: 'R1',
      normalizedFamily: `FAM-${documentVersionId}`,
    },
    documentCurrentness: {
      familyId: `FAM-${documentVersionId}`,
      currentDocumentVersionId: selectedVersionIsCurrent
        ? documentVersionId
        : null,
      currentGeneration: 1,
      selectedVersionIsCurrent,
    },
    sourceNavigation: {
      status: 'NOT_PARSED',
      sourceRefCount: 0,
      structuredContentPath: null,
    },
  };
}

describe('deriveShellUrlIdentity', () => {
  it('reads every valid identity pin from the query without touching the path', () => {
    const identity = deriveShellUrlIdentity(
      '?matterId=M1&documentVersionId=DV1&workRef=MWREV-1&workItemId=WI-1' +
        '&selectedMatterId=SM1&selectedDocumentVersionId=SDV1',
    );
    expect(identity).toEqual({
      matterId: 'M1',
      documentVersionId: 'DV1',
      workRef: 'MWREV-1',
      workItemId: 'WI-1',
      librarySelectedMatterId: 'SM1',
      librarySelectedDocumentVersionId: 'SDV1',
      invalidPins: [],
    });
  });

  it('distinguishes an absent pin from an invalid one without forwarding either', () => {
    const absent = deriveShellUrlIdentity('?documentVersionId=DV1');
    expect(absent.matterId).toBe('');
    expect(absent.invalidPins).toEqual([]);
    const empty = deriveShellUrlIdentity('?matterId=');
    expect(empty.matterId).toBe('');
    expect(empty.invalidPins).toEqual(['matterId']);
    expect(deriveShellUrlIdentity('?matterId=A&matterId=B').invalidPins).toEqual(['matterId']);
    expect(deriveShellUrlIdentity('?documentVersionId=DV1&documentVersionId=DV1').invalidPins).toEqual(['documentVersionId']);
    expect(deriveShellUrlIdentity('?workItemId=').invalidPins).toEqual(['workItemId']);
  });

  it('rejects pins containing control characters rather than guessing', () => {
    expect(deriveShellUrlIdentity('?matterId=MA%00T').matterId).toBe('');
    expect(deriveShellUrlIdentity('?matterId=MA%00T').invalidPins).toEqual(['matterId']);
    expect(deriveShellUrlIdentity('?matterId=MAT-1').matterId).toBe('MAT-1');
    expect(deriveShellUrlIdentity('?matterId=MAT-1').invalidPins).toEqual([]);
  });

  it('keeps library selection independent from the route identity pins', () => {
    const identity = deriveShellUrlIdentity(
      '?selectedMatterId=SM9&selectedDocumentVersionId=SDV9',
    );
    expect(identity.matterId).toBe('');
    expect(identity.documentVersionId).toBe('');
    expect(identity.librarySelectedMatterId).toBe('SM9');
    expect(identity.librarySelectedDocumentVersionId).toBe('SDV9');
  });

  it('reports an invalid library selection pin instead of dropping it silently', () => {
    const identity = deriveShellUrlIdentity('?selectedDocumentVersionId=');
    expect(identity.librarySelectedDocumentVersionId).toBe('');
    expect(identity.invalidPins).toEqual(['selectedDocumentVersionId']);
  });
});

describe('selectMatterTimelineSources', () => {
  it('returns an empty list when the matter registers no document versions', () => {
    expect(selectMatterTimelineSources([])).toEqual([]);
  });

  it('deduplicates by document version and orders the current version first', () => {
    const sources = selectMatterTimelineSources([
      entry('DV-OLD', false),
      entry('DV-CUR', true),
      entry('DV-OLD', false),
      entry('DV-MID', false),
    ]);
    expect(sources.map((item) => item.document.documentVersionId)).toEqual([
      'DV-CUR',
      'DV-OLD',
      'DV-MID',
    ]);
  });
});
