import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
  Compass,
} from 'lucide-react';
import type { GuideController, GuideState } from './guide-controller';
import { guideTracks } from './guide-content';
export default function GuidePlayer({
  guide,
  state,
  voiceAvailable,
  onStart,
}: {
  guide: GuideController;
  state: GuideState;
  voiceAvailable: boolean;
  onStart: () => void;
}) {
  const scene = state.track?.scenes[state.currentScene];
  return (
    <footer
      className={`atlas-guide ${state.active ? 'is-active' : ''}`}
      aria-label="自动演示控制"
    >
      {!state.active ? (
        <>
          <span>沿工程工作线了解 WiseLink</span>
          {guideTracks.map((track) => (
            <button
              key={track.id}
              onClick={() => {
                onStart();
                guide.start(track);
              }}
            >
              <Play aria-hidden="true" />
              {track.title}
            </button>
          ))}
        </>
      ) : (
        <>
          <div className="atlas-guide-meta">
            <span className="atlas-guide-dot" />
            {state.track?.title}
            <span>
              {state.currentScene + 1} / {state.track?.scenes.length}
            </span>
            <span>演示回放 · 独立示例</span>
          </div>
          <div className="atlas-caption" aria-live="polite">
            <strong>{scene?.title}</strong>
            <p>{scene?.caption}</p>
            {state.error ? <p role="alert">{state.error}</p> : null}
          </div>
          <div className="atlas-guide-bottom">
            <span className="atlas-guide-status">
              {state.preparing
                ? '等待页面与目标就绪'
                : state.playing
                  ? '正在讲解'
                  : '已暂停'}{' '}
              · {Math.ceil(state.remaining / 1000)} 秒
            </span>
            <div className="atlas-controls">
              <button
                aria-label="上一幕"
                disabled={state.currentScene === 0}
                onClick={() => guide.previous()}
              >
                <ChevronLeft />
              </button>
              <button
                className="atlas-play"
                aria-label={
                  state.preparing
                    ? '目标准备中'
                    : state.playing
                      ? '暂停'
                      : '继续'
                }
                disabled={state.preparing}
                onClick={() => (state.playing ? guide.pause() : guide.resume())}
              >
                {state.playing ? <Pause /> : <Play />}
              </button>
              <button
                aria-label="下一幕"
                disabled={
                  state.currentScene + 1 === (state.track?.scenes.length ?? 0)
                }
                onClick={() => guide.next()}
              >
                <ChevronRight />
              </button>
              <select
                aria-label="跳转讲解章节"
                value={state.currentScene}
                onChange={(e) => void guide.select(Number(e.target.value))}
              >
                {state.track?.scenes.map((s, i) => (
                  <option key={s.id} value={i}>
                    {i + 1} · {s.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="讲解倍速"
                value={state.speed}
                onChange={(e) => guide.setSpeed(Number(e.target.value))}
              >
                {[0.75, 1, 1.5, 2].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
              <button
                aria-label={state.voice ? '关闭语音' : '开启语音'}
                aria-pressed={state.voice}
                disabled={!voiceAvailable}
                title={
                  voiceAvailable
                    ? '可选中文语音'
                    : '当前没有可用中文语音，字幕保持可读'
                }
                onClick={() => guide.voice(!state.voice)}
              >
                {state.voice ? <Volume2 /> : <VolumeX />}
                <span>{state.voice ? '语音开' : '语音关'}</span>
              </button>
              <button onClick={() => guide.takeover()}>
                <Compass />
                <span>在此探索</span>
              </button>
              <button
                aria-label="退出演示并恢复"
                onClick={() => void guide.exit()}
              >
                <X />
              </button>
            </div>
            <small>空格 暂停／继续 · ← → 切幕 · Esc 退出</small>
          </div>
          <div
            className="atlas-guide-progress"
            style={{
              transform: `scaleX(${scene ? 1 - state.remaining / (scene.seconds * 1000) : 0})`,
            }}
          />
        </>
      )}
    </footer>
  );
}
