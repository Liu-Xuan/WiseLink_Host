# WiseLink canonical Host：项目内补充指令

当前产品与执行进度见 `docs/WISELINK_R10_CURRENT.md`、`docs/WISELINK_R10_EXECUTION_PLAN.md`。历史进度、旧分支和旧发布编号不是当前运行证据；但进度过期不等于授权限制自动失效。

## 工程原则

- 按需调用 MCP、智能体和 skills；不允许静默降级或失败，应找到系统性原因并修订。
- 优先跑通大流程并实际验证，不陷入细节断言或 gate 循环。
- 默认不新增 hash、冻结 contract、baseline 或 gate。只有明确具体失败场景，并说明 Git、版本号、主键、事务、唯一约束、类型和普通测试为何不足时，才允许加入。
- 不删除已有安全措施；认证、数据安全、不可逆操作和正式发布等高风险环节仍按项目要求处理。

## Git 同步边界

- `origin` 是妙搭开发远端；`github` 指向 `https://github.com/Liu-Xuan/WiseLink_Host.git`。两者不是同一种发布授权。
- **2026-09-05 用户明确长期授权：允许向 `https://github.com/Liu-Xuan/WiseLink_Host.git` 非强制创建或更新项目相关 `codex/*` 分支，按需直接执行，不再逐次询问。** 授权来源是用户对“撤销 main-only 限制，长期允许该仓库 codex/* 非强制推送”的明确答复“是的 长期允许”。该授权就此仓库替换父目录及旧交接中禁止 Codex 分支推送的条款。
- 原有非强制 `refs/remotes/origin/main:refs/heads/main` 同步仍可用；两个 main 分叉时只暂停 main 镜像并先做语义核对，不阻断已授权的 `codex/*` 同名分支快进推送。不能覆盖 GitHub 独有提交，也不能把当前 HEAD 当作 origin/main。
- 本次长期授权不包括强推、删除引用、标签、其他分支或其他仓库。不得使用 `--all`、`--mirror`、force 或绕过认证/数据安全措施；真实分支分叉应正常核对，不能强制覆盖。
- GitHub 分支同步与 Host/Skill 技术发布分开。main 镜像暂停不阻断已授权的本地开发、妙搭 origin 开发分支推送和技术发布。
- 推送前明确 remote、源引用、目标引用和非强制方式；事后分别报告实际写入与授权合规情况。命令成功、历史推送、交接摘要和 Goal 的持续执行都不是新增授权。
- 本机保留 `remote.github.push=refs/remotes/origin/main:refs/heads/main` 作为省略 refspec 时的默认值。推送已授权 Codex 分支时明确指定单一同名源/目标引用；不配置通配符批量推送。这是显式授权路径，不是绕过限制；不增加业务 gate。

2026-09-05 历史更正：此前 `53c322371 → 73561af4d → 9597d8e53` 的推送不符合当时的 main-only 限制；本次明确长期授权从确认后生效，不抹去此前事实。后续交接应引用本次授权，不再沿用旧禁令。记录见 `docs/WL31_GITHUB_SYNC_BOUNDARY_20260905.md`。删除或改写历史仍需另行明确指示。
