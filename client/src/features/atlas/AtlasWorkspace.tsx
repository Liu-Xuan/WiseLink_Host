import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
import {
  Compass,
  FileText,
  Network,
  Layers,
  Workflow,
  Sun,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Maximize2,
} from 'lucide-react';
import type { Core } from 'cytoscape';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import {
  initialAtlasLocation,
  atlasRelationLabel,
  type AtlasLocation,
  type AtlasSnapshot,
} from './atlas-model';
import {
  readExample,
  exampleSources,
  exampleNodes,
  exampleEdges,
} from './example-provider';
import { atlasReadKey, useAtlasHost } from './useAtlasHost';
import AtlasGraph from './AtlasGraph';
import AtlasClassification from './AtlasClassification';
import AtlasExampleReading from './AtlasExampleReading';
import { GuideController } from './guide-controller';
import { atlasTitle, guideTracks, type GuideScene } from './guide-content';
import GuidePlayer from './GuidePlayer';
import iconCatalog from './data/icons.json';
import './atlas.css';
const viewLabels: Record<AtlasLocation['view'], string> = {
  network: '文档关系网',
  evidence: '依据与反证',
  anchors: '框架之外的锚点',
  documents: '工程文档',
  family: '文档族 / 版本',
  materials: '本次评估资料',
  initial: '初始综合评估',
  review: '工程师交互复核',
  synthesis: '复核后综合评估',
  library: '事项速览',
  classification: '分类骨架',
  domain: '技术领域',
  matter: '事项图谱',
  panorama: '全景',
  runtime: '工作线',
  source: '原文 / 来源',
};
const graphViews = new Set([
  'network',
  'evidence',
  'documents',
  'family',
  'source',
  'domain',
  'matter',
  'panorama',
]);
export default function AtlasWorkspace({
  workItemId = '',
  matterId = '',
  onClose,
  onNavigate,
  initialSnapshot,
  onSnapshot,
}: {
  initialSnapshot?: AtlasSnapshot;
  onSnapshot?: (snapshot: AtlasSnapshot) => void;
  workItemId?: string;
  matterId?: string;
  onClose: () => void;
  onNavigate: (route: string) => void;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const [displayError, setDisplayError] = useState('');
  const { theme, toggleTheme, visualMode, reduceTransparency } = useWlTheme();
  const [inspectorOpen, setInspectorOpen] = useState(
    initialSnapshot?.inspectorOpen ?? true,
  );
  const preferences = useRef({ theme, inspectorOpen });
  preferences.current = { theme, inspectorOpen };
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [location, setLocation] = useState<AtlasLocation>({
    ...initialAtlasLocation,
    effect: visualMode === 'ultra' ? 'highest' : visualMode,
    focus: matterId || workItemId,
    view: matterId ? 'matter' : 'documents',
    ...initialSnapshot?.location,
  });
  const locationRef = useRef(location);
  locationRef.current = location;
  const [draft, setDraft] = useState(initialSnapshot?.draft ?? '');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [retry, setRetry] = useState(0);
  const [help, setHelp] = useState(false);
  const [source, setSource] = useState<string | null>(
    initialSnapshot?.sourceRef ?? null,
  );
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const inspector = useRef<HTMLElement | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () =>
      setVoiceAvailable(
        window.speechSynthesis.getVoices().some((v) => v.lang.startsWith('zh')),
      );
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () =>
      window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  const body = useRef<HTMLDivElement>(null);
  const bodyScroll = useRef(0);
  const inspectorScroll = useRef(0);
  const cy = useRef<Core | null>(null);
  const ready = useRef(false);
  const readyKey = useRef('');
  const renderedKey = useRef('');
  const camera = useRef<{ pan: { x: number; y: number }; zoom: number } | null>(
    null,
  );
  const host = useAtlasHost(
    location,
    sessionGeneration,
    authenticationRequired,
    retry,
  );
  const hostStatus = useRef({ loading: host.loading, error: host.error });
  hostStatus.current = { loading: host.loading, error: host.error };
  const exampleGraph = useMemo(
    () => readExample(location),
    [
      location.view,
      location.focus,
      location.domain,
      location.history,
      location.lens,
      location.showMissing,
      location.showAttachments,
      location.showDerived,
      location.expanded,
      location.center,
      location.series,
      location.standard,
      location.includeUnknown,
      location.showDiscoveries,
      location.afterSnapshot,
    ],
  );
  const graph = location.space === 'EXAMPLE' ? exampleGraph : host.graph;
  const key = JSON.stringify([
    atlasReadKey(location, sessionGeneration),
    location.domain,
    location.history,
    location.effect,
    location.lens,
    location.showMissing,
    location.showAttachments,
    location.showDerived,
    location.expanded,
    location.layout,
    location.center,
  ]);
  const activeGraph = graphViews.has(location.view);
  const manualGuide = useRef<GuideController | null>(null);
  const change = useCallback((patch: Partial<AtlasLocation>) => {
    const playback = manualGuide.current?.getSnapshot();
    if (playback?.active && (playback.playing || playback.preparing))
      manualGuide.current?.pause();
    setSource(null);
    setLocation((current) => ({ ...current, ...patch }));
  }, []);
  const waitFor = useCallback(
    async (expected: AtlasLocation, signal: AbortSignal) => {
      const deadline = Date.now() + 15000;
      while (!signal.aborted) {
        if (
          expected.space === 'HOST' &&
          JSON.stringify(locationRef.current) === JSON.stringify(expected) &&
          hostStatus.current.error
        )
          throw new Error(hostStatus.current.error);
        if (
          JSON.stringify(locationRef.current) === JSON.stringify(expected) &&
          (expected.space !== 'HOST' || !hostStatus.current.loading) &&
          ready.current &&
          readyKey.current === renderedKey.current
        )
          return;
        if (Date.now() > deadline)
          throw new Error(
            '页面读取或布局未就绪，已暂停。可重试本幕或在此探索。',
          );
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 40);
          function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          }
          signal.addEventListener('abort', done, { once: true });
        });
      }
      throw new Error('已取消');
    },
    [],
  );
  const [guide] = useState(
    () =>
      new GuideController({
        capture: () => ({
          ...preferences.current,
          location: { ...locationRef.current },
          ...camera.current,
          scroll: body.current?.scrollTop ?? bodyScroll.current,
          draft: draftRef.current,
          sourceRef: sourceRef.current,
          inspectorScroll:
            inspector.current?.scrollTop ?? inspectorScroll.current,
        }),
        open: async (scene, signal) => {
          const next = {
            ...locationRef.current,
            space: 'EXAMPLE' as const,
            sidebarOpen: false,
            view: scene.view,
            focus: scene.focus ?? (scene.view === 'matter' ? 'mf-a' : 'sb-r1'),
            lens: 'relations' as const,
            showMissing: true,
            showAttachments: true,
            showDerived: false,
            history: false,
            expanded: false,
            layout: 'auto' as const,
            series: 'all' as const,
            standard: 'all' as const,
            includeUnknown: true,
            showDiscoveries: false,
            afterSnapshot: scene.view === 'matter',
            allLabels: false,
            domain: 'fmc',
            center: '',
            classificationNamespace: 'ispec' as const,
            classificationChapter: '34',
            classificationMode: 'graph' as const,
            selected:
              scene.focus ??
              (['documents', 'source', 'family'].includes(scene.view)
                ? 'sb-r1'
                : scene.view === 'matter'
                  ? 'mf-a'
                  : scene.view === 'domain'
                    ? 'fmc'
                    : ''),
            search: '',
            cursor: '',
          };
          setLocation(next);
          setInspectorOpen(
            ['graph', 'source'].includes(scene.target) &&
              scene.view !== 'panorama',
          );
          setSource(
            scene.view === 'source'
              ? (exampleNodes.find((n) => n.id === next.focus)?.sourceRefs[0] ??
                  null)
              : null,
          );
          await waitFor(next, signal);
          if (!signal.aborted && scene.focusArea === 'review-answer') {
            const answer = body.current?.querySelector(
              '.continuous-review-candidate',
            );
            if (!answer) throw new Error('本幕复核答复尚未就绪，已暂停。');
            if (body.current)
              body.current.scrollTop +=
                answer.getBoundingClientRect().top -
                body.current.getBoundingClientRect().top -
                20;
          }
        },
        ready: (scene) =>
          ready.current &&
          readyKey.current === renderedKey.current &&
          locationRef.current.space === 'EXAMPLE' &&
          locationRef.current.view === scene.view &&
          (!scene.focusArea ||
            !!body.current?.querySelector('.continuous-review-candidate')) &&
          (scene.target !== 'graph' ||
            !locationRef.current.selected ||
            !!cy.current?.getElementById(locationRef.current.selected)
              .length) &&
          Boolean(
            body.current?.querySelector(
              `[data-atlas-target="${scene.target}"]`,
            ),
          ),
        restore: async (snapshot, signal) => {
          setLocation({ ...snapshot.location });
          if (snapshot.theme && snapshot.theme !== preferences.current.theme)
            toggleTheme();
          setInspectorOpen(snapshot.inspectorOpen ?? true);
          setDraft(snapshot.draft);
          setSource(snapshot.sourceRef ?? null);
          await waitFor(snapshot.location, signal);
          if (signal.aborted) return;
          if (snapshot.pan && snapshot.zoom)
            cy.current?.viewport({ pan: snapshot.pan, zoom: snapshot.zoom });
          if (body.current) body.current.scrollTop = snapshot.scroll;
          if (inspector.current)
            inspector.current.scrollTop = snapshot.inspectorScroll ?? 0;
        },
        speak: (text) => {
          if (!('speechSynthesis' in window)) return;
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'zh-CN';
          const epoch = guide.getSnapshot().epoch;
          utterance.onerror = (e) => {
            if (
              e.error !== 'canceled' &&
              e.error !== 'interrupted' &&
              guide.getSnapshot().epoch === epoch
            )
              guide.fail('语音播放不可用，已暂停；字幕仍可阅读。');
          };
          window.speechSynthesis.speak(utterance);
        },
        stop: () => {
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
          cy.current?.stop();
        },
      }),
  );
  manualGuide.current = guide;
  const state = useSyncExternalStore(guide.subscribe, guide.getSnapshot);
  useEffect(() => {
    const exit = () => {
      void guide.exit();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        !guide.getSnapshot().active ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            'input, textarea, select, button, a, summary, [contenteditable=true]',
          ))
      )
        return;
      if (
        event.key === ' ' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        event.preventDefault();
        if (event.key === ' ') {
          if (guide.getSnapshot().playing) guide.pause();
          else guide.resume();
        }
        if (event.key === 'ArrowLeft') guide.previous();
        if (event.key === 'ArrowRight') guide.next();
      }
    };
    window.addEventListener('atlas-exit-guide', exit);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('atlas-exit-guide', exit);
      window.removeEventListener('keydown', keyboard);
    };
  }, [guide]);
  const saveSnapshot = useRef(onSnapshot);
  saveSnapshot.current = onSnapshot;
  useEffect(
    () => () => {
      const previous = guide.getSnapshot().preEntrySnapshot;
      if (previous?.theme && previous.theme !== preferences.current.theme)
        toggleTheme();
      saveSnapshot.current?.(
        guide.getSnapshot().preEntrySnapshot ?? {
          ...preferences.current,
          location: { ...locationRef.current },
          ...camera.current,
          scroll: body.current?.scrollTop ?? bodyScroll.current,
          draft: draftRef.current,
          sourceRef: sourceRef.current,
          inspectorScroll:
            inspector.current?.scrollTop ?? inspectorScroll.current,
        },
      );
      guide.dispose();
    },
    [guide, toggleTheme],
  );
  useEffect(() => {
    if (!initialSnapshot) return;
    const controller = new AbortController();
    void waitFor(initialSnapshot.location, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        if (initialSnapshot.pan && initialSnapshot.zoom)
          cy.current?.viewport({
            pan: initialSnapshot.pan,
            zoom: initialSnapshot.zoom,
          });
        if (body.current) body.current.scrollTop = initialSnapshot.scroll;
        if (inspector.current)
          inspector.current.scrollTop = initialSnapshot.inspectorScroll ?? 0;
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          guide.fail(error instanceof Error ? error.message : '恢复视图失败');
      });
    return () => controller.abort();
  }, [initialSnapshot, waitFor, guide]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) guide.pause();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [guide]);
  useEffect(() => {
    if (authenticationRequired && location.space === 'HOST')
      ready.current = false;
  }, [authenticationRequired, location.space]);
  useEffect(() => {
    renderedKey.current = key;
    if (activeGraph) return;
    ready.current = false;
    const id = requestAnimationFrame(() => {
      ready.current =
        location.space === 'EXAMPLE' || (!host.loading && !host.error);
      readyKey.current = key;
    });
    return () => cancelAnimationFrame(id);
  }, [key, activeGraph, host.loading, host.error, location.space]);
  const graphReady = useCallback(
    (value: boolean) => {
      ready.current = value;
      readyKey.current = key;
      renderedKey.current = key;
    },
    [key],
  );
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [location.view]);
  const userAction = () => {
    if (state.active && (state.playing || state.preparing)) guide.pause();
  };
  const chooseView = (view: AtlasLocation['view']) => {
    userAction();
    change({
      view,
      sidebarOpen: false,
      selected: '',
      focus:
        location.space === 'EXAMPLE'
          ? 'sb-r1'
          : view === 'matter'
            ? matterId
            : workItemId,
    });
  };
  const selectedNode = graph.nodes.find((n) => n.id === location.selected);
  const selectedEdge = graph.edges.find((e) => e.id === location.selected);
  const selectedSources =
    selectedNode?.sourceRefs ?? selectedEdge?.sourceRefs ?? [];
  function navigateDocument(
    id: string,
    sourceRef?: string,
    documentVersionId?: string,
  ) {
    onNavigate(
      `/work-items/${encodeURIComponent(id)}/documents?node=reader${sourceRef ? `&sourceRef=${encodeURIComponent(sourceRef)}` : ''}${documentVersionId ? `&documentVersionId=${encodeURIComponent(documentVersionId)}` : ''}`,
    );
  }
  function enterScene(trackIndex: number, index: number) {
    guide.start(guideTracks[trackIndex]);
    if (index !== 0) void guide.select(index);
    setHelp(false);
  }
  return (
    <div
      className="atlas-workspace"
      ref={workspace}
      data-guide-target={
        state.active
          ? state.track?.scenes[state.currentScene]?.target
          : undefined
      }
      data-theme={theme}
      data-effect={location.effect}
      data-transparency={reduceTransparency ? 'reduced' : 'full'}
      data-guiding={state.active}
    >
      <aside className="atlas-rail" aria-label="工作台导航">
        <span className="atlas-monogram">W</span>
        <button title="工程文档" onClick={() => chooseView('documents')}>
          <FileText />
        </button>
        <button title="全景数据" onClick={() => chooseView('panorama')}>
          <Network />
        </button>
        <button title="分类骨架" onClick={() => chooseView('classification')}>
          <Layers />
        </button>
        <button title="工程工作线" onClick={() => chooseView('runtime')}>
          <Workflow />
        </button>
        <button title="使用介绍" onClick={() => setHelp(!help)}>
          <Compass />
        </button>
      </aside>
      <div className="atlas-frame">
        <header className="atlas-header">
          <div>
            <span className="atlas-eyebrow">WISELINK · GUIDED ATLAS</span>
            <h1 title={atlasTitle}>图谱与工程工作线</h1>
          </div>
          <nav className="atlas-perspectives" aria-label="主视角">
            {(['documents', 'panorama', 'domain', 'matter'] as const).map(
              (view) => (
                <button
                  key={view}
                  aria-pressed={location.view === view}
                  onClick={() => chooseView(view)}
                >
                  {viewLabels[view]}
                </button>
              ),
            )}
          </nav>
          <div className="atlas-header-actions">
            <button
              aria-label="切换图谱全屏"
              onClick={async () => {
                userAction();
                try {
                  if (document.fullscreenElement === workspace.current)
                    await document.exitFullscreen();
                  else await workspace.current?.requestFullscreen();
                  setDisplayError('');
                } catch {
                  setDisplayError(
                    '浏览器未允许全屏；仍可在当前工作台继续阅读。',
                  );
                }
              }}
            >
              <Maximize2 />
            </button>
            <button
              aria-label="切换图谱主题"
              onClick={() => {
                userAction();
                toggleTheme();
              }}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
          </div>
          <button
            onClick={() => {
              guide.dispose();
              onClose();
            }}
            aria-label="关闭图谱并返回阅读"
          >
            关闭并返回
          </button>
        </header>
        <div className="atlas-controls">
          <button
            className="atlas-mobile-scope"
            aria-expanded={!!location.sidebarOpen}
            onClick={() => change({ sidebarOpen: !location.sidebarOpen })}
          >
            范围与目录
          </button>
          <label>
            资料空间{' '}
            <select
              value={location.space}
              onChange={(e) => {
                guide.takeover();
                change({
                  space: e.target.value as AtlasLocation['space'],
                  view: 'documents',
                  focus: e.target.value === 'EXAMPLE' ? 'sb-r1' : workItemId,
                  selected: '',
                  cursor: '',
                  search: '',
                });
              }}
            >
              <option value="HOST">真实授权资料</option>
              <option value="EXAMPLE">独立示例空间</option>
            </select>
          </label>
          <span className={`atlas-space is-${location.space}`}>
            {location.view === 'classification'
              ? '附件分类原值 · 非机队构型'
              : location.space === 'EXAMPLE'
                ? '构造样例 · 非实际机队状态'
                : 'Host 授权只读'}
          </span>
          <label>
            效果{' '}
            <select
              aria-label="图谱效果"
              value={location.effect}
              onChange={(e) => {
                userAction();
                change({ effect: e.target.value as AtlasLocation['effect'] });
              }}
            >
              <option value="default">默认</option>
              <option value="highest">最高</option>
              <option value="compatible">兼容</option>
            </select>
          </label>
          <button
            onClick={() => {
              userAction();
              setHelp(!help);
            }}
          >
            使用介绍与逐幕讲解
          </button>
        </div>
        {displayError ? <p role="alert">{displayError}</p> : null}
        <div className="atlas-workarea">
          <nav
            className={`atlas-tabs ${location.sidebarOpen ? 'is-expanded' : ''}`}
            aria-label="图谱观察方式"
          >
            <span className="atlas-sidebar-label">探索范围</span>
            {Object.entries(viewLabels).map(([view, label]) => (
              <button
                key={view}
                aria-pressed={location.view === view}
                onClick={() => chooseView(view as AtlasLocation['view'])}
              >
                {label}
              </button>
            ))}
            {location.space === 'EXAMPLE' && location.view === 'domain' ? (
              <div className="atlas-scope-controls">
                <span className="atlas-sidebar-label">观察范围</span>
                <label>
                  737 系列
                  <select
                    aria-label="观察系列"
                    value={location.series ?? 'all'}
                    onChange={(e) =>
                      change({
                        series: e.target.value as AtlasLocation['series'],
                        selected: '',
                      })
                    }
                  >
                    <option value="all">全部系列</option>
                    <option value="NG">NG</option>
                    <option value="MAX">MAX</option>
                  </select>
                </label>
                <label>
                  软件标准
                  <select
                    aria-label="观察软件标准"
                    value={location.standard ?? 'all'}
                    onChange={(e) =>
                      change({
                        standard: e.target.value as AtlasLocation['standard'],
                        selected: '',
                      })
                    }
                  >
                    <option value="all">全部标准</option>
                    <option value="A">标准 A</option>
                    <option value="B">标准 B</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={location.includeUnknown !== false}
                    onChange={(e) =>
                      change({ includeUnknown: e.target.checked })
                    }
                  />
                  保留范围待核
                </label>
                <button onClick={() => change({ center: '', selected: '' })}>
                  返回领域中心
                </button>
              </div>
            ) : null}
            {location.space === 'EXAMPLE' && activeGraph ? (
              <div className="atlas-scope-controls">
                <label>
                  <input
                    type="checkbox"
                    checked={!!location.showDiscoveries}
                    onChange={(e) =>
                      change({ showDiscoveries: e.target.checked })
                    }
                  />
                  显示发现线索
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!location.allLabels}
                    onChange={(e) => change({ allLabels: e.target.checked })}
                  />
                  显示全部标签
                </label>
                {['matter', 'evidence', 'domain'].includes(location.view) ? (
                  <label>
                    示例快照
                    <select
                      aria-label="预置示例快照"
                      value={location.afterSnapshot ? 'after' : 'before'}
                      onChange={(e) =>
                        change({
                          afterSnapshot: e.target.value === 'after',
                          selected: '',
                        })
                      }
                    >
                      <option value="before">初始已登记资料</option>
                      <option value="after">复核后预置快照</option>
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}
          </nav>
          {help ? (
            <section className="atlas-help">
              <h2>先看清单项工作，再了解整体</h2>
              <p>
                从工程文件出发，围绕事项形成完整背景，通过初评、交互核对和重新综合，持续完善工程认识。各事项的背景、措施、认识和进展汇集起来，让工程师、相关技术人员和管理人员快速了解整体，并随时深入依据。
              </p>
              {guideTracks.map((track, t) => (
                <details key={track.id}>
                  <summary>
                    {track.title} · {track.scenes.length} 幕 ·{' '}
                    {track.scenes.reduce((n, s) => n + s.seconds, 0)} 秒预设停留
                  </summary>
                  <button onClick={() => enterScene(t, 0)}>播放本路线</button>
                  <ol>
                    {track.scenes.map((s, i) => (
                      <li key={s.id}>
                        <button onClick={() => enterScene(t, i)}>
                          {s.title}
                        </button>
                        <p>{s.caption}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </section>
          ) : null}
          <div
            className="atlas-body"
            ref={body}
            onScroll={(event) => {
              bodyScroll.current = event.currentTarget.scrollTop;
            }}
            onPointerDownCapture={userAction}
            onClickCapture={userAction}
            onKeyDownCapture={(event) => {
              if (![' ', 'ArrowLeft', 'ArrowRight'].includes(event.key))
                userAction();
            }}
            onWheelCapture={userAction}
          >
            {location.space === 'HOST' && host.loading ? (
              <p role="status">正在读取授权资料…</p>
            ) : null}
            {location.space === 'HOST' && host.error ? (
              <div role="alert">
                {host.error}{' '}
                <button onClick={() => setRetry((n) => n + 1)}>重新读取</button>
              </div>
            ) : null}
            {location.view === 'classification' ? (
              <AtlasClassification
                location={location}
                onLocation={change}
                query={location.search}
                page={Number(location.cursor) || 0}
                onChange={(search, page) =>
                  change({ search, cursor: String(page) })
                }
              />
            ) : null}
            {location.space === 'EXAMPLE' &&
            !activeGraph &&
            location.view !== 'classification' ? (
              <AtlasExampleReading
                view={location.view}
                draft={draft}
                onDraft={setDraft}
                selectedClaim={location.selected}
                onSelectClaim={(selected) => change({ selected })}
                runtimeIndex={Number(location.cursor) || 0}
                onRuntimeChange={(index) => change({ cursor: String(index) })}
              />
            ) : null}
            {location.space === 'HOST' &&
              !host.loading &&
              host.graph.notices.map((n) => (
                <p className="atlas-notice" key={n}>
                  {n}
                </p>
              ))}
            {activeGraph ||
            (location.space === 'HOST' && location.view === 'library') ? (
              <>
                <div className="atlas-controls">
                  {location.space === 'EXAMPLE' ? (
                    <input
                      aria-label="查找当前范围对象"
                      placeholder="查找对象或版本"
                      value={location.search}
                      onChange={(e) => {
                        setInspectorOpen(true);
                        change({ search: e.target.value });
                      }}
                    />
                  ) : null}
                  {location.space === 'HOST' ? (
                    <>
                      <input
                        aria-label="搜索授权文档"
                        placeholder="文档编号或名称"
                        value={location.search}
                        onChange={(e) =>
                          change({
                            search: e.target.value,
                            cursor: '',
                            focus: '',
                          })
                        }
                      />
                      <button onClick={() => change({ focus: '', cursor: '' })}>
                        授权目录
                      </button>
                      {host.nextCursor ? (
                        <button
                          onClick={() =>
                            change({
                              cursor: host.nextCursor ?? '',
                              selected: '',
                            })
                          }
                        >
                          下一页
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {location.space === 'EXAMPLE' &&
                  location.view === 'documents' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={location.history}
                        onChange={(e) => change({ history: e.target.checked })}
                      />
                      显示修订历史
                    </label>
                  ) : null}
                  {location.space === 'EXAMPLE' &&
                  ['documents', 'source'].includes(location.view) ? (
                    <>
                      <select
                        aria-label="引用方向"
                        value={location.lens ?? 'relations'}
                        onChange={(e) =>
                          change({
                            lens: e.target.value as AtlasLocation['lens'],
                          })
                        }
                      >
                        <option value="relations">全部关系</option>
                        <option value="outgoing">向外引用</option>
                        <option value="incoming">被哪些文件引用</option>
                      </select>
                      <label>
                        <input
                          type="checkbox"
                          checked={location.showMissing !== false}
                          onChange={(e) =>
                            change({ showMissing: e.target.checked })
                          }
                        />
                        待补资料
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={location.showAttachments !== false}
                          onChange={(e) =>
                            change({ showAttachments: e.target.checked })
                          }
                        />
                        附属资料
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!location.showDerived}
                          onChange={(e) =>
                            change({ showDerived: e.target.checked })
                          }
                        />
                        翻译与已存意见
                      </label>
                    </>
                  ) : null}
                  {location.space === 'EXAMPLE' &&
                  location.view === 'matter' ? (
                    <select
                      aria-label="工程事项"
                      value={
                        exampleNodes.some(
                          (n) => n.kind === 'matter' && n.id === location.focus,
                        )
                          ? location.focus
                          : 'mf-a'
                      }
                      onChange={(e) =>
                        change({ focus: e.target.value, selected: '' })
                      }
                    >
                      {exampleNodes
                        .filter((n) => n.kind === 'matter' && !n.afterOnly)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.code} · {n.title}
                          </option>
                        ))}
                    </select>
                  ) : null}
                  {location.space === 'EXAMPLE' &&
                  ['domain', 'matter', 'evidence'].includes(location.view) ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={!!location.expanded}
                        onChange={(e) => change({ expanded: e.target.checked })}
                      />
                      展开资料
                    </label>
                  ) : null}
                  <select
                    aria-label="图谱布局"
                    value={location.layout ?? 'auto'}
                    onChange={(e) =>
                      change({
                        layout: e.target.value as AtlasLocation['layout'],
                      })
                    }
                  >
                    <option value="auto">语义布局</option>
                    <option value="concentric">同心</option>
                    <option value="circle">环形</option>
                    <option value="breadthfirst">层级</option>
                    <option value="cose">力导向</option>
                    <option value="grid">网格</option>
                  </select>
                  {location.view === 'domain' ? (
                    <select
                      aria-label="技术领域"
                      value={location.domain}
                      onChange={(e) =>
                        change({
                          domain: e.target.value,
                          center: '',
                          selected: '',
                        })
                      }
                    >
                      <option value="fmc">飞行管理计算机</option>
                      <option value="display">显示技术领域</option>
                    </select>
                  ) : null}
                  <strong className="atlas-view-title">
                    {viewLabels[location.view]}
                  </strong>
                  <span className="atlas-count">
                    {graph.nodes.length} 对象 · {graph.edges.length} 关系
                  </span>
                  <button
                    aria-label="缩小图谱"
                    onClick={() => cy.current?.zoom(cy.current.zoom() / 1.2)}
                  >
                    −
                  </button>
                  <button
                    aria-label="放大图谱"
                    onClick={() => cy.current?.zoom(cy.current.zoom() * 1.2)}
                  >
                    ＋
                  </button>
                  <button
                    aria-label="切换对象详情"
                    onClick={() => setInspectorOpen(!inspectorOpen)}
                  >
                    {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
                  </button>
                  <button onClick={() => cy.current?.fit(undefined, 45)}>
                    全图适配
                  </button>
                  <button
                    onClick={() => {
                      const uri = cy.current?.png({
                        full: true,
                        scale: 1,
                        maxWidth: 2400,
                        maxHeight: 1600,
                      });
                      if (uri) {
                        const a = document.createElement('a');
                        a.href = uri;
                        a.download = `WiseLink-${location.space}-${location.view}.png`;
                        a.click();
                      }
                    }}
                  >
                    导出当前图
                  </button>
                </div>
                <div
                  className={`atlas-grid ${inspectorOpen ? '' : 'without-inspector'}`}
                >
                  <div className="atlas-canvas-region">
                    <header className="atlas-scene-heading">
                      <span className="atlas-eyebrow">
                        {location.space === 'EXAMPLE'
                          ? 'EXAMPLE · 独立资料空间'
                          : 'HOST · 授权资料'}
                      </span>
                      <h2>
                        {location.view === 'domain'
                          ? location.domain === 'fmc'
                            ? 'FMC · 飞行管理计算机'
                            : '显示技术领域'
                          : viewLabels[location.view]}
                      </h2>
                      <p>
                        {location.view === 'domain'
                          ? '稳定技术对象连接多项工程事项；同域不意味着同一原因。'
                          : location.view === 'network'
                            ? '先看文档族之间的联系，再深入确切版本与原始引用。'
                            : location.view === 'panorama'
                              ? '从每项认识了解整体，随时返回事项和确切依据。'
                              : location.view === 'evidence'
                                ? '支持与限制一起阅读；资料范围不等于结论适用范围。'
                                : '保留主题、版本与来源，沿有依据的关系继续深入。'}
                      </p>
                    </header>
                    <AtlasGraph
                      graph={graph}
                      location={location}
                      onSelect={(selected) => change({ selected })}
                      onReady={graphReady}
                      onCamera={(pan, zoom) => {
                        camera.current = { pan, zoom };
                      }}
                      api={cy}
                    />
                  </div>
                  <aside
                    className="atlas-inspector"
                    ref={inspector}
                    onScroll={(event) => {
                      inspectorScroll.current = event.currentTarget.scrollTop;
                    }}
                    hidden={!inspectorOpen}
                  >
                    <span className="atlas-eyebrow">对象与依据</span>
                    <h2>
                      {selectedNode?.title ??
                        (selectedEdge
                          ? atlasRelationLabel(selectedEdge.kind)
                          : undefined) ??
                        '选择一个对象或关系'}
                    </h2>
                    <p>
                      {selectedNode?.summary ??
                        selectedEdge?.explanation ??
                        '查看主题、版本与来源；图中的连线不表示措施已经实施。'}
                    </p>
                    {selectedNode?.version ? (
                      <p>确切版本：{selectedNode.version}</p>
                    ) : null}
                    {selectedNode ? (
                      <button
                        onClick={() => {
                          const node = cy.current?.getElementById(
                            selectedNode.id,
                          );
                          if (!node?.length) return;
                          if (
                            window.matchMedia(
                              '(prefers-reduced-motion: reduce)',
                            ).matches ||
                            location.effect === 'compatible'
                          )
                            cy.current?.fit(node.closedNeighborhood(), 60);
                          else
                            cy.current?.animate({
                              fit: {
                                eles: node.closedNeighborhood(),
                                padding: 60,
                              },
                              duration: 350,
                            });
                        }}
                      >
                        聚焦此对象与直接关系
                      </button>
                    ) : null}
                    {location.space === 'EXAMPLE' &&
                    location.view === 'domain' &&
                    selectedNode ? (
                      <button
                        onClick={() =>
                          change({
                            center: selectedNode.id,
                            selected: selectedNode.id,
                          })
                        }
                      >
                        以此技术对象为中心
                      </button>
                    ) : null}
                    {location.space === 'EXAMPLE' &&
                    selectedNode &&
                    ['document', 'reference'].includes(selectedNode.kind) ? (
                      <button
                        onClick={() =>
                          change({
                            view: 'documents',
                            focus: selectedNode.id,
                            selected: selectedNode.id,
                          })
                        }
                      >
                        以此确切版本为中心
                      </button>
                    ) : null}
                    {location.space === 'EXAMPLE' && selectedNode?.familyId ? (
                      <button
                        onClick={() =>
                          change({
                            view: 'family',
                            focus: selectedNode.id,
                            selected: '',
                          })
                        }
                      >
                        文档族与版本
                      </button>
                    ) : null}
                    {selectedNode?.workItemId ? (
                      <>
                        <button
                          onClick={() =>
                            change({
                              view: 'documents',
                              focus: selectedNode.workItemId!,
                              selected: '',
                            })
                          }
                        >
                          读取此确切版本关系
                        </button>
                        <button
                          onClick={() =>
                            navigateDocument(
                              selectedNode.workItemId!,
                              undefined,
                              selectedNode.documentVersionId,
                            )
                          }
                        >
                          进入原文与已有意见
                        </button>
                        <button
                          onClick={() =>
                            change({
                              view: 'family',
                              focus: selectedNode.workItemId!,
                              selected: '',
                            })
                          }
                        >
                          文档族与版本
                        </button>
                      </>
                    ) : null}
                    {selectedEdge?.memberEdgeRefs ? (
                      <section>
                        <h3>版本级原始引用</h3>
                        <p>
                          这里是文档族的显示聚合，不表示整族或所有版本通用。
                        </p>
                        {selectedEdge.memberEdgeRefs.map((id) => {
                          const edge = exampleEdges.find((e) => e.id === id);
                          if (!edge) return null;
                          const from = exampleNodes.find(
                            (n) => n.id === edge.source,
                          );
                          const to = exampleNodes.find(
                            (n) => n.id === edge.target,
                          );
                          return (
                            <button
                              key={id}
                              onClick={() =>
                                change({
                                  view: 'documents',
                                  focus: edge.source,
                                  selected: edge.target,
                                })
                              }
                            >
                              {from?.code} {from?.version} → {to?.code}{' '}
                              {to?.version}
                            </button>
                          );
                        })}
                      </section>
                    ) : null}
                    {selectedSources.map((ref) => (
                      <button key={ref} onClick={() => setSource(ref)}>
                        来源 {ref}
                      </button>
                    ))}
                    {source ? (
                      <section data-atlas-target="source">
                        <h3>来源位置</h3>
                        {location.space === 'EXAMPLE' ? (
                          <>
                            <p>{exampleSources[source]?.title ?? source}</p>
                            <p>{exampleSources[source]?.section}</p>
                            <p>
                              {exampleSources[source]?.text ??
                                '样例仅登记来源标识，未提供正文。'}
                            </p>
                          </>
                        ) : (
                          <>
                            <p>{source}</p>
                            {host.preview?.mentions
                              .filter((m) => m.sourceRefIds.includes(source))
                              .flatMap((m) =>
                                m.sourceLocators
                                  .filter((l) => l.sourceRefId === source)
                                  .map((l, i) => (
                                    <p key={`${m.mentionId}:${i}`}>
                                      {l.quote ?? '已登记位置，无引文返回'}
                                    </p>
                                  )),
                              )}
                            <button
                              onClick={() =>
                                navigateDocument(
                                  location.focus,
                                  source,
                                  host.quicklook?.document.documentVersionId,
                                )
                              }
                            >
                              在引用方原文定位
                            </button>
                          </>
                        )}
                      </section>
                    ) : null}
                    <details>
                      <summary>图例与关系含义</summary>
                      {Object.values(iconCatalog.categories)
                        .filter((category) =>
                          graph.nodes.some(
                            (node) => node.kind === category.key,
                          ),
                        )
                        .map((category) => (
                          <p key={category.key}>
                            <strong style={{ color: category[theme] }}>
                              {category.label}
                            </strong>
                            <br />
                            {category.description}
                          </p>
                        ))}
                      <p>
                        实线与箭头保留关系方向；虚线区分修订或待核线索。色彩表示资料类型，不表示批准或风险等级。
                      </p>
                    </details>
                    <details open={location.search ? true : undefined}>
                      <summary>等价对象列表 · {graph.nodes.length}</summary>
                      {graph.nodes
                        .filter(
                          (n) =>
                            !location.search ||
                            `${n.code} ${n.title} ${n.version ?? ''}`
                              .toLowerCase()
                              .includes(location.search.toLowerCase()),
                        )
                        .map((n) => (
                          <button
                            className="atlas-object"
                            key={n.id}
                            aria-pressed={location.selected === n.id}
                            onClick={() => change({ selected: n.id })}
                          >
                            <strong>
                              {n.code} {n.version}
                            </strong>
                            <span>{n.title}</span>
                          </button>
                        ))}
                    </details>
                    <details>
                      <summary>关系 · {graph.edges.length}</summary>
                      {graph.edges.map((e) => (
                        <button
                          className="atlas-object"
                          key={e.id}
                          onClick={() => change({ selected: e.id })}
                        >
                          {atlasRelationLabel(e.kind)} ·{' '}
                          {e.explanation ?? `${e.source} → ${e.target}`}
                        </button>
                      ))}
                    </details>
                  </aside>
                </div>
              </>
            ) : null}
            {location.space === 'HOST' && host.reading ? (
              <SavedAssessmentReading
                result={host.reading}
                onLocateDocument={(e) =>
                  navigateDocument(
                    e.workItemId,
                    e.sourceRefId,
                    e.documentVersionId,
                  )
                }
              />
            ) : null}
            {location.space === 'HOST' && host.quicklook && !host.reading ? (
              <section className="atlas-reading">
                <h2>同版已保存意见</h2>
                <p>
                  {host.quicklook.result?.overallCandidate ??
                    '当前没有可读取的保存意见。'}
                </p>
                <p>
                  {host.quicklook.result
                    ? '候选意见，尚非正式实施决定。'
                    : '不在读取时生成意见。'}
                </p>
              </section>
            ) : null}
            {location.space === 'HOST' && host.readMs !== undefined ? (
              <p className="atlas-metrics">
                本次 Host 读取 {host.readMs} ms · 图渲染时间单独记录 ·
                未调用模型
              </p>
            ) : null}
          </div>
        </div>
        <GuidePlayer
          guide={guide}
          state={state}
          voiceAvailable={voiceAvailable}
          onStart={() => setHelp(false)}
        />
      </div>
    </div>
  );
}
