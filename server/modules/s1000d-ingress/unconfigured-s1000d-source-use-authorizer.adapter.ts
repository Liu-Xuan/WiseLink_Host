import type {
  S1000dSourceUseAuthorization,
  S1000dSourceUseAuthorizerPort,
} from './s1000d-ingress.types';

/** Default deployment posture: no OEM or redistribution credential, no read. */
export class UnconfiguredS1000dSourceUseAuthorizerAdapter implements S1000dSourceUseAuthorizerPort {
  async authorize(): Promise<S1000dSourceUseAuthorization> {
    throw Object.assign(
      new Error(
        'S1000D processing and redistribution authorization is not configured.',
      ),
      {
        code: 'S1000D_SOURCE_USE_AUTHORIZATION_UNCONFIGURED',
        statusCode: 503,
      },
    );
  }
}
