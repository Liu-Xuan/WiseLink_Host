import {
  CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID,
  readActiveJobAidBrowserRules,
} from '../../server/modules/canonical-host/canonical-job-aid-browser-rules';

describe('canonical Job-Aid browser rules', () => {
  it('grants the installation-event capability only to the five configuration-relevant criteria', async () => {
    const rules = await readActiveJobAidBrowserRules(
      CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID,
    );
    const capableCriterionIds = [...rules.entries()]
      .filter(([, rule]) =>
        rule.gapMetadata.evidenceCapabilities.includes(
          'GET_INSTALLATION_EVENTS',
        ),
      )
      .map(([criterionId]) => criterionId)
      .sort();

    expect(capableCriterionIds).toEqual([
      'APP-007',
      'APP-009',
      'APP-011',
      'APP-012',
      'PUB-012',
    ]);
  });
});
