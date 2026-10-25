# 宿主配置、旧入口停止领取与迟到写隔离

本文件是本批接线的具体准备和验证顺序，未执行配置写入、切换调度、业务领取或真实模型。已定目标是单个新事项的程序初评，实际运行类型CODEX；目标应用`app_17gr74pbere`通过`WL_CODEX_RUNTIME_APP_ID`配置，独立principal和单新intake范围不借用旧运行端。服务发现、历史wire名和实际运行身份分别核对。

本摘要依据首测CORE同源的`docs/coordination/WISELINK_CODEX_RUNTIME_ACCEPTANCE_20261025.md`；原文摘要已进入source manifest。文档跨lease Host扩展单独交付，本包不含P1新增三项phase，也不以其验证作为程序初评首测前置。

## 1. 宿主需确定的配置

| 内容 | 已有实现 | 待现场确定 |
| --- | --- | --- |
| 唯一业务入口 | 显式CODEX消费者，Host仅活动Codex路径 | 实际宿主、进程管理/调度方式、唯一operator及启停登记 |
| Codex二进制与现有妙搭模型配置 | 接受绝对路径、固定经验证版本和GLM5.3 route；认证不写模型材料 | 实际安装/私有配置引用及权限；包内不提供路径或凭据值 |
| `runRoot`和`checkpointRoot` | 排他请求目录、原子文件、fsync与原回执恢复 | 两者都位于保留的私有持久卷，重启/容器回收/断电行为及保留期；本轮尚未现场验证 |
| Host连接 | 独立Codex配置名、HTTPS新路径、专用私有headers输入 | 精确5条路径授权、新principal/tenant及单WI/intake配置 |
| 业务受理 | intake与stage/SAVE key分开，两层lease不混用 | 一个明确新事项、当前来源/actor授权、原文与模型封存 |

两目录缺一不可。旧`.openclaw`默认路径或历史UNKNOWN检查点不作为新执行器的隐式配置来源；须传明确新目录，不迁移旧记录冒充恢复。

## 2. 停止新增领取与隔离顺序

1. 先读回旧入口的实际在途、排队、lease owner/generation和未知上游状态。停止旧入口新增claim/派发的调度或领取授权，保留原记录和回执；关闭连接不表示模型或远端事务已撤销。
2. 新运行端使用独立principal、仅Codex精确路径凭据与单新WI/intake。不得转移旧lease owner，旧租约过期或旧WAITING状态也不能因此被新执行器领取。
3. 配置Host唯一活动路线后，旧MCP/队列endpoint拒绝新请求；新队列只看配置的准确事项。Applicability、Review、待办Review和后继Review Overall及相关attempt在首批CODEX范围显式403拒绝。
4. 保持原attempt lease、原SAVE key/CAS、source grant与最终写入前校验。迟到响应只能按其原attempt/result/lease归属接受或拒绝，不能落到新事项、换模型、换key或更新当前指针。新旧入口的停止与凭据处理应按获准精确范围执行，不撤销无关阅读权限。
5. 对仍不确定的旧上游只保留UNKNOWN和原恢复条件；不清检查点、不伪造FAILED/完成、不用新消费者接管。先独立完成新事项的真实SAVE、原key准确READ、同版Overall、原页面阅读和正常ACK，再登记各层证据。

以上是切换方案，不能代替实际停调度回执、scope/lease检查或业务写入证据。本包没有执行这些操作。

业务并发按1→2→4另行验收。当前精确单WI/intake scope仅授权第一条新事项；消费者整批flock和逐项await也不等于4个worker。首条闭环通过后，扩到2/4须先明确逐请求授权、owner/检查点和真实provider/宿主容量，保留同一数据库槽位范围。不能直接开4个相同CLI、换4个root绕锁或换origin扩容。

旧包、演示或旧成果的清理/新版重生成另列准确对象和依赖；不要求新版继续兼容旧形状。UNKNOWN、COMMITTING和在途回执保留取证，不因旧包退役按TTL删除或重派。此处置与新版第一条闭环分别跟踪，不互作无关前置。

## 3. 已取得的非秘密数据库与本地验证结论

主控通过开发/线上官方只读catalog SELECT核对，三项已有partial indexes的谓词、valid/ready状态均正确，执行slot仅允许0..3的CHECK已验证。生成的schema声明没有显示WHERE，属于声明漂移；没有因此执行DDL或新增约束。本包不公开私有schema、索引名、表名、业务值或查询结果明细。

主控本轮定向结果：20项Node（14项program-finish、6项真实consumer wrapper）、scope 3项（含拒旧runtime app）、Discovery 3项、queue 3项、实际Host服务边界8项通过，服务端类型检查通过。这些结果各自有测试范围，不相加为业务完成率；没有重跑旧53/9/70用例代替当前验证。

源码/合成验证尚不能证明实际宿主已调度、两个目录所在卷持久、网关/API Key已认证、真实模型运行、业务页面读到同版成果或线上正常结束。技术部署、运行身份、保存/读取、Overall和页面验收仍分别记录。

## 4. 本次正式现场读回

2026-10-25 11:25—11:31 UTC，Host正式发布仍a65/finished；dev与online各38个配置名称，所需10个Codex名称均不存在；现有7条Key metadata没有5条Codex POST的启用授权，值与Key ID未导出。官方完整schema差异为空。新应用正式会话inactive、平台cron列表为空，Chrome已登录但预览/终端仍唤醒中；这不证明无原生调度或安装失败。API origin、实际安装根/二进制、两个持久root和具体operator仍待补，不猜测地址或路径。

上述缺项属于部署配置与现场证据，不能称代码未实现。一次首测可使用现成受控单次唤起，不以前置新常驻框架、2/4 workers或P1扩展拖延。准确参数齐全后再提交一次具体切换与新事项审批；本轮未提出空泛批准，也未执行部署、配置、模型或SAVE。
