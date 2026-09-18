# WiseLink Suite 1.1 S1 集成实施方案

**日期**: 2026-09-18  
**状态**: 准备集成  
**负责**: M (全栈) + Luna (前端) + Astra (审查)

---

## 📋 集成概览

### 目标
将 Suite 1.1 Shell 和 LibraryPage 组件集成到生产环境，实现完整的资料库功能。

### 范围
1. **前端集成**: Shell + LibraryPage
2. **后端集成**: DocumentReading API 扩展
3. **数据对接**: 真实 API 连接
4. **测试验证**: 功能 + 视觉验收

---

## 🔧 后端集成方案

### 现有架构分析

**已有接口**:
```typescript
// server/modules/canonical-host/document-reading.controller.ts
GET /api/document-management/document-versions/:documentVersionId/document-reading
  ?parseRunId=xxx
  &semanticRevision=1
  &readingRevision=1  // 可选

// 返回完整 DocumentReadingResponse
```

**现有类型** (`shared/document-reading.interface.ts`):
```typescript
interface DocumentReadingPreview {
  status: 'AVAILABLE' | 'SOURCE_CHANGED' | 'NOT_GENERATED';
  reading: {
    headline: string;      // ✅ 已有
    brief: string;         // ✅ 已有（但是完整文本）
    criticalConditions: string[];
    limitations: string[];
    // ...
  } | null;
}
```

### 需要的扩展

#### 1. 列表投影接口（新增）

**目的**: 为资料库表格提供轻量级的文档解读列表

**新增接口**:
```typescript
GET /api/canonical-host/documents/readings/preview
  ?documentVersionIds=id1,id2,id3
  &parseRunScope=current  // 可选: current | all

// 返回
{
  readings: Array<{
    documentVersionId: string;
    parseRunId: string;
    semanticRevision: number;
    headline: string;
    briefSummary: string;  // 40-80字简明解读
    status: 'AVAILABLE' | 'SOURCE_CHANGED' | 'NOT_GENERATED';
  }>;
}
```

**实现位置**: `server/modules/canonical-host/document-reading-list.controller.ts` (新建)

#### 2. 批量查询优化

**问题**: 资料库可能有上百份文档，逐个查询性能差

**方案**: 批量查询 + 缓存
```typescript
// 新增服务方法
class DocumentReadingRuntimeService {
  async getBatchPreview(
    documentVersionIds: string[],
    context: CanonicalHostContext
  ): Promise<Map<string, DocumentReadingPreview>> {
    // 1. 批量查询数据库
    // 2. 按文档组织结果
    // 3. 返回 Map 以便快速查找
  }
}
```

### 后端实施步骤

#### Step 1: 创建批量查询服务方法
```bash
# 文件: server/modules/canonical-host/document-reading-runtime.service.ts
# 新增方法: getBatchPreview()
```

#### Step 2: 创建列表投影控制器
```bash
# 新建: server/modules/canonical-host/document-reading-list.controller.ts
```

#### Step 3: 注册路由
```typescript
// server/modules/canonical-host/canonical-host.module.ts
controllers: [
  // ...existing
  DocumentReadingListController,
]
```

#### Step 4: 测试
```bash
# 启动服务
npm run dev:server

# 测试接口
curl "http://localhost:3000/api/canonical-host/documents/readings/preview?documentVersionIds=doc1,doc2"
```

---

## 🎨 前端集成方案

### 集成架构

```
现有应用 (app.tsx)
    ↓
ShellAdapter (路由映射)
    ↓
Shell (统一外壳)
    ↓
LibraryPageAdapter (数据适配)
    ↓
LibraryPage (业务组件)
    ↓
真实 API 调用
```

### 前端实施步骤

#### Step 1: 导入样式系统
```typescript
// client/src/index.tsx
import './styles/suite-entry.css';
```

