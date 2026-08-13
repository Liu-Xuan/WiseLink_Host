import type { CanonicalFailureValidationWriteAuthorizationPort } from './canonical-host.types';

export class UnconfiguredFailureValidationWriteAuthorizationAdapter
  implements CanonicalFailureValidationWriteAuthorizationPort
{
  async authorize(): Promise<never> {
    throw new Error('FAILURE_VALIDATION_WRITE_RECEIPT_REQUIRED');
  }
}
