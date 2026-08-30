import type {
  ResolvedS1000dDocumentSource,
  S1000dDocumentSourcePort,
} from './s1000d-ingress.types';

export class UnconfiguredS1000dDocumentSourceAdapter implements S1000dDocumentSourcePort {
  readonly available = false;
  async resolveCurrent(): Promise<ResolvedS1000dDocumentSource> {
    throw unavailable();
  }

  async readActualBytes(): Promise<Uint8Array> {
    throw unavailable();
  }

  async readAuthorizedActualBytes(): Promise<Uint8Array> {
    throw unavailable();
  }
}

function unavailable(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('S1000D DocumentVersion source is absent.'), {
    code: 'S1000D_DOCUMENT_SOURCE_UNCONFIGURED',
    statusCode: 503,
  });
}
