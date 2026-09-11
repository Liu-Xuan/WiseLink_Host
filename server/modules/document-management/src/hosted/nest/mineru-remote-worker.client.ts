import { Injectable } from '@nestjs/common';

export interface MineruRemoteTaskReceipt {
  taskId: string; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  sourceSha256: string; sourceByteLength: number; parserVersion: string;
  artifactManifestPath: string | null; errorCode: string | null;
}

/** Transport boundary for the separately deployed MinerU application. */
@Injectable()
export class MineruRemoteWorkerClient {
  private readonly endpoint = (process.env.WL_MINERU_WORKER_URL ?? '').replace(/\/$/, '');
  private readonly token = process.env.WL_MINERU_WORKER_TOKEN ?? '';
  configured() { return Boolean(this.endpoint && this.token); }
  async submit(pdf: Uint8Array): Promise<MineruRemoteTaskReceipt> {
    if (!this.configured()) throw new Error('MINERU_REMOTE_WORKER_NOT_CONFIGURED');
    const response = await fetch(`${this.endpoint}/api/mineru-worker/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ pdfBase64: Buffer.from(pdf).toString('base64') }), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`MINERU_REMOTE_WORKER_HTTP_${response.status}`);
    const value = await response.json() as Partial<MineruRemoteTaskReceipt>;
    if (typeof value.taskId !== 'string' || typeof value.status !== 'string' || typeof value.sourceSha256 !== 'string' || typeof value.sourceByteLength !== 'number')
      throw new Error('MINERU_REMOTE_WORKER_RESPONSE_INVALID');
    return value as MineruRemoteTaskReceipt;
  }
}
