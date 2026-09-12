# 后端与数据

## 模块与接口

采用现有 NestJS Controller/Service/Repository 和依赖注入结构，业务模块放在 `server/modules/`。新模块接入 `server/app.module.ts`，排在 `ViewModule` 前；Service 在所属 Module 的 providers 注册。平台入口和构建配置不要为业务小修重写。

- `/api` 是内部接口，写操作沿用 `@NeedLogin()` 及已有业务授权；`/openapi` 使用 [专门规范](../../openapi-guide/SKILL.md)。
- 方法、路径、DTO 和 `shared/api.interface.ts` 保持一致；静态路径放在会冲突的参数路由之前。`@Query`/`@Param` 的字符串输入按实际 DTO 转换和验证。
- 用户与租户来自可信 `req.userContext` 或 Host 已有的授权绑定，不能由前端自报。身份字段和 ID 转换见 [user-identity](../../user-identity/SKILL.md)。
- 沿用现有 HTTP 请求与状态轮询机制；不为普通任务另建第二运行时或未经平台支持的传输通道。
- 第三方调用在适合的服务端边界进行，秘密留在服务端；浏览器 SDK 不导入 `server/`。文件受理沿用现有 FileService/前端上传及元信息登记路径，不凭模板替换现有受控链路。

## Drizzle 与事务

使用平台注入的 `DRIZZLE_DATABASE`，不另建连接或拼接连接串。数据库结构和类型来自 `server/database/schema.ts`；改表时走项目现有授权 DDL 流程，再运行 `npm run gen:db-schema` 并检查生成结果。未改表时只核对用到的表和字段。

Host 已有 `db.transaction`、参数化 `sql`、actor/RLS 查询。涉及多条一致性写入时保留或使用短事务；文件上传、外部调用和长计算留在事务外。不能把需要原子性的动作拆成彼此独立的写入。新增 SQL 沿用参数绑定与授权过滤，不使用字符串拼接、额外权限连接或临时伪类型。

- 条件组合沿用现有查询方式；不要为了修类型丢掉筛选或授权条件。
- 数字型身份 ID 按 string 透传。`userProfile` 自定义列按生成类型使用；count、时间字段按驱动实际返回和序列化结果处理，前端日期通常是 ISO 字符串。
- 参数化 UUID 数组查询需要时用现有 `ANY(${ids}::uuid[])` 写法，空集合和无权限结果保持正确语义。
- 分页沿用接口契约；需要稳定翻页时使用唯一排序键及游标，给 limit 合理上限。

## 异常与日志

后端使用 NestJS `Logger`，`log` 代替不存在的 `info`。错误保留原因并交现有错误处理层；日志按现有脱敏规则记录定位信息。密钥、连接串、Cookie、受控正文和内部堆栈不直接返回浏览器。

出现连接验证失败先检查当前启动/环境获取链路及失效原因，按 [本地调试](local-debug.md) 恢复，不修改业务权限来绕过错误。
