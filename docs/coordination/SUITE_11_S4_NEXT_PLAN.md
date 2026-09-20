# Suite 1.1 S4: 后续计划

**更新时间**: 2026-09-18  
**当前阶段**: 验证场地已就绪，等待测试和决策

---

## 🎯 即将进行的工作

### Phase 0: 验证和决策 (当前阶段)

**目标**: 通过对比测试，最终选定图谱框架

**任务清单**:
- [x] 创建 Cytoscape 验证场地
- [x] 创建 React Flow 验证场地
- [x] 编写框架评估文档
- [x] 编写对比测试文档
- [ ] **手动浏览器测试**（当前任务）
- [ ] **做出最终框架选择**
- [ ] 记录测试结果和决策理由

**测试地址**:
- Cytoscape: `http://localhost:8080/app/app_17bzc551rsg/dev-preview/cytoscape-validation`
- React Flow: `http://localhost:8080/app/app_17bzc551rsg/dev-preview/reactflow-validation`

**预计完成时间**: 今天（测试 20 分钟 + 决策 10 分钟）

---

## 📋 Phase 1: 关系图谱页面基础实现

**前置条件**: Phase 0 完成，框架已选定

### 1.1 页面结构搭建 (1 天)

**创建文件**:
```
client/src/pages/RelationGraphPage/
├── RelationGraphPage.tsx          (主页面组件)
├── RelationGraphPage.css          (页面样式)
├── components/
│   ├── GraphView.tsx              (图谱视图组件)
│   ├── TimelinePanel.tsx          (时间线面板)
│   ├── KnowledgePanel.tsx         (知识面板)
│   └── PerspectiveSwitcher.tsx    (视角切换器)
└── types.ts                        (类型定义)
```

**实现内容**:
- ✅ 三栏布局（时间线 20% + 图谱 60% + 知识 20%）
- ✅ 响应式设计（可调整列宽）
- ✅ 深色主题（复用验证场地样式）
- ✅ 骨架屏和加载状态

**成功标准**:
- 三栏布局正确显示
- 可以调整列宽
- 各面板独立滚动
- 移动端自适应（堆叠布局）

### 1.2 图谱视图集成 (1 天)

**基于选定的框架**:

**如果选择 React Flow** (推荐):
```typescript
// client/src/pages/RelationGraphPage/components/GraphView.tsx
import ReactFlow from 'reactflow';
import { DocumentGroupNode } from './DocumentGroupNode';

export function GraphView({ perspective }: { perspective: PerspectiveType }) {
  const { nodes, edges } = useGraphData(perspective);
  
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={{ documentGroup: DocumentGroupNode }}
      fitView
    />
  );
}
```

**如果选择 Cytoscape**:
```typescript
// client/src/pages/RelationGraphPage/components/GraphView.tsx
import Cytoscape from 'cytoscape';
import { useEffect, useRef } from 'react';

export function GraphView({ perspective }: { perspective: PerspectiveType }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { nodes, edges } = useGraphData(perspective);
  
  useEffect(() => {
    const cy = Cytoscape({
      container: containerRef.current,
      elements: [...nodes, ...edges]
    });
    return () => cy.destroy();
  }, [nodes, edges]);
  
  return <div ref={containerRef} />;
}
```

**实现内容**:
- ✅ 图谱组件封装
- ✅ 节点和边的渲染
- ✅ 平移缩放控制
- ✅ 节点样式（复用验证场地 CSS）

### 1.3 视角切换器 (0.5 天)

**四种视角**:
1. **文档视角** - 以文档为节点，显示文档间的引用关系
2. **知识视角** - 以知识点为节点，显示知识图谱
3. **时间视角** - 按时间线组织，显示文档演进
4. **人员视角** - 以参与者为节点，显示协作关系

**实现内容**:
```typescript
// client/src/pages/RelationGraphPage/components/PerspectiveSwitcher.tsx
export function PerspectiveSwitcher() {
  const [perspective, setPerspective] = useState<PerspectiveType>('document');
  
  return (
    <div className="perspective-switcher">
      <button onClick={() => setPerspective('document')}>文档</button>
      <button onClick={() => setPerspective('knowledge')}>知识</button>
      <button onClick={() => setPerspective('timeline')}>时间</button>
      <button onClick={() => setPerspective('people')}>人员</button>
    </div>
  );
}
```

**成功标准**:
- 四个视角按钮正确显示
- 点击切换时图谱数据更新
- 切换动画流畅

