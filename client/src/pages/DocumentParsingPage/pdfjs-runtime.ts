interface PdfJsWorkerOptions {
  workerSrc: string;
}

interface PdfJsRuntimeContract {
  GlobalWorkerOptions: PdfJsWorkerOptions;
}

type PdfJsRuntimeImporter<Runtime extends PdfJsRuntimeContract> =
  () => Promise<Runtime>;
type PdfJsRuntimeLoader<Runtime extends PdfJsRuntimeContract> = (
  workerSrc: string,
) => Promise<Runtime>;

export function createCachedPdfJsRuntimeLoader<
  Runtime extends PdfJsRuntimeContract,
>(importer: PdfJsRuntimeImporter<Runtime>): PdfJsRuntimeLoader<Runtime> {
  let runtimePromise: Promise<Runtime> | null = null;

  return (workerSrc: string): Promise<Runtime> => {
    if (!runtimePromise) {
      runtimePromise = importer()
        .then((runtime: Runtime) => {
          runtime.GlobalWorkerOptions.workerSrc = workerSrc;
          return runtime;
        })
        .catch((error: unknown) => {
          runtimePromise = null;
          throw error;
        });
    }
    return runtimePromise;
  };
}

const loadPdfJsRuntime = createCachedPdfJsRuntimeLoader(
  () => import('pdfjs-dist'),
);

export { loadPdfJsRuntime };
