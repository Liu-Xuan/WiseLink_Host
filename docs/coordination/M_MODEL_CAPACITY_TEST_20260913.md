# WiseLink M3 实际容量测试（2026-09-13）

通过既有官方 Hosted 工程路由执行，模型 miaoda/minimax-m3，独立诊断会话，thinkingLevel=low。使用纯构造数据，不读取业务来源、不调用Host保存，不展示内部推理正文。

## 1. 长输出

- 会话：241b17a5-11b9-420d-8387-067377c6263d。
- 请求预算65536，要求1800条显式结构化记录，可按编号/固定标签/数值逐条核对。
- UTC13:22:41.704至13:26:20.190，约218.5秒。
- HTTP400：miaoda/minimax-m3 ended with an incomplete terminal response。
- 三次原生生成均length/output16000，内容仅thinking类型，无完整函数载荷；不能将三次用量相加称作一份报告。
- 未证明实际生成突破16000；也不能仅凭这个测试确定限制位于哪个上游参数转换位置。

## 2. 长上下文与条件推理

- 会话：593491e6-be99-404e-8bfb-02291e544110。
- 6000条随机记录，提示653801字节；指定头部、中间、尾部六个位置，复制随机nonce，并计算含AND/OR/NOT的条件。
- UTC13:29:42.971至13:30:39.882，约56.9秒。
- HTTP200/tool_calls；prompt_tokens382372（含cache11355）、completion_tokens1271；原生input371017+cache11355，stopReason=toolUse。
- 6/6随机值精确，6/6条件判断正确。
- 本次已实际使用超过旧256000窗口的输入，不能称为全部百万窗口或复杂工程推理能力已验证。

## 配置与运行文件差异

界面配置及网关目录已更新为reasoning=true、上下文1000000；配置maxTokens1000000。但工程Agent目录/home/gem/workspace/agent/agents/wiselink-engineering/agent/models.json仍为reasoning=false/maxTokens16000/contextWindow256000。该文件差异不是“其所有字段都在本次实际生效”的证据：本次长上下文已经超过256000，且原生包含thinking块。需要追踪实际请求映射，不能只凭文件认定唯一根因。

## 3. 接近百万输入的检索与条件推理

- 会话：c8369672-5332-4942-a944-4f9cfc4643fd。
- 15000条独立随机记录，提示1633583字节；与测试2使用同一条件规则和六处精确取值要求，新随机值。
- UTC13:33:02.890至13:34:55.893，约113秒。
- HTTP200/tool_calls；prompt_tokens893180（原生input892540+cache640），completion_tokens3951，total897131。一次原生生成，toolUse，thinking+toolCall。
- 随机nonce精确2/6；条件判断4/6；整体未通过。R00017、R03751、R07501、R11251的随机值不正确；R03751、R07501的条件判断也不正确；末尾R14988、R15000两项全部正确。
- 输入被接受及计量，不等于上下文信息被可靠利用。此单次测试不能证明具体在哪层丢失或忽略信息，也不能得出普遍准确率。

## 判定与后续

界面修改并非完全无效：38.2万输入已经实际读取并正确答题，low被接受。但近89.3万输入仅协议成功，内容未通过；申请65536的长输出也没有完整交付，三次原生生成各停于16000。不能宣传百万可靠上下文或更高生成上限已实现。

AND/OR/NOT测试证明的是这些构造案例的结果，不替代FTD工程分析能力验收。当前不再扩大压力测试；下一步若继续业务验证，保留有关完整原文与语义、分批保存，以首份实质FTD工作读回为标准，不以模型目录数字或输入被接受作为验收。

本轮未改变模型配置、安装运行时、Host/Skill部署或业务代码，未创建工程业务请求、未调用SAVE。远端/tmp/wiselink-capacity-{output,context,context-large}-{meta,response,result}.json保留合成测试回执；context两组另有expected.json。这里只保存计量、结构类型与正确性，不保存内部推理正文。
