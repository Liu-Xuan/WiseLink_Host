import {
  GuideController,
  type GuideAdapter,
} from '../../client/src/features/atlas/guide-controller';
import { guideTracks } from '../../client/src/features/atlas/guide-content';
import {
  initialAtlasLocation,
  type AtlasSnapshot,
} from '../../client/src/features/atlas/atlas-model';
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function setup() {
  const snapshot: AtlasSnapshot = {
    location: {
      ...initialAtlasLocation,
      focus: 'exact-r3',
      selected: 's1',
      search: 'test',
    },
    pan: { x: 20, y: 40 },
    zoom: 1.2,
    scroll: 245,
    draft: 'unsent',
  };
  const adapter: GuideAdapter = {
    capture: () => snapshot,
    open: jest.fn().mockResolvedValue(undefined),
    ready: jest.fn().mockReturnValue(true),
    restore: jest.fn().mockResolvedValue(undefined),
    speak: jest.fn(),
    stop: jest.fn(),
  };
  return { adapter, snapshot, guide: new GuideController(adapter) };
}
describe('Guided Atlas read-only playback', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('keeps the three revised routes and dwell times in the shared content', () => {
    expect(
      guideTracks.map((t) => [
        t.scenes.length,
        t.scenes.reduce((n, s) => n + s.seconds, 0),
      ]),
    ).toEqual([
      [13, 243],
      [16, 297],
      [12, 205],
    ]);
  });
  it('starts time only after adapter readiness', async () => {
    const { adapter, guide } = setup();
    let resolve!: () => void;
    adapter.open = () =>
      new Promise((r) => {
        resolve = r;
      });
    guide.start(guideTracks[0]);
    jest.advanceTimersByTime(5000);
    expect(guide.getSnapshot().remaining).toBe(19000);
    expect(guide.getSnapshot().playing).toBe(false);
    resolve();
    await flush();
    jest.advanceTimersByTime(1000);
    expect(guide.getSnapshot().remaining).toBe(18000);
    guide.dispose();
  });
  it('ignores late scene completion after rapid jumps', async () => {
    const { adapter, guide } = setup();
    const finish: Array<() => void> = [];
    adapter.open = () => new Promise((r) => finish.push(r));
    guide.start(guideTracks[0]);
    void guide.select(4);
    void guide.select(7);
    finish[2]();
    await flush();
    finish[0]();
    finish[1]();
    await flush();
    expect(guide.getSnapshot().currentScene).toBe(7);
    expect(guide.getSnapshot().playing).toBe(true);
    guide.dispose();
  });
  it('pauses time and speech and resumes the remaining dwell', async () => {
    const { guide, adapter } = setup();
    guide.start(guideTracks[0]);
    await flush();
    guide.voice(true);
    jest.advanceTimersByTime(1300);
    guide.pause();
    const remaining = guide.getSnapshot().remaining;
    jest.advanceTimersByTime(50000);
    expect(guide.getSnapshot().remaining).toBe(remaining);
    expect(adapter.stop).toHaveBeenCalled();
    guide.resume();
    await flush();
    expect(guide.getSnapshot().remaining).toBe(remaining);
    guide.dispose();
  });
  it('pauses if the mounted target disappears', async () => {
    const { guide, adapter } = setup();
    guide.start(guideTracks[0]);
    await flush();
    adapter.ready = () => false;
    jest.advanceTimersByTime(150);
    expect(guide.getSnapshot().playing).toBe(false);
    expect(guide.getSnapshot().error).toContain('丢失');
    guide.dispose();
  });
  it('restores exact version, camera, filters, reading position and draft', async () => {
    const { guide, adapter, snapshot } = setup();
    guide.start(guideTracks[0]);
    await flush();
    await guide.select(5);
    await guide.exit();
    expect(adapter.restore).toHaveBeenCalledWith(
      snapshot,
      expect.any(AbortSignal),
    );
    expect(guide.getSnapshot().active).toBe(false);
    guide.dispose();
  });
  it('takeover stops all timers without restoring the example location', async () => {
    const { guide, adapter } = setup();
    guide.start(guideTracks[0]);
    await flush();
    guide.takeover();
    jest.advanceTimersByTime(999999);
    expect(guide.getSnapshot().active).toBe(false);
    expect(adapter.restore).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    guide.dispose();
  });
  it('cancels pending readiness on user pause', async () => {
    const { guide, adapter } = setup();
    let finish!: () => void;
    adapter.open = () =>
      new Promise((r) => {
        finish = r;
      });
    guide.start(guideTracks[0]);
    guide.pause();
    finish();
    await flush();
    expect(guide.getSnapshot().playing).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    guide.dispose();
  });
  it('keeps a failed restore reviewable and retryable', async () => {
    const { guide, adapter, snapshot } = setup();
    guide.start(guideTracks[0]);
    await flush();
    adapter.restore = jest.fn().mockRejectedValue(new Error('读取失败'));
    await guide.exit();
    expect(guide.getSnapshot().error).toBe('读取失败');
    expect(guide.getSnapshot().preEntrySnapshot).toBe(snapshot);
    adapter.restore = jest.fn().mockResolvedValue(undefined);
    await guide.exit();
    expect(guide.getSnapshot().active).toBe(false);
    guide.dispose();
  });
});

describe('Guided Atlas explicit tempo and adjacent scenes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('changes remaining dwell consumption without skipping or resetting a scene', async () => {
    const { guide } = setup();
    guide.start(guideTracks[0]);
    await flush();
    jest.advanceTimersByTime(1000);
    const prior = guide.getSnapshot().remaining;
    guide.setSpeed(2);
    expect(guide.getSnapshot().remaining).toBe(prior);
    jest.advanceTimersByTime(1000);
    expect(guide.getSnapshot().remaining).toBe(prior - 2000);
    guide.pause();
    guide.setSpeed(0.75);
    guide.resume();
    await flush();
    jest.advanceTimersByTime(1000);
    expect(guide.getSnapshot().remaining).toBeCloseTo(prior - 2750, 2);
    guide.dispose();
  });
  it('previous and next respect track boundaries and use normal cancellation', async () => {
    const { guide } = setup();
    guide.start(guideTracks[0]);
    await flush();
    guide.previous();
    expect(guide.getSnapshot().currentScene).toBe(0);
    guide.next();
    await flush();
    expect(guide.getSnapshot().currentScene).toBe(1);
    guide.previous();
    await flush();
    expect(guide.getSnapshot().currentScene).toBe(0);
    guide.dispose();
  });
});
