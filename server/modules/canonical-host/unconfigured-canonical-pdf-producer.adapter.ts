import type { CanonicalPdfVerticalRunRequest } from '@shared/api.interface';

import type {
  CanonicalPdfProducerPort,
  CanonicalPdfProducerResult,
} from './canonical-host.types';

export class UnconfiguredCanonicalPdfProducerAdapter implements CanonicalPdfProducerPort {
  async producePdf(
    _request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalPdfProducerResult> {
    throw new Error('CANONICAL_PDF_PRODUCER_NOT_CONFIGURED');
  }
}
