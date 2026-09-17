#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const MANIFEST_PATTERN = /WL_CODE_HANDOFF_V1\s+base_sha=([0-9a-f]{40})\s+patch_sha256=([0-9a-f]{64})\s+payload_sha256=([0-9a-f]{64})\s+patch_bytes=(\d+)\s+parts=(\d+)\s+files=([^\r\n]+)/gu;
const CHUNK_PATTERN = /WL_CODE_HANDOFF_CHUNK_V1\s+part=(\d+)\/(\d+)\s*\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\nWL_CODE_HANDOFF_CHUNK_END/gu;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  return null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function messageText(path) {
  const source = readFileSync(resolve(path), 'utf8');
  try {
    const values = [];
    const visit = (value) => {
      if (typeof value === 'string') values.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(JSON.parse(source));
    return values.join('\n');
  } catch {
    return source;
  }
}

function parseArgs(argv) {
  const options = { inputs: [], repo: process.cwd(), output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--input' && next) {
      options.inputs.push(next);
      index += 1;
    } else if (value === '--repo' && next) {
      options.repo = next;
      index += 1;
    } else if (value === '--output' && next) {
      options.output = next;
      index += 1;
    } else {
      return fail(`未知或缺少参数：${value}`);
    }
  }
  if (options.inputs.length === 0 || !options.output)
    return fail('用法：verify-miaoda-cloud-handoff.mjs --input <消息文件> [--input ...] --output <patch> [--repo <仓库>]');
  return options;
}

function git(repo, args, input) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} 失败`).trim());
  }
  return result.stdout.trim();
}

function parseManifest(text) {
  const matches = [...text.matchAll(MANIFEST_PATTERN)];
  if (matches.length === 0) throw new Error('未找到 WL_CODE_HANDOFF_V1 manifest');
  const normalized = matches.map((match) => match.slice(1).join('\u0000'));
  if (new Set(normalized).size !== 1) throw new Error('发现相互冲突的 handoff manifest');
  const [match] = matches;
  const patchBytes = Number(match[4]);
  const parts = Number(match[5]);
  if (!Number.isSafeInteger(patchBytes) || patchBytes <= 0 || patchBytes > MAX_PATCH_BYTES)
    throw new Error(`patch_bytes 超出允许范围：${match[4]}`);
  if (!Number.isSafeInteger(parts) || parts <= 0 || parts > 512)
    throw new Error(`parts 超出允许范围：${match[5]}`);
  const files = match[6].split('|').map((item) => item.trim()).filter(Boolean);
  if (files.length === 0 || new Set(files).size !== files.length)
    throw new Error('manifest files 必须是非空且不重复的清单');
  return {
    baseSha: match[1], patchSha256: match[2], payloadSha256: match[3],
    patchBytes, parts, files,
  };
}

function safeRepoPath(path) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => part === '..'))
    throw new Error(`不安全的仓库路径：${path}`);
  return path.replace(/^\.\//u, '');
}

function patchFiles(patch) {
  const files = [];
  for (const match of patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gmu)) {
    const before = safeRepoPath(match[1]);
    const after = safeRepoPath(match[2]);
    if (before !== after) throw new Error(`当前协议不接受重命名：${before} -> ${after}`);
    files.push(after);
  }
  if (files.length === 0) throw new Error('patch 中没有 diff --git 文件边界');
  if (new Set(files).size !== files.length) throw new Error('patch 中存在重复文件边界');
  return files;
}

function reconstruct(text, manifest) {
  const chunks = new Map();
  for (const match of text.matchAll(CHUNK_PATTERN)) {
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (total !== manifest.parts || index < 1 || index > total)
      throw new Error(`分块编号与 manifest 不一致：${index}/${total}`);
    const value = match[3].replace(/\s+/gu, '');
    const previous = chunks.get(index);
    if (previous && previous !== value) throw new Error(`第 ${index} 块存在冲突内容`);
    chunks.set(index, value);
  }
  const missing = Array.from({ length: manifest.parts }, (_, index) => index + 1)
    .filter((index) => !chunks.has(index));
  if (missing.length > 0) throw new Error(`缺少分块：${missing.join(', ')}`);
  const encoded = Array.from({ length: manifest.parts }, (_, index) => chunks.get(index + 1)).join('');
  const payload = Buffer.from(encoded, 'base64');
  if (sha256(payload) !== manifest.payloadSha256) throw new Error('压缩 payload SHA256 不匹配');
  const patch = gunzipSync(payload, { maxOutputLength: MAX_PATCH_BYTES });
  if (patch.length !== manifest.patchBytes) throw new Error(`patch 字节数不匹配：${patch.length}`);
  if (sha256(patch) !== manifest.patchSha256) throw new Error('patch SHA256 不匹配');
  return patch;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;
  const repo = resolve(options.repo);
  const output = resolve(options.output);
  try {
    const text = options.inputs.map(messageText).join('\n');
    const manifest = parseManifest(text);
    const head = git(repo, ['rev-parse', 'HEAD']);
    if (head !== manifest.baseSha)
      throw new Error(`当前 HEAD ${head} 与 handoff 基线 ${manifest.baseSha} 不一致`);
    const patch = reconstruct(text, manifest);
    const actualFiles = patchFiles(patch.toString('utf8'));
    const expectedFiles = manifest.files.map(safeRepoPath);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
      throw new Error(`patch 文件清单不匹配：${actualFiles.join('|')}`);

    const temp = mkdtempSync(resolve(tmpdir(), 'wl-cloud-handoff-'));
    const tempPatch = resolve(temp, 'handoff.patch');
    try {
      writeFileSync(tempPatch, patch, { flag: 'wx' });
      git(repo, ['apply', '--check', '--whitespace=error-all', tempPatch]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }

    if (existsSync(output)) {
      const existing = readFileSync(output);
      if (sha256(existing) !== manifest.patchSha256)
        throw new Error(`输出已存在且内容不同：${output}`);
    } else {
      const rootRelative = relative(repo, output);
      if (rootRelative !== '' && !rootRelative.startsWith('..'))
        throw new Error('已验证 patch 必须写到仓库外，避免误纳入提交');
      writeFileSync(output, patch, { flag: 'wx' });
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      baseSha: manifest.baseSha,
      patchSha256: manifest.patchSha256,
      patchBytes: manifest.patchBytes,
      files: actualFiles,
      output,
    }, null, 2)}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

main();
