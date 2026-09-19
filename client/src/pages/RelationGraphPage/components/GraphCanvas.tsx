import React, { useEffect, useRef, useState } from 'react';
import { ensureGraph } from '../../../lib/graph/loader';

interface GraphCanvasProps {
    matter: any;
    selected?: string;
    onSelect?: (node: any, edge?: boolean) => void;
    onGroup?: (key: string, id?: string) => void;
    hidden?: string[];
    graphRef?: React.MutableRefObject<any>;
    compact?: boolean;
    viewKey?: string;
}

export default function GraphCanvas({
    matter,
    selected,
    onSelect,
    onGroup,
    hidden = [],
    graphRef,
    compact = false,
    viewKey = ''
}: GraphCanvasProps) {
    const el = useRef<HTMLDivElement>(null);
    const api = useRef<any>(null);
    const cbs = useRef({ onSelect, onGroup });
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [zoom, setZoom] = useState(100);
    const [allEdges, setAllEdges] = useState(false);

    cbs.current = { onSelect, onGroup };
    const key = matter.id + viewKey;
    useEffect(() => {
        let gone = false;
        ensureGraph()
            .then(() => import('../../../lib/graph/graph-core'))
            .then((mod: any) => {
                if (gone) return;
                const a = mod.createMatterGraph(el.current, {
                    onSelect: (n: any, edge: boolean) => cbs.current.onSelect?.(n, edge),
                    onGroup: (k: string) => cbs.current.onGroup?.(k),
                    onHiddenSelect: (k: string, id: string) => cbs.current.onGroup?.(k, id),
                    onViewport: (z: number) => setZoom(Math.round(z * 100))
                });
                api.current = a;
                if (graphRef) graphRef.current = a;
                a.update(matter, { animate: false, hidden });
                a.setTheme('dark');
                setReady(true);
            })
            .catch((e: Error) => {
                if (!gone) setError(e.message);
            });
        return () => {
            gone = true;
            const a = api.current;
            if (a) {
                a.destroy();
                api.current = null;
            }
            if (graphRef) graphRef.current = null;
        };
    }, [key]);
    useEffect(() => {
        if (api.current) {
            api.current.update(matter, { hidden, animate: false });
            api.current.setTheme('dark');
        }
    }, [matter, hidden.join('|')]);

    useEffect(() => {
        api.current?.setTheme('dark');
    }, []);

    useEffect(() => {
        if (selected && ready) api.current?.select(selected);
    }, [selected, ready]);

    return (
        <div className={`graph-stage ${compact ? 'small-graph' : ''}`}>
            <div ref={el} className="cy-mount" role="img" aria-label="事项关系图。完整资料与关系列表提供键盘阅读入口。" />
            {error && <div className="graph-error">图谱暂不可用: {error}</div>}
            <div className="graph-tools">
                <button
                    className={`graph-tool-btn ${allEdges ? 'active' : ''}`}
                    onClick={() => {
                        setAllEdges(!allEdges);
                        api.current?.toggleEdges(!allEdges);
                    }}
                    title="切换聚合或逐条关系"
                >
                    {allEdges ? '逐条' : '聚合'}
                </button>
                <button
                    className="graph-tool-btn"
                    aria-label="缩小图谱"
                    onClick={() => api.current?.zoomBy(0.88)}
                >
                    −
                </button>
                <button
                    className="graph-tool-btn"
                    onClick={() => api.current?.fit()}
                    aria-label="适合图谱画面"
                >
                    {zoom}%
                </button>
                <button
                    className="graph-tool-btn"
                    aria-label="放大图谱"
                    onClick={() => api.current?.zoomBy(1.14)}
                >
                    +
                </button>
                <button
                    className="graph-tool-btn"
                    aria-label="重置图谱布局"
                    onClick={() => {
                        api.current?.update(matter, {
                            hidden,
                            animate: !matchMedia('(prefers-reduced-motion: reduce)').matches
                        });
                        api.current?.fit();
                    }}
                >
                    ↻
                </button>
            </div>
            <div className="graph-status">
                {matter.groups.reduce((n: number, g: any) => n + g.items.length, 0)} 个资料与对象 · {matter.relations.length} 条登记关系
            </div>
        </div>
    );
}
