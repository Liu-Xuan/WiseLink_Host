import { withOneFileReadTransportRetry } from '../../server/modules/unified-reader/file-service-read-transport';

describe('bounded FileService read transport retry', () => {
  it('repeats a transport failure once and preserves the real result', async () => {
    const read = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(null);
    await expect(withOneFileReadTransportRetry(read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('propagates the second transport failure without a third read', async () => {
    const cause = new TypeError('fetch failed');
    const read = jest.fn().mockRejectedValue(cause);
    await expect(withOneFileReadTransportRetry(read)).rejects.toBe(cause);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 409, 500, 503])(
    'does not repeat HTTP %s even with a transport-looking message',
    async (status) => {
      const cause = Object.assign(new TypeError('fetch failed'), {
        cause: { response: { status } },
      });
      const read = jest.fn().mockRejectedValue(cause);
      await expect(withOneFileReadTransportRetry(read)).rejects.toBe(cause);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  it('does not infer object absence from a provider or semantic error', async () => {
    const cause = Object.assign(new Error('File not found or no access'), {
      code: 400000034,
    });
    const read = jest.fn().mockRejectedValue(cause);
    await expect(withOneFileReadTransportRetry(read)).rejects.toBe(cause);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
