import { Phase2dValidationAuthorizer, PHASE2D_VALIDATION_ROLE } from '../../server/modules/document-management-validation/phase2d-validation-authorizer';

describe('Phase2dValidationAuthorizer', () => {
  const previousEnabled = process.env.WL_DM_PHASE2D_VALIDATION_ENABLED;
  const previousRunId = process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID;

  afterEach(() => {
    if (previousEnabled === undefined) {
      delete process.env.WL_DM_PHASE2D_VALIDATION_ENABLED;
    } else {
      process.env.WL_DM_PHASE2D_VALIDATION_ENABLED = previousEnabled;
    }
    if (previousRunId === undefined) {
      delete process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID;
    } else {
      process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID = previousRunId;
    }
  });

  it('denies the ordinary hosted route even while the validation window is open', async () => {
    process.env.WL_DM_PHASE2D_VALIDATION_ENABLED = 'true';
    process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID = 'phase2d-test';
    const authorizer = new Phase2dValidationAuthorizer();

    await expect(
      authorizer.assertCanIngest({
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        roles: [],
        action: 'DOCUMENT_INGEST',
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN' });
  });

  it('allows only the server-added validation role inside an explicit window', async () => {
    process.env.WL_DM_PHASE2D_VALIDATION_ENABLED = 'true';
    process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID = 'phase2d-test';
    const authorizer = new Phase2dValidationAuthorizer();

    await expect(
      authorizer.assertCanIngest({
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        roles: [PHASE2D_VALIDATION_ROLE],
        action: 'DOCUMENT_INGEST',
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed when the environment window is absent', async () => {
    delete process.env.WL_DM_PHASE2D_VALIDATION_ENABLED;
    delete process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID;
    const authorizer = new Phase2dValidationAuthorizer();

    await expect(
      authorizer.assertCanIngest({
        actorUserId: 'user-1',
        tenantId: 'tenant-1',
        roles: [PHASE2D_VALIDATION_ROLE],
        action: 'DOCUMENT_INGEST',
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN' });
  });
});
