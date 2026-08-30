import { Injectable } from '@nestjs/common';

import { buildS1000dXmlStructuredPackage } from '../professional-input/builders/s1000d-xml-structured-package.builder';
import type {
  S1000dStructuredPackageProducerPort,
  S1000dStructuredPackageProducerResult,
} from './s1000d-ingress.types';

/**
 * Real-byte S1000D XML producer. It parses the authorized FileService member
 * bytes and builds a fresh package on every call; no fixture package or parser
 * snapshot is read as production input.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- CanonicalHostModule.forRoot registers this dynamic production provider.
export class S1000dXmlStructuredPackageProducerAdapter implements S1000dStructuredPackageProducerPort {
  readonly available = true;
  async produce(
    input: Parameters<S1000dStructuredPackageProducerPort['produce']>[0],
  ): Promise<S1000dStructuredPackageProducerResult> {
    if (
      input.artifacts.length !==
      input.authorization.authorizedSourceManifest.length
    ) {
      throw Object.assign(
        new Error('Authorized S1000D source bytes are incomplete.'),
        {
          code: 'S1000D_AUTHORIZED_SOURCE_BYTES_INCOMPLETE',
          statusCode: 409,
        },
      );
    }
    const built = await buildS1000dXmlStructuredPackage({
      artifacts: input.artifacts,
      generatedAt: input.source.committedAt,
    });
    return {
      packageId: built.pkg.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      bytes: built.u0Input.bytes,
      producerId: 'WiseLinkS1000dXmlProducer',
      producerRevision: 's1000d-xml.v1.1',
    };
  }
}
