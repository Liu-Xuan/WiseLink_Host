import {
  invalidateCanonicalHostClientSession,
  readProgramAssessmentMaterials,
} from '@client/src/api/canonical-host';
import { programMaterialsFixture } from './fixtures/program-assessment-materials';
const mockRequest = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: (input: unknown) => mockRequest(input),
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl: (url: string) => url,
}));
beforeEach(() => {
  mockRequest.mockReset();
  invalidateCanonicalHostClientSession();
});

it('reads only the exact historical attempt through the normal GET endpoint', async () => {
  const signal = new AbortController().signal;
  const read = programMaterialsFixture('WI/history', 'ATT/history');
  mockRequest.mockResolvedValueOnce({ status: 200, data: read });
  expect(
    await readProgramAssessmentMaterials(
      read.workItemId,
      read.attemptId,
      signal,
    ),
  ).toBe(read);
  expect(mockRequest).toHaveBeenCalledWith({
    method: 'GET',
    signal,
    url: '/api/canonical-host/work-items/WI%2Fhistory/assessment-work/attempts/ATT%2Fhistory/program-materials',
  });
});

it.each(['workItemId', 'attemptId', 'executionMode'] as const)(
  'rejects a response with a mismatched %s',
  async (key) => {
    mockRequest.mockResolvedValueOnce({
      status: 200,
      data: { ...programMaterialsFixture(), [key]: 'DIFFERENT' },
    });
    await expect(
      readProgramAssessmentMaterials('WI-material', 'ATT-material'),
    ).rejects.toThrow('PROGRAM_ASSESSMENT_MATERIALS_BINDING_MISMATCH');
  },
);

it('ignores an exact attempt response after the browser session changes', async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = readProgramAssessmentMaterials('WI-material', 'ATT-material');
  invalidateCanonicalHostClientSession();
  finish({ status: 200, data: programMaterialsFixture() });
  await expect(pending).rejects.toThrow(
    'PROGRAM_ASSESSMENT_MATERIALS_OBSOLETE',
  );
});

it('ignores a response after its explicit reader is closed', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = readProgramAssessmentMaterials(
    'WI-material',
    'ATT-material',
    controller.signal,
  );
  controller.abort();
  finish({ status: 200, data: programMaterialsFixture() });
  await expect(pending).rejects.toThrow(
    'PROGRAM_ASSESSMENT_MATERIALS_OBSOLETE',
  );
});

it.each([403, 404])(
  'preserves the normal object-access boundary on source status %s',
  async (status) => {
    mockRequest.mockResolvedValueOnce({
      status,
      data: { secret: 'must not leave error path' },
    });
    await expect(
      readProgramAssessmentMaterials('WI-material', 'ATT-material'),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  },
);
