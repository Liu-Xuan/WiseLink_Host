# 跨端待修与验收边界

本包导出已存在的实现，不建立额外冻结合同、调度器或产品运行 gate。基线和上游来源见 [source-version.json](source-version.json)；精确源文件见 [source-manifest.json](source-manifest.json)。最终集成提交由主控在外层交接登记，避免在提交内容中自指最终 hash。

| 责任端 | 当前已有 | 下一项具体动作 | 完成证据 |
| --- | --- | --- | --- |
| 新执行器 owner | 固定请求/runner回执、解析后上游事件、adapted response、codexReceipt/program links、原key恢复、commit双读 | 沿同一回执链补实际Codex prompt、bridge payload与原HTTP/SSE字节/引用；保持已实现恢复 | 同一task/attempt可核对adapter请求、prompt、上游payload、childrun、原响应和原SAVE key，不把解析后JSON称为原字节 |
| Host owner / 主控 | 独立CODEX endpoint/身份、单新intake/lease、拒旧runtime和未支持业务、原保存读取投影 | 技术部署准确源码，配置新运行端/独立principal/精确path与新事项，停止旧入口新增领取 | 官方配置/授权/部署与实际metadata，旧owner不被接管；秘密值保留原受控位置 |
| 可信消费者 owner | 独立discovery、完整SDK schema引用、Codex四条队列路径、准确双读与封存结果恢复 | 确定实际唯一宿主和两个持久目录/卷，再用新授权运行首条新事项 | 原SAVE key、唯一原请求响应、独立READ、同版Overall与原队列结束；宿主/卷验证独立记载 |
| 前端 / 读者 owner | 已有工作、材料、初评状态/图与知识阅读服务 | 从原页面读取新事项准确workRef/revision和Overall来源；读取不调用模型 | 当前工作、同版sourceAssessment、真实状态和完整正文；不把材料/进度标签当作结果 |
| 主控 | 当前源码包、名字级平台观察与合成服务测试 | 组织首条真实新事项的完整链，再分别登记技术部署与业务验收 | 准确模型响应/执行回执、SAVE/READ、确定性Overall、原阅读面和正常结束分别有证据 |

首批不把所有翻译、Wiki、Review、适用性、TDMS或公司事实能力设为前置；工具schema保留完整45项不等于这些入口都完成迁移。未知上游或保存结果只按原绑定恢复，不能清检查点、换key、接管旧lease或补造成功。

925消费者的恢复准备已在CORE，但文档跨lease Host封存/恢复是并行P1，本包schema不含`READ_GENERATION`、`SEAL_CANDIDATE`、`RECOVER_SAVE`。文档缺少原Host seal或原结果不明时保留pending，不能因首测包交付就替换候选或再次生成。
