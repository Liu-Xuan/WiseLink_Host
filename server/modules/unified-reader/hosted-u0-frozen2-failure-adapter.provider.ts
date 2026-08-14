import type { Provider } from '@nestjs/common';

import { U0_FROZEN2_FAILURE_ADAPTER_PORT } from './unified-reader.constants';
import { U0Frozen2FailureAdapterService } from './u0-frozen2-failure-adapter.service';

export function createHostedU0Frozen2FailureAdapterProvider(): Provider {
  return {
    provide: U0_FROZEN2_FAILURE_ADAPTER_PORT,
    useExisting: U0Frozen2FailureAdapterService,
  };
}
