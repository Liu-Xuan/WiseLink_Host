import type { S1000dStructuredPackageProducerPort } from './s1000d-ingress.types';

/**
 * Explicit blocker until the authorized production S1000D producer owner is
 * bound. Contract fixtures are never used as a production parser fallback.
 */
export class UnconfiguredS1000dStructuredPackageProducerAdapter implements S1000dStructuredPackageProducerPort {
  async produce(): ReturnType<S1000dStructuredPackageProducerPort['produce']> {
    throw Object.assign(
      new Error('The production S1000D structured package producer is absent.'),
      {
        code: 'S1000D_PRODUCER_UNCONFIGURED',
        statusCode: 503,
      },
    );
  }
}
