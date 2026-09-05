# Hosted 原文存储读取异常

记录日期：2026-09-05，时间均为 Asia/Shanghai。范围：Host `app_17bzc551rsg`，样本 `WI-2c1902db-c2cd-427d-b0d4-1f8f70fe6597`。这是实际运行异常记录，不是新的发布 gate 或数据契约。

## 已确认的事实

- 13:57:33，FileService 对原文包返回有效元数据：文件 ID `1875042263478407`，桶 `bucket_aadkprardjghu`，1290694 bytes，`application/json`。成功 Trace：`5fa0e6824ca52cb357084f6d5d635d5f`。
- 14:00:34，页面创建 Turn 17。无 criterion URL 参数；数据库实读评估点 `GOV-008`、自动执行意图 true、`CANDIDATE_UNADOPTED`。
- 14:01:23，原生 Hosted 消费者自动领取；原文包元数据返回 null，Host 在上下文装配阶段写入 FAILED。Trace：`d1df4cde8cf11f796e732c35059daedb`。
- 同一 Trace 内另一包的一次 `fetch failed` 已被现有单次传输重试处理，随后同样返回 null。不是重试未生效，不需要新增重试框架或放开完整性检查。
- 14:14:15 左右，刷新整个页面同样在读取原文包时 500，Trace：`f53ce38f7203bfa37cce086c4dbfcf6b`；因此旧页面的 REQUESTED 并非最新执行状态。新页面明确显示暂时无法打开。
- 14:20 左右，官方 `apps +file-get` 返回 `400000034: File not found or no access`；按精确文件名及整个应用查询的列表为空，用量接口返回 0 文件 / 0 bytes。近两小时 Host 文件日志未发现 `remove` 调用。这不足以断言物理删除，也未证明是某次发布导致。
- 本地项目运行目录和官方 Hosted 既有运行目录/缓存未发现与现有原文包完全匹配的备份。Hosted 仅持有上下文/来源片段和引用，不能据此重造原件。
- 用户随后明确回复“没有进行过操作”。这是本人未执行清理、恢复或配置变更的确认；仍需平台侧查明存储不可见的原因。
- 14:36，纯前端修复 release `7681935244031429931` / `d620b22c8` 已 finished，再次官方文件查询仍返回 `400000034`，日志定位 `2026090514362846B9313531C4886F8195`。技术发布没有恢复原文存储。

缺失引用的现有文件路径为：

`unified-parsed-packages/sha256/46753f3aef474e65caec3f92dd5340644b102b28fe4ede833c1248ada8459a88.json`

此 SHA 是已有产物标识，不是本轮新增的 hash 或基线。

## Turn 17 的真实状态

| 字段 | 值 |
| --- | --- |
| ReviewConversation | RC-c92b2e97-3b6c-4d78-a59d-8c90e4046cf5 |
| Turn | RT-31d4f979-5b24-49b3-9e67-a62575008b21 |
| requestId | 9029d6b6-dd8b-4486-b95a-de695832b208 |
| ActionAttempt | ATT-38218e57-8186-49df-b1d6-54a24ef869e6 |
| operationRef | AQ-5692dc36e8934104aaad6b3d0b8a3d62 |
| status / claimCount | FAILED / 0 |
| errorCode | ARTIFACT_READBACK_MISMATCH:METADATA |
| terminalReason | REVIEW_CONTEXT_PREPARATION_FAILED |
| 任务输入 / 模型 / 候选 | 均未生成 |

事项 revision 11、讨论 ACTIVE、历史候选仍保存在数据库。没有 ReviewAction 确认、正式采用、重新解析或业务版本修改。原生消费者已自然返回 IDLE，未重放失败 Turn。

## 后续处置

1. 平台侧核查上述桶、文件 ID、路径与成功/失败 Trace，区分存储不可用、权限/可见性变化与实际删除；如涉及清理或恢复，查对应操作记录。
2. 优先恢复原位置的既有文件；只有持有完整原始备份且与现有描述一致时，才可做恢复。当前尚无此备份，不上传替代片段或改写数据库引用。
3. 存储恢复后，用实际页面读回原文和历史讨论，再创建新回合验证自动候选及连续追问。恢复结论单独记录，不以技术发布成功代替。

前端的刷新/草稿交互修复可独立交付：旧投影须明确标识，只读刷新不阻止编辑草稿，真实写入仍防重复。它不能修复云端存储，也不作为存储恢复证明。
