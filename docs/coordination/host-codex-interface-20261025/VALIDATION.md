# 本包验证记录

本包的机器产物由 `scripts/export-host-codex-contract.mjs` 离线导出，源码新接线完成后会再次刷新。`source-manifest.json` 记录准确 HEAD 与实际读取文件摘要，避免把旧编译产物或其他树的工具合同误作本批实现。

导出验证范围：

- 当前真实生产 `createServer('HOSTED'|'CODEX')`，全部可选provider存在但一经业务调用便失败。
- 官方 SDK InMemory `initialize` 和 `tools/list`，核对两种独立服务身份与服务版本。
- 45个工具metadata和完整输入JSONSchema逐字段原样导出；两种服务工具metadata完全一致。
- 原客户端 `validateHostToolMetadata` 对实际导出列表通过。
- 不调用业务tool、不打开外部transport、不执行模型或配置写入；导出计数 `hostBusinessHandlersCalled=0`。
- 每tool独立版本与outputSchema未声明，原样报告，不从服务版本伪造。

`validate-package.mjs` 进一步检查JSON可解析、源文件摘要一致、每个tool schema可编译、索引和单文件内容等于tools/list、脱敏合成MCP参数符合真实schema、原key SAVE/准确READ关系、材料绑定、同版纯函数Overall关联、敏感值/用户路径缺失和相对链接可解析。它默认只检查；显式 `--write-result` 才刷新无时间戳的稳定摘要。

原始合成服务trace来源于独立跨边界Jest测试，8个用例通过（由负责测试的协作者执行并报告，导出器没有重复运行模型）；该测试不执行真实上游推理，数据库、身份、persistence依赖为离线替身。它验证真实producer投影→程序材料parser→完整适配器响应检查点→真实service SAVE/materialize→独立READ、CODEX scope与真实MCP handler，以及准确读回修订的实际纯函数Overall投影；不证明线上身份、网关、真实数据库/RLS、最终commit/CAS/attempt/queue或页面业务成功。

公开例子经过明确脱敏，方法正文/定义/原系统提示词不包含在包内。原始Jest测试证明和脱敏示例schema/关联校验是两份不同证据；重算的inputHash/argsHash/artifact摘要不能冒充原始执行回执，不声称脱敏文本通过实际正文方法准入。

最终可复制结果以 `validation-result.json` 为准；测试和检查通过不改变 `README` 的未部署、未配置与未真实验收状态。
