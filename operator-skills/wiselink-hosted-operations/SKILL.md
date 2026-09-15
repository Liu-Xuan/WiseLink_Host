---
name: wiselink-hosted-operations
description: 通过已授权的妙搭 CLI 和 Hosted 终端部署 WiseLink Host 与 OpenClaw Skill，校验安装、恢复相关调度并执行任务指定的测试。用于 CodeM 操作员任务，不是产品工程分析 Skill。
---

# WiseLink Hosted 部署与测试

按任务卡执行已经授权的部署和测试，返回实际发布、安装、恢复和测试回执。旧豆包操作技能原件已删除；本稿由 CodeM 重建草稿经 M 修订，依据当前仓库 Publish Lite 和实测官方命令，不声称恢复了原文件。

## 执行入口

CodeM 可由任务提示显式读取本文件并按它执行；目录存在不代表自动发现或已经加载。使用当前任务实际提供的 shell、文件及浏览器工具。Mac 上的官方 `lark-cli` 用于 Host 发布和私有文件传输；`openclaw` 命令在获准的 Hosted 容器执行。本机没有 OpenClaw CLI 不代表产品不可用，也不应安装本地消费者代替生产。

先验证能读回一个新命令的结果。登录页恢复、终端显示旧输出、输入动作成功都不等于容器执行成功。若 CodeM 缺少可用的远端控制工具，把具体远端命令和所需短回执交给任务指定操作者，继续可独立完成的本地准备；不要将能力缺口固定成每次必须人工执行的规则。

## 本次输入与授权

从当前任务和实际回读取得：Host app、Hosted app/profile、仓库与同名开发分支、接受的精确 Git SHA、Skill 版本和包/manifest/SHA、受影响 job ID、允许的测试对象及操作范围、私有证据目录。缺失参数先查当前项目与回执，不向用户重复索取已知值。普通技术部署不授予新的业务生成、正式采用或模型/权限变更。

保留既有授权。未授权的额外动作才需确认，不因切换执行者、重登或兼容版本变化重复要求批准。配置快照和原始回执保存到私有目录，报告只返回必要字段；不打印凭据、签名 URL 或完整业务正文。

## 本地准备

读取当前仓库 `openclaw/skills/wiselink-research-and-synthesize/references/hosted-uat-runbook.md` 的 Publish Lite 段和 `scripts/package-wiselink-openclaw-skill.mjs`。使用当前内容，不把旧 c 修订当成现行版本。

确认接受的改动已提交并同步到明确的同名 `codex/*` 分支。Git 由任务指定 owner 处理，不推 main/sprint、其他 ref 或强制覆盖。不合入未经接受的前端分支。

`npm run package:openclaw:skill` 已包含源状态检查、版本对齐和 Skill 自测；通过后不为同一事实重复执行一轮 gate。包来自提交的 Skill 子树，不打包未提交近似内容。用本目录的 `scripts/verify-package.py` 校验实际 ZIP：

```bash
python3 <技能目录>/scripts/verify-package.py --zip <zip文件> --manifest <manifest文件> --expected-sha256 <已接受的archive SHA>
```

校验器核对现有 manifest 的 `archive` 与逐文件字节、SHA和完整文件集合，拒绝重复路径、越界路径和特殊文件。ZIP声明Unix模式时同时比较模式；当前publisher的DOS条目未携带Unix权限，会如实返回该数量，不声称验证了缺失的权限位。包 SHA 用于上传下载字节一致性，不是新的业务版本协议。

## 技术窗口

通过官方 cron 入口读取本次受影响 job 的完整配置到私有快照；只输出 ID、enabled、schedule、agentId、sessionTarget 和在途状态等短摘要。不要逐字段反复读屏。先保存，再按当前 CLI 帮助使用官方 disable 暂停本次相关派发，核实在途任务自然收尾后再切换。不要修改其他 job、直接覆盖 cron 配置文件、结束有效业务或重启托管内核。

Host-only 不重复安装未变 Skill，Skill-only 不重复发布未变 Host。双方结果语义改变时按接受的切换顺序执行，保持窗口内不领取新任务。代码提交、Host 发布与 Skill 安装分别核实。

## Host 发布

先确认当前 `lark-cli` 实际具有 `apps +release-create` / `+release-get`；多个版本可能提供不同命令，不因 PATH 变化改用另一发布链路。已验证命令形态如下：

```bash
lark-cli apps +release-create --app-id <Host app> --branch <接受的codex分支> --as user --dry-run
lark-cli apps +release-create --app-id <Host app> --branch <同一分支> --as user
lark-cli apps +release-get --app-id <Host app> --release-id <原release_id> --as user
```

服务端部署远端分支 HEAD。发布窗口不要推进该分支；用同一 release_id 读回 `data.status=finished` 和 `data.commit_id` 等于接受 SHA。`publishing` 时有界等待，未知结果查原 release，不新建第二次发布。失败读取该 release 的 error_logs，保护私有内容。

## Skill 安装与恢复

沿当前官方 `apps +file-upload` /下载能力传输 ZIP 和 manifest 到指定私有存储；先查本机 CLI 帮助核实路径与输出契约，不记录签名 URL。Hosted 下载后使用接受的 SHA 和同一校验器再次验证，解压到本次新临时目录；校验通过才执行：

```bash
openclaw skills install <已验证根目录> --as wiselink-research-and-synthesize --force
```

同名覆盖唯一产品 Skill，不手改 installed 文件。用当前 CLI 支持的 skills list/info/check 读回安装目录、版本及状态，运行 installed tests，按 manifest 比较安装目录完整文件集合与每文件内容。安装器的 `.openclaw/source-origin.json` 单独报告，不计作包内文件。测试失败不能重复安装凑成功次数。

用官方 cron enable/disable 按本次快照恢复原 enabled 状态，再读回并比较 schedule、payload、agentId、sessionTarget 等配置；自然变化的运行计数/时间不要求回退。原先 disabled 的 job 保持 disabled。发现窗口内合法配置变化，保留并交 owner 判断，不用旧备份覆盖。安装或恢复结果未知先读实际状态，不重发。

## 测试与回执

区分本地包校验、installed tests、技术发布、操作员恢复和自然调度。用户授权的业务测试才用正常 Host 入口执行；受理前 fresh-read 精确对象与 CAS，不重放旧 attempt 或重新生成已有有效原件。SAVE 结果未知查原 request，不换 ID 重交。保留已保存工作，正式采用仍由 Host 授权链决定。

回执给出：实际执行者/入口、源 SHA、Host release/SHA、包 SHA/Skill 版本、安装比对与测试退出码、job 恢复对照、正常运行的原请求标识、未完成步骤及具体错误。仅填写实际取得的结果；不能以创建目录、工具配置或动作已发送代替完成。
