import { IdentityRepository } from '../../server/modules/identity/identity.repository';

const OFFICIAL_INPUT = {
  feishuOpenId: 'official-open-id',
  feishuTenantKey: 'official-tenant-key',
  feishuUserId: 'official-user-id',
  expectedClientId: 'cli_aadde8b579f95bc9',
  miaodaTenantId: 'controlled-dev-tenant',
};

const CREATED = {
  id: '11111111-1111-4111-8111-111111111111',
  ...OFFICIAL_INPUT,
  miaodaUserId: 'hosted-actor',
  revision: 1,
};

describe('IdentityRepository official mapping bootstrap', () => {
  it('fails closed before insert when Hosted app.user_id is absent', async () => {
    const db = mockDatabase({ actorUserId: null });
    const repository = new IdentityRepository(db.value as never);

    await expect(repository.bootstrapSubjectMapping(OFFICIAL_INPUT)).resolves.toBeNull();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('requires zero ACTIVE mapping for the Hosted actor and exact client', async () => {
    const db = mockDatabase({ actorUserId: 'hosted-actor', active: true });
    const repository = new IdentityRepository(db.value as never);

    await expect(repository.bootstrapSubjectMapping(OFFICIAL_INPUT)).resolves.toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts official subject fields with the server-derived Hosted actor', async () => {
    const db = mockDatabase({ actorUserId: 'hosted-actor', created: CREATED });
    const repository = new IdentityRepository(db.value as never);

    await expect(repository.bootstrapSubjectMapping(OFFICIAL_INPUT)).resolves.toEqual(CREATED);
    expect(db.values).toHaveBeenCalledWith({
      feishuOpenId: OFFICIAL_INPUT.feishuOpenId,
      feishuTenantKey: OFFICIAL_INPUT.feishuTenantKey,
      feishuUserId: OFFICIAL_INPUT.feishuUserId,
      miaodaUserId: 'hosted-actor',
      miaodaTenantId: OFFICIAL_INPUT.miaodaTenantId,
      expectedClientId: OFFICIAL_INPUT.expectedClientId,
      status: 'ACTIVE',
      revision: 1,
    });
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a unique conflict returns no inserted row', async () => {
    const db = mockDatabase({ actorUserId: 'hosted-actor', created: null });
    const repository = new IdentityRepository(db.value as never);

    await expect(repository.bootstrapSubjectMapping(OFFICIAL_INPUT)).resolves.toBeNull();
  });
});

function mockDatabase(input: {
  actorUserId: string | null;
  active?: boolean;
  created?: typeof CREATED | null;
}) {
  const returning = jest.fn().mockResolvedValue(input.created ? [input.created] : []);
  const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
  const values = jest.fn().mockReturnValue({ onConflictDoNothing });
  const insert = jest.fn().mockReturnValue({ values });
  const limit = jest.fn().mockResolvedValue(input.active ? [{ id: 'existing' }] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const execute = jest.fn().mockResolvedValue([
    { miaodaUserId: input.actorUserId },
  ]);
  return {
    value: { execute, select, insert },
    execute,
    select,
    insert,
    values,
    onConflictDoNothing,
  };
}
