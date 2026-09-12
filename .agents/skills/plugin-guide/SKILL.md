---
name: plugin-guide
description: "集成妙搭应用的 capabilityClient/CapabilityService 或配置插件实例时使用；不处理 Codex 插件管理或普通图片、文档任务。"
compatibility: "Miaoda application capability SDK; lark-cli plugin commands are required only for package management."
when_to_use: "Integrating Miaoda capability calls or instance configuration; existing installed contracts can be inspected without CLI package-management commands."
steering: true
steering-topic: plugin_guide
match-template-name: nestjs-react-fullstack
---

# 妙搭插件集成

只用于应用中的 capabilityClient/CapabilityService 与插件实例。Codex 插件安装、开发素材生图、普通 PDF/Markdown 阅读按其相应工具处理，不因关键词“插件/图片/文档”选用本技能。

## 按任务读取

| 任务 | 资料 |
| --- | --- |
| 选择能力、确定配置目录 | [plugin-catalog.md](references/plugin-catalog.md) |
| 创建或修改 paramsSchema/formValue | [instance-config.md](references/instance-config.md) |
| 获取实例 action/schema、调用侧、持久化及错误处理 | [call-contract.md](references/call-contract.md) |
| 实现调用代码 | [plugin-coding-guide.md](references/plugin-coding-guide.md) 的匹配模式 |

平台插件包管理用 lark-apps 的已支持命令；只有要执行包管理时才检查 CLI 能力。CLI 不可用不阻断对已有实例、包 manifest 和本地代码的读取或修复。实际缺少必需能力时报告具体原因和影响，不静默切换执行路径。

插件包写入 actionPlugins，通过平台命令管理；不能当普通 npm 依赖安装。实例 ID、实际 action、输入/输出 schema 与调用方一致，已核实且未变的定义无需反复查询。

保留凭据、用户/租户、文件授权和 Host 数据边界。插件失败按失败处理，不返回虚构默认业务值；恢复有副作用动作前先查结果与幂等性。产品已有解析或持久化链路不因通用插件示例被替代。