#### Step 2: 创建 API 服务
```typescript
// client/src/api/document-reading.api.ts
export async function fetchDocumentReadingsPreview(
  documentVersionIds: string[]
): Promise<DocumentReadingPreview[]> {
  const ids = documentVersionIds.join(',');
  const response = await fetch(
    `/api/canonical-host/documents/readings/preview?documentVersionIds=${ids}`
  );
  return response.json();
}
```

#### Step 3: 更新 LibraryPageAdapter
```typescript
// client/src/adapters/LibraryPageAdapter.tsx
function useLibraryData() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  
  useEffect(() => {
    async function load() {
      // 1. 获取文档列表
      const docs = await fetchDocuments();
      
      // 2. 批量获取解读
      const readings = await fetchDocumentReadingsPreview(
        docs.map(d => d.id)
      );
      
      // 3. 合并数据
      const enriched = docs.map(doc => ({
        ...doc,
        brief: readings.find(r => r.documentVersionId === doc.id)?.briefSummary,
      }));
      
      setDocuments(enriched);
    }
    load();
  }, []);
  
  return { documents, ... };
}
```

#### Step 4: 集成 Shell（可选）
```typescript
// client/src/app.tsx
import { ShellAdapter } from './components/ShellAdapter';

export default function App() {
  return (
    <BrowserRouter>
      <ShellAdapter>
        <Routes>
          <Route path="/" element={<Navigate to="/library" />} />
          <Route path="/library" element={<LibraryPageAdapter />} />
          {/* 其他现有路由 */}
        </Routes>
      </ShellAdapter>
    </BrowserRouter>
  );
}
```

#### Step 5: 测试
```bash
npm run dev:client
# 访问 http://localhost:5173/library
```

---

## 🧪 测试方案

### 后端测试

#### 1. 单元测试
```typescript
// server/modules/canonical-host/__tests__/document-reading-list.spec.ts
describe('DocumentReadingListController', () => {
  it('should return batch preview', async () => {
    const result = await controller.getBatchPreview(['doc1', 'doc2']);
    expect(result.readings).toHaveLength(2);
    expect(result.readings[0].briefSummary).toBeDefined();
  });
});
```

#### 2. 集成测试
```bash
# 使用真实数据库测试
npm run test:e2e
```

#### 3. 手动验证
```bash
# Postman / curl 测试
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/canonical-host/documents/readings/preview?documentVersionIds=xxx"
```

### 前端测试

#### 1. 组件测试
```typescript
// client/src/pages/LibraryPage/__tests__/LibraryPage.test.tsx
describe('LibraryPage', () => {
  it('should render three columns', () => {
    render(<LibraryPage {...mockProps} />);
    expect(screen.getByRole('complementary')).toBeInTheDocument(); // FolderPane
    expect(screen.getByRole('table')).toBeInTheDocument(); // LibraryTable
    expect(screen.getByText('快速理解')).toBeInTheDocument(); // QuickLook
  });
});
```

#### 2. 视觉回归测试
```bash
# 截图对照
npm run test:visual

# 生成截图
- screenshots/library-1672-light.png
- screenshots/library-1440-light.png
- screenshots/library-390-light.png
```

#### 3. 手动验证清单
- [ ] 资料库三栏正确显示
- [ ] 文档列表加载成功
- [ ] 短解读正确显示
- [ ] 单击选择行为正确
- [ ] 打开按钮导航正确
- [ ] 快览面板信息正确
- [ ] ATA 分类筛选工作
- [ ] 机型筛选工作
- [ ] 搜索框过滤工作
- [ ] Family 展开/收起工作
- [ ] 主题切换生效
- [ ] 响应式布局正确

---

## 📦 分阶段部署

### Phase 1: 独立预览（最小风险）

**目标**: 在独立路由测试新组件

```typescript
// 添加测试路由
<Route path="/suite-preview/library" element={<LibraryPageAdapter />} />
```

**验证**:
- 组件渲染正常
- 样式无冲突
- 功能基本可用

### Phase 2: 并行运行

**目标**: 新旧页面并存

```typescript
<Route path="/library" element={<WorkspaceHomePage />} />  // 旧版
<Route path="/library-v2" element={<LibraryPageAdapter />} />  // 新版
```

