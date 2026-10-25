# 本包验证记录

本包的机器产物由独立首测CORE的 `scripts/export-host-codex-contract.mjs` 离线导出。`source-manifest.json` 记录观察时的HEAD祖先与实际读取文件摘要；最终组合提交另记于交付回执，不在仓库文件中自指。

导出验证范围：

- 当前真实生产 `createServer('HOSTED'|'CODEX')`，全部可选provider存在但一经业务调用便失败。
- 官方 SDK InMemory `initialize` 和 `tools/list`，核对两种独立服务身份与服务版本。
- 45个工具metadata和完整输入JSONSchema逐字段原样导出；两种服务工具metadata完全一致。
- 原客户端 `validateHostToolMetadata` 对实际导出列表通过。
- 不调用业务tool、不打开外部transport、不执行模型或配置写入；导出计数 `hostBusinessHandlersCalled=0`。
- 每tool独立版本与outputSchema未声明，原样报告，不从服务版本伪造。

`validate-package.mjs` 进一步检查JSON可解析、源文件摘要一致、每个tool schema可编译、索引和单文件内容等于tools/list、脱敏合成MCP参数符合真实schema、原key SAVE/准确READ关系、材料绑定、同版纯函数Overall关联、敏感值/用户路径缺失和相对链接可解析。它默认只检查；显式 `--write-result` 才刷新无时间戳的稳定摘要。

`check-host-contract.mjs --current-interface`固定引用同一SDK包：上游42名称均可读取完整schema，35机械示例和1既有示例通过；该旧示例集合另外6项未覆盖的事实仍报告。925新增7项真实Zod固定用例另经当前生产注册schema执行：56接受、184拒绝，零预期偏差；旧集合的缺例不再误称当前缺少schema或Zod验证。该检查不启用JSONSchema format插件，pattern照常验证；Zod用例实际执行format/transform/refinement，各自范围分开。

接口定向正反例共26项：当前包引用/路由/身份/safe integer及Zod证据11项、925比较器分类11项、固定artifact反篡改4项。比较器保留35机械schema的15项一致、20项差异；等价表达仍报告差异，真实限制不放宽。默认artifact模式明确从925固定Git对象校验client字节，当前本地源码另由manifest核对，不用前者冒充后者。

原始合成服务trace来源于独立跨边界Jest测试，8个用例通过（由负责测试的协作者执行并报告，导出器没有重复运行模型）；该测试不执行真实上游推理，数据库、身份、persistence依赖为离线替身。它验证真实producer投影→程序材料parser→完整适配器响应检查点→真实service SAVE/materialize→独立READ、CODEX scope与真实MCP handler，以及准确读回修订的实际纯函数Overall投影；不证明线上身份、网关、真实数据库/RLS、最终commit/CAS/attempt/queue或页面业务成功。

公开例子经过明确脱敏，方法正文/定义/原系统提示词不包含在包内。原始Jest测试证明和脱敏示例schema/关联校验是两份不同证据；重算的inputHash/argsHash/artifact摘要不能冒充原始执行回执，不声称脱敏文本通过实际正文方法准入。

本地94集成后的主控定向结果另行分层记录：20项Node（14项program-finish、6项真实consumer wrapper）、scope 3项（含拒旧runtime app）、Discovery 3项、queue 3项、按严格receipt fixture适配的实际Host服务边界8项通过；服务端类型检查通过。上游原70项离线报告仅是其交付时的证据，本轮未重跑旧53/9/70，不将这些数字相加成完成率。官方只读catalog约束验证与宿主/卷尚未验证的区别见 [ROLLOUT_AND_ISOLATION.md](ROLLOUT_AND_ISOLATION.md)。

925核心集成由主控报告Review19项、translation28项、queue23项、Host preflight12项通过。这些消费者结果不证明文档跨lease Host扩展：本首测CORE明确排除`READ_GENERATION`、`SEAL_CANDIDATE`、`RECOVER_SAVE`及其P1测试。宿主唤起、两处私有持久root、实际认证与首个新事项闭环仍未验收。

最终可复制结果以 `validation-result.json` 为准；测试和检查通过不改变 `README` 的未部署、未配置与未真实验收状态。

本次f57上19d必要增量：独立源码审查无阻塞；Node87通过/9项Linux跳过，Python10通过/3项Linux跳过，实际Host服务跨端8项通过。父checkpoint失败零spawn、prompt落盘失败零bridge/Popen、upstream body落盘失败零HTTPSConnection已离线验证。Linux `/proc` 与进程终止恢复部分本机未验，不能把skip算通过。首轮旧fixture/平台失败日志保留；没有放宽生产守卫。根server/shared/client未因本增量改变，最终构建另据准确组合回执。
