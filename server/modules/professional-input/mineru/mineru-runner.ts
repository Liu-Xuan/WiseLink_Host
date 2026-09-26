import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMineruArtifactFiles } from './mineru-artifact-files';
import {
  enhanceMineruTitles,
  type MineruTitleCall,
} from './mineru-title-enhancer';

export interface MineruRuntimeOptions {
  /** Fixed deployment executable and verified model config; never request data. */
  executable: string;
  configPath: string;
  /** Fixed local entry script when executable is the selected virtualenv Python. */
  entryScript?: string;
  /** Verified, isolated Linux support libraries from the deployment archive. */
  libraryPath?: string;
  timeoutMs?: number;
  titleCall?: MineruTitleCall;
}

export class MineruExecutionError extends Error {
  constructor(
    code: string,
    readonly stderr: string,
  ) {
    super(code);
  }
}

/** One CPU parse per runner instance. The Host owns persistence and authorization. */
export class MineruRunner {
  private running = false;
  constructor(private readonly options: MineruRuntimeOptions) {}

  async parse(pdf: Uint8Array, execution: { signal?: AbortSignal } = {}) {
    if (execution.signal?.aborted) throw new Error('MINERU_ABORTED');
    if (this.running) throw new Error('MINERU_BUSY');
    if (
      pdf.length > 100 * 1024 * 1024 ||
      Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-'
    )
      throw new Error('MINERU_INPUT_INVALID');
    const { executable, configPath } = this.options;
    const timeoutMs = this.options.timeoutMs ?? 15 * 60 * 1000;
    if (
      !isAbsolute(executable) ||
      !isAbsolute(configPath) ||
      (this.options.entryScript !== undefined && !isAbsolute(this.options.entryScript)) ||
      (this.options.libraryPath !== undefined && (!isAbsolute(this.options.libraryPath) || this.options.libraryPath.includes(':'))) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 30 * 60 * 1000
    )
      throw new Error('MINERU_RUNTIME_CONFIG_INVALID');
    this.running = true;
    let directory: string | undefined;
    try {
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      if (
        config['model-source'] !== 'local' ||
        typeof config['models-dir']?.pipeline !== 'string' ||
        !isAbsolute(config['models-dir'].pipeline) ||
        config['llm-aided-config']?.title_aided?.enable === true
      )
        throw new Error('MINERU_LOCAL_MODEL_CONFIG_REQUIRED');
      directory = await mkdtemp(join(tmpdir(), 'wiselink-mineru-'));
      const input = join(directory, 'document.pdf');
      const output = join(directory, 'output');
      await writeFile(input, pdf, { flag: 'wx' });
      await execute(
        executable,
        [...(this.options.entryScript ? [this.options.entryScript] : []), '-p', input, '-o', output, '-b', 'pipeline'],
        timeoutMs,
        configPath,
        this.options.libraryPath,
        execution.signal,
      );
      const candidates: string[] = [];
      async function locate(path: string, depth: number) {
        if (depth > 3) throw new Error('MINERU_OUTPUT_LAYOUT_INVALID');
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.isSymbolicLink())
            throw new Error('MINERU_OUTPUT_SYMLINK_FORBIDDEN');
          if (entry.isDirectory() && entry.name !== 'images')
            await locate(join(path, entry.name), depth + 1);
          if (entry.isFile() && entry.name === 'document_middle.json')
            candidates.push(path);
        }
      }
      await locate(output, 0);
      if (candidates.length !== 1)
        throw new Error('MINERU_OUTPUT_BUNDLE_MISSING_OR_AMBIGUOUS');
      const parsed = await readMineruArtifactFiles(candidates[0], 'document');
      if (execution.signal?.aborted) throw new Error('MINERU_ABORTED');
      const result = await enhanceMineruTitles(parsed, this.options.titleCall);
      if (execution.signal?.aborted) throw new Error('MINERU_ABORTED');
      return {
        ...result,
        // Keep the parser's unenhanced output; title enhancement produces a separate view.
        rawArtifacts: {
          markdown: parsed.rawMarkdown,
          contentListV2: parsed.contentListV2,
          middle: parsed.middle,
        },
        sourceSha256: createHash('sha256').update(pdf).digest('hex'),
        sourceByteLength: pdf.length,
      };
    } finally {
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        this.running = false;
      }
    }
  }
}

function execute(
  executable: string,
  args: string[],
  timeoutMs: number,
  configPath: string,
  libraryPath?: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) { reject(new Error('MINERU_ABORTED')); return; }
    const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(childEnvironment)) {
      if (/(?:^|_)(?:API_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|TOKEN|PASSWORD|SECRET)$/u.test(name)) delete childEnvironment[name];
    }
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, args, {
      detached: grouped,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnvironment,
        ...(libraryPath ? { LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
        MINERU_TOOLS_CONFIG_JSON: configPath,
        MINERU_MODEL_SOURCE: 'local',
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        CUDA_VISIBLE_DEVICES: '',
        OMP_NUM_THREADS: '2',
        MKL_NUM_THREADS: '2',
        MINERU_INTRA_OP_NUM_THREADS: '2',
        MINERU_INTER_OP_NUM_THREADS: '1',
        MINERU_PROCESSING_WINDOW_SIZE: '1',
        MINERU_API_MAX_CONCURRENT_REQUESTS: '1',
        LOGURU_LEVEL: 'WARNING',
      },
    });
    let stderr = '';
    let outputBytes = 0;
    let failure: string | undefined;
    let hardKill: NodeJS.Timeout | undefined;
    function kill(signal: NodeJS.Signals) {
      if (!child.pid) return;
      try {
        if (grouped) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error);
      }
    }
    function stop(code: string) {
      if (failure) return;
      failure = code;
      kill('SIGTERM');
      hardKill = setTimeout(() => kill('SIGKILL'), 1000);
    }
    const onAbort = () => stop('MINERU_ABORTED');
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    const timeout = setTimeout(() => stop('MINERU_TIMEOUT'), timeoutMs);
    function capture(data: Buffer, isError: boolean) {
      outputBytes += data.length;
      if (isError) stderr = (stderr + data.toString('utf8')).slice(-8192);
      if (outputBytes > 1024 * 1024) stop('MINERU_LOG_LIMIT_EXCEEDED');
    }
    child.stdout.on('data', (data: Buffer) => capture(data, false));
    child.stderr.on('data', (data: Buffer) => capture(data, true));
    child.once('error', (error) => {
      abortSignal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      if (hardKill) clearTimeout(hardKill);
      reject(error);
    });
    child.once('close', (code, signal) => {
      abortSignal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      if (hardKill) clearTimeout(hardKill);
      kill('SIGKILL'); // Also clean up a temporary MinerU API left by the owned process.
      if (failure || code !== 0)
        reject(
          new MineruExecutionError(
            failure ?? `MINERU_PROCESS_FAILED:${code ?? signal}`,
            stderr,
          ),
        );
      else resolve();
    });
  });
}