**验证**:
- 新版功能完整
- 数据一致性
- 性能对比

### Phase 3: 灰度发布

**目标**: 部分用户使用新版

```typescript
// 根据用户标识决定路由
const isNewVersion = user.featureFlags.includes('library-v2');
<Route path="/library" element={
  isNewVersion ? <LibraryPageAdapter /> : <WorkspaceHomePage />
} />
```

### Phase 4: 全量替换

**目标**: 完全使用新版

```typescript
<Route path="/library" element={<LibraryPageAdapter />} />
// 移除旧版
```

---

## 🚨 风险与缓解

### 风险评估

| 风险 | 等级 | 影响 | 缓解措施 |
|---|---|---|---|
| 后端性能问题 | 🟡 中 | 批量查询慢 | 添加缓存、分页加载 |
| 数据格式不匹配 | 🟡 中 | 显示错误 | 适配器转换、单元测试 |
| 样式冲突 | 🟢 低 | 视觉异常 | 命名空间隔离 ✅ |
| 路由冲突 | 🟢 低 | 导航错误 | 独立路由测试 |
| 用户适应成本 | 🟡 中 | 操作不熟悉 | 渐进式灰度 |

### 回退方案

#### 快速回退
```typescript
// 1. 注释掉新路由
// <Route path="/library" element={<LibraryPageAdapter />} />

// 2. 恢复旧路由
<Route path="/library" element={<WorkspaceHomePage />} />

// 3. 注释样式导入
// import './styles/suite-entry.css';
```

#### 数据回退
- 后端新接口不影响现有接口
- 数据库无变更，无需回滚

---

## 📊 验收标准

### 功能验收 ✅
- [ ] 资料库加载真实数据
- [ ] 短解读正确显示
- [ ] 所有交互行为正确
- [ ] 导航跳转正确
- [ ] 筛选功能正常
- [ ] 性能达标（首屏 < 1s）

### 视觉验收 ✅
- [ ] 1672×1000 对照通过
- [ ] 1440×1000 对照通过
- [ ] 390×844 对照通过
- [ ] Silver/Carbon 主题正确
- [ ] 动效流畅自然

### 性能验收 ✅
- [ ] 首屏加载 < 1s
- [ ] 批量查询 < 500ms
- [ ] 表格滚动流畅 (60fps)
- [ ] 内存无泄漏

### 兼容性验收 ✅
- [ ] Chrome 最新版
- [ ] Safari 最新版
- [ ] Firefox 最新版
- [ ] Edge 最新版

---

## 📅 时间表

### Week 1 - 后端实现
- Day 1: 批量查询服务 (4h)
- Day 2: 列表投影控制器 (4h)
- Day 3: 单元测试 + 集成测试 (4h)

### Week 2 - 前端集成
- Day 1: API 服务层 (2h)
- Day 2: LibraryPageAdapter 数据对接 (4h)
- Day 3: 集成测试 + 问题修复 (6h)

### Week 3 - 视觉验收
- Day 1-2: 三尺寸截图对照 (8h)
- Day 3: 问题修复 + 细节调优 (6h)

### Week 4 - 灰度发布
- Day 1: 部署到测试环境 (2h)
- Day 2-3: 灰度 10% 用户 (监控)
- Day 4-5: 全量发布

**预计总时间**: 3-4周

---

## 🎯 下一步行动

### 立即开始（今天）
1. **后端**: 实现批量查询服务方法
2. **前端**: 创建 API 服务层
3. **文档**: 完善集成文档

### 明天
4. **后端**: 创建列表投影控制器
5. **前端**: LibraryPageAdapter 数据对接
6. **测试**: 端到端集成测试

### 本周
7. **集成**: 完整集成测试
8. **验收**: 功能 + 视觉验收
9. **部署**: 测试环境部署

---

**状态**: 准备开始集成 🚀  
**优先级**: P0 - 关键路径  
**负责人**: M (全栈) + Luna (前端) + Astra (审查)  
**最后更新**: 2026-09-18
