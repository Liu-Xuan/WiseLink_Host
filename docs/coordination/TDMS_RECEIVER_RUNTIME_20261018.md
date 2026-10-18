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

## 接收身份部署配置

`TdmsReceiverIdentityProfile` 复用现有 `OAUTH_CONFIG` 的 client，只增加受控配置项 `WISELINK_TDMS_BOUND_TENANT_ID`。这个值须由真实当前身份与部署归属核对后配置；不从来源包、调用者、身份映射或其他业务的租户变量自动填入，也不授予来源权限。未配置时应用仍正常启动，只有实际接收调用返回未配置错误。

接收仓库在 authority、selection 和关联保存前比较当前 actor 的 tenant/app，再核 SQL 中的 actor、准确 workspace 与两个已核 runtime suffix 角色，并调用 `workspace_aadkpkjef3slu.tdms_act_bound_identity(tenant, client)`。配套 SQL 必须在同一受控部署中提供这个 invoker 函数、固定八表 tenant 并接入原 RLS；函数核对固定 tenant/client 与当前 ACTIVE 映射。映射的一致性不等于来源批准，SDK 未向 SQL 传入的任意请求 tenant/app 也不会因此恢复。原 session、来源动作／成员、事务和撤销链继续适用。

当前公开 SQL 草案仍不能直接作为正式启用批次。准确 profile、九表 SQL、代码及来源登记须按实际环境一起审阅；本地测试和配置项存在均不证明已有真实 binding 或接收回执。

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

可通过 `WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG` 指定另一个绝对路径。示例中的端点和目录均为占位符，不能直接载入；实际值由既有 Chrome 与 Source 状态目录的 owner 提供并核对：

```json
{
  "schemaVersion": "wiselink.tdms-native-host-transport-config.v1",
  "chromeDevtoolsEndpoint": "<已确认且获准使用的既有 Chrome loopback CDP 端点>",
  "sourceStateDirectory": "/absolute/path/to/source-state"
}
```

同一 v1 配置支持两种显式端点：

- 既有 HTTP discovery：数值 loopback `127.0.0.1` 或 `[::1]`、明确端口及根路径；按原 `/json/list` 选取同 host/port 的 page WebSocket。
- 既有 browser WebSocket：精确 `ws://127.0.0.1:<port>/devtools/browser/<id>`，也接受 `[::1]` 或 `localhost`；端口必须明确且在 1–65535 内，browser id 仅限字母、数字、下划线和连字符。该模式不接受远端、`wss`、凭据、查询参数、fragment 或 page 路径，也不回退到 HTTP discovery。

可选 `targetId` 与 `receiverId` 用于消除已有目标歧义。`targetId` 必须是实际 CDP target id，不能填入浏览器工具自己的 page 编号。配置不得含 actor、凭据或任意外部端点；文件须为当前用户所有的普通文件，不能是符号链接，也不能允许组或其他用户写入。模块还核对现有 CDP 页面的准确 Host、app、WebSocket 和绑定。原件仅从声明 Source CAS 内按准确哈希与长度读取。

browser WebSocket 的每次调用只连接已配置端点，执行 `Target.getTargets`、对唯一准确 Host 页面 `Target.attachToTarget`（`flatten: true`）、同 session 的 `Runtime.evaluate`，最后 detach 并关闭连接。指定 target 时不改选其它页面；Runtime 在调用原桥前再次核对页面 origin/app。控制响应不得带外层 session，Runtime 响应必须匹配附着 session。协议字段依据 [Chrome DevTools Target 定义](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Target.pdl)。

既有调用 45 秒、Runtime 40 秒边界保留；detach 最多等待 1 秒，不改写已经确定的业务结果。断线、超时或错误 session 的未定结果保持 UNKNOWN，只按原请求与准确 SourceRef 对账，不自动重发。11 字段接收绑定、来源权限、preflight 先于原件字节、CAS 核验及原三路由保持原样。

工厂不读取 Chrome profile、端口文件或进程，不猜端口、不启动 Chrome、不创建、激活或导航页面，也不提交远程调试授权。`--autoConnect` 配置、端点文件中的线索或工具现有连接均不能证明另一个产品调用者已获准连接；若正常连接出现新的远程调试确认，须先明确调用者、准确端点、用途和范围。

## 来源代码消费

