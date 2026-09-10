# R10 初始评估链路：2026-09-10

本任务负责正常新任务的解析、上下文、补充输入、初始 JobAid 与综合评估。M3 / DLI 的真实完整流程仍待验收；测试、安装及发布不替代业务完成。主控负责 R10 云文档，交互 owner 负责 WI33 的私人贡献和后续更新；唯一 Hosted 消费者与 Host scope 只在协调后的空闲窗口切换。

## 当前核实

- 本 worktree 从默认 main 正常合并已发布 `d9c4c9a80a65c256291330a57e2f8e1dc55234e1`，合并后文件树与该提交相同，没有覆盖旧历史。唯一主动推送目标仍为妙搭 `origin`。
- 线上只读查询确认 WI33（`WI-33f5b8fa-53e3-44ec-8b9f-05bbd1e03df0`）保留 9 月 9 日 M3 翻译、JobAid 和 Overall 的成功记录及之前失败。JobAid 于 14:15:56、Overall 于 14:29:43 保存，事项修订 6。候选内容质量、补充输入与正常新流程仍需验收。
- 同源 DLI `WI-c67d44e3-c78c-49e9-91fa-8bce7aa34004` 仅有旧译文成功，JobAid `ATT-61c55f86-2031-4134-b95b-cb3c90a96862` 失败；9 月 9 日两次翻译续作取消。不能据此宣称 DLI 初始全链完成，也不自动重放旧 attempt。
- JobAid v2 / Overall v2 直接使用解析包，登记原文、方法和补充来源，允许保存阶段工作；Overall 使用精确已保存工作进行一致性检查。原 `buildJobAidProblemTask` 没有把共同上下文的完整关联资料用途、权威和可用性传给模型。
- 初始知识检索仍为 `NOT_CONNECTED`，可执行意图仅来源读取、工作保存、完成；Review 的 Aily 接线不等于初始检索已接通。初始按需查询仍需通过正常用户入口绑定本任务授权，不能借用私人会话、猜测最新登录或把未查询描述为零结果。

## 第一批实现

启用 `VERIFIED_ENGLISH` 的正常新任务按原文先处理适用性、JobAid、Overall，之后处理未启动的翻译。现有 BUSY 不抢占；显式排队请求先执行；未启用原文分析的旧路径保留翻译前置。缺少机队选择继续保留 `WAITING_INPUT`；P0B 受控重算的前提保持。

JobAid / Overall 的既有持久任务输入新增 `contextPackage`，保存事项与工作修订、主文件可读状态、关联资料版本/权威/背景用途/访问失败、来源性质。已由共同上下文实际读取的关联片段进入 `deliveredEvidence`；只在目录中的主文件片段仍需模型实际请求读取。工程师陈述保留未核性质，不转为外部已确认事实。无新增 hash、队列或正式采用动作。

初始提示补充明确语义：`No compliance time is given` 不能证明没有 AD、没有飞行安全影响或无需及时处置；受限参考不等于主文件不可读。该提示待后续兼容 Skill 批次安装，不在此改写当前 c69 发布归属。

## 验证与限制

64 项 Host 定向测试、14 项初始 Skill 协议测试通过；服务端类型检查、定向 lint 和生产构建通过。测试文件为仓库既有 lint 忽略范围。当前 worktree 未配置独立 dev server，因此未伪称读取本地服务运行日志；线上最近 30 分钟 JOBAID error 查询为空，仅说明该查询范围没有返回日志。新业务流仍需发布后从正常入口验证，未新增业务写入、未迁移 scope、未正式采用。

## 按需知识检索接线（第二批）

正常 PDF 新任务从已解析、身份一致的 OAuth 浏览器会话保存 `initial_aily_session_id`；旧任务保持 NULL，重试不换会话。新 JobAid/Overall 的外层 Host task 绑定会话与官方 agent，内层模型输入仅告知检索是否可用。初始排队请求和 claim 使用同一 connector 选择，完整模型上下文仍在 claim 时准备。

新增 `query_assessment_knowledge` 通过既有用户授权 Aily 服务执行只读查询；每次新请求使用一个 requestKey，提交响应不确定时按同一 key 读本地记录，不重新提交。有效 lease、原任务完整来源授权、任务 owner 和已存会话绑定均需匹配；失效授权明确返回 UNAVAILABLE。真实返回的 COMPLETED/FAILED/UNKNOWN 非空文字保存为 QUERY_RECEIPT，保留查询、时间、状态、PARTIAL 覆盖和 originalDocumentsVerified=false。读取回执才加入可引用集合，save 合并实际持久化回执；再读取已保存工作时校验原 owner/tenant/task 下的确切回执。查询文字不能作为 SOURCE_FACT 的直接依据。

0031 已由主控发布 7683797322245802959（a50f96732）附带平台同步，主控读回 db-env-diff changes=[]；迁移工件本分支提交 317562cd9，canonical 对应 43245b4a5。此项结构上线不等于检索路径已验收。

本地验证：独立 PostgreSQL 数据库加载实际 0029、0030 query 策略和0031，正确 initial/overall 允许；错误 actor/tenant/session/agent/attempt、缺 connector、旧任务 NULL 绑定、取消后新插入拒绝；取消后既有查询保留部分结果，旧 Review/private message 路径仍可用。新增 Host 测试覆盖 lease/取消、授权失效、确切回执和存储投影，模型边界测试确认 begin.modelInput 无 Host 会话/agent 控制绑定。Skill 实际请求体测试覆盖不确定提交只读原 key、不可用仍可保存条件分析和回执 provenance。相关既有测试、服务端类型检查、eslint 和 production build 通过。

尚待主控集成 Host/Skill 接线、安排官方 cron/scope 窗口，再由正常新任务验证 Hosted M3 与 DLI。不得把上述测试或发布结构当作真实全链完成证据；不手动调用 driver，不覆盖 WI33 交互运行窗口。
