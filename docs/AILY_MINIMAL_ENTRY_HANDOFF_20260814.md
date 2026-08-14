# Aily 最小入口交接

状态：`LOCAL_READ_ONLY_WRAPPER_COMPLETE / OPENAPI_KEY_AND_AILY_CONFIG_PENDING`

## 本轮范围

第一条真实 PDF 纵切已经形成 WorkItem
`WI-c2943f5a-d023-46ac-9cf5-9480de0aabaf`。本切片只为 Aily 暴露三项只读能力，
不再次解析，不创建 WorkItem，不写 Base、妙搭数据库或 FileService。

| Aily Skill | 妙搭 OpenAPI | 输入 | 输出重点 |
| --- | --- | --- | --- |
| `get_parse_status` | `GET /openapi/wiselink/work-items/{workItemId}/status` | `workItemId` | phase、failure、frozen.2 package summary、server deep link |
| `query_parsed_package` | `GET /openapi/wiselink/work-items/{workItemId}/parsed-units?query=...` | `workItemId`、`query` | 同一 Reader 的 source-bound results |
| `get_deep_link` | `GET /openapi/wiselink/work-items/{workItemId}/deep-link` | `workItemId` | 妙搭服务端生成的 HTTPS 深链 |

三项入口复用同一个 `CanonicalHostVerticalService`、同一个妙搭数据库 WorkItem、
同一个 ArtifactStore 和 Unified Reader。`requestId`、`documentVersionId`、
permission snapshot、artifact ref 和 deep link 均从服务端 fresh-read，不由 Aily 传入。

## 为什么不直接调用现有 `/api`

现有 `/api/canonical-host/**` 使用妙搭 `@NeedLogin` 登录上下文。Aily Workflow 的 HTTP
节点可以调用 HTTP/HTTPS 服务，但不会继承用户浏览器中的妙搭 Cookie。复制 Cookie 或关闭
CSRF 都不是可接受方案。

妙搭 `/openapi` 路由由平台网关使用应用 OpenAPI Key 鉴权，适合 Aily 的服务端只读调用。
它仍在同一妙搭应用、同一 Nest service 内，不是新 MCP、网关或第二后端。

参考：

- 飞书 Aily HTTP 节点：https://www.feishu.cn/content/k9cgfg70
- 飞书 Aily 自定义连接器：https://www.feishu.cn/content/ya5j9hjw

## Aily 平台最小配置

发布包含上述三条路由的 DEV 版本后，先只读检查现有 Key，再创建一个仅覆盖这三条 GET
路由的专用 Key：

```bash
lark-cli apps +openapi-key-list \
  --app-id app_17bzc551rsg --as user

lark-cli apps +openapi-key-create \
  --app-id app_17bzc551rsg \
  --name "WiseLink 3.1 Aily read-only" \
  --scope-api 'GET /openapi/wiselink/work-items/{workItemId}/status' \
  --scope-api 'GET /openapi/wiselink/work-items/{workItemId}/parsed-units' \
  --scope-api 'GET /openapi/wiselink/work-items/{workItemId}/deep-link' \
  --as user
```

`create` 只回显一次原始密钥。原始值必须直接保存到 Aily HTTP/自定义连接器的 Secret
凭证字段，并由连接器注入 `X-Api-Key`；不得写入 Git、文档、Prompt、对话、普通环境变量
截图或日志。后续 `list/get` 只能看到脱敏预览，丢失时只能执行受控 reset。

然后建立三个 Workflow Skill；只声明上表字段，不提供任意 URL/header/body 输入。先在 Aily
调试态读取上面的真实 WorkItem，核对状态、查询结果和深链与妙搭页面一致。Aily 发布属于
后续独立动作，本提交不执行。

## 第四项 `start_parse`

本轮不配置 `start_parse`。真实 WorkItem 已完成，重复调用会违反“不得触发第二次解析”的
边界。未来需要时复用现有
`POST /api/canonical-host/work-items/parse-pdf` 的普通业务 service，另行暴露受控写入口；
不能让 Aily 直写数据库，也不应为此建设队列、MCP 网关或独立服务。

## Non-claims

- 未创建或发布 Aily Agent/Skill。
- 未创建、重置或回显妙搭 OpenAPI Key。
- 未发布妙搭新版本，因此 hosted `/openapi` 尚不可调用。
- 未写 WorkItem、Base、FileService、DocumentVersion 或 ParsedPackage。
- 未触发第二次解析，未加入 Assessment、Job Aid 或 OpenClaw。
