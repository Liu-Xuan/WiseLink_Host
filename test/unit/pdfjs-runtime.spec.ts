import { createCachedPdfJsRuntimeLoader } from '../../client/src/pages/DocumentParsingPage/pdfjs-runtime';

describe('PDF.js runtime loader', () => {
  it('loads the runtime once and configures the deployed worker URL', async () => {
    const runtime = { GlobalWorkerOptions: { workerSrc: '' } };
    const importer = jest.fn(async () => runtime);
    const loadRuntime = createCachedPdfJsRuntimeLoader(importer);

    const first = await loadRuntime('https://assets.example/pdf.worker.js');
    const second = await loadRuntime('https://ignored.example/worker.js');

    expect(first).toBe(runtime);
    expect(second).toBe(runtime);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(runtime.GlobalWorkerOptions.workerSrc).toBe(
      'https://assets.example/pdf.worker.js',
    );
  });

  it('allows a later viewer mount to retry after an asset load failure', async () => {
    const runtime = { GlobalWorkerOptions: { workerSrc: '' } };
    const importer = jest
      .fn()
      .mockRejectedValueOnce(new Error('asset unavailable'))
      .mockResolvedValueOnce(runtime);
    const loadRuntime = createCachedPdfJsRuntimeLoader(importer);

    await expect(loadRuntime('/assets/pdf.worker.js')).rejects.toThrow(
      'asset unavailable',
    );
    await expect(loadRuntime('/assets/pdf.worker.js')).resolves.toBe(runtime);

    expect(importer).toHaveBeenCalledTimes(2);
    expect(runtime.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.js');
  });
});
