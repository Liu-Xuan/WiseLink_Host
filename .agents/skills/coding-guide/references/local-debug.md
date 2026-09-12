# 本地调试

只有当前任务需要运行或调试时读取本页。按 `package.json` 的实际脚本和启动输出确认服务状态，不假定 devServer 已启动。先复用已知相关服务；需重启时只处理属于当前任务的进程，避免打断其他 owner。

## 入口与身份

从 `.env.local` 仅查看需要的非敏感配置及实际启动输出：

| 配置 | 作用 |
| --- | --- |
| CLIENT_DEV_PORT | 前端 dev server 与 `/api` 代理入口，常见 8080 |
| SERVER_PORT | NestJS 内部端口，常见 3000 |
| CLIENT_BASE_PATH | 平台路径前缀，可能为 `/app/<app_id>` |

实际入口通常为 `http://localhost:<CLIENT_DEV_PORT><CLIENT_BASE_PATH>/...`，以启动输出为准。通过前端代理调试依赖身份的接口，它负责已有 webuser 注入；直接访问 NestJS 可能丢失用户上下文。端口冲突按实际 env 配置选择空闲端口，不改平台 bootstrap 的硬编码，不杀不明进程。

优先使用已登录浏览器验证身份接口；HTTP 客户端只有在同样可信的开发代理/会话链路下才有等价意义。缺少身份时如实标明未验证，不伪造线上身份头，也不用“思考通过”代替实际结果。

## CSRF

保留现有 double-submit cookie 保护。浏览器请求层配对 cookie 与 `X-Suda-Csrf-Token`；本地 HTTP 调试遵循该环境实际中间件规则并走前端代理。先核实请求路径、cookie/header 和身份来源，不能因 403 删除 CSRF 或权限检查。

## 定位错误

- 编译错误：从实际报错位置和涉及类型入手，选择项目已有类型检查或构建脚本。
- API 404 或返回 HTML：核对 Controller 前缀、Module 注册、ViewModule 顺序与 base path，不改内置 ViewController 来兜底。
- 运行异常：读取对应的 `logs/server.log`、`logs/server.std.log`、`logs/dev.log` 或浏览器错误。不存在的日志路径先核实实际启动配置；不要求每次文案修改都启动服务读日志。
- 连接串 expired/invalid：检查项目启动流程是否重新拉取环境变量，必要时用已授权的 `lark-cli apps +env-pull` 或启动脚本刷新后重启相关进程。不要输出连接串或手写凭据；未恢复则继续查认证、网络和平台返回的具体原因。

用适合改动的实际路径完成验证；没有新信息时不要重复同一个失败请求。隔离 fixture 测试的通过不能替代 Hosted 行为证明，反之纯指令修订也无需触发线上动作。
