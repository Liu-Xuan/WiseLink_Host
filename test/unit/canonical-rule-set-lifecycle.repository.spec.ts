import { CanonicalRuleSetLifecycleRepository } from '../../server/modules/canonical-host/canonical-rule-set-lifecycle.repository';

describe('CanonicalRuleSetLifecycleRepository', () => {
  it('maps a nested PostgreSQL unique violation to the current CAS conflict', async () => {
    const selectRows = [[], [storedSnapshotRow()], []];
    const db = {
      select: jest.fn(() => selectBuilder(selectRows.shift() ?? [])),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn().mockRejectedValue({
            cause: { code: '23505' },
          }),
        })),
      })),
    };
    const repository = new CanonicalRuleSetLifecycleRepository(db as never);

    await expect(
      repository.appendActivation({
        tenantId: 'tenant-rule-set-test',
        targetCriterionSetId: 'JACS-TARGET',
        expectedRevision: 0,
        action: 'PROMOTE',
        engineeringOwnerUserId: 'owner-test',
        requiredRoleId: 'role-owner-test',
        reason: 'Competing promotion.',
      }),
    ).rejects.toMatchObject({
      code: 'RULE_SET_CURRENT_CAS_CONFLICT',
      statusCode: 409,
    });
  });
});

function selectBuilder(rows: unknown[]) {
  const builder = {
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockResolvedValue(rows as never);
  return builder;
}

function storedSnapshotRow() {
  return {
    tenantId: 'tenant-rule-set-test',
    ruleSetKey: 'JOB_AID',
    criterionSetId: 'JACS-TARGET',
    criterionSetHash: `sha256:${'a'.repeat(64)}`,
    memberIdentityHash: `sha256:${'b'.repeat(64)}`,
    criteriaCount: 1,
    rulePackVersion: '0.2',
    rulePackJson: '{}',
    artifactRef: 'test://rule-pack',
    artifactDigest: `sha256:${'c'.repeat(64)}`,
    artifactVersion: 'v1',
    canonicalCriteriaHash: `sha256:${'d'.repeat(64)}`,
    sourceJobAidDocumentVersionId: null,
    sourceJobAidVersionStatus: 'VERSION_UNCONFIRMED',
    createdByEngineeringOwnerUserId: 'owner-test',
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
  };
}
