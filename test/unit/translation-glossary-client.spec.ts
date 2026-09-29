const request = jest.fn();
const requireAuthentication = jest.fn();
const logError = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: logError },
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 7,
  requireCanonicalHostClientAuthentication: requireAuthentication,
}));

import {
  readTranslationGlossary,
  updateTranslationGlossary,
} from '@client/src/api/translation-glossary';

const snapshot = {
  revision: 2,
  entries: [
    {
      entryId: 'term.warning.zh-cn',
      kind: 'TERM' as const,
      sourceText: 'WARNING',
      targetRenderings: ['警告'],
      note: null,
    },
  ],
};

describe('translation glossary client', () => {
  beforeEach(() => {
    request.mockReset();
    requireAuthentication.mockReset();
    logError.mockReset();
  });

  it('reads and saves the tenant glossary with an expected revision', async () => {
    request.mockResolvedValue({ status: 200, data: snapshot });
    expect(await readTranslationGlossary()).toEqual(snapshot);
    expect(
      await updateTranslationGlossary({
        expectedRevision: 1,
        entries: snapshot.entries,
      }),
    ).toEqual(snapshot);
    expect(request).toHaveBeenNthCalledWith(1, {
      url: '/api/canonical-host/translation-glossary',
      method: 'GET',
      data: undefined,
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      url: '/api/canonical-host/translation-glossary',
      method: 'PUT',
      data: { expectedRevision: 1, entries: snapshot.entries },
      headers: { 'Cache-Control': 'no-cache' },
    });
  });

  it('keeps a revision conflict as a visible error', async () => {
    request.mockRejectedValue({
      response: {
        status: 409,
        data: { message: 'TRANSLATION_GLOSSARY_REVISION_CONFLICT' },
      },
    });
    await expect(
      updateTranslationGlossary({
        expectedRevision: 1,
        entries: snapshot.entries,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('marks the current session expired on authentication failure', async () => {
    request.mockRejectedValue({ response: { status: 401, data: {} } });
    await expect(readTranslationGlossary()).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(requireAuthentication).toHaveBeenCalledWith(7);
  });
});
