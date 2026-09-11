import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export type MineruRemoteTaskStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface MineruRemoteTaskReceipt {
  taskId: string;
  status: MineruRemoteTaskStatus;
  sourceSha256: string;
  sourceByteLength: number;
  parserVersion: '3.4.5';
  artifactManifestPath: string | null;
  errorCode: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MineruRemoteArtifactLink {
  role: string;
  relativePath: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  downloadUrl: string;
}

export interface MineruRemoteTaskResult {
  task: MineruRemoteTaskReceipt;
  artifacts: MineruRemoteArtifactLink[];
}

export interface MineruRemoteArtifact extends MineruRemoteArtifactLink {
  bytes: Uint8Array;
}

/** Transport boundary for the separately deployed MinerU application. */
@Injectable()
export class MineruRemoteWorkerClient {
  private readonly endpoint = (process.env.WL_MINERU_WORKER_URL ?? '').replace(/\/$/, '');
  private readonly token = process.env.WL_MINERU_WORKER_TOKEN ?? '';

  configured() {
    return Boolean(this.endpoint && this.token);
  }

  async submit(pdf: Uint8Array, taskId?: string): Promise<MineruRemoteTaskReceipt> {
    const value = await this.request<MineruRemoteTaskReceipt>('/openapi/mineru-worker/tasks', {
      method: 'POST',
      body: JSON.stringify({ ...(taskId ? { taskId } : {}), pdfBase64: Buffer.from(pdf).toString('base64') }),
      timeoutMs: 30_000,
    });
    if (!isTask(value)) throw new Error('MINERU_REMOTE_WORKER_RESPONSE_INVALID');
    return value;
  }

  /** Submit or resume a deterministic task, then fetch and verify every artifact. */
  async run(pdf: Uint8Array, taskId: string, deadlineAt: Date): Promise<{ task: MineruRemoteTaskReceipt; artifacts: MineruRemoteArtifact[] }> {
    let task = await this.submit(pdf, taskId);
    let delayMs = 1_000;
    while (task.status === 'QUEUED' || task.status === 'RUNNING') {
      const remaining = deadlineAt.getTime() - Date.now();
      if (remaining <= 0) throw new Error('MINERU_REMOTE_WORKER_TIMEOUT');
      await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, remaining)));
      task = await this.task(task.taskId);
      delayMs = Math.min(5_000, Math.round(delayMs * 1.5));
    }
    if (task.status === 'FAILED') throw new Error(task.errorCode || 'MINERU_REMOTE_WORKER_TASK_FAILED');
    if (task.status !== 'SUCCEEDED') throw new Error('MINERU_REMOTE_WORKER_RESPONSE_INVALID');
    const result = await this.result(task.taskId);
    if (result.task.sourceSha256 !== task.sourceSha256 || result.task.sourceByteLength !== task.sourceByteLength)
      throw new Error('MINERU_REMOTE_WORKER_SOURCE_MISMATCH');
    const artifacts = await Promise.all(result.artifacts.map(link => this.download(link)));
    return { task, artifacts };
  }

  async task(taskId: string): Promise<MineruRemoteTaskReceipt> {
    const value = await this.request<MineruRemoteTaskReceipt>(`/openapi/mineru-worker/tasks/${encodeURIComponent(taskId)}`, { timeoutMs: 30_000 });
    if (!isTask(value) || value.taskId !== taskId) throw new Error('MINERU_REMOTE_WORKER_TASK_INVALID');
    return value;
  }

  async result(taskId: string): Promise<MineruRemoteTaskResult> {
    const value = await this.request<MineruRemoteTaskResult>(`/openapi/mineru-worker/tasks/${encodeURIComponent(taskId)}/result`, { timeoutMs: 30_000 });
    if (!value || !isTask(value.task) || value.task.taskId !== taskId || !Array.isArray(value.artifacts) || value.artifacts.some(item => !isArtifactLink(item)))
      throw new Error('MINERU_REMOTE_WORKER_RESULT_INVALID');
    return value;
  }

  taskIdForParseRun(parseRunId: string) {
    if (!/^PRUN-[0-9a-f-]{36}$/.test(parseRunId)) throw new Error('MINERU_REMOTE_WORKER_TASK_ID_INVALID');
    return `MW-${parseRunId.slice('PRUN-'.length)}`;
  }

  private async download(link: MineruRemoteArtifactLink): Promise<MineruRemoteArtifact> {
    const response = await fetch(link.downloadUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`MINERU_REMOTE_WORKER_ARTIFACT_HTTP_${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isSafeInteger(declared) && declared !== link.byteLength) throw new Error('MINERU_REMOTE_WORKER_ARTIFACT_LENGTH_MISMATCH');
    const bytes = await readBounded(response, 64 * 1024 * 1024);
    if (bytes.byteLength !== link.byteLength || digest(bytes) !== link.sha256) throw new Error('MINERU_REMOTE_WORKER_ARTIFACT_MISMATCH');
    return { ...link, bytes };
  }

  private async request<T>(path: string, input: { method?: string; body?: string; timeoutMs: number }): Promise<T> {
    if (!this.configured()) throw new Error('MINERU_REMOTE_WORKER_NOT_CONFIGURED');
    const response = await fetch(`${this.endpoint}${path}`, {
      method: input.method ?? 'GET',
      headers: { accept: 'application/json', ...(input.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${this.token}` },
      ...(input.body ? { body: input.body } : {}),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) throw new Error(`MINERU_REMOTE_WORKER_HTTP_${response.status}`);
    try { return await response.json() as T; }
    catch { throw new Error('MINERU_REMOTE_WORKER_RESPONSE_INVALID'); }
  }
}

function isTask(value: unknown): value is MineruRemoteTaskReceipt {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.taskId === 'string' && /^MW-[0-9a-f-]{36}$/.test(item.taskId) &&
    ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(String(item.status)) &&
    typeof item.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sourceSha256) &&
    Number.isSafeInteger(item.sourceByteLength) && item.parserVersion === '3.4.5' &&
    (item.artifactManifestPath === null || typeof item.artifactManifestPath === 'string') &&
    (item.errorCode === null || typeof item.errorCode === 'string');
}

function isArtifactLink(value: unknown): value is MineruRemoteArtifactLink {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const byteLength = item.byteLength;
  return typeof item.role === 'string' && typeof item.relativePath === 'string' && typeof item.mediaType === 'string' &&
    typeof byteLength === 'number' && Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= 64 * 1024 * 1024 &&
    typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256) &&
    typeof item.downloadUrl === 'string' && /^https?:\/\//.test(item.downloadUrl);
}

async function readBounded(response: Response, maxBytes: number) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('MINERU_REMOTE_WORKER_ARTIFACT_TOO_LARGE');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error('MINERU_REMOTE_WORKER_ARTIFACT_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
