import type { GuideScene, GuideTrack } from './guide-content';
import type { AtlasSnapshot } from './atlas-model';
export interface GuideAdapter {
  capture(): AtlasSnapshot;
  open(scene: GuideScene, signal: AbortSignal): Promise<void>;
  ready(scene: GuideScene): boolean;
  restore(snapshot: AtlasSnapshot, signal: AbortSignal): Promise<void>;
  speak(text: string): void;
  stop(): void;
}
export interface GuideState {
  active: boolean;
  playing: boolean;
  currentScene: number;
  epoch: number;
  remaining: number;
  preEntrySnapshot: AtlasSnapshot | null;
  track: GuideTrack | null;
  preparing: boolean;
  error: string | null;
  voice: boolean;
  speed: number;
}
export class GuideController {
  private state: GuideState = {
    active: false,
    playing: false,
    currentScene: 0,
    epoch: 0,
    remaining: 0,
    preEntrySnapshot: null,
    track: null,
    preparing: false,
    error: null,
    voice: false,
    speed: 1,
  };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private deadline = 0;
  constructor(private adapter: GuideAdapter) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<GuideState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private cancel() {
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.adapter.stop();
  }
  start(track: GuideTrack) {
    const snapshot = this.state.preEntrySnapshot ?? this.adapter.capture();
    this.cancel();
    this.set({ active: true, track, preEntrySnapshot: snapshot });
    void this.select(0);
  }
  async select(index: number, remaining?: number) {
    const track = this.state.track;
    const scene = track?.scenes[index];
    if (!scene || !this.state.active) return;
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const epoch = this.state.epoch + 1;
    this.set({
      currentScene: index,
      epoch,
      remaining: remaining ?? scene.seconds * 1000,
      preparing: true,
      playing: false,
      error: null,
    });
    try {
      await this.adapter.open(scene, controller.signal);
      if (controller.signal.aborted || epoch !== this.state.epoch) return;
      if (!this.adapter.ready(scene))
        throw new Error('当前讲解目标不可用，请重新选择章节或在此探索。');
      this.set({ preparing: false, playing: true });
      this.deadline = Date.now() + this.state.remaining / this.state.speed;
      if (this.state.voice) this.adapter.speak(scene.caption);
      this.timer = setInterval(() => {
        if (!this.adapter.ready(scene)) {
          this.pause();
          this.set({ error: '讲解目标已丢失，已暂停。' });
          return;
        }
        const remaining = Math.max(
          0,
          (this.deadline - Date.now()) * this.state.speed,
        );
        this.set({ remaining });
        if (remaining === 0) {
          if (index + 1 < track.scenes.length) void this.select(index + 1);
          else this.pause();
        }
      }, 100);
    } catch (reason) {
      if (controller.signal.aborted || epoch !== this.state.epoch) return;
      this.cancel();
      this.set({
        preparing: false,
        playing: false,
        error:
          reason instanceof Error
            ? reason.message
            : '讲解目标读取失败，请重试。',
      });
    }
  }
  pause() {
    const remaining = this.state.playing
      ? Math.max(0, (this.deadline - Date.now()) * this.state.speed)
      : this.state.remaining;
    this.cancel();
    this.set({
      playing: false,
      preparing: false,
      remaining,
      epoch: this.state.epoch + 1,
    });
  }
  setSpeed(speed: number) {
    if (![0.75, 1, 1.5, 2].includes(speed)) return;
    const remaining = this.state.playing
      ? Math.max(0, (this.deadline - Date.now()) * this.state.speed)
      : this.state.remaining;
    this.deadline = Date.now() + remaining / speed;
    this.set({ speed, remaining });
  }
  previous() {
    if (this.state.currentScene > 0)
      void this.select(this.state.currentScene - 1);
  }
  next() {
    if (
      this.state.track &&
      this.state.currentScene + 1 < this.state.track.scenes.length
    )
      void this.select(this.state.currentScene + 1);
  }
  fail(message: string) {
    this.pause();
    this.set({ error: message });
  }
  resume() {
    if (this.state.active)
      void this.select(
        this.state.currentScene,
        this.state.remaining || undefined,
      );
  }
  voice(enabled: boolean) {
    this.adapter.stop();
    this.set({ voice: enabled });
    if (enabled && this.state.playing) {
      const scene = this.state.track?.scenes[this.state.currentScene];
      if (scene) this.adapter.speak(scene.caption);
    }
  }
  async exit() {
    const snapshot = this.state.preEntrySnapshot;
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const epoch = this.state.epoch + 1;
    this.set({ playing: false, preparing: true, epoch });
    try {
      if (snapshot) await this.adapter.restore(snapshot, controller.signal);
      if (controller.signal.aborted || epoch !== this.state.epoch) return;
      this.set({
        active: false,
        preparing: false,
        preEntrySnapshot: null,
        track: null,
        error: null,
      });
    } catch (reason) {
      if (!controller.signal.aborted)
        this.set({
          preparing: false,
          error:
            reason instanceof Error ? reason.message : '恢复失败，请重试退出。',
        });
    }
  }
  takeover() {
    this.cancel();
    this.set({
      active: false,
      playing: false,
      preparing: false,
      preEntrySnapshot: null,
      epoch: this.state.epoch + 1,
      track: null,
      error: null,
    });
  }
  dispose() {
    this.cancel();
    this.listeners.clear();
  }
}
