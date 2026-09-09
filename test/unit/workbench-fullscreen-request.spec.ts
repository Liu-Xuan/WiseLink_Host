import {
  createFullscreenRequestController,
  type FullscreenRequestState,
} from '../../client/src/features/workbench/fullscreen-request';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('fullscreen request actual-state feedback', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports unsupported entry without claiming full screen', () => {
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      { read: () => false },
      publish,
    );
    controller.toggle();
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: false,
      phase: 'idle',
      message: expect.stringContaining('不支持系统全屏'),
    });
  });

  it.each(['throw', 'reject'])(
    'reports a %s and releases the request lock',
    async (mode) => {
      const publish = jest.fn<void, [FullscreenRequestState]>();
      const enter = jest.fn(() => {
        if (mode === 'throw') throw new Error('test synchronous failure');
        return Promise.reject(new Error('test rejection'));
      });
      const controller = createFullscreenRequestController(
        { read: () => false, enter },
        publish,
      );
      controller.toggle();
      await Promise.resolve();
      expect(publish).toHaveBeenLastCalledWith({
        isFullscreen: false,
        phase: 'idle',
        message: expect.stringContaining('未完成全屏请求'),
      });
      controller.toggle();
      await Promise.resolve();
      expect(enter).toHaveBeenCalledTimes(2);
      controller.dispose();
    },
  );

  it('reads the actual element after fulfilment even without a browser event', async () => {
    let actual = false;
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const request = deferred();
    const controller = createFullscreenRequestController(
      { read: () => actual, enter: () => request.promise },
      publish,
    );
    controller.toggle();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isFullscreen: false,
        phase: 'pending',
      }),
    );
    actual = true;
    request.resolve();
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: true,
      phase: 'idle',
      message: null,
    });
  });

  it('does not equate fulfilled with successful entry', async () => {
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      { read: () => false, enter: () => Promise.resolve() },
      publish,
    );
    controller.toggle();
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: false,
      phase: 'idle',
      message: expect.stringContaining('尚未进入此工作台'),
    });
  });

  it('shows bounded pending feedback without duplicate requests and accepts a late result', async () => {
    let actual = false;
    const request = deferred();
    const enter = jest.fn(() => request.promise);
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      { read: () => actual, enter },
      publish,
    );
    controller.toggle();
    controller.toggle();
    jest.advanceTimersByTime(4000);
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: false,
      phase: 'unconfirmed',
      message: expect.stringContaining('暂停重复请求'),
    });
    controller.clearFeedback();
    controller.toggle();
    expect(enter).toHaveBeenCalledTimes(1);
    actual = true;
    request.resolve();
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: true,
      phase: 'idle',
      message: null,
    });
  });

  it('reconciles a hung promise when the timeout readback confirms entry', () => {
    let actual = false;
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      { read: () => actual, enter: () => new Promise<void>(() => undefined) },
      publish,
    );
    controller.toggle();
    actual = true;
    jest.advanceTimersByTime(4000);
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: true,
      phase: 'idle',
      message: null,
    });
    controller.dispose();
  });

  it('allows exit after confirmed entry and ignores an older promise settling late', async () => {
    let actual = false;
    const entry = deferred();
    const exit = deferred();
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      {
        read: () => actual,
        enter: () => entry.promise,
        exit: () => exit.promise,
      },
      publish,
    );
    controller.toggle();
    actual = true;
    controller.observe();
    controller.toggle();
    entry.reject(new Error('late entry result'));
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isFullscreen: true,
        phase: 'pending',
      }),
    );
    actual = false;
    exit.resolve();
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: false,
      phase: 'idle',
      message: null,
    });
  });

  it('keeps actual fullscreen state when exit fails', async () => {
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      {
        read: () => true,
        exit: () => Promise.reject(new Error('exit failed')),
      },
      publish,
    );
    controller.toggle();
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({
      isFullscreen: true,
      phase: 'idle',
      message: expect.stringContaining('退出全屏未完成'),
    });
  });

  it('does not publish after disposal or leave timeout work behind', async () => {
    const request = deferred();
    const publish = jest.fn<void, [FullscreenRequestState]>();
    const controller = createFullscreenRequestController(
      { read: () => false, enter: () => request.promise },
      publish,
    );
    controller.toggle();
    controller.dispose();
    publish.mockClear();
    jest.advanceTimersByTime(5000);
    request.resolve();
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
