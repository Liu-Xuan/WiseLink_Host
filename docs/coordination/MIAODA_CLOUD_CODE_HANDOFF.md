# 妙搭云端代码交接协议

妙搭云端会话的工作树不等于本机 Git worktree。云端完成、测试通过或给出提交号，只证明对应云端环境；在本机取得可校验的代码之前，M 和 Astra 不据此合入、同步或发布。

## 何时使用

- 本机仓库直接开发：不使用本协议，按普通 Git 审查与同步。
- 云端会话已把准确提交推到获准的同名开发分支：本机优先正常 fetch 并核对提交，不使用分块交接；不得仅为传输把未接受代码推入共享开发分支。
- 云端存在未推送或待选择性审查的代码：使用本协议。不得以聊天摘要代替代码交付，也不手工拼接裸 patch。

## 云端产物

云端操作员以开始开发时的精确 `base_sha` 生成。先检查已跟踪差异与未跟踪文件，明确本批源码和测试清单。普通 `git diff` 不包含新文件，不能用它交付含新增组件的批次。使用仓库外的临时 index，只加入准确清单中的文件（下面的路径为占位示例，执行前替换）：

```bash
handoff_dir=$(mktemp -d /tmp/wl-handoff-export.XXXXXX)
handoff_base=<已核实的40位base_sha>
GIT_INDEX_FILE="$handoff_dir/index" git read-tree "$handoff_base"
GIT_INDEX_FILE="$handoff_dir/index" git add -- <本批已修改路径> <本批新增源码及测试路径>
GIT_INDEX_FILE="$handoff_dir/index" git diff --cached --binary --no-ext-diff --no-renames "$handoff_base" > /tmp/wl-handoff.patch
gzip -9 -c /tmp/wl-handoff.patch > /tmp/wl-handoff.patch.gz
```

该操作不改变正式 index、不提交、不推送。禁止用 `git add .` 收入平台记忆、下载材料、预览产物或无关修改。逐项确认清单包含本批所有新增文件，删除项也必须显式列入；最终 manifest 从实际 patch 文件边界生成，不凭记忆填写。

随后记录原始 patch 与 gzip payload 的 SHA256、原始字节数、按 `diff --git` 顺序排列的精确文件清单。gzip 文件优先通过已有授权的 CLI 应用私有文件存储上传/下载；私有临时传输可承载未审产物，不表示接受、安装或发布。核对应用及准确存储路径，不生成公开分享链接。本机私有上传/下载成功不证明云端会话具备相同身份和 scope；云端也须具备自己的有效授权，不复制本机凭据。此路径不可用时再以 base64 传输，建议每块不超过 12 KiB 文本。分块输出使用以下固定格式；manifest 可重复，但每份内容必须完全一致。

```text
WL_CODE_HANDOFF_V1
base_sha=<40位小写提交SHA>
patch_sha256=<原始patch SHA256>
payload_sha256=<gzip文件 SHA256>
patch_bytes=<原始patch字节数>
parts=<总块数>
files=<path1>|<path2>|<path3>

WL_CODE_HANDOFF_CHUNK_V1 part=1/3
<base64内容>
WL_CODE_HANDOFF_CHUNK_END
```

同一个 part 可以因消息分页重复出现；重复内容必须相同。不得在分块内加入 Markdown 围栏、说明文字或省略号。远端应先压缩再编码，避免把普通文本 patch 拆成十余轮人工交接。

## 本地取得与验证

使用 `lark-cli apps +session-messages-list` 读取相关 turn，把 JSON 输出原样保存到仓库外的临时文件；缺少产物内容时按 `has_more` 和分页 token 继续读取。优先从生成命令及 `read_file` 的原始 tool 输出机器提取 manifest 和编码，不使用 assistant 重新粘贴或复述的 Base64。`read_file` 的行号仅按明确的“行号 | 内容”结构剥离，并核对读取范围、连续行号及分块顺序；不手修、补猜或替换编码字符。

本次 E1 与 runtime 交接均发生过原工具内容完整、assistant 复述编码失真的情况。若生成 manifest 与完整产物字节已经取得且通过下述验证，即可开始隔离审查，不等待自然语言终态或无必要的重复导出；`has_more=true` 或 turn 尚未结束本身不使已校验产物失效。会话是否可接下一批仍另行核对，不把产物接受视为会话已经结束。

规范分块的所有 turn 消息文件可一起传给验证器：

```bash
node scripts/verify-miaoda-cloud-handoff.mjs \
  --repo "$PWD" \
  --input /private/tmp/turn-1.json \
  --input /private/tmp/turn-2.json \
  --output /private/tmp/wl-handoff.patch
```

验证器只有在以下条件全部成立时才写出 patch：

1. manifest 唯一且字段合法；
2. 所有分块齐全、重复块完全一致；
3. gzip payload 与原始 patch 的 SHA256、字节数均匹配；
4. 当前本机 `HEAD` 精确等于 `base_sha`；
5. patch 实际文件顺序与 manifest 精确一致，不含绝对路径、`..` 或重命名；
6. `git apply --check --whitespace=error-all` 对当前仓库通过；
7. 输出位于仓库外；已有同名文件只有内容哈希相同才允许复用。

CLI 直接下载或从带行号 tool 输出提取时，保持上述基线、双哈希、字节数、精确文件清单和 apply-check 检查等价；保留原始 JSON/manifest 和机器提取结果，不为了符合聊天格式重新生成产物。

脚本只重建和验证，不执行 `git apply`。Astra/M 阅读实际 patch 并接受后，才由集成 owner 应用、运行本地验证、提交和同步。技术发布及真实线上验证仍单独记录。

若 canonical 工作树已保留同批早期 WIP，不为通过检查而 reset、clean 或覆盖。先在仓库外建立精确 `base_sha` 的干净临时 checkout，将其作为验证器的 `--repo`；通过后在那里审查云端完整结果，再与 canonical 的现有文件逐项比较并集成。临时 checkout 检查通过仅证明补丁能应用于声明基线，不代表它能直接覆盖当前脏工作树，也不代替实际代码审查。

## 回报格式

云端回报：会话/turn、base SHA、patch SHA256、payload SHA256、字节数、分块数、文件清单、云端验证及限制。

本地回报：验证器 JSON、实际 diff、选择性接受或拒绝理由、本地测试、最终提交/父提交、双远端回读及技术发布。任何一步缺失时说明具体缺口，不把云端测试转述为本地通过。
