# 妙搭云端代码交接协议

妙搭云端会话的工作树不等于本机 Git worktree。云端完成、测试通过或给出提交号，只证明对应云端环境；在本机取得可校验的代码之前，M 和 Astra 不据此合入、同步或发布。

## 何时使用

- 本机仓库直接开发：不使用本协议，按普通 Git 审查与同步。
- 云端会话已把准确提交推到获准的同名开发分支：本机正常 fetch 并核对提交，不使用分块交接。
- 云端存在未推送或待选择性审查的代码：使用本协议。不得以聊天摘要代替代码交付，也不手工拼接裸 patch。

## 云端产物

云端操作员以开始开发时的精确 `base_sha` 生成：

```bash
git diff --binary --no-ext-diff > /tmp/wl-handoff.patch
gzip -9 -c /tmp/wl-handoff.patch > /tmp/wl-handoff.patch.gz
```

随后记录原始 patch 与 gzip payload 的 SHA256、原始字节数、按 `diff --git` 顺序排列的精确文件清单。gzip 文件只作 base64 传输，建议每块不超过 12 KiB 文本。输出必须使用以下固定格式；manifest 可重复，但每份内容必须完全一致。

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

使用 `lark-cli apps +session-messages-list` 读取相关 turn，按 `has_more` 分页到 false，把 JSON 输出原样保存到仓库外的临时文件。所有 turn 的消息文件可一起传给验证器：

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

脚本只重建和验证，不执行 `git apply`。Astra/M 阅读实际 patch 并接受后，才由集成 owner 应用、运行本地验证、提交和同步。技术发布及真实线上验证仍单独记录。

## 回报格式

云端回报：会话/turn、base SHA、patch SHA256、payload SHA256、字节数、分块数、文件清单、云端验证及限制。

本地回报：验证器 JSON、实际 diff、选择性接受或拒绝理由、本地测试、最终提交/父提交、双远端回读及技术发布。任何一步缺失时说明具体缺口，不把云端测试转述为本地通过。
