jest.mock('./canonical-host-request-actor', () => ({
  hostActor: jest.fn(() => ({ tenantId: 'tenant', userId: 'user' })),
}));
import { EngineeringIssueSearchController } from './engineering-issue-search.controller';

describe('EngineeringIssueSearchController', () => {
  it('rejects an invalid rebuild limit as a client error', async () => {
    const service = { rebuildProjection: jest.fn() };
    const controller = new EngineeringIssueSearchController(service as never);
    expect(() => controller.rebuildProjection('101', {} as never)).toThrow('ENGINEERING_SEARCH_REBUILD_LIMIT_INVALID');
    expect(service.rebuildProjection).not.toHaveBeenCalled();
  });

  it('passes a bounded limit and the request actor to projection recovery', async () => {
    const receipt = { attempted: 2, rebuilt: 2, failed: 0 };
    const service = { rebuildProjection: jest.fn().mockResolvedValue(receipt) };
    const controller = new EngineeringIssueSearchController(service as never);
    const request = { userContext: { tenantId: 'tenant', userId: 'user' } } as never;
    await expect(controller.rebuildProjection('25', request)).resolves.toEqual(receipt);
    expect(service.rebuildProjection).toHaveBeenCalledWith(25, expect.objectContaining({ tenantId: 'tenant', userId: 'user' }));
  });
});
