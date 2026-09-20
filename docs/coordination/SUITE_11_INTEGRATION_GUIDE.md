/**
 * Suite 1.1 集成说明
 *
 * 如何将 Suite 1.1 组件集成到现有应用
 */

# Suite 1.1 组件集成指南

## 快速开始

### 1. 导入样式

在 `client/src/index.tsx` 中导入 Suite 样式：

```typescript
import './styles/suite/suite-system.css';
```

### 2. 使用 ShellAdapter

在应用根组件使用 ShellAdapter 包装：

```typescript
// client/src/app.tsx
import { ShellAdapter } from './components/ShellAdapter';

function App() {
  return (
    <BrowserRouter>
      <ShellAdapter>
        <Routes>
          {/* 现有路由 */}
        </Routes>
      </ShellAdapter>
    </BrowserRouter>
  );
}
```

### 3. 替换资料库页面

在路由配置中使用新的 LibraryPageAdapter：

```typescript
// client/src/app.tsx
import { LibraryPageAdapter } from './adapters/LibraryPageAdapter';

<Route path="library" element={<LibraryPageAdapter />} />
```

## 分步集成方案

### Phase 1: 仅样式预览（最小风险）

1. 导入 Suite 样式
2. 不修改现有路由
3. 在独立路由测试新组件

```typescript
<Route path="suite-preview/library" element={<LibraryPageAdapter />} />
```

### Phase 2: Shell 外壳集成

1. 在 Layout 组件中使用 ShellAdapter
2. 保持现有页面内容
3. 测试导航和主题切换

### Phase 3: 逐页替换

按以下顺序替换页面：

1. ✅ Library (资料库) - 使用 LibraryPageAdapter
2. Knowledge (工程知识) - 待创建适配器
3. Graph (关系图谱) - 待重构
4. 其他页面...

## 数据接口集成

### DocumentReading 接口

**前端期望**:
```typescript
interface DocumentReading {
  headline: string;
  briefSummary: string;  // 40-80字
  fullExplanation: string;
}
```

**临时方案**:
```typescript
// LibraryPageAdapter.tsx
const doc = {
  // ...
  brief: doc.briefSummary || '解读准备中…',
};
```

### API 调用示例

```typescript
// 获取文档列表（含解读）
async function fetchDocuments() {
  const response = await fetch('/api/canonical-host/documents?include=reading');
  return response.json();
}

// 获取单个文档解读
async function fetchDocumentReading(versionId: string) {
  const response = await fetch(`/api/canonical-host/documents/${versionId}/reading`);
  return response.json();
}
```

## 测试清单

### 功能测试
- [ ] Shell 组件渲染正常
- [ ] 主题切换生效
- [ ] 全局导航可用
- [ ] 资料库三栏布局正确
- [ ] 表格数据加载
- [ ] 单击选择行为
- [ ] 打开按钮导航
- [ ] 快览面板显示

### 兼容性测试
- [ ] 与现有 Layout 共存
- [ ] 不影响其他页面
- [ ] 样式无冲突
- [ ] 路由正常工作

### 视觉测试
- [ ] 1672px 桌面对照
- [ ] 1440px 桌面对照
- [ ] 390px 手机对照
- [ ] Silver/Carbon 主题
- [ ] 效果档切换

## 回退方案

如果集成出现问题，可以快速回退：

### 回退 Shell
```typescript
// 注释掉 ShellAdapter
// import { ShellAdapter } from './components/ShellAdapter';

function App() {
  return (
    <BrowserRouter>
      {/* <ShellAdapter> */}
        <Routes>
          {/* 现有路由 */}
        </Routes>
      {/* </ShellAdapter> */}
    </BrowserRouter>
  );
}
```

### 回退资料库
```typescript
// 恢复原路由
<Route path="library" element={<WorkspaceHomePage />} />
```

### 移除样式
```typescript
// 注释掉样式导入
// import './styles/suite/suite-system.css';
```

## 常见问题

### Q: Shell 和现有 Layout 冲突？
A: ShellAdapter 应该替换 Layout，不是嵌套在内部。

### Q: 样式覆盖了现有样式？
A: Suite 样式在 `.wl-studio` 命名空间下，不应该影响其他组件。检查是否正确使用了命名空间。

### Q: 图标不显示？
A: 当前使用简化 SVG 图标，可能需要完善图标库。

### Q: 数据格式不匹配？
A: 使用适配器转换数据格式，参考 LibraryPageAdapter 实现。

## 下一步

1. 测试 ShellAdapter 基础功能
2. 集成真实 API 数据
3. 完成视觉验收
4. 准备 S2 (知识+Wiki)

## 技术支持

如有问题，查看：
- `SUITE_11_COMPONENT_MAPPING.md` - 组件对照
- `SUITE_11_S1_COMPLETION_REPORT.md` - 完成报告
- Suite 1.1 源码: `/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/`
