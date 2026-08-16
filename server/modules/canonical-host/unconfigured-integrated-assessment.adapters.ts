import type {
  CanonicalBaseRuleResultProviderPort,
  CanonicalOpenClawOverallProviderPort,
} from './canonical-host.types';

export class UnconfiguredCanonicalBaseRuleResultProvider
  implements CanonicalBaseRuleResultProviderPort
{
  readonly configured = false;

  async readResult(): Promise<never> {
    throw new Error('BASE_RULE_RESULT_PROVIDER_NOT_CONFIGURED');
  }
}

export class UnconfiguredCanonicalOpenClawOverallProvider
  implements CanonicalOpenClawOverallProviderPort
{
  readonly configured = false;

  async synthesize(): Promise<never> {
    throw new Error('OPENCLAW_OVERALL_PROVIDER_NOT_CONFIGURED');
  }
}
