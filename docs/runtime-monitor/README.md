# WiseLink 主线图入口

## 现行主线：v1.11 结构＋Codex 原生职责修订

- [轻量主线图](WiseLink_Mainline.html)：系统接线与一次评估流程、节点开发卡、搜索、复制和导出。
- [图数据](mainline.graph.json)：主线图的唯一数据源。
- [主线图契约](../WISELINK_MAINLINE_GRAPH_CONTRACT.md)：长期职责、规则和五处接缝。
- [完整规范目录](mainline.reference.md)：按需查阅 v1.10 的13个节点、47条关系、58个场景及10条规则；这些数量不是完成率。

## 来源与维护

本地图沿用原v1.11布局、交互与[增量11来源](https://chatgpt.com/share/6ae2846a-f780-83e8-9234-684d77323ec6)，本轮实际合并用户《WiseLink Native：Codex原生能力复用、简化清单与图契约修订候选》（2026-10-29）的N01—N24及十条约束，并登记[新分享](https://chatgpt.com/share/6ae2adf4-b884-83e8-a07b-264a0eaa083d)。最新直接Goal保留Codex＋LiteLLM＋Host与完整Agent循环，Native只作最小可信业务接线；条件性DSH建议不采纳。不另立版本系列或第二图；未取得原增量11 Library附件完整字节，不冒称镜像。契约要求不等于尚未开发，也不证明已安装或真实运行。

阶段候选seal／SAVE不等于任务final；原授权、期限和Host合同允许时可把准确回执交回同session继续，不强制每SAVE新请求／session。这是职责要求，当前中途保存接续能力仍按准确实现和消费者验证，不据图宣称已接通。

需要修改图数据时，编辑 [mainline.graph.json](mainline.graph.json)，再从仓库根目录执行：

```sh
python3 docs/runtime-monitor/sync_mainline_graph.py
```

脚本只把合法 JSON 同步进本地 HTML 的唯一 `graph-data` 节点，不调用业务或网络；改变关系或边界时同时维护主契约与受影响目录。

## 独立验证与历史

[历史验证快照](../history/mainline-graph/20261029-retired-verification/README.md)保留原接线验证页及五份原 `verification.*.json` 的字节和观察时点，不作为现行设计或当前运行状态。[本轮维护前原契约及说明](../history/mainline-graph/20261029-before-author-alignment/README.md)按原字节归档。实现、技术发布和真实业务回执按各自准确范围查阅，不由文档版本或历史通过记录推断当前业务完成。