### 1.4 路由集成 (0.5 天)

**路由配置**:
```typescript
// client/src/App.tsx
import RelationGraphPage from './pages/RelationGraphPage/RelationGraphPage';

<Route path="relation-graph" element={<RelationGraphPage />} />
```

**导航链接**:
- 从工作台首页进入
- 从文档详情页进入
- 从时间线页进入

**成功标准**:
- URL: `/relation-graph`
- 可以通过导航菜单访问
- 面包屑正确显示
- 刷新页面状态保持

---

## 📋 Phase 2: 时间线联动 (2 天)

### 2.1 时间线面板实现

**数据结构**:
```typescript
interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: 'create' | 'update' | 'comment' | 'review';
  title: string;
  documentId?: string;
  personId?: string;
}
```

**实现内容**:
- ✅ 时间线事件列表
- ✅ 事件分组（按日期）
- ✅ 事件过滤（按类型）
- ✅ 虚拟滚动（处理大量事件）

### 2.2 时间线 → 图谱联动

**交互逻辑**:
1. 点击时间线事件
2. 图谱中对应的节点高亮
3. 图谱自动平移到该节点
4. 知识面板显示详细信息

**实现方式**:
```typescript
// 使用 React Context 共享选中状态
const GraphContext = createContext<{
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
}>(null);

// TimelinePanel 组件
function TimelinePanel() {
  const { setSelectedNodeId } = useContext(GraphContext);
  
  const handleEventClick = (event: TimelineEvent) => {
    setSelectedNodeId(event.documentId);
  };
  
  return <EventList onClick={handleEventClick} />;
}

// GraphView 组件
function GraphView() {
  const { selectedNodeId } = useContext(GraphContext);
  
  useEffect(() => {
    if (selectedNodeId) {
      // 高亮节点并平移视口
      highlightNode(selectedNodeId);
      panToNode(selectedNodeId);
    }
  }, [selectedNodeId]);
}
```

### 2.3 图谱 → 时间线联动

**交互逻辑**:
1. 点击图谱节点
2. 时间线滚动到相关事件
3. 相关事件高亮显示
4. 知识面板更新

**成功标准**:
- 双向联动流畅无卡顿
- 高亮状态清晰可见
- 自动滚动和平移准确
- 状态在视角切换后保持

---

## 📋 Phase 3: 数据集成 (2 天)

### 3.1 后端 API 设计

**需要协调的 API**:

```typescript
// 1. 获取图谱数据
GET /api/canonical-host/relation-graph
Query: 
  - perspective: 'document' | 'knowledge' | 'timeline' | 'people'
  - filters?: string[]
Response:
{
  nodes: Array<{
    id: string;
    type: string;
    data: {
      title: string;
      count: number;
      docs: string[];
      metadata: Record<string, any>;
    };
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
  }>;
}

// 2. 获取时间线事件
GET /api/canonical-host/timeline-events
Query:
  - startDate?: string;
  - endDate?: string;
  - types?: string[];
Response:
{
  events: Array<TimelineEvent>;
  total: number;
}

// 3. 获取节点详情
GET /api/canonical-host/relation-graph/node/:nodeId
Response:
{
  node: NodeDetail;
  relatedEvents: TimelineEvent[];
  knowledge: KnowledgeItem[];
}
```

### 3.2 前端数据获取

**使用 React Query**:
```typescript
// client/src/pages/RelationGraphPage/hooks/useGraphData.ts
export function useGraphData(perspective: PerspectiveType) {
  return useQuery({
    queryKey: ['relation-graph', perspective],
    queryFn: () => fetch(`/api/canonical-host/relation-graph?perspective=${perspective}`)
  });
}

export function useTimelineEvents() {
  return useQuery({
    queryKey: ['timeline-events'],
    queryFn: () => fetch('/api/canonical-host/timeline-events')
  });
}
```

### 3.3 Mock 数据 → 真实数据切换

**实现策略**:
1. 第一阶段使用 Mock 数据（验证场地的数据）
2. 第二阶段集成后端 API
3. 使用环境变量控制数据源

```typescript
// client/src/pages/RelationGraphPage/data/mockData.ts
export const MOCK_GRAPH_DATA = { ... };

// client/src/pages/RelationGraphPage/hooks/useGraphData.ts
const USE_MOCK = import.meta.env.VITE_USE_MOCK_GRAPH === 'true';

export function useGraphData(perspective: PerspectiveType) {
  if (USE_MOCK) {
    return { data: MOCK_GRAPH_DATA[perspective], isLoading: false };
  }
  return useQuery({ ... });
}
```

