# Suite 1.1 S4: 图谱框架验证场地

**目的**: 在实现完整的关系图谱页面之前，对比验证 Cytoscape 和 React Flow 两种方案

---

## 🚀 快速开始

### 1. 启动开发服务器
```bash
npm run dev
```

### 2. 打开验证场地（两个可选）

**Cytoscape 验证场地**:
```
http://localhost:8080/app/app_17bzc551rsg/dev-preview/cytoscape-validation
```

**React Flow 验证场地** ✨ NEW:
```
http://localhost:8080/app/app_17bzc551rsg/dev-preview/reactflow-validation
```

### 3. 执行对比测试
按照 [React Flow 对比测试文档](./SUITE_11_S4_REACTFLOW_COMPARISON.md) 进行两个方案的对比测试

---

## 📚 文档导航

### 必读文档
- **[当前状态总结](./SUITE_11_S4_CURRENT_STATUS.md)** ← 从这里开始
  - 工作完成情况
  - 当前任务
  - 下一步行动路径

- **[手动测试指南](./SUITE_11_S4_MANUAL_TEST_GUIDE.md)** ← 测试人员使用
  - 7 个测试用例详细步骤
  - 测试记录表格
  - 问题记录模板

### 参考文档
- **[React Flow vs Cytoscape 对比测试](./SUITE_11_S4_REACTFLOW_COMPARISON.md)** ← 新增对比文档
  - 代码复杂度对比
  - TypeScript 支持对比
  - 性能测试方法
  - 开发体验对比
  - 推荐决策

- **[框架评估](./SUITE_11_S4_FRAMEWORK_EVALUATION.md)**
  - React Flow、Vis Network、G6、Cytoscape 详细对比
  - 推荐方案：React Flow

- **[技术研究](./SUITE_11_S4_TECHNICAL_RESEARCH.md)**
  - Cytoscape + popper.js 技术方案
  - 8 个验证测试定义
  - 备选方案分析

- **[验证结果](./SUITE_11_S4_VALIDATION_RESULTS.md)**
  - 实施状态
  - 环境信息
  - 测试结果记录

- **[部署检查清单](./SUITE_11_S4_DEPLOYMENT_CHECKLIST.md)**
  - 代码实现检查
  - 依赖包确认
  - 环境诊断信息

---

## ✅ 验证目标

### 核心问题
1. ✓ cytoscape-popper 能否稳定地定位 HTML 元素？
2. ✓ 50 个节点的渲染性能是否满足要求（< 2s）？
3. ✓ HTML 元素内的交互是否正常工作？
4. ✓ 卡片能否平滑跟随画布的平移和缩放？

### 成功标准
- 所有 7 个测试用例通过
- 无明显性能问题
- 无控制台错误（除了预期的后端 503）

---

## 🎯 测试后的决策

### ✅ 全部通过
→ 继续 S4 Phase 1: 实现三栏布局 + RelationGraphPage

### ⚠️ 性能问题
→ 实现优化：视口裁剪、渲染节流、节点聚类

### ❌ 功能问题
→ 评估备选方案：React 覆盖层、纯 Cytoscape 样式、Canvas 渲染

---

## 📁 验证场地代码

### Cytoscape 验证场地
```
client/src/playground/
├── CytoscapeValidationPlayground.tsx  (330 行) - React 组件
├── cytoscape-validation.css           (265 行) - 样式定义
└── cytoscape-popper.d.ts              (31 行)  - TypeScript 类型
```

### React Flow 验证场地 ✨ NEW
```
client/src/playground/
└── ReactFlowValidationPlayground.tsx  (292 行) - React 组件
    - 复用 cytoscape-validation.css（完全相同的样式）
    - 无需自定义 TypeScript 类型（开箱即用）
```

### 路由集成
```typescript
// client/src/App.tsx
<Route path="dev-preview/cytoscape-validation" element={<CytoscapeValidationPlayground />} />
<Route path="dev-preview/reactflow-validation" element={<ReactFlowValidationPlayground />} />
```

### 依赖
```json
{
  "cytoscape": "^3.34.0",
  "cytoscape-popper": "^4.0.1",
  "@popperjs/core": "^2.11.8",
  "reactflow": "^11.11.4"
}
```

---

## 🔧 技术实现亮点

### 1. 不可见锚点节点
```typescript
{
  selector: 'node[type="group-anchor"]',
  style: {
    'width': 1,
    'height': 1,
    'opacity': 0,
    'events': 'no'
  }
}
```

### 2. HTML 卡片通过 popper 定位
```typescript
const popperInstance = anchorNode.popper({
  content: () => cardElement,
  popper: {
    placement: 'top',
    modifiers: [{ name: 'offset', options: { offset: [0, 0] } }]
  }
});

cy.on('pan zoom resize', () => {
  popperInstance.update();
});
```

### 3. 相机状态持久化
```typescript
const state = { pan: cy.pan(), zoom: cy.zoom() };
localStorage.setItem('cytoscape-validation-camera', JSON.stringify(state));
```

---

## 📊 测试覆盖

| # | 测试 | 类型 | 状态 |
|---|------|------|------|
| 1 | 基础 HTML 渲染 | 自动 | ⏳ 待测试 |
| 2 | 边连接 | 自动 | ⏳ 待测试 |
| 3 | 交互 | 手动 | ⏳ 待测试 |
| 4 | 平移缩放跟随 | 手动 | ⏳ 待测试 |
| 5 | 性能（50节点） | 手动 | ⏳ 待测试 |
| 6 | 相机状态持久化 | 手动 | ⏳ 待测试 |
| 7 | 相机控制按钮 | 手动 | ⏳ 待测试 |

---

## ⚠️ 已知问题

1. **后端 API 503** - 不影响验证场地（使用 mock 数据）
2. **TypeScript 类型不完整** - 使用了 `@ts-ignore`（待改进）
3. **无自动化测试** - 仅手动测试覆盖
4. **硬编码测试数据** - 真实数据集成在后续 Phase

---

## 🤝 贡献

**验证场地维护者**: Luna  
**问题反馈**: 在 `SUITE_11_S4_MANUAL_TEST_GUIDE.md` 中记录测试结果

---

**创建日期**: 2026-09-18  
**最后更新**: 2026-09-18  
**状态**: ⏳ 等待手动测试
