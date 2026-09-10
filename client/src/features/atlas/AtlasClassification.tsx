import { useMemo, useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
import type { AtlasLocation } from './atlas-model';
import catalog from './data/ata-catalog.json';
const rawClassificationRecords = Object.entries(catalog.schemes).flatMap(
  ([namespace, scheme]) =>
    [...scheme.chapters, ...scheme.entries, ...scheme.expanded].map(
      (record) => ({
        ...record,
        namespace,
        sourceVersion: catalog.asOf,
        identity: `${namespace}:${catalog.asOf}:${record.file}:${record.sheet}:${record.row}`,
      }),
    ),
);
export const classificationRecords = [
  ...new Map(
    rawClassificationRecords.map((record) => [record.identity, record]),
  ).values(),
];
export default function AtlasClassification({
  query,
  page,
  onChange,
  location,
  onLocation,
}: {
  location: AtlasLocation;
  onLocation: (patch: Partial<AtlasLocation>) => void;
  query: string;
  page: number;
  onChange: (query: string, page: number) => void;
}) {
  const namespace = location.classificationNamespace ?? 'all';
  const chapter = location.classificationChapter ?? 'all';
  const mode = location.classificationMode ?? 'table';
  const setPage = (value: number) => onChange(query, value);
  const setQuery = (value: string) => onChange(value, 0);
  const records = useMemo(
    () =>
      classificationRecords.filter(
        (r) =>
          (mode === 'compare' ||
            namespace === 'all' ||
            r.namespace === namespace) &&
          (chapter === 'all' || r.chapter === chapter) &&
          `${r.code} ${r.titleEN} ${r.titleZH}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [query, namespace, chapter, mode],
  );
  const graphRecords = useMemo(
    () =>
      records.filter(
        (r) =>
          query ||
          chapter !== 'all' ||
          r.kind === 'chapter' ||
          r.kind === 'chapterIndex',
      ),
    [records, query, chapter],
  );
  return (
    <section
      className="atlas-classification"
      data-atlas-target="classification"
    >
      <h2>分类骨架与原始出处</h2>
      <p>
        附件来源 · {catalog.asOf}
        。命名空间、附件版本和原行共同标识记录。同号可比较，源记录不合并；不推导实际构型或适用性。
      </p>
      <div className="atlas-controls">
        <select
          aria-label="分类命名空间"
          value={namespace}
          onChange={(e) =>
            onLocation({
              classificationNamespace: e.target
                .value as AtlasLocation['classificationNamespace'],
              cursor: '0',
              selected: '',
            })
          }
        >
          <option value="all">全部附件来源</option>
          <option value="ispec">iSpec 附件</option>
          <option value="jasc">JASC 附件</option>
        </select>
        <select
          aria-label="分类章节"
          value={chapter}
          onChange={(e) =>
            onLocation({
              classificationChapter: e.target.value,
              cursor: '0',
              selected: '',
            })
          }
        >
          <option value="all">全部章节</option>
          {[
            ...new Set(
              classificationRecords
                .filter((r) => namespace === 'all' || r.namespace === namespace)
                .map((r) => r.chapter),
            ),
          ]
            .sort()
            .map((code) => (
              <option key={code} value={code}>
                章 {code}
              </option>
            ))}
        </select>
        {(['table', 'graph', 'compare'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() =>
              onLocation({ classificationMode: value, cursor: '0' })
            }
          >
            {value === 'table'
              ? '来源清单'
              : value === 'graph'
                ? '分类图'
                : '同码对照'}
          </button>
        ))}
      </div>
      <div className="atlas-controls">
        <input
          aria-label="筛选分类原值"
          placeholder="代码或原文术语"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        {['45-45', '34-60', '34-61', '42'].map((code) => (
          <button
            key={code}
            onClick={() => {
              onLocation({
                classificationChapter: 'all',
                classificationNamespace: 'all',
                classificationMode: 'compare',
                selected: '',
              });
              setQuery(code);
            }}
          >
            {code}
          </button>
        ))}
      </div>
      <p>
        45-45 的重复原行均保留；34-60 与章 42 对照各自来源。iSpec 无独立
        34-61，不能从 JASC 同号补出 iSpec 原值。中文原值保持不变。
      </p>
      {mode === 'graph' ? (
        <ClassificationGraph
          records={graphRecords}
          selected={location.selected}
          onSelect={(selected) => onLocation({ selected })}
        />
      ) : null}
      {location.selected &&
      records.some((r) => r.identity === location.selected) ? (
        <article className="atlas-classification-definition">
          {records
            .filter((r) => r.identity === location.selected)
            .map((r) => (
              <div key={r.identity}>
                <span className="atlas-eyebrow">
                  {r.namespace} · {r.code}
                </span>
                <h3>{r.titleZH || r.titleEN}</h3>
                <p>{r.definitionZH || r.definitionEN || '该原行未提供定义'}</p>
                <p>{r.titleEN}</p>
                <p>
                  {r.file} · {r.sourceVersion} · {r.locator}
                </p>
                <button
                  onClick={() =>
                    onLocation({
                      classificationChapter: r.chapter,
                      classificationNamespace: r.namespace as 'ispec' | 'jasc',
                      selected: '',
                      cursor: '0',
                    })
                  }
                >
                  展开本来源章 {r.chapter}
                </button>
              </div>
            ))}
        </article>
      ) : null}
      {mode === 'compare' ? (
        <p>
          同码对照展示各命名空间及原行，不合并重复记录。未返回的原值保持缺失。
        </p>
      ) : null}
      <div className="atlas-table">
        <table>
          <thead>
            <tr>
              <th>来源 / 代码</th>
              <th>中文原值 / 英文原值</th>
              <th>定义与原始定位</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(page * 40, (page + 1) * 40).map((r) => (
              <tr key={r.identity}>
                <td>
                  {r.namespace}
                  <br />
                  <button
                    aria-pressed={location.selected === r.identity}
                    onClick={() => onLocation({ selected: r.identity })}
                  >
                    <strong>{r.code}</strong>
                  </button>
                </td>
                <td>
                  {r.titleZH}
                  <br />
                  {r.titleEN}
                </td>
                <td>
                  {r.definitionZH || r.definitionEN || '该原行未提供定义'}
                  <details>
                    <summary>完整来源位置</summary>
                    <p>
                      {r.file} · {r.sourceVersion}
                    </p>
                    <p>
                      {r.locator} · 原始页码记录{' '}
                      {r.sourcePageRecorded || '未登记'}
                    </p>
                    <p>{r.definitionEN}</p>
                    <p>
                      {r.noteEN} {r.noteZH}
                    </p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="atlas-controls">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>
          {records.length} 条原记录 · 第 {page + 1} 页
        </span>
        <button
          disabled={(page + 1) * 40 >= records.length}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </section>
  );
}

function ClassificationGraph({
  records,
  selected,
  onSelect,
}: {
  records: typeof classificationRecords;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { theme } = useWlTheme();
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<cytoscape.Core | null>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    if (!container.current) return;
    const seen = new Set<string>();
    const unique = records.filter((r) => {
      if (seen.has(r.identity)) return false;
      seen.add(r.identity);
      return true;
    });
    const dark = theme === 'dark';
    const graph = cytoscape({
      container: container.current,
      elements: [
        ...unique.map((r) => ({
          data: {
            id: r.identity,
            label: `${r.namespace} ${r.code}\n${r.titleZH || r.titleEN}`,
          },
        })),
        ...unique.flatMap((r) => {
          if (r.kind === 'chapter' || r.kind === 'chapterIndex') return [];
          return unique
            .filter(
              (parent) =>
                parent.namespace === r.namespace &&
                (parent.kind === 'chapter' || parent.kind === 'chapterIndex') &&
                parent.code === r.chapter,
            )
            .map((parent) => ({
              data: {
                id: `contains:${parent.identity}:${r.identity}`,
                source: parent.identity,
                target: r.identity,
              },
            }));
        }),
      ],
      style: [
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#899778',
            'target-arrow-color': '#899778',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            opacity: 0.35,
          },
        },
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            width: 85,
            height: 44,
            label: 'data(label)',
            'font-size': 10,
            'text-valign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            color: dark ? '#e3e5d9' : '#424a36',
            'background-color': dark ? '#30352a' : '#eef1e6',
            'border-color': '#879871',
            'border-width': 1,
          },
        },
        {
          selector: ':selected',
          style: { 'border-width': 3, 'border-color': '#b59b60' },
        },
      ],
      layout: {
        name: 'grid',
        padding: 25,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
      },
      minZoom: 0.05,
      maxZoom: 3,
    });
    api.current = graph;
    graph.on('tap', 'node', (event) => callback.current(event.target.id()));
    const observer = new ResizeObserver(() => graph.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      graph.destroy();
      api.current = null;
    };
  }, [records, theme]);
  useEffect(() => {
    api.current?.nodes().unselect();
    if (selected) api.current?.getElementById(selected).select();
  }, [selected, records, theme]);
  return (
    <div
      className="atlas-classification-graph"
      ref={container}
      role="img"
      aria-label="附件分类原行图；下方清单提供相同记录"
    />
  );
}
