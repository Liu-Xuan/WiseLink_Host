# 关系图谱 Phase 3 实施计划

**开始时间**: 2026-09-18  
**预计完成**: 2026-09-25 至 2026-10-02 (1-2 周)  
**当前状态**: Phase 3.1 节点高亮/淡化 - 规划中  
**基于文档**: RELATION_GRAPH_GAP_ANALYSIS.md, RELATION_GRAPH_PHASE2_PROGRESS.md

---

## 🎯 Phase 3 目标

Phase 3 的核心目标是实现高级交互功能，提升用户对图谱的探索和理解能力。

**核心特性**:
1. **节点淡化/高亮** - Focus Mode，突出选中节点及其关系
2. **路径追踪** - 显示节点间的关系路径
3. **关系强度可视化** - 边的粗细/颜色表示关联强度
4. **节点分组折叠/展开** - 管理复杂图谱的视图复杂度
5. **搜索和过滤** - 快速定位节点
6. **节点详情悬浮卡片** - 无需点击查看节点信息
7. **历史导航** - 前进/后退浏览历史
8. **导出图谱** - 保存为 PNG/SVG 图片

---

## 📋 Phase 3 子阶段规划

### Phase 3.1: 节点高亮/淡化 (Focus Mode)

**预计工时**: 1-2 天  
**优先级**: 🔴 最高 (核心交互基础)

#### 实施内容

1. **创建 useNodeHighlight Hook**
   - 文件: `client/src/pages/RelationGraphPage/hooks/useNodeHighlight.ts`
   - 功能:
     - 计算选中节点的连接节点（1跳距离）
     - 设置节点/边的 opacity 样式
     - 支持淡化强度配置（默认 0.27）
   - 依赖: `useReactFlow` from `@xyflow/react`

2. **实现连接节点查找**
   - 函数: `getConnectedNodeIds(nodeId, edges)`
   - 算法: 遍历所有边，查找 source 或 target 匹配的节点
   - 返回: Set<string> 包含选中节点和1跳邻居

3. **GraphView 集成**
   - 在 GraphView 中调用 `useNodeHighlight`
   - 传递 `selectedNodeId` 状态
   - 监听选中变化，自动更新节点样式

4. **CSS 样式支持**
   - 节点淡化: `opacity: 0.27`
   - 边淡化: `opacity: 0.15`
   - 过渡动画: `transition: opacity 0.3s ease`

#### 技术细节

```typescript
// hooks/useNodeHighlight.ts
import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { GraphEdge } from '../types';

interface UseNodeHighlightOptions {
  selectedNodeId: string | null;
  dimOpacity?: number; // 默认 0.27
  edgeDimOpacity?: number; // 默认 0.15
}

function getConnectedNodeIds(
  nodeId: string,
  edges: GraphEdge[]
): Set<string> {
  const connected = new Set<string>([nodeId]);
  
  edges.forEach(edge => {
    if (edge.source === nodeId) {
      connected.add(edge.target);
    }
    if (edge.target === nodeId) {
      connected.add(edge.source);
    }
  });
  
  return connected;
}

export function useNodeHighlight({
  selectedNodeId,
  dimOpacity = 0.27,
  edgeDimOpacity = 0.15
}: UseNodeHighlightOptions) {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();
  
  useEffect(() => {
    const nodes = getNodes();
    const edges = getEdges();
    
    if (!selectedNodeId) {
      // 恢复所有节点
      setNodes(nodes.map(n => ({
        ...n,
        style: { ...n.style, opacity: 1 }
      })));
      setEdges(edges.map(e => ({
        ...e,
        style: { ...e.style, opacity: 1 }
      })));
      return;
    }
    
    // 获取连接节点
    const relatedIds = getConnectedNodeIds(selectedNodeId, edges);
    
    // 淡化无关节点
    setNodes(nodes.map(node => ({
      ...node,
      style: {
        ...node.style,
        opacity: relatedIds.has(node.id) ? 1 : dimOpacity
      }
    })));
    
    // 淡化无关边
    setEdges(edges.map(edge => ({
      ...edge,
      style: {
        ...edge.style,
        opacity: relatedIds.has(edge.source) || relatedIds.has(edge.target)
          ? 1
          : edgeDimOpacity
      }
    })));
  }, [selectedNodeId, dimOpacity, edgeDimOpacity, setNodes, setEdges, getNodes, getEdges]);
}
```

