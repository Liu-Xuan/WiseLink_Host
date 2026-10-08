# 临时 Gateway 源码接线与执行边界

`scripts/native-temporary-review-gateway.mjs` 与 `scripts/one-shot-outbound-adapter.mjs` 有两个消费者。Review 在显式 `--isolated-candidate` 并指定 launcher 时懒准备临时 Gateway；现有 Summary CLI 默认导入该准备器，交给 `derived-summary-native-gateway.mjs` 的确切会话生命周期。两个脚本补齐了 Summary CLI 已有的缺失依赖；这不改变 Summary 的候选合同、稀疏 READ、修订、缓存前缀或保存与恢复语义。

源码提供准备器接口，不提供新的执行授权。当前合成测试使用 fake resolver module、fake child CLI、合成配置和本地回环 upstream。它们证明本地源码接线、绑定与回执校验，不能证明实际安装 SDK、原生 Gateway 或 provider 兼容。真实 SecretRef 解析、child CLI、Host begin/heartbeat/READ 和模型请求都须有具体执行授权，不能由包存在或本地测试通过推定。

准备器先由 Host 回执绑定对象、attempt、模型选择、会话及 Task deadline。Review 在准备之前写 `gateway-prepare.started`；准备器另写独占 attempt marker，清理后保留该 marker，不能通过更换 checkpoint 重新武装同一 attempt。Summary 使用其既有 subject/session/deadline/rearm 接口和严格 receipt validator；已保存响应的重放不再次准备或派发。

SecretRef 源码接口从显式 strict-JSON OpenClaw 配置取得 `miaoda` provider 的 URL、模型、等待、API key 引用及自定义 header 引用；缺失或不匹配则停止。默认 resolver 的源码深导入路径为 `/home/gem/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/runtime-secret-resolution.js`，调用接口是 `resolveSecretRefValues(refs, { config, env })` 并要求单值 Map。这个路径和函数形状只是当前源码依赖，当前合成证据不确认真实安装版本支持它，也不授权读取真实配置。导入、export、配置或返回值不符均失败。

已解析的 key 仅进入 child environment 的 env SecretRef，自定义 header 值交给 adapter；临时 0600 配置不保存已解析秘密。Gateway 仅绑定 127.0.0.1，使用本次 token，关闭 plugins，并限制 built-in tools。健康检查使用该临时配置与端口；child environment 移除继承的 Gateway URL，token 不放入 argv。准备、健康检查、Host RPC 和 provider 等待受同一执行 deadline 约束；达到 deadline 后仍执行本次拥有资源的清理。child 停止有独立的等待时限，秘密扫描和临时文件移除也不受执行 deadline 限制，不保证在该 deadline 内完成清理。清理失败或状态未知会停止该 attempt；中止不证明远端工作已结束。

adapter 绑定 nonce、模型、输出上限、请求数和 deadline，拒绝重定向与并发占位。实际 upstream dispatch 逐 ordinal 计数，包括 Gateway 内部尝试。完整 JSON 或有效 SSE finish reason 加最终 `[DONE]` 才能证明 provider 终态；断流、协议不完整、未知终态、`length` 或清理状态不明会关闭该 attempt。仅在已有终态证明、剩余预算及有效 Host lease 下，Review 才能对支持的明确错误做有界恢复；未知结果不派发替代请求。

Review 的可选 `reasoningEffort` 写入临时模型参数，并由 adapter 在 upstream 派发前核对实际请求值。缺失、不匹配或显式关闭 thinking 会阻止派发；这些源码检查不构成对当前真实 provider 能力的声明。临时 provider 等待继承来源配置或显式 caller 值，并受剩余 deadline 约束；输出上限须符合来源模型配置，不能静默扩大或截断。

清理停止本次拥有的 Gateway 与 adapter，检查临时文件中是否出现已知秘密，再移除临时配置和状态。失败或发现持久化会停止。sanitized receipt 仅保留绑定、ordinal ledger、状态枚举、计数、时间和秘密扫描布尔值；不记录秘密、header、prompt、推理正文或 provider 原始响应。Review 的 assembly/response checkpoint 记录 body hash/字节数、实际 SourceRef IDs 和可取得的 usage；这些记录不证明候选已保存。

Review 的隔离结果在 seal/commit 之前返回未保存候选，不执行 commit 或 FINISH，但 Host attempt 活动已发生。Summary 继续走原有授权保存生命周期。具体输入输出、Host 副作用及 checkpoint 边界见 [输入输出合同](input-output.md)。真实运行前须单独核对安装 SDK、原生接线与本次执行授权；当前源码与 mock 测试不替代该核对。
