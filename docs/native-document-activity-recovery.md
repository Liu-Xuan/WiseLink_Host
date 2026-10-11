# 原 native Activity 工具结果的显式恢复

这是原工具结果到现有 consumer 的协议适配。原 HTTP wire 没有保存，恢复不声称原 HTTP 状态、body 或 usage，也不调用模型。合成测试只验证安全边界，不表示真实业务结果已保存。

入口仅用于一个明确的原 v2 quote-selection run。默认 consumer、自动 cron 和仅提供 native 路径的调用仍停在原 unknown。调用者须使用已安装版本的正常 runtime/config 与原私有 checkpoint 根，显式传入：

```text
node scripts/invoke-hosted-document-activity-model.mjs
  --document-version-id <原DV>
  --activity-run-ref <原DAR>
  --candidate-schema-version wiselink.document.activity-candidate.v2
  --exact-quote-selection
  --checkpoint-root <原checkpoint根>
  --recover-native-result
  --native-session-store <原owned sessions.json绝对真实路径>
  --native-trajectory-file <原owned trajectory.jsonl绝对真实路径>
```

路径不能指向 symlink、外部所有者或超限文件。模块只读精确 inputHash 派生的唯一 activity-driver session，不读取其它会话的最后响应。原完整 INPUT 必须与 consumer 重建的完整输入逐字段一致；原 startedAt、DV、parseRun、semanticRevision、selection、sourceBinding 和四项 productionContract 必须一致。模型身份只来自相互匹配的 native index、model_change 和实际 assistant 元数据，不能从配置补齐；旧 ACTIVITY 未记录的 executionModel/settingsRevision 仍未记录。

原会话必须已成功结束，全部 abort 标志明确为 false，且只有一个最终被 schema 接受并 delegated 的 return_wiselink_activity_proposal。先前 schema 拒绝记录保留。实际 arguments 不删改；thinking 不出现在返回值或恢复回执。截断的 trajectory snapshot 仅交叉核对 call/response 身份，不替代完整参数。

consumer 先读取原 STATUS，已保存时直接返回，绝不第二次 SAVE。未保存时用原 run 的 fresh CLAIM，并在同一 fence 下 READ 重核当前 actor/member/source 授权与全部旧来源、context、range 和 coverage。任何变化、缺失、未知、并发冲突或过期均停止；原 deadline 不延长。权限由 Host 决定，native 文件不授予权限。

仅在完整 provenance 与现有 quote/context/source 严格校验通过后，consumer 写正式 model.result，保留原 source.result/model.started 字节，然后使用普通 ACTIVITY_SAVE_SELECTION。若先前 SAVE 已派发则只查原 STATUS，不重发。恢复错误不调用 ACTIVITY_FAIL，不改变原 unknown/retry 保护；已写正式 result 后也不会重调模型。

failure.diagnostic 只记录固定 stage/category、允许的错误代码或 HTTP status；不记录原始 error、body、URL、header 或 provider 私有内容。诊断从不授权重试。真实原 run 恢复/保存仍须另外核验正式 Host 回执，不能以 native session success 或本地验证 PASS 代替。
