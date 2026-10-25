# 跨端待修与验收边界

本包导出已存在的实现，不建立额外冻结合同、调度器或产品运行 gate。基线和上游来源见 [source-version.json](source-version.json)；精确源文件见 [source-manifest.json](source-manifest.json)。最终集成提交由主控在外层交接登记，避免在提交内容中自指最终 hash。

| 责任端 | 当前已有 | 下一项具体动作 | 完成证据 |
| --- | --- | --- | --- |
| 新执行器 owner | 程序入口、完整适配器响应检查点、argsHash、一次生成、候选→正常SAVE/READ | 窄补实际 child run/transport receipt 随既有result落盘；在原run保存实际Codex prompt、bridge payload、完整上游原响应及引用，连回原adapter请求argsHash | 同一task/attempt可机器核对adapter request、prompt、实际上游payload、childrun、原响应、候选及原SAVE key；不借旧runtime名或成功标记 |
| Host owner / 主控 | 独立CODEX固定endpoint/身份、独立scope、单新intake与现有lease、原保存读取投影服务 | 接受并技术部署准确源码；配置新运行端/独立principal/精确path凭据和单新WI/intake，不移交旧owner任务 | 官方配置名称/授权scope/部署回执 + 新端点实际metadata；秘密值保留原受控位置 |
| 可信消费者 owner | 独立CODEX discovery、严格tools metadata、Codex四条队列路径、stage执行编排 | 用新授权配置启动首条新事项；保持intake、stage、SAVE三种key和两层租约分别绑定 | 原SAVE key查询、唯一完整响应、正常SAVE、独立准确READ、同版Overall与attempt/queue收尾 |
| 前端 / 读者 owner | 已有工作、材料、初评状态/图与知识阅读服务 | 从原页面读取新事项准确workRef/revision和Overall来源；读取不调用模型 | 当前工作、同版sourceAssessment、真实状态和完整正文；不把材料/进度标签当作结果 |
| 主控 | 当前源码包、名字级平台观察与合成服务测试 | 组织首条真实新事项的完整链，再分别登记技术部署与业务验收 | 准确模型响应/执行回执、SAVE/READ、确定性Overall、原阅读面和正常结束分别有证据 |

首批不把所有翻译、Wiki、Review、适用性、TDMS或公司事实能力设为前置；工具schema保留完整45项不等于这些入口都完成迁移。未知上游或保存结果只按原绑定恢复，不能清检查点、换key、接管旧lease或补造成功。