---

## 📋 Phase 4: 性能优化 (1 天)

### 4.1 大图性能优化

**目标**: 支持 100+ 节点流畅渲染

**优化策略**:
1. **视口裁剪** - 只渲染可见区域的节点
2. **节点聚类** - 超过阈值时自动聚类
3. **延迟加载** - 按需加载节点详情
4. **虚拟化** - 时间线面板虚拟滚动

**React Flow 内置优化**:
```typescript
<ReactFlow
  nodes={nodes}
  edges={edges}
  onlyRenderVisibleElements={true}  // 视口裁剪
  nodesDraggable={false}             // 禁用拖拽提升性能
  proOptions={{ hideAttribution: true }}
/>
```

### 4.2 响应式优化

**目标**: 移动端、平板端自适应

**实现方式**:
```css
/* 桌面端：三栏布局 */
@media (min-width: 1024px) {
  .relation-graph-page {
    grid-template-columns: 250px 1fr 300px;
  }
}

/* 平板端：图谱 + 侧边栏 */
@media (max-width: 1023px) and (min-width: 768px) {
  .relation-graph-page {
    grid-template-columns: 1fr 300px;
  }
  .timeline-panel { display: none; }
}

/* 移动端：仅图谱，抽屉式侧边栏 */
@media (max-width: 767px) {
  .relation-graph-page {
    grid-template-columns: 1fr;
  }
  .timeline-panel,
  .knowledge-panel {
    position: fixed;
    transform: translateX(-100%);
  }
}
```

---

## 📋 Phase 5: 测试和发布 (1 天)

### 5.1 测试清单

**功能测试**:
- [ ] 四种视角切换正常
- [ ] 时间线 → 图谱联动正常
- [ ] 图谱 → 时间线联动正常
- [ ] 节点点击显示详情
- [ ] 平移缩放流畅
- [ ] 50+ 节点性能达标

**兼容性测试**:
- [ ] Chrome 最新版
- [ ] Safari 最新版
- [ ] Firefox 最新版
- [ ] 移动端浏览器

**性能测试**:
- [ ] 首屏加载 < 2s
- [ ] 50 节点渲染 < 2s
- [ ] 100 节点渲染 < 5s
- [ ] 视角切换 < 500ms

### 5.2 部署到妙搭平台

**部署步骤**:
1. 提交代码到 Git 仓库
2. 在妙搭平台触发构建
3. 验证生产环境功能
4. 监控性能指标

**部署检查清单**:
- [ ] 环境变量配置正确
- [ ] API 端点可访问
- [ ] 静态资源 CDN 加速
- [ ] 错误监控已配置

---

## 📊 总体时间预估

| Phase | 任务 | 预计时间 | 依赖 |
|-------|------|----------|------|
| 0 | 验证和决策 | 0.5 天 | - |
| 1 | 页面基础实现 | 3 天 | Phase 0 |
| 2 | 时间线联动 | 2 天 | Phase 1 |
| 3 | 数据集成 | 2 天 | Phase 2 |
| 4 | 性能优化 | 1 天 | Phase 3 |
| 5 | 测试和发布 | 1 天 | Phase 4 |
| **总计** | | **9.5 天** | |

**关键里程碑**:
- Day 1: 框架选定，页面骨架完成
- Day 3: 图谱视图可交互
- Day 5: 时间线联动完成
- Day 7: 真实数据集成
- Day 9: 性能优化完成
- Day 10: 测试通过，部署上线

---

## 🎯 当前需要的决策

### ⚠️ 阻塞项

**决策 1**: 选择 React Flow 还是 Cytoscape？
- **推荐**: React Flow
- **需要**: 完成验证场地对比测试
- **影响**: Phase 1 的实现方式

**决策 2**: 后端 API 由谁实现？
- **需要**: 与后端团队协调
- **影响**: Phase 3 的时间安排

**决策 3**: 是否在妙搭平台测试？
- **用户建议**: 应在妙搭平台测试
- **需要**: 部署到妙搭测试环境
- **影响**: 验证场地的测试方式

---

**文档维护者**: Luna  
**最后更新**: 2026-09-18  
**状态**: 等待 Phase 0 完成（框架选择决策）
