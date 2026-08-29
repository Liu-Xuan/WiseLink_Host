import { random, uniqueId } from 'es-toolkit/compat';

const FALLBACK_RANDOM_MAX = 0xffff_ffff;
const MAX_CORRELATION_ID_LENGTH = 96;

export function createRequestCorrelationId(): string {
  const runtimeCrypto: Crypto | undefined = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return runtimeCrypto.randomUUID().toLowerCase();
  }
  const randomPart: string = [
    random(0, FALLBACK_RANDOM_MAX),
    random(0, FALLBACK_RANDOM_MAX),
  ]
    .map((value: number) => value.toString(36))
    .join('');
  return `wl_${Date.now().toString(36)}_${uniqueId()}_${randomPart}`.slice(
    0,
    MAX_CORRELATION_ID_LENGTH,
  );
}
