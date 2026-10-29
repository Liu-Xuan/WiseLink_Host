# WiseLink 主线图入口

## 现行目标：v1.11结构＋v2.6直接Goal职责

- [轻量主线图](WiseLink_Mainline.html)：系统接线与一次评估流程、节点开发卡、搜索、复制和导出。
- [图数据](mainline.graph.json)：主线图的唯一数据源。
- [主线图契约](../WISELINK_MAINLINE_GRAPH_CONTRACT.md)：长期职责、规则和五处接缝。
- [完整规范目录](mainline.reference.md)：按需查阅 v1.10 的13个节点、47条关系、58个场景及10条规则；这些数量不是完成率。

## 来源与维护

本地图沿用原v1.11布局与交互，现行职责本地按用户v2.6直接Goal语义修订：正式自动化由Aily企业智能体执行，团队仅获权只读问答／解释／进度／导航；交互复核即使不保存也须登录WiseLink后经企业链／Host显式受理，打开链接或登录不建任务，既有获权后台自动触发保留。两入口共享准确成果／版本，不复制完整聊天，群受众分别核权。GLM-5.3可用时优先，否则使用DeepSeek V4 Pro，不强制备用。本机原节点、view.f10、W1—W6及生成器保持，不按外部同号卡覆盖；历史v2.4文稿、[增量11](https://chatgpt.com/share/6ae2846a-f780-83e8-9234-684d77323ec6)与[Codex职责候选](https://chatgpt.com/share/6ae2adf4-b884-83e8-a07b-264a0eaa083d)保留来源身份，目标规则不证明迁移或业务已验。

“企业伙伴”是正式企业执行职责简称，具体对象与两入口的能力边界按[主契约当前定义](../WISELINK_MAINLINE_GRAPH_CONTRACT.md)读取。

阶段seal／SAVE不等于任务final。B须消费A独立Host READ的实际正文、引用、revision及保存引用的获权full／view；原授权、期限和合同允许才可同session继续，不强制每SAVE新请求。A同版Overall不提前FINISH／ACK，B失败不抹A，旧UNKNOWN先查原操作，不重放或自动启动旧C。

需要修改图数据时，编辑 [mainline.graph.json](mainline.graph.json)，再从仓库根目录执行：

```sh
python3 docs/runtime-monitor/sync_mainline_graph.py
```

脚本只把合法 JSON 同步进本地 HTML 的唯一 `graph-data` 节点，不调用业务或网络；改变关系或边界时同时维护主契约与受影响目录。

`WiseLink_Mainline.html` 的静态外壳、样式和 `drawWires()` 是本机渲染源，没有另一份模板；生成器保留这些内容，只同步图数据。调整连线几何时在该原外壳维护，再用同一脚本同步 JSON，不引入第二份页面源。

## 独立验证与历史

[历史验证快照](../history/mainline-graph/20261029-retired-verification/README.md)保留原接线验证页及五份原 `verification.*.json` 的字节和观察时点，不作为现行设计或当前运行状态。[本轮维护前原契约及说明](../history/mainline-graph/20261029-before-author-alignment/README.md)按原字节归档。实现、技术发布和真实业务回执按各自准确范围查阅，不由文档版本或历史通过记录推断当前业务完成。
