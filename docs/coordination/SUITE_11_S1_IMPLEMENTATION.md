# Suite 1.1 S1 实施计划：外壳与资料库

**批次**: S1  
**日期**: 2026-09-18  
**负责**: 前端 Luna + M (接口) + Astra (审查)  
**目标**: 统一外壳 + 资料库首屏可用

## 1. S1 交付清单

### 1.1 统一 Shell 组件
- [ ] 创建 `client/src/components/Shell/` 目录
- [ ] 迁移 Suite Shell.jsx 逻辑
- [ ] 全局导航（资料库/知识/图谱/态势/进展）
- [ ] 当前事项导航（Wiki/时间轴/分析/复核）
- [ ] 顶部搜索栏（`/` 快捷键）
- [ ] 面包屑 + 返回按钮
- [ ] 事项切换下拉
- [ ] 全屏切换
- [ ] 主题/效果设置弹窗

### 1.2 资料库 3 栏布局
- [ ] 左侧：资料分组面板
  - 全部资料
  - ATA 分类
  - 我的负责范围
  - 筛选器
  
- [ ] 中间：统一表格
  - 文档/事项切换
  - 5 列布局
  - family 历史版本展开
  - 单击选择 vs 打开按钮
  - 返回位置恢复
  
- [ ] 右侧：快览面板 ⭐
  - 快速理解标题
  - 主题/版本信息
  - 解读与当前认识
  - 阅读范围说明
  - 附件列表
  - 精读/Wiki/图谱入口

### 1.3 样式迁移
- [ ] 创建 `client/src/styles/suite/` 目录
- [ ] 复制 Suite 样式系统
- [ ] 集成到主应用

## 2. 技术实施方案

### 2.1 目录结构
```
client/src/
├── components/
│   └── Shell/
│       ├── index.tsx (主组件)
│       ├── GlobalNav.tsx
│       ├── MatterNav.tsx
│       ├── Topbar.tsx
│       ├── Breadcrumb.tsx
│       └── SettingsModal.tsx
│
├── pages/
│   └── LibraryPage/
│       ├── index.tsx (容器)
│       ├── FolderPane.tsx (左侧)
│       ├── LibraryTable.tsx (中间)
│       ├── QuickLook.tsx (右侧)
│       └── library.css
│
└── styles/
    └── suite/
        ├── index.css (915行)
        ├── proof.css
        ├── studio.css
        └── suite.css
```

### 2.2 Shell 组件接口
```tsx
// client/src/components/Shell/index.tsx
interface ShellProps {
  children: React.ReactNode;
  currentMatter?: EngineeringMatter;
  currentDocument?: DocumentVersion;
}

export function Shell({ children, currentMatter, currentDocument }: ShellProps) {
  // 全局状态管理
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [effects, setEffects] = useState<'default' | 'ultra' | 'compatible'>('default');
  const [immersive, setImmersive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  return (
    <div className="wl-studio" data-theme={theme} data-effects={effects}>
      <GlobalNav currentPage={currentPage} />
      {currentMatter && <MatterNav matter={currentMatter} />}
      <main>
        <Topbar />
        <Breadcrumb />
        {children}
      </main>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
```

### 2.3 资料库组件接口
```tsx
// client/src/pages/LibraryPage/index.tsx
interface LibraryPageProps {
  mode: 'documents' | 'matters';
}

export function LibraryPage({ mode }: LibraryPageProps) {
  const [selection, setSelection] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>({});
  
  return (
    <div className="library-layout">
      <FolderPane filters={filters} onChange={setFilters} />
      <LibraryTable 
        mode={mode}
        selection={selection}
        expanded={expanded}
        onSelect={setSelection}
        onToggleExpand={(id) => {/* ... */}}
      />
      <QuickLook item={selectedItem} />
    </div>
  );
}
```

### 2.4 数据接口需求

#### DocumentReading 接口（阻塞项）
```typescript
// 需要 M 实现
interface DocumentReading {
  id: string;
  documentVersionId: string;
  parseRunId: string;
  semanticRevision: number;
  
  // 核心字段
  headline: string;          // 短主题（10-20字）
  briefSummary: string;      // 简明解读（40-80字）⭐
  fullExplanation: string;   // 完整解释
  
  // 元数据
  scope: string;             // 阅读范围
  limitations: string[];     // 限制说明
  keyConditions: string[];   // 关键条件
  
  // 版本控制
  createdAt: Date;
  revision: number;
}

// API 端点
GET /api/canonical-host/documents/:versionId/reading
  ?parseRunId=xxx
  &semanticRevision=1
```

