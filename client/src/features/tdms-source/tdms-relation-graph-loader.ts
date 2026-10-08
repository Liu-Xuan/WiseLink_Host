type GraphModule = typeof import('./TdmsSourceRelationGraph');
let graphPromise: Promise<GraphModule> | null = null;

/** Cache executable code only, never source data or authorization. */
export function loadTdmsSourceRelationGraph(): Promise<GraphModule> {
  if (!graphPromise) {
    graphPromise = import('./TdmsSourceRelationGraph').catch(
      (reason: unknown) => {
        graphPromise = null;
        throw reason;
      },
    );
  }
  return graphPromise;
}
