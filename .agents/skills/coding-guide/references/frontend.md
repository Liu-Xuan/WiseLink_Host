# 前端

沿用当前 React、路由、shadcn/ui、Tailwind 及项目已采用的设计，不根据模板擅自切换视觉方案。页面放在 `client/src/pages/`，复用组件位于 `client/src/components/`。

## 请求与状态

内部 Host 请求使用项目 API 层和平台请求函数；不要用裸 fetch 绕过租户、身份与 CSRF 封装：

```typescript
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
await axiosForBackend({ url: '/api/example', method: 'GET' });
```

`axiosForBackend` 是函数，不是可调用 `.get()`/`.post()` 的实例。使用真实 Controller 与共享 DTO，不给业务数据加虚构 fallback。授权失效、临时错误、空数据和加载状态分别处理；普通刷新保留已允许显示的内容与草稿，不能把读取失败展示成成功空结果。

前端日志使用 `@lark-apaas/client-toolkit/logger`，提示简洁可操作，保留错误 cause 和已有脱敏，不直接显示内部堆栈。

## 组件与身份

使用已有 UI 组件和实际 props。不确定时读组件源码或对应 README 的相关部分；缺少 `/forms-skill`、`/charts-skill`、`/table-skill` 不阻断开发，也不臆造调用这些技能。表单、表格、图表按项目现有组件、依赖类型和官方文档实现。

- 用户头像、姓名和人员/部门选择使用现有 business-ui 组件，按需读 `client/src/components/business-ui/README.md`；普通界面不直接展示内部 userId。
- 当前用户使用 `useCurrentUserProfile()`；初始值为 `{}`，通过 `userInfo?.user_id` 判断就绪。飞书 ID 不与妙搭 ID 混用；详细处理见 [user-identity](../../user-identity/SKILL.md)。
- 图标沿用 Lucide，新增图标核实包导出；图片沿用项目 Image 组件，保留替代文本、尺寸和响应式属性。
- 表单优先已有输入组件。组织组件按功能与复用需要决定，不按 100/500 行阈值强制拆分。

## 样式与路由

复用主题语义 token 与现有布局，保持响应式和可访问性。Tailwind arbitrary value 的空格使用下划线；使用项目已有颜色变量格式。仅在依赖与编译插件均已配置时使用 styled-jsx，动态值通过 CSS 变量或适当的行内 style。

内部跳转用 Router 的 Link/NavLink/useNavigate，路由注册与导航一致；首页保留有效 index。分享/二维码链接使用 `resolveAppUrl` 处理部署 base path，不自行拼接。懒加载和拆包根据实际消费者与测量选择，不机械禁用，也不为小改动额外引入。

资源优先采用用户提供与项目已有素材；开发素材生成与产品运行时插件分开。真实业务界面不使用占位资料伪装接通，隔离原型和测试数据应标明用途。
