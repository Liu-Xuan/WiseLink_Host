jest.mock(
  '@shared/aeo-integration',
  () => ({
    AEO_ARTIFACT_ACTION_VERSION:
      'wiselink.3_1.aeo_artifact_action.v0.candidate.2',
    AEO_ARTIFACT_INDEX_VERSION:
      'wiselink.3_1.aeo_artifact_index.v0.candidate.2',
  }),
  { virtual: true },
);
jest.mock('../../server/modules/aeo-authoring/public-api', () => ({
  AeoArtifactActionService: class {},
  AeoAuthoringSessionService: class {},
  AeoReviewedIntegratedAssessmentConsumer: class {},
}));

import { CanonicalHostAeoService } from '../../server/modules/canonical-host/canonical-host-aeo.service';

describe('CanonicalHostAeoService object authorization ordering', () => {
  it('performs no full projection, attempt, artifact, or FileService I/O for an outsider', async () => {
    const registrar = { getTenantScopedByWorkItemId: jest.fn() };
    const authorization = {
      authorize: jest.fn().mockRejectedValue(
        Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
          statusCode: 404,
        }),
      ),
    };
    const permissions = { freshRead: jest.fn() };
    const artifacts = { readActualBytes: jest.fn() };
    const repository = { reserveAssessmentAction: jest.fn() };
    const fileService = { from: jest.fn() };
    const reviewedAssessment = { read: jest.fn() };
    const service = new CanonicalHostAeoService(
      registrar as never,
      authorization as never,
      permissions as never,
      artifacts as never,
      repository as never,
      fileService as never,
      reviewedAssessment as never,
    );

    await expect(
      service.generateCandidate('WI-DIRECT-ID', {
        userId: 'outsider',
        tenantId: 'tenant-a',
        appId: 'app_17bzc551rsg',
        roles: [],
        env: 'test',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(permissions.freshRead).not.toHaveBeenCalled();
    expect(registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
    expect(repository.reserveAssessmentAction).not.toHaveBeenCalled();
    expect(artifacts.readActualBytes).not.toHaveBeenCalled();
    expect(fileService.from).not.toHaveBeenCalled();
    expect(reviewedAssessment.read).not.toHaveBeenCalled();
  });
});
