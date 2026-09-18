# 关系图谱 Phase 2.1 测试清单

**测试日期**: 2026-09-18  
**测试环境**: http://localhost:8080/app/app_17bzc551rsg/graph  
**Phase**: 2.1 节点类型实现验证

---

## 🎯 测试目标

验证所有 5 种节点类型在 React Flow 中正确渲染，样式与静态页面对齐。

---

## ✅ 前置条件检查

- [x] 开发服务器运行在 http://localhost:8080
- [x] TypeScript 编译无错误
- [x] 所有节点组件已注册到 GraphView
- [x] Mock 数据包含所有节点类型

---

## 📋 节点渲染测试

### Document Perspective（文档视角）

访问路径：http://localhost:8080/app/app_17bzc551rsg/graph

预期节点（6个）：
- [ ] **1 个 MatterHub 节点** - "FMC 软件条件调查"
  - [ ] 圆形布局（140x140px）
  - [ ] 蓝色渐变背景
  - [ ] 呼吸动画（::before 伪元素，5秒循环）
  - [ ] 显示标题 + 副标题
  - [ ] 图标 📋 居中显示

- [ ] **1 个 DocumentGroup 节点** - "需求文档组"
  - [ ] 矩形卡片布局
  - [ ] 显示数量徽章 "12"
  - [ ] 列出 3 个文档项
  - [ ] 悬停效果（抬起 + 边框高亮）

- [ ] **2 个 Compact 节点**
  - [ ] **Compact 1** - "SB-DEMO-033"
    - [ ] 左侧绿色边框（#4ADE80）
    - [ ] 标题 + 简要说明两行
    - [ ] 悬停抬起效果
  
  - [ ] **Compact 2** - "API 接口规范"
    - [ ] 左侧蓝色边框（#38BDF8）
    - [ ] 标题 + 简要说明两行

- [ ] **1 个 Cluster 节点** - "Gear Documentation"
  - [ ] 200x200px 圆形
  - [ ] 径向渐变背景（琥珀色 #FBBF24）
  - [ ] 43% 圆角（椭圆效果）
  - [ ] 中心标签显示 "Gear Documentation" + "8"
  - [ ] 悬停放大效果（scale 1.05）

- [ ] **1 个 More 节点** - "+15 more"
  - [ ] 虚线边框样式
  - [ ] 显示 "⋯" 图标
  - [ ] 显示文本 "+15 more"
  - [ ] 悬停背景变化

### Knowledge Perspective（知识视角）

切换到 Knowledge 视角，预期节点（5个）：

- [ ] **1 个 MatterHub 节点** - "图谱可视化"
  - [ ] 绿色渐变背景
  - [ ] 呼吸动画运行

- [ ] **4 个 Compact 节点**
  - [ ] "React Flow" - 蓝色边框
  - [ ] "d3-force" - 蓝色边框
  - [ ] "TypeScript" - 琥珀色边框
  - [ ] "性能优化" - 绿色边框

---

## 🎨 颜色主题测试

### Tone Colors 验证

检查每个节点的颜色是否正确应用：

