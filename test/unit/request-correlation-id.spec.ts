import { createRequestCorrelationId } from '../../client/src/utils/request-correlation-id';

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'crypto',
);

describe('browser request correlation id', () => {
  afterEach(() => restoreGlobalCrypto());

  it('generates distinct valid ids when global crypto is unavailable', () => {
    setGlobalCrypto(undefined);

    const first = createRequestCorrelationId();
    const second = createRequestCorrelationId();

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(96);
    expect(second).not.toBe(first);
  });

  it('prefers the platform randomUUID implementation when available', () => {
    const randomUUID = jest
      .fn()
      .mockReturnValue('ABCD1234-ABCD-1234-ABCD-1234567890AB');
    setGlobalCrypto({ randomUUID });

    expect(createRequestCorrelationId()).toBe(
      'abcd1234-abcd-1234-abcd-1234567890ab',
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});

function setGlobalCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value,
  });
}

function restoreGlobalCrypto(): void {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, 'crypto');
}
