# TDMS 接收实现与 Native 运输接线

本文件说明 Host 接收代码及运行前置。代码采用、平台部署、来源批准、真实接收和工程正式采用是独立状态。

## Host 接线

- `server/app.module.ts` 在 `TdmsSourceModule.register()` 中导入 `TdmsReceiverRuntimeModule`，通过 `useExisting` 使用 `MiaodaTdmsSourceAuthorization` 与 `MiaodaTdmsDailyArtifactStore`。
- Source 授权来自当前 Native 最终用户身份、有效的 opaque session，以及受控持久来源登记。IMPORT、READ_RECORD、READ_HISTORY 等动作及其精确成员分别判断；登录、来源包和文件所有者均不授予 Source 权限。
- `MiaodaTdmsDailyArtifactStore.resolveDailySelection()` 为原 daily 导入解析准确关联。文件路径、对象、所有者、长度、哈希及前后元数据由实际 FileService 实现核对；关联按原 request、binding、包摘要及成员保持不可变。
- 查询和提交的短事务重新验证当前来源与原接收绑定。网络文件 I/O 不持有数据库锁。版本、SourceRef、lease、CAS 和 DocumentVersion 的决定权仍在 Host。

原三条客户端路由与原十字段导入回执保持：

```text
POST /api/tdms-source-imports
GET  /api/tdms-source-imports/:requestId
GET  /api/tdms-source-refs?sourceRef=...
```

Host 内部补充 receiver binding、selection preflight、selection stage/read 接口。它们不是来源侧新增正式采用协议。已核验文件仍为 `STAGED_CANDIDATE`；`documentVersionId` 保持 null，后续正式映射独立处理。

Selection 读取返回 `TDMS_UPLOAD_SELECTION_UNAVAILABLE` / 404，表示当前授权视图不可用，既可能不存在，也可能受成员 RLS 隐藏；该响应不证明对象物理不存在。Native 只有在精确包 preflight 通过且原来源、身份与会话绑定不变时才能进入新取得路径；浏览器 STAGE 再次校验。其他 404、明确拒绝和未知写入结果不触发自动重发。

## Native 工厂

```text
模块：server/modules/tdms-source/tdms-native-host-transport.mjs
命名导出：createNativeTransport
调用：await createNativeTransport()，无参数
运行时：Node.js 22 或以上
```

部署描述符中的模块位置必须指向实际安装文件的绝对路径。工厂使用已有 Chrome Host 页面会话，不打开页面、重新登录或导出 Cookie/令牌。页面挂载只安装本地可调用桥，不产生任务、请求或上传。

默认配置文件：

```text
~/Library/Application Support/WiseLink/tdms-host-native-transport.json
```

可通过 `WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG` 指定另一个绝对路径。示例仅说明结构，不能作为真实运行配置：

```json
{
  "schemaVersion": "wiselink.tdms-native-host-transport-config.v1",
  "chromeDevtoolsEndpoint": "http://127.0.0.1:9222",
  "sourceStateDirectory": "/absolute/path/to/source-state"
}
```

可选 `targetId` 与 `receiverId` 用于消除已有目标歧义。配置不得含 actor、凭据或任意外部端点；文件须为当前用户所有的普通文件，不能是符号链接，也不能允许组或其他用户写入。模块还核对现有 CDP 页面的准确 Host、app、WebSocket 和绑定。原件仅从声明 Source CAS 内按准确哈希与长度读取。

## 来源代码消费

0.2.73 的完整交接闭包作为准确前驱保留。Host 选择性采用九个纯 SB 模型及三个既有验证接点，并配套两个测试文件；没有执行或整包导入 68 个来源模块。History、Notebook 等后续来源修订须在新的完整交接闭包核对后消费，来源扩展升级本身不代表 Host 已采用其新结构。

## 运行前置与验收

`server/database/tdms-receiver-runtime.draft.sql` 是待授权的数据库候选，包含三张接收登记/授权/不可变关联表。旧六张 Source 表仍默认拒绝；测试专用策略不能复制成生产权限。实际 Hosted 角色、最小表权限、service-scope/RLS、来源批准证据、动作/成员/有效期和撤销通道须在单独审阅的启用批次中配置并验证。

本地 PG 与合成外部端口检查不证明真实 Chrome、Source 身份、FileService、生产 SQL 或数据接收已成立。正式接收须取得实际来源包、原 request 读回回执和准确 SourceRef 证据。正式调度保持关闭，直到声明范围的基线与真实增量接收验收通过。