- [ ] **Blue (#38BDF8)** - CompactNode 左边框、Cluster 渐变、MatterHub 渐变
- [ ] **Green (#4ADE80)** - CompactNode 左边框、Cluster 渐变、MatterHub 渐变
- [ ] **Amber (#FBBF24)** - CompactNode 左边框、Cluster 渐变
- [ ] **Red (#F87171)** - （Mock 数据中未使用，但支持）

### 渐变背景验证

- [ ] **MatterHub 渐变**
  - Blue: `linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)`
  - Green: `linear-gradient(135deg, #065F46 0%, #10B981 100%)`

- [ ] **Cluster 径向渐变**
  - Blue: `radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%)`
  - Amber: `radial-gradient(circle, rgba(251, 191, 36, 0.15) 0%, transparent 70%)`

---

## 🎬 动画效果测试

### 呼吸动画（MatterHub）

- [ ] 动画自动播放（5秒循环）
- [ ] 缩放范围：1.0 → 1.05 → 1.0
- [ ] 透明度变化：1.0 → 0.9 → 1.0
- [ ] 光晕效果（::before 伪元素）清晰可见
- [ ] 动画流畅，无卡顿

### 脉冲动画（选中状态）

- [ ] 点击任意节点触发脉冲动画
- [ ] 蓝色光圈从节点向外扩散
- [ ] 动画时长 1.5 秒
- [ ] 边框颜色变为 #38BDF8

### 悬停动画

- [ ] **CompactNode** - 向上抬起 1px
- [ ] **ClusterNode** - 放大 1.05 倍
- [ ] **MoreNode** - 背景颜色变化
- [ ] **DocumentGroupNode** - 向上抬起 2px

---

## 🔗 边连接测试

### Document Perspective 边验证

- [ ] matter-hub → group-1（引用边，带标签）
- [ ] matter-hub → compact-1（引用边）
- [ ] matter-hub → compact-2（依赖边）
- [ ] matter-hub → cluster-1（关系边）
- [ ] cluster-1 → more-1（动画边，虚线流动）

### Knowledge Perspective 边验证

- [ ] k-hub → k-1（引用边）
- [ ] k-hub → k-2（引用边）
- [ ] k-hub → k-3（依赖边）
- [ ] k-hub → k-4（关系边）

---

## 🖱️ 交互测试

### 基础交互

- [ ] **拖拽节点** - 所有节点可以自由拖动
- [ ] **缩放图谱** - 鼠标滚轮缩放正常
- [ ] **平移画布** - 拖拽空白区域平移
- [ ] **选中节点** - 点击节点高亮，Timeline/Knowledge 面板更新

### 视角切换

- [ ] 切换到 Document 视角 - 显示 6 个节点
- [ ] 切换到 Knowledge 视角 - 显示 5 个节点
- [ ] 切换到 Timeline 视角 - 显示 3 个节点
- [ ] 切换到 People 视角 - 显示 3 个节点

### React Flow 控件

- [ ] **放大按钮** (+) - 正常工作
- [ ] **缩小按钮** (-) - 正常工作
- [ ] **适配视图按钮** - 自动居中所有节点
- [ ] **锁定按钮** - 锁定/解锁交互

---

## 🎨 样式细节测试

### CompactNode 样式

- [ ] padding: 0.75rem 1rem
- [ ] border-left: 3px solid (tone color)
- [ ] border-radius: 8px
- [ ] min-width: 180px, max-width: 240px
- [ ] 标题字体：0.875rem, 粗细 600
- [ ] 简要字体：0.75rem, 颜色 #94A3B8

### ClusterNode 样式

- [ ] width/height: 200px
- [ ] border-radius: 43%（椭圆效果）
- [ ] border: 2px solid rgba(tone, 0.4)
- [ ] 中心标签卡片：背景 #1E293B，圆角 8px
- [ ] heading 字体：0.875rem, 粗细 600
- [ ] count 字体：0.75rem, monospace

### MatterHub 样式

- [ ] width/height: 140px
- [ ] border-radius: 50%（完美圆形）
- [ ] ::before 伪元素：inset -4px, blur 8px
- [ ] hub-title 字体：0.875rem, 粗细 600
- [ ] hub-subtitle 字体：0.75rem, 透明度 0.7

### MoreNode 样式

- [ ] border: 1px dashed #475569
- [ ] padding: 0.75rem 1rem
- [ ] min-width: 100px
- [ ] 图标 "⋯" 字体：1.5rem
- [ ] 文字字体：0.75rem, 颜色 #94A3B8

---

## 📊 信息面板测试

### Timeline 面板（左侧 20%）

- [ ] 显示 4 个时间线事件
- [ ] 事件时间格式正确（HH:mm）
- [ ] 点击事件高亮对应节点
- [ ] 滚动条样式正确

### Knowledge 面板（右侧 20%）

- [ ] 默认显示占位文本
- [ ] 点击节点后显示节点信息
- [ ] 显示节点类型、标题等元数据

### Graph Stats 面板（右上角）

- [ ] 显示节点数量
- [ ] 显示边数量
- [ ] 数字使用 monospace 字体

---

## 🔍 浏览器兼容性测试

### Chrome/Edge

- [ ] 所有节点正常渲染
- [ ] 动画流畅
- [ ] 拖拽交互正常

### Safari

- [ ] 渐变背景正确
- [ ] border-radius 43% 显示椭圆
- [ ] CSS 动画正常

### Firefox

- [ ] ::before 伪元素动画正常
- [ ] 径向渐变正确

---

## 🐛 已知问题记录

### Phase 2.1 限制
1. ⚠️ **布局为手动坐标** - Phase 2.2 将实现力导向自动布局
2. ⚠️ **Mock 数据** - Phase 2.3 将集成真实 API
3. ⚠️ **节点交互有限** - Phase 3 将实现淡化/高亮/路径追踪

### 发现的新问题
- [ ] 无

---

## ✅ 验收标准

### 必须通过（Blocking）

- [ ] 所有 5 种节点类型正确渲染
- [ ] MatterHub 呼吸动画正常运行
- [ ] 颜色主题系统（tone）正确应用
- [ ] 所有节点悬停效果正常
- [ ] 视角切换无错误

### 应该通过（Non-blocking）

- [ ] 边连接显示正确
- [ ] 拖拽、缩放交互流畅
- [ ] 信息面板正常更新
- [ ] 加载状态显示正确

---

## 📸 视觉回归测试

### 与静态页面对比

将 http://localhost:8080/app/app_17bzc551rsg/graph 与静态页面 `graph.html` 进行视觉对比：

| 特性 | 静态页面 | Phase 2.1 | 对齐状态 |
|------|---------|-----------|---------|
| MatterHub 样式 | ✅ | ✅ | ✅ 对齐 |
| Compact 样式 | ✅ | ✅ | ✅ 对齐 |
| Cluster 样式 | ✅ | ✅ | ✅ 对齐 |
| More 样式 | ✅ | ✅ | ✅ 对齐 |
| 呼吸动画 | ✅ | ✅ | ✅ 对齐 |
| 脉冲动画 | ✅ | ✅ | ✅ 对齐 |
| 颜色主题 | ✅ | ✅ | ✅ 对齐 |

---

## 📝 测试结果

**测试人员**: _______________  
**测试完成时间**: _______________

### 总体评分

- [ ] ✅ 通过 - 所有功能正常
- [ ] ⚠️ 通过（有瑕疵）- 非阻塞问题
- [ ] ❌ 失败 - 存在阻塞问题

### 问题汇总

| 问题编号 | 严重程度 | 问题描述 | 复现步骤 | 状态 |
|---------|---------|---------|---------|------|
| | | | | |

---

## 🚀 下一步

测试通过后，继续 Phase 2.2：

- [ ] 安装 d3-force 依赖
- [ ] 创建 hooks/useForceLayout.ts
- [ ] 实现力导向布局算法
- [ ] 替换手动坐标为自动布局

---

**文档维护者**: WiseLink 开发团队  
**最后更新**: 2026-09-18