**当前状态**: ❌ 接口未实现  
**阻塞**: 资料库短解读列显示  
**负责**: M  
**S1 临时方案**: 显示占位文本 "解读准备中"

#### 资料库目录增强
```typescript
// 现有接口增强
interface DocumentVersionListItem {
  // 现有字段...
  
  // 新增
  reading?: {
    headline: string;
    briefSummary: string;  // ⭐ 关键
    revision: number;
  };
}
```

## 3. 分步实施

### Phase 1: 样式基础 (Day 1)
1. 复制 Suite 样式到 `client/src/styles/suite/`
2. 在 `client/src/index.tsx` 导入样式
3. 验证样式不冲突

### Phase 2: Shell 组件 (Day 1-2)
1. 创建 Shell 组件结构
2. 实现全局导航
3. 实现顶部栏
4. 集成主题切换
5. 迁移一个页面测试（资料库）

### Phase 3: 资料库布局 (Day 2-3)
1. 创建 3 栏布局骨架
2. 实现左侧分组面板
3. 实现中间表格
4. 实现右侧快览面板
5. 连接真实数据

### Phase 4: 交互细节 (Day 3)
1. 单击选择 vs 打开
2. family 展开/收起
3. 返回位置恢复
4. 键盘导航

### Phase 5: 集成测试 (Day 4)
1. 真实数据测试
2. 三尺寸截图对照
3. 性能检查
4. 边界情况处理

## 4. 验收标准

### 4.1 视觉验收
- [ ] 1672×1000 桌面截图与 Suite 对照（主要边界 ≤4px）
- [ ] 1440×1000 桌面截图
- [ ] 390×844 手机截图
- [ ] Silver/Carbon 两主题
- [ ] 默认/最高/兼容 三效果档

### 4.2 功能验收
- [ ] 全局导航可用
- [ ] 事项导航动态显示
- [ ] 搜索框 `/` 快捷键
- [ ] 主题切换生效
- [ ] 文档/事项表格正确显示
- [ ] 单击选择更新快览
- [ ] 打开按钮正确导航
- [ ] family 展开正确
- [ ] 返回恢复筛选、选择、滚动
- [ ] 快览面板显示正确内容

### 4.3 性能验收
- [ ] 首屏加载 < 1s (已登录)
- [ ] 切换选择 < 100ms
- [ ] 表格滚动流畅
- [ ] 无内存泄漏

### 4.4 数据验收
- [ ] 至少 1 个真实文档可读
- [ ] 至少 1 个真实事项可读
- [ ] 短解读显示正确（或占位）
- [ ] family 历史版本正确

## 5. 风险与依赖

### 5.1 阻塞风险
- **DocumentReading 接口未实现** - 高风险
  - 缓解：先用占位，接口就绪后替换
  - 负责：M 优先实现

### 5.2 技术风险
- 样式冲突 - 中风险
  - 缓解：使用命名空间隔离
- 路由集成 - 中风险
  - 缓解：保持现有路由，逐步迁移

### 5.3 依赖项
- ✅ Suite 1.1 源码可用
- ⚠️ DocumentReading 接口（M）
- ✅ 现有 API 基本可用
- ⚠️ 妙搭会话隔离（待验证）

## 6. 执行时间表

### Week 1 (当前)
- Day 1-2: Shell 组件 + 样式基础
- Day 3-4: 资料库 3 栏布局
- Day 5: 集成测试 + 视觉对照

### 输出
- 可用的统一 Shell
- 完整的资料库页面
- 截图对照报告
- 发现的问题清单

## 7. 并行工作

### 前端 Luna (主线)
- Shell 组件
- 资料库布局
- 视觉调整

### M (接口)
- DocumentReading 实现
- 接口文档
- 测试数据

### Astra (审查)
- 代码审查
- 设计对照
- 问题反馈

## 8. 下一步

1. **启动 Shell 组件开发**
2. **等待 M 确认 DocumentReading 时间表**
3. **准备隔离开发环境**

---

**状态**: 准备就绪  
**等待**: 执行批准  
**预计**: 4-5 天完成 S1
