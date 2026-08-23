import { developmentRunBody } from '../../server/modules/canonical-host/canonical-development-run-input';

const selection = {
  bucketId: 'bucket-default',
  filePath:
    'wiselink/dev-intake/0f8fad5b-d9cb-469f-a165-70867728950e/source.pdf',
};

describe('canonical hosted development-run input', () => {
  it('accepts one server-authorized FileService selection', () => {
    expect(
      developmentRunBody({
        selection,
        developmentRunToken: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        query: 'applicability',
      }),
    ).toEqual({
      selection,
      developmentRunToken: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      query: 'applicability',
    });
  });

  it.each([
    ['neither source', {}],
    ['both sources', { selection, documentVersionId: 'DV-1' }],
  ])('rejects %s', (_label, source) => {
    expect(() =>
      developmentRunBody({
        ...source,
        developmentRunToken: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'DEVELOPMENT_RUN_SOURCE_EXACTLY_ONE_REQUIRED',
        }),
      }),
    );
  });

  it('rejects self-reported identity and authority fields', () => {
    expect(() =>
      developmentRunBody({
        selection,
        developmentRunToken: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        tenantId: 'caller-tenant',
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'DEVELOPMENT_RUN_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:tenantId',
        }),
      }),
    );
  });
});
