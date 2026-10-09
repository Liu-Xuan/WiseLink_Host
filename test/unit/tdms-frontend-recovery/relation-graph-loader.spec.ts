type Loader = typeof import('@client/src/features/tdms-source/tdms-relation-graph-loader');
const graphModule = { __esModule: true, default: () => null };
const graphPath = '@client/src/features/tdms-source/TdmsSourceRelationGraph';
const loaderPath = '@client/src/features/tdms-source/tdms-relation-graph-loader';

it('shares one in-flight import and retains the successful module promise', async () => {
  const graphFactory = jest.fn(() => graphModule);
  jest.resetModules();
  await jest.isolateModulesAsync(async () => {
    jest.doMock(graphPath, graphFactory);
    const { loadTdmsSourceRelationGraph } = require(loaderPath) as Loader;
    const first = loadTdmsSourceRelationGraph();
    const second = loadTdmsSourceRelationGraph();
    expect(second).toBe(first);
    const [firstModule, secondModule] = await Promise.all([first, second]);
    expect(firstModule).toBe(graphModule);
    expect(secondModule).toBe(graphModule);
    expect(loadTdmsSourceRelationGraph()).toBe(first);
    expect(graphFactory).toHaveBeenCalledTimes(1);
  });
  jest.dontMock(graphPath);
});

it('clears a rejected import so the next attempt can succeed and then cache', async () => {
  const chunkError = new Error('chunk unavailable');
  const graphFactory = jest.fn()
    .mockImplementationOnce(() => { throw chunkError; })
    .mockImplementation(() => graphModule);
  jest.resetModules();
  await jest.isolateModulesAsync(async () => {
    jest.doMock(graphPath, graphFactory);
    const { loadTdmsSourceRelationGraph } = require(loaderPath) as Loader;
    await expect(loadTdmsSourceRelationGraph()).rejects.toBe(chunkError);
    const retry = loadTdmsSourceRelationGraph();
    expect(await retry).toBe(graphModule);
    expect(loadTdmsSourceRelationGraph()).toBe(retry);
    expect(graphFactory).toHaveBeenCalledTimes(2);
  });
  jest.dontMock(graphPath);
});