0.2.73 的完整交接闭包作为准确前驱保留。Host 选择性采用九个纯 SB 模型及三个既有验证接点；没有执行或整包导入 68 个来源模块。0.2.76／交接 @9 在完整闭包核对后，更新 History、Notebook 及内容身份投影三处消费者：两个已验证的原生 timeline 路径在跨次内容身份比较中视作等价。原始证据、同次前后与双读比较保留原 URL；owner、来源、技术版本、原件和意见准入继续按原规则校验。仅对已通过 purpose 校验的投影副本归一化；未知路径与畸形输入仍拒绝。来源扩展的安装本身不代表后续新结构已由 Host 采用。

### 完整 @13 / 0.2.83 的选择性消费

本批以完整 @13 的 17 个入口、69 个纯模块闭包为审查输入，只更新以下六个实际 Host 消费者，不导入来源侧采集、浏览器或调度执行器：

| Host 文件 | 本次消费 |
| --- | --- |
| `tdms-complete-owned-source.validation.js` | 接入经过完整校验的 OWNER_PRIMARY 阶段及内容身份投影，保留原请求与原始证据 |
| `tdms-reviewed-sb-history-purpose.js` | History v2/@2，核对实际 documentUrl 与已观察的原生 frame URL |
| `tdms-reviewed-sb-notebook-purpose.js` | Notebook v2/@2，同样核对实际文档而非只认 iframe 声明地址 |
| `tdms-reviewed-sb-native-tree.js` | 三种已审原生编号列标题与精确位置校验 |
| `tdms-reviewed-sb-native-layout.js` | 对应列标题与布局证据的一致性检查 |
| `tdms-reviewed-sb-notebook-native-table.js` | 准确两 folder 叶表与可选 tabindex，时钟只在内容比较副本中归一 |

OWNER_PRIMARY 沿用原 Complete1 schema，不增加路由。它只证明准确 owner、技术版本、详情与一份 PRIMARY metadata；其它必需页须明确延期，覆盖仍为 PARTIAL/NON_ATOMIC。Host 通用阶段支持六种厂家文件 scope，SIL/SB-IN 保留其额外 qualified 状态门槛；来源侧 SB/SL/MT/AD 的优先采集安排不变成 Host 全局黑名单。AD 未核实的业务版本保持精确 NOT_READ/null，不从同名或其它行推断。厂家 PRIMARY 与评估意见的 exact Estimated 准入分别判断。

原 capture、双读、原始 URL、请求 digest、来源与权限不归一。只有已经通过当前完整证据校验的内容比较副本处理已审 timeline 路径、编号列标题及 Notebook 时钟差异。同次漂移、未知 caption、旧缺实际 documentUrl 的 proof、叶表歧义和凭据 URL 继续拒绝，旧 proof 需正常重采。

实际消费者检查覆盖 prepare/adapter、receiver preflight/stage/read、daily POST/replay/GET 与准确 SourceRef；外部身份、数据库及文件存储使用明确合成端口。既有真实代表的导出 metadata 也只经过本地纯 prepare/adapter，不读取 PDF、不产生接收回执。已保存原件候选仍是 REVIEW_REQUIRED/null DVI，不能据此声称正式映射或工程排队完成。

Native 工厂的两种显式连接方式已接入同一个实际 `createNativeTransport` 消费者。本地合成 HTTP/WS peer 检查与独立反例证明协议、目标/session 绑定、清理及未知结果处理；它们不证明真实 Chrome 连接或业务接收。已有同一 Chrome 的正常 Host 身份接口 200，但当前线上旧版 receiver binding 返回 404，页面没有 Native bridge；仍须部署准确代码、完成正式来源登记并取得可用端点与目标。

## 运行前置与验收

`server/database/tdms-receiver-runtime.draft.sql` 包含三张接收登记/授权/不可变关联表，连同原六表草案均为未启用候选。当前草案还需补齐平台审计字段、JSONB 类型注释和原六表生产 RLS；实际 Hosted 工作区角色及平台默认策略须核对，测试专用角色、GRANT 和策略不能复制成生产权限。接收登记与来源授权的受控写入提供方、批准证据、动作/成员/有效期和撤销通道须在单独审阅的启用批次中配置并验证。建表本身不会生成来源授权。

本地 PG 与合成外部端口检查不证明真实 Chrome、Source 身份、FileService、生产 SQL 或数据接收已成立。正式接收须取得实际来源包、原 request 读回回执和准确 SourceRef 证据。正式调度保持关闭，直到声明范围的基线与真实增量接收验收通过。