#### 测试清单

- [ ] 点击节点，观察周围节点保持亮度，远处节点淡化
- [ ] 取消选中，所有节点恢复正常亮度
- [ ] 快速切换选中节点，动画流畅无卡顿
- [ ] 边的淡化与节点同步
- [ ] DocumentGroup、Compact、Cluster、MatterHub、More 所有节点类型均正常淡化

---

### Phase 3.2: 路径追踪显示

**预计工时**: 1 天  
**优先级**: 🟡 中等

#### 实施内容

1. **创建 useGraphPath Hook**
   - 文件: `client/src/pages/RelationGraphPage/hooks/useGraphPath.ts`
   - 功能:
     - 从 MatterHub (中心节点) 到选中节点的最短路径
     - 使用 BFS 算法查找路径
     - 返回路径节点数组 `[hub, intermediate, selected]`

2. **创建 GraphPathTrail 组件**
   - 文件: `client/src/pages/RelationGraphPage/components/GraphPathTrail.tsx`
   - 位置: 图谱底部固定条
   - 布局: 节点标题 → 箭头 → 节点标题
   - 交互: 点击路径节点可跳转定位

3. **CSS 样式**
   - 固定在 graph-main 底部
   - 半透明背景 (#1E293B with 95% opacity)
   - 箭头使用 Unicode → 或 SVG icon
   - 悬停高亮路径节点

#### 技术细节

```typescript
// hooks/useGraphPath.ts
import { useMemo } from 'react';
import type { GraphNode, GraphEdge } from '../types';

interface PathNode {
  id: string;
  title: string;
}

function findShortestPath(
  startId: string,
  endId: string,
  edges: GraphEdge[],
  nodes: GraphNode[]
): PathNode[] | null {
  if (startId === endId) return [{ id: startId, title: getTitleFromNode(startId, nodes) }];
  
  // BFS
  const queue: string[][] = [[startId]];
  const visited = new Set<string>([startId]);
  const adjacency = buildAdjacencyList(edges);
  
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    
    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (neighbor === endId) {
        const fullPath = [...path, neighbor];
        return fullPath.map(id => ({
          id,
          title: getTitleFromNode(id, nodes)
        }));
      }
      
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  
  return null;
}

export function useGraphPath(
  selectedNodeId: string | null,
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] }
): PathNode[] | null {
  return useMemo(() => {
    if (!selectedNodeId) return null;
    
    // 找到 MatterHub 节点
    const hubNode = graphData.nodes.find(n => n.type === 'matterHub');
    if (!hubNode) return null;
    
    return findShortestPath(hubNode.id, selectedNodeId, graphData.edges, graphData.nodes);
  }, [selectedNodeId, graphData]);
}
```

---

### Phase 3.3: 搜索和过滤功能

**预计工时**: 1-2 天  
**优先级**: 🟢 中等

#### 实施内容

1. **创建 GraphSearchBar 组件**
   - 位置: graph-header 右侧，perspective switcher 旁边
   - 功能:
     - 实时搜索节点标题
     - 显示匹配结果下拉列表
     - 点击结果定位到节点

2. **创建 GraphFilter 组件**
   - 位置: 搜索栏下方或侧边栏
   - 过滤维度:
     - 节点类型 (DocumentGroup, Compact, Cluster, MatterHub, More)
     - 视角 (Document, Knowledge, Timeline, People)
     - 自定义标签 (tone 颜色)

3. **实现过滤逻辑**
   - Hook: `useGraphFilter`
   - 功能: 根据过滤条件返回过滤后的 nodes 和 edges
   - 性能: 使用 useMemo 缓存过滤结果

---

### Phase 3.4: 节点详情悬浮卡片

**预计工时**: 1 天  
**优先级**: 🟢 中等

#### 实施内容

1. **创建 NodeHoverCard 组件**
   - 使用 React Flow 的 `onNodeMouseEnter` / `onNodeMouseLeave`
   - 显示节点完整信息（标题、描述、元数据）
   - 延迟显示（300ms）避免误触

2. **CSS 样式**
   - Popover 样式，跟随鼠标或锚定节点
   - 半透明背景，模糊效果
   - 卡片阴影，8px 圆角

---

### Phase 3.5: 关系强度可视化

**预计工时**: 1 天  
**优先级**: 🟡 中等

#### 实施内容

1. **边权重数据扩展**
   - GraphEdge 添加 `weight?: number` 字段
   - Mock 数据添加权重示例

2. **视觉映射**
   - 边粗细: `strokeWidth: 1 + weight * 2` (1-5px)
   - 边颜色透明度: `opacity: 0.3 + weight * 0.4` (0.3-0.7)
   - 边类型: 实线 (强关系) vs 虚线 (弱关系)

---

### Phase 3.6: 历史导航

**预计工时**: 0.5 天  
**优先级**: 🟢 低

#### 实施内容

1. **创建 useGraphHistory Hook**
   - 记录选中节点历史 `[node1, node2, node3]`
   - 支持前进/后退操作
   - 最多记录 50 个历史

2. **UI 按钮**
   - 位置: graph-header 左侧
   - 图标: ← (后退) / → (前进)
   - 禁用状态: 没有历史时灰色

---

### Phase 3.7: 节点分组折叠/展开

**预计工时**: 2 天  
**优先级**: 🟡 中等

#### 实施内容

1. **ClusterNode 折叠状态**
   - 添加 `expanded: boolean` 状态
   - 折叠时显示节点数量，展开时显示子节点

2. **MoreNode 展开逻辑**
   - 点击 MoreNode 加载隐藏节点
   - 动画过渡，节点淡入

---

### Phase 3.8: 导出图谱为图片

**预计工时**: 0.5 天  
**优先级**: 🟢 低

#### 实施内容

1. **导出按钮**
   - 位置: graph-header 右侧
   - 图标: 📷 或下载图标

2. **导出功能**
   - 使用 React Flow 的 `toImage()` API
   - 支持 PNG 和 SVG 格式
   - 文件名: `relation-graph-${date}.png`

---

## 📁 Phase 3 文件结构

### 新增文件

```
client/src/pages/RelationGraphPage/
├── hooks/
│   ├── useNodeHighlight.ts         # Phase 3.1
│   ├── useGraphPath.ts              # Phase 3.2
│   ├── useGraphFilter.ts            # Phase 3.3
│   ├── useGraphHistory.ts           # Phase 3.6
│   └── useGraphExport.ts            # Phase 3.8
├── components/
│   ├── GraphPathTrail.tsx           # Phase 3.2
│   ├── GraphSearchBar.tsx           # Phase 3.3
│   ├── GraphFilter.tsx              # Phase 3.3
│   ├── NodeHoverCard.tsx            # Phase 3.4
│   └── GraphHistoryButtons.tsx      # Phase 3.6
└── utils/
    ├── graphAlgorithms.ts           # BFS, DFS, 最短路径
    └── graphExport.ts               # 图片导出工具
```

### 修改文件

```
client/src/pages/RelationGraphPage/
├── RelationGraphPage.tsx            # 集成 Phase 3 功能
├── components/GraphView.tsx         # 添加 hover 事件处理
├── types.ts                         # 扩展 GraphEdge (weight)
├── RelationGraphPage.css            # 新增 Phase 3 样式
└── data/mockData.ts                 # 添加边权重示例
```

---

## 🎨 设计规范

### 颜色系统

**Focus Mode 淡化**:
- 无关节点: `opacity: 0.27`
- 无关边: `opacity: 0.15`
- 过渡: `transition: opacity 0.3s ease`

**路径追踪**:
- 背景: `#1E293B` with 95% opacity
- 文字: `#F8FAFC`
- 箭头: `#64748B`
- 悬停: `#38BDF8`

**搜索结果**:
- 高亮: `#38BDF8` (天蓝)
- 匹配文字背景: `rgba(56, 189, 248, 0.2)`

### 动画时长

- 节点淡化/恢复: 0.3s
- 路径追踪展开: 0.2s
- 搜索下拉: 0.15s
- 节点展开/折叠: 0.4s

---

## 🧪 测试策略

### 单元测试

```typescript
describe('useNodeHighlight', () => {
  it('should dim unrelated nodes when a node is selected', () => {
    const { result } = renderHook(() => useNodeHighlight({
      selectedNodeId: 'node-1',
      dimOpacity: 0.27
    }));
    // Assert nodes opacity
  });
  
  it('should restore all nodes when selection is cleared', () => {
    // ...
  });
});

describe('useGraphPath', () => {
  it('should find shortest path from hub to selected node', () => {
    const path = findShortestPath('hub', 'node-5', mockEdges, mockNodes);
    expect(path).toEqual([
      { id: 'hub', title: 'Matter Hub' },
      { id: 'node-3', title: 'Intermediate' },
      { id: 'node-5', title: 'Selected' }
    ]);
  });
  
  it('should return null if no path exists', () => {
    // ...
  });
});
```

### 集成测试

- [ ] 点击节点 → Focus Mode 激活
- [ ] 点击时间线事件 → 图谱节点高亮 + 路径显示
- [ ] 搜索节点 → 定位并高亮
- [ ] 过滤节点类型 → 图谱更新
- [ ] 前进/后退 → 历史导航正常
- [ ] 导出图片 → PNG 文件下载

### 性能测试

- [ ] 100 节点图谱，Focus Mode 响应时间 < 100ms
- [ ] 路径计算（BFS）时间 < 50ms
- [ ] 搜索实时过滤延迟 < 100ms

---

## 📊 Phase 3 里程碑

| 子阶段 | 预计工时 | 完成标志 | 状态 |
|--------|---------|---------|------|
| 3.1 节点高亮/淡化 | 1-2 天 | useNodeHighlight Hook 完成，Focus Mode 可用 | ⏳ 待开始 |
| 3.2 路径追踪 | 1 天 | 路径追踪条显示，BFS 算法正确 | ⏳ 待开始 |
| 3.3 搜索和过滤 | 1-2 天 | 搜索栏可用，过滤器正常工作 | ⏳ 待开始 |
| 3.4 节点悬浮卡片 | 1 天 | Hover 显示节点详情 | ⏳ 待开始 |
| 3.5 关系强度可视化 | 1 天 | 边粗细/透明度表示权重 | ⏳ 待开始 |
| 3.6 历史导航 | 0.5 天 | 前进/后退按钮可用 | ⏳ 待开始 |
| 3.7 节点折叠/展开 | 2 天 | Cluster/More 节点可折叠 | ⏳ 待开始 |
| 3.8 导出图谱 | 0.5 天 | 导出 PNG/SVG 功能 | ⏳ 待开始 |

**总计预计工时**: 7.5 - 10 天 (1-2 周)

---

## 🔄 与静态页面对比

| 特性 | 静态页面 | Phase 3 目标 | 差距 |
|-----|---------|------------|------|
| 节点淡化/高亮 | ✅ 完整 | ⏳ 待实现 | Phase 3.1 |
| 路径追踪 | ✅ 完整 | ⏳ 待实现 | Phase 3.2 |
| 搜索功能 | ✅ 完整 | ⏳ 待实现 | Phase 3.3 |
| 节点详情卡片 | ✅ 完整 | ⏳ 待实现 | Phase 3.4 |
| 关系强度 | ❌ 无 | ⏳ 待实现 | Phase 3.5 |
| 历史导航 | ❌ 无 | ⏳ 待实现 | Phase 3.6 |
| 节点折叠 | ✅ 部分 | ⏳ 待实现 | Phase 3.7 |
| 导出图谱 | ❌ 无 | ⏳ 待实现 | Phase 3.8 |

---

## 📝 实施顺序建议

**Week 1 (核心交互)**:
1. Day 1-2: Phase 3.1 节点高亮/淡化 (最重要)
2. Day 3: Phase 3.2 路径追踪
3. Day 4-5: Phase 3.3 搜索和过滤

**Week 2 (增强功能)**:
4. Day 1: Phase 3.4 节点悬浮卡片
5. Day 2: Phase 3.5 关系强度可视化
6. Day 3-4: Phase 3.7 节点折叠/展开
7. Day 5: Phase 3.6 历史导航 + Phase 3.8 导出图谱

---

## ✅ 完成标准

Phase 3 完成需满足:

1. ✅ 所有 8 个子阶段实施完成
2. ✅ 单元测试覆盖率 > 80%
3. ✅ 浏览器手动测试通过
4. ✅ 性能测试达标（响应时间 < 100ms）
5. ✅ 与静态页面交互功能对齐
6. ✅ 完整的 Phase 3 完成报告文档

---

**文档维护者**: WiseLink 开发团队  
**创建时间**: 2026-09-18  
**最后更新**: 2026-09-18  
**关联文档**: RELATION_GRAPH_GAP_ANALYSIS.md, RELATION_GRAPH_PHASE2_PROGRESS.md
