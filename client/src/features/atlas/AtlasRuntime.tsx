import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
const stages = [
  [
    '资料与版本',
    '先保存来源与确切版本',
    'SB R1 引用 FTD R3；库内 R4 不替换已有引用。',
  ],
  [
    '连续源文',
    '保留完整语义与来源位置',
    '条件、限制、正文和引用位置一起进入阅读。',
  ],
  [
    '汇集资料',
    '按问题取得真正有关的材料',
    '已取得正文与仅登记引用分开；未取得正文不算已读依据。',
  ],
  [
    '事项背景',
    '形成共同背景与待核问题',
    '条件 X 与 Y 有背景联系，但不能据此合并机理或措施范围。',
  ],
  [
    '问题分析',
    '分开措施、条件与实际状态',
    '资料提出措施不等于我方已采用，也不等于实际执行完成。',
  ],
  [
    '初始综合',
    '保存有边界的候选认识',
    '各阅读入口引用同一份候选；未知和限制保留在正文中。',
  ],
  [
    '交互核对',
    '工程师补充现场事实',
    '记录反映标准 A；是否意味着改进完成，需要分别核对。',
  ],
  [
    '补充记录',
    '核对新材料及其覆盖范围',
    '标准字段有依据，子集与执行证据仍未取得。',
  ],
  [
    '整理认识',
    '保留变化、不变与分歧',
    '软件标准与实施状态分开。条件 Y 的解释仍待补充。',
  ],
  [
    '重新综合',
    '显式纳入受影响内容',
    '普通解释不重写综合；重要材料变化使旧意见需要复看。',
  ],
  [
    '事项速览',
    '从同一结果读取整体认识',
    '速览保留措施范围、候选意见、实际实施未知三者的区别。',
  ],
  [
    '整体联系',
    '回到领域与机队技术全貌',
    '多个事项的背景、依据与进展汇集，仍可返回确切来源。',
  ],
];
export default function AtlasRuntime({
  index,
  onChange,
}: {
  index: number;
  onChange: (index: number) => void;
}) {
  const { theme } = useWlTheme();
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<cytoscape.Core | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const selected = Math.max(0, Math.min(stages.length - 1, index));
  useEffect(() => {
    if (!container.current) return;
    const dark = theme === 'dark';
    const graph = cytoscape({
      container: container.current,
      elements: [
        ...stages.map(([label], i) => ({
          data: {
            id: String(i),
            label: `${String(i + 1).padStart(2, '0')}  ${label}`,
          },
        })),
        ...stages.slice(1).map((_, i) => ({
          data: { id: `e${i}`, source: String(i), target: String(i + 1) },
        })),
        { data: { id: 'feedback', source: '9', target: '4' } },
      ],
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            width: 145,
            height: 56,
            label: 'data(label)',
            'text-valign': 'center',
            'font-size': 13,
            color: dark ? '#e4e6da' : '#474c3f',
            'background-color': dark ? '#30312b' : '#eff0e9',
            'border-width': 1,
            'border-color': dark ? '#55594b' : '#c6ccb9',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.4,
            'line-color': '#929a82',
            'target-arrow-color': '#929a82',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            opacity: 0.6,
          },
        },
        {
          selector: 'node.active',
          style: {
            'border-width': 3,
            'border-color': '#b09a68',
            'background-color': dark ? '#534c38' : '#e9e1c9',
          },
        },
        {
          selector: 'edge[id="feedback"]',
          style: {
            'line-style': 'dashed',
            'curve-style': 'unbundled-bezier',
            'control-point-distances': 50,
            'control-point-weights': 0.5,
          },
        },
      ],
      layout: {
        name: 'grid',
        rows: 3,
        cols: 4,
        padding: 28,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
      },
      minZoom: 0.1,
      maxZoom: 3,
    });
    api.current = graph;
    graph.on('tap', 'node', (e) => callback.current(Number(e.target.id())));
    const observer = new ResizeObserver(() => {
      graph.resize();
      graph.fit(undefined, 28);
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      graph.destroy();
      api.current = null;
    };
  }, [theme]);
  useEffect(() => {
    api.current?.nodes().removeClass('active');
    api.current?.getElementById(String(selected)).addClass('active');
  }, [selected, theme]);
  return (
    <>
      <h2>认识怎样形成与更新</h2>
      <p>
        预置示例事件 · 点击节点回读各阶段内容。这里没有真实 Agent 或工具运行。
      </p>
      <div
        ref={container}
        className="atlas-runtime-graph"
        role="img"
        aria-label="工程认识十二阶段职责图"
      />
      <div className="atlas-runtime-steps" aria-label="等价阶段列表">
        {stages.map(([name], i) => (
          <button
            key={name}
            aria-pressed={selected === i}
            onClick={() => onChange(i)}
          >
            {i + 1} · {name}
          </button>
        ))}
      </div>
      <article>
        <span className="atlas-eyebrow">
          示例事件 {selected + 1} / {stages.length}
        </span>
        <h3>{stages[selected][1]}</h3>
        <p>{stages[selected][2]}</p>
      </article>
      <div className="atlas-controls">
        <button
          disabled={selected === 0}
          onClick={() => onChange(selected - 1)}
        >
          上一个事件
        </button>
        <button
          disabled={selected === stages.length - 1}
          onClick={() => onChange(selected + 1)}
        >
          下一个事件
        </button>
        <span>回放进度不表示模型工作百分比</span>
      </div>
    </>
  );
}
