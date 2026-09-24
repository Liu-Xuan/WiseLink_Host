# FTD JobAid 精确作用域候选（2026-09-24）

本地候选基于 c114 源码 `a834d3ba731c1de06872ab665a82e66f3b7a9674`。
它只准备 `WI-990d6e76-78d4-440a-a419-1b2e37b94ac9` 的单阶段
`EVALUATE_JOBAID` 接入；未修改在线配置、cron、服务身份或业务数据。

## 授权与兼容

- 原 `WL_OPENCLAW_SERVICE_WORK_ITEM_ID` 保持 `WI-d09b7acc-2221-4e51-addd-e040ce3c68f4`；
  六条 cron 无需改动。旧调用省略新增 selector 时仍只落到原 WorkItem，原授权指纹不变。
- 新环境变量 `WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS` 默认不存在。
  若后续获得独立授权，值必须是**恰好一个**合法且不同于原任务的 WorkItem ID 的 JSON 数组，
  例如 `["WI-990d6e76-78d4-440a-a419-1b2e37b94ac9"]`。
  非法配置只阻断额外任务，不影响原任务。删除变量立即撤销额外作用域。
- 额外任务仅可通过状态、深链、动态 JobAid BEGIN，以及带显式 WorkItem ID 的
  JobAid attempt 来源读取、知识检索、工作保存/读回、状态、心跳、取消和提交。
  Host 用 tenant + WorkItem + attemptRef 读取持久记录；显式 selector 的 attempt
  还必须是 `OPENCLAW_DYNAMIC_EVALUATION`。跨任务 ref 返回 404。
- 翻译、适用性、Overall、Review、事项与文档操作未因这项配置取得额外权限。
  `isOpenClawAutomaticReviewConfigured` 仍只认原任务。FTD 完整业务链尚未因此完成。

## 技术上线顺序（尚未授权执行）

1. 审查并发布含可选 selector 的 Host。保持新增环境变量缺席，先验证原任务调用和 cron。
2. 审查并安装 c115 Skill。它只在 `EVALUATE_JOBAID` 阶段将任务 ID 传入
   attempt-only 工具；旧任务及其它阶段协议保持兼容。
3. 单独确认 FTD 目标、来源、预算与当前阶段，再授权设置上述精确环境变量。
4. 先核对当前 attempt 与运行队列；使用 c115 的单阶段限制和预期操作锁执行。
   `get_parse_status` 可能调和已过期的运行期限，不能当作绝对无写探针。

## 回滚

先删除额外环境变量并读回；此操作会使额外任务后续读回、心跳、取消和提交失权，
所以必须先确认没有在途 FTD attempt，或记录并处理其恢复状态。随后可回退 c115 Skill
与 Host 发布；原单值与六条 cron 始终保持不变。任何阶段不以安装、发布或本地测试
代替真实业务验收。

## 仍需完成

若要让 FTD 继续翻译、适用性、Overall 或 Review，必须为各无 WorkItem 参数的工具
建立显式准确 selector 与持久 ref/tenant/WorkItem/actor/source/CAS 联合校验，并对适用性
使用独立受控 context 绑定。不能把这份单阶段配置当作完整链路授权。
