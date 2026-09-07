import { withFileReadTransportRetry } from '../../server/modules/unified-reader/file-service-read-transport';

describe('bounded FileService read transport retry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('repeats a transport failure once and preserves the real result', async () => {
    const read = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(null);
    const result = withFileReadTransportRetry(read);
    await jest.advanceTimersByTimeAsync(249);
    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('allows a second transient failure to recover after increasing backoff', async () => {
    const read = jest.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue({ id: 'actual-provider-object' });
    const result = withFileReadTransportRetry(read);
    await jest.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ id: 'actual-provider-object' });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('propagates the third transport failure without a fourth read', async () => {
    const cause = new TypeError('fetch failed');
    const read = jest.fn().mockRejectedValue(cause);
    const result = expect(withFileReadTransportRetry(read)).rejects.toBe(cause);
    await jest.runAllTimersAsync();
    await result;
    expect(read).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404, 409, 500, 503])(
    'does not repeat HTTP %s even with a transport-looking message',
    async (status) => {
      const cause = Object.assign(new TypeError('fetch failed'), {
        cause: { response: { status } },
      });
      const read = jest.fn().mockRejectedValue(cause);
      await expect(withFileReadTransportRetry(read)).rejects.toBe(cause);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  it('does not infer object absence from a provider or semantic error', async () => {
    const cause = Object.assign(new Error('File not found or no access'), {
      code: 400000034,
    });
    const read = jest.fn().mockRejectedValue(cause);
    await expect(withFileReadTransportRetry(read)).rejects.toBe(cause);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops immediately if a retry returns a permission failure', async () => {
    const cause = Object.assign(new Error('fetch failed'), { status: 403 });
    const read = jest.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValue(cause);
    const result = expect(withFileReadTransportRetry(read)).rejects.toBe(cause);
    await jest.runAllTimersAsync();
    await result;
    expect(read).toHaveBeenCalledTimes(2);
  });
});
