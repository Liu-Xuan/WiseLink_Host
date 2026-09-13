# WiseLink canonical Host

当前产品范围见 `docs/WISELINK_R10_CURRENT.md`，当前实施顺序、owner 和运行证据见 `docs/WISELINK_R10_EXECUTION_PLAN.md`。涉及产品范围、集成、运行或发布时读取相关章节；小修和只读定位无需通读两份文档。历史分支、发布编号和记忆不代表当前状态；旧进度过期不撤销已记录授权。

## 项目边界

- 本仓库是 Host 开发来源；父目录的 0.10/0.11、旧 R09 worktree 只作历史或复用参考。按当前任务分工工作，避免覆盖并发修改；共享入口由负责集成的 owner 协调。
- Host 保有身份、租户/actor 授权、来源、版本、事务/CAS 和正式采用的决定权。模型输出是候选，不自动确认 ReviewAction、正式采用工程结论、审批或放行。
- 产品模型与工具运行使用已配置的妙搭官方 Hosted profile；Codex 的模型偏好不改变产品运行时、外部数据发送目的地或授权。
- `.agents/skills` 是按需使用的妙搭开发指引。模板示例不覆盖本项目已有 service-scope、RLS、SourceRef 和事务边界；保留实际授权链，不按通用模板删除它们。
- 优先使用 Git、版本号、主键、事务、唯一约束、类型和普通测试。只有具体失败场景证明这些不足时，才考虑新 hash、冻结 contract、baseline 或 gate；保留已有安全措施。
- 修改应接入实际消费者。按用户任务验证受影响流程，并区分本地检查、技术发布和真实业务运行；文档或提示词修改本身不要求触发线上业务来证明完成。

## Git 同步边界

- **2026-09-13 用户最新要求：允许妙搭 Host 的 `origin` 与公开 GitHub `github` 分别同步同一开发分支。** 该要求替代 2026-09-06 的 origin-only 规则及旧的一次性 GitHub 限制；仅适用于明确指定的项目 `codex/*` 开发分支。
- `origin` 仍是妙搭开发来源；`github` 指向 `https://github.com/Liu-Xuan/WiseLink_Host.git`。每次同步须分别明确 remote、精确同名源/目标 ref，采用普通非强制快进，并在两端分别核对实际 SHA。
- 仅允许项目 `codex/*` 分支的单条同名更新；不自动推送 main、标签或其他分支，不使用 `--all`、`--mirror`、force，不删除引用、不改写已发布历史、不改仓库可见性，也不绕过认证或凭据/敏感数据检查。
- `.githooks/pre-push` 同时校验 remote 名称及实际 URL、单条更新、同名 `codex/*` ref、非删除和快进关系；origin 与 github 的规则一致。同步前仍需检查新增提交是否包含不适合公开的数据。

历史事实保留：`53c322371 → 73561af4d → 9597d8e53` 的早期推送不符合当时的 main-only 限制；2026-09-05 后续授权不追认这些操作。历史记录见 `docs/WL31_GITHUB_SYNC_BOUNDARY_20260905.md`；其中的旧授权说明不覆盖上述 2026-09-06 最新要求。
