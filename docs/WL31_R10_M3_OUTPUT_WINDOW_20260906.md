# R10 c24 真实 M3 运行与 c25 输出分窗修订

日期：2026-09-06（Asia/Shanghai）。本记录区分技术发布、真实业务失败与尚待验证的修订，不把安装或普通测试视作业务完成。

## 已发布及真实页面

- Host release `7682359509466106846` 于 18:02:38 finished，完整提交 `4d38faea79b0db15382aef9a2d5f96e9339bb14f`，error_logs 为空；发布后官方 dev→online 数据库差异为空。
- Hosted c24 安装轮次 `7682357276456176840`：26/26 源文件匹配，125 tests pass，Ready/Visible；归档 SHA256 `a33db9f7f476992031aeb2fd28946514164da50cd2d93a7f4963175c2be7530a`。安装源通过同一 Host 私有文件存储及官方临时签名 HTTPS 链接取得；没有公开 ACL、下载代理或凭证迁移。
- 新真实文件为用户授权目录中的 `737-46-1053_R04.pdf`，正常内置浏览器上传；事项 `WI-6584f4cb-0a28-478e-9746-fe66acaf1b56`，文档版本 `document_version_8efe5a47c955b8d30a5d08d7`，24 页、671 内容单元、672 SourceRef，revision 3。
- 初始阶段页面已实际显示 PENDING → RUNNING → 未完成，以及绑定 M3、未保存候选与保留失败的说明；来源查询 SUBJECT 命中 6 个单元/6 页并由真实引用定位到受控 PDF 第 1 页。
- `/settings/models` 页面显示四个已登记内置模型与 `dli/gpt-5.6-sol`。全局当前 M3/revision 0，因模型管理角色尚未确认而显示 ROLE_NOT_CONFIGURED、单选及保存禁用。没有写权限、角色绑定或 DLI 工程生成测试。

## 自然运行与根因边界

唯一原生 cron `8db789fa-4fe9-4e58-850c-97b4cd70eb46` 在空闲时由管理轮次 `7682358935945530346` 禁用并只迁移事项 argv；Host 对应 exact WorkItem scope 单键同步。Host 发布完成、差异为空后，轮次 `7682360923508296677` 仅启用原任务，未手工执行 driver/cron run。

18:05:19.994 自然 tick 运行；翻译 ActionAttempt `ATT-b185188a-6c6f-4cec-9fc3-15f8f53e9e34` / request `AQ-ef986d9dd7b54785bd448c2571602b54` 于 18:05:24.122 启动并绑定 `miaoda/minimax-m3`/settings revision 0。18:08:50.158 取消，consumer 原因 `INITIAL_GATEWAY_HTTP_400`；没有 model.result、run-result、候选提交、JobAid/Overall 或事项版本变化。

只读管理轮次 `7682363592980958140` 核实：

1. driver 只有 round 1 的一次 HTTP 请求。Gateway 自己对空结果做 retry 1/1；首次空结果在 18:07:10，内部重试在 18:08:49 以 length 结束。
2. 返回 HTTP 400 / 142 bytes，无 usage、工具调用或候选 payload。驱动未显式传入 maxTokens；实际生效的输出预算和推理预算未知，模型目录声明不充当实际 token 观测。
3. Gateway 仅在完整 pending tool call 和 tool_calls 终态时序列化结果；空 length 终态被归为 format / incomplete_result。c24 的“接收有效连续前缀后续写”在这里没有可接续内容。
4. 原生 cron 本次约 210381 ms、历史连续错误数增至 9，下一次自然运行受原生错误退避约束。没有清除错误历史、重放 checkpoint 或把旧失败改为成功。

因此，本次证据支持“必须在生成前限制单次输出工作量”，不支持“全文输入超限”或“已经翻译了一部分”。

## c25 兼容修订（安装与实跑待完成）

首次仍向同一原生会话传入完整、未经切片的 Host 模型输入，另给出连续输出窗口：最多 96 个完整来源单元、约 6000 原文字符。它是保守工作预算，不冒充模型 token 上限；单个超长来源单元不被截断。后续只追加新工具交互及下一个输出窗，沿用原始全文与此前译文，不重发全包、不开始独立分段任务。

模型只输出序号与译文，确定性适配器恢复原 unitKey、SourceRef、rulePack 和启动绑定。既有完整性校验、Host CAS 与提交边界不变；中途失败没有完整候选可返回，开发期不自动重试或换 Provider。短文可一窗结束；合法连续前缀可提前结束，不新增拒绝多返回单元的门禁。

本地三个 Skill 测试文件 127 pass / 0 fail，覆盖 503 单元的同会话六窗完整回装、完整全文只出现在首请求、长单元不切断、第二窗失败不重发及不产出半成品。此次没有 Host 接口或数据库变更，可在已发布 c24 Host 上正常 Skill-only 安装。

后续必须用正常页面的新请求验证真实译文覆盖、跨章节术语一致性、初始分析后续阶段及至少两轮 Review。两个模型均跑通、全局切换权限确认和正式运行的有界恢复仍未完成；此处不宣告 R10 Goal 完成。
