let mockSession: number = 1;
let mockAuthenticationRequired: boolean = false;
let mockSessionChange: () => void = () => undefined;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalHostClientSessionAuthenticationRequired: () =>
    mockAuthenticationRequired,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockSessionChange = listener;
    return () => undefined;
  },
}));
import {
  readTranslationDraft,
  writeTranslationDraft,
  type TranslationDraft,
} from '../../client/src/pages/DocumentParsingPage/translation-draft-store';

describe('unsaved semantic translation revisions', () => {
  const draft: TranslationDraft = {
    baseBlockRevisionId: 'body-test-2',
    expectedRowVersion: 7,
    expectedWorkItemRevision: 4,
    requestId: 'same-save-test',
    texts: { paragraph: '不得丢失的未保存文字。' },
    saveUnconfirmed: true,
  };
  beforeEach(() => {
    mockSession += 1;
    mockAuthenticationRequired = false;
    mockSessionChange();
  });
  it('retains the draft, base version and uncertain request across closing/reopening', () => {
    writeTranslationDraft('work:workspace:block', draft, mockSession);
    expect(readTranslationDraft('work:workspace:block')).toEqual(draft);
    expect(readTranslationDraft('other:workspace:block')).toBeNull();
    const read = readTranslationDraft('work:workspace:block')!;
    read.texts.paragraph = '外部修改';
    expect(readTranslationDraft('work:workspace:block')?.texts.paragraph).toBe(
      draft.texts.paragraph,
    );
  });
  it('drops text and stale async writes after an identity change', () => {
    const before = mockSession;
    writeTranslationDraft('scope', draft, before);
    mockSession += 1;
    mockSessionChange();
    writeTranslationDraft('scope', draft, before);
    expect(readTranslationDraft('scope')).toBeNull();
  });
  it('clears only the saved scope and does not recover text across login loss', () => {
    writeTranslationDraft('scope', draft, mockSession);
    writeTranslationDraft('other', draft, mockSession);
    writeTranslationDraft('scope', null, mockSession);
    expect(readTranslationDraft('other')).toEqual(draft);
    mockAuthenticationRequired = true;
    mockSessionChange();
    expect(readTranslationDraft('other')).toBeNull();
    mockAuthenticationRequired = false;
    expect(readTranslationDraft('other')).toBeNull();
  });
});
