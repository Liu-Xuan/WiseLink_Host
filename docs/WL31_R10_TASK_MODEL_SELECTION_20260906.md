# R10 每任务模型选择

2026-09-06 20:05 用户明确同意改为每任务选择模型并继续；R10 云正文 revision 2206 与本地正文镜像已经同步。

## 已接通的路径

- 新建工程事项的现有 OAuth/Host 授权入口接受已登记的 `modelRef`。在原 WorkItem 预留事务中保存非秘密模型快照；全部初始 ActionAttempt 从同一事项继承，不再读取全局默认。不同模型用新事项，不改旧任务。
- 可空字段 `work_item.analysis_model_json` 兼容旧行。旧行优先保留最早的初始分析 attempt 模型；没有历史绑定的旧行才使用明确的部署初始选项，并以空值条件写入一次。没有基于失败切换模型的逻辑。
- Review 在保存输入时将本轮模型放入既有 Turn/EngineerSuppliedInput JSON；默认继承上一轮或事项模型，新请求可显式另选。幂等重试、正在运行与恢复中的 ActionAttempt 使用原快照。
- 跨模型回合不复用另一模型的原生会话；Host 已保存的讨论与本轮获准来源继续作为上下文。模型标识留在执行控制信息中，不混入候选工程事实。
- 新建页与 Review 提供模型选择；初始进度和 Review 分别展示事项/本轮选择与执行绑定。未知提交结果保留原请求标识和模型。全局设置页变为只读模型目录，原全局 POST 仍保留原权限保护。

## 数据与权限范围

本次 dev DDL 仅新增上述可空 TEXT 列及说明；`npm run gen:db-schema` 从平台生成的差异仅此一列。发布前 `+db-env-diff` 仅有 ADD COLUMN 与 COMMENT，无删除、历史回填、角色/成员或策略变更。模型目录是官方 Hosted 已核实登记的路由标识，不是实时调用健康检查；浏览器不能提交 endpoint、密钥或自报身份。

## 验证状态

前后端类型检查与 `build:prod` 通过，保留原有外部历史 worktree tsconfig、Tailwind module type 和 bundle size 警告。普通测试覆盖角色不作为任务前置、严格输入、根模型继承、Review 新选择与重试、跨模型新会话、持久 JSON 回读及正常受理链。

本文件首次提交时尚未技术发布或完成两模型真实运行；本地测试不替代真实初始分析及至少两轮 Review。c25 输出分窗已经安装，旧 M3 失败不重放；后续按原授权对齐单事项 Host scope 与唯一 cron，使用自然 tick。生产有界恢复仍是未完成项，不因本次选择模型接线而宣称完成。

## 技术发布与页面实测

- 功能提交 `aaac68ceda20d308c77d76f484e93389d1c12cea` 已以单一同名 refspec 非强制写入妙搭 origin 和获长期授权的 GitHub codex 分支。release `7682400018015243242` 于 20:39:22 finished，提交匹配，`error_logs=[]`。
- 内置浏览器以当前普通账户实读“按任务选择分析模型”：M3、智能选择、Flash、多模态及 DLI GPT 5.6 Sol 均展示，不再要求全局管理角色。受理表单默认 M3，可选 DLI；线上 `work_item.analysis_model_json` 为可空 TEXT。
- 22:31:40 页面单次提交现有真实 `SB-787-31-0019-01.pdf`，创建 `WI-26ce7d09-311c-4c6f-b1bf-58a3b7bf6e9c`。数据库根选择为 `miaoda/minimax-m3`，selectedAt 为 `2026-09-06T14:31:40.389Z`；证明受理模型已持久化，尚不证明模型生成成功。

## 本次存储传输失败与修订

该新事项 PARSE_PDF 在模型调用前失败。实际 Trace `58a2386577acacfa58b6a474a842d860`（当前前端提交 aaac68ced）显示原 PDF 元数据与下载成功；专业产物上传前 `getFileMetadata` 返回 `fetch failed`，随后失败报告上传前的同类请求也失败。没有产物 upload span，最终 revision 3、`RECORDING_FAILED`、`originalFailureCode=FETCH_FAILED`、`failureCode=FAILURE_REPORT_RECORDING_FAILED`。精确官方元数据读取返回 `400000034`（不存在或无权），不能将此解释为删除、明确不存在或旧事故根因。

新修订复用原文件读取规则，在上述两处上传前的只读探测补上一次传输错误重试。带 HTTP 状态的错误、权限、对象缺失/不一致仍失败；不会把未知错误当对象不存在，不重复上传、不替换已登记 locator，也不重放失败业务。前端保持同用户、事项/请求与来源一致性读回；已明确登记的 FAILED/RECORDING_FAILED 展示实际失败类别和脱敏代码，提供原事项详情入口，不再误报为“校验尚未完成”或在受理入口反复提交。

4 个相关 suites / 49 tests、前后端类型和生产构建通过，保留既有构建告警。这些证明修订的本地行为，尚不证明线上传输故障已恢复。

此前正常解析、没有模型 attempt 的 `WI-1c1e3f05-0807-4cd1-b43c-df4aea5e4be3` 当前可在内置浏览器加载全部 13 页原文。官方管理轮次 `7682431486981491912` 在无在途/同脚本进程 0 时，暂停唯一 cron `8db789fa-4fe9-4e58-850c-97b4cd70eb46`，仅将 argv 最后一个事项标识迁至该可用事项。cwd、每 60 秒、payload.timeoutSeconds=1800、历史和计数均保留；Host online 的单事项 scope 已对齐。此刻 cron 保持 disabled，待本次修订正常发布后再启用自然 tick；没有 cron run 或手工 driver。
