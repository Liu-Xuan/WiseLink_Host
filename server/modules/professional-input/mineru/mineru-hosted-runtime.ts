import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { MineruRuntimeReadiness } from '@shared/mineru-runtime.interface';
import { MineruModelCache, readMineruModelStorageManifest } from './mineru-model-cache';

const execute = promisify(execFile);

/**
 * App FileService is the durable deployment source. Local disk is a reconstructible
 * cache. Call observe only inside an already-authorized Host request so the SDK
 * captures the real application context; do not invent a startup user or tenant.
 */
export class MineruHostedRuntime {
  private readonly logger = new Logger(MineruHostedRuntime.name);
  private preparation: Promise<void> | undefined;
  private lastAttemptAt = 0;
  private configuration: { executable: string; configPath: string } | undefined;
  private readiness: MineruRuntimeReadiness = {
    state: 'NOT_CONFIGURED', stage: null, verifiedFiles: 0, totalFiles: 0, errorCode: null,
  };

  constructor(private readonly files: Pick<FileService, 'from'>) {}

  observe(): MineruRuntimeReadiness {
    if (!this.preparation && this.readiness.state !== 'READY' && Date.now() - this.lastAttemptAt >= 60_000) {
      this.lastAttemptAt = Date.now();
      this.readiness = { state: 'PREPARING', stage: 'FILES', verifiedFiles: 0, totalFiles: 0, errorCode: null };
      // Continue in the originating request's AsyncLocalStorage context, without
      // holding the HTTP response or keeping the browser open for a large restore.
      this.preparation = this.prepare().catch(error => {
        const code = runtimeErrorCode(error);
        this.readiness = { ...this.readiness, state: code === 'MINERU_RUNTIME_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED', stage: null, errorCode: code };
        this.configuration = undefined;
        this.logger.error(`MinerU environment preparation failed: ${code}`);
      }).finally(() => { this.preparation = undefined; });
    }
    return { ...this.readiness };
  }

  options(): { executable: string; configPath: string } {
    if (this.readiness.state !== 'READY' || !this.configuration) throw new Error('MINERU_RUNTIME_NOT_READY');
    return { ...this.configuration };
  }

  private async prepare() {
    const assets = resolve(__dirname, '../../../runtime-assets/mineru');
    let raw: string;
    try { raw = await readFile(join(assets, 'runtime-files.json'), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('MINERU_RUNTIME_NOT_CONFIGURED');
      throw error;
    }
    const manifest = readMineruModelStorageManifest(JSON.parse(raw));
    if (manifest.files.filter(file => file.relativePath.startsWith('pipeline/')).length !== 40 ||
        manifest.files.filter(file => file.relativePath.startsWith('vlm/')).length !== 13 ||
        manifest.files.filter(file => file.relativePath === 'runtime/wheelhouse.tar').length !== 1 ||
        manifest.files.filter(file => file.relativePath === 'runtime/python.tar.gz').length !== 1 || manifest.files.length !== 55) {
      throw new Error('MINERU_RUNTIME_DEPLOYMENT_INCOMPLETE');
    }
    this.readiness.totalFiles = manifest.files.length;
    const configuredHome = process.env.WL_MINERU_HOME ?? join(tmpdir(), 'wiselink-mineru-runtime', '3.4.5');
    if (!isAbsolute(configuredHome)) throw new Error('MINERU_RUNTIME_HOME_INVALID');
    await mkdir(configuredHome, { recursive: true, mode: 0o700 });
    const home = await realpath(configuredHome);
    const root = join(home, 'assets');
    const configPath = await new MineruModelCache(this.files).prepare({ root, manifest,
      onProgress: () => { this.readiness.verifiedFiles += 1; },
    });
    this.readiness.stage = 'DEPENDENCIES';
    const { stdout: bootstrapOutput } = await execute('/usr/bin/python3', [join(assets, 'restore-python-runtime.py'),
      '--root', home, '--archive', join(root, 'runtime/python.tar.gz')], {
      timeout: 3 * 60_000, maxBuffer: 1024 * 1024,
    });
    const bootstrap = JSON.parse(bootstrapOutput.trim().split('\n').at(-1) ?? '{}');
    const python = join(home, 'python/bin/python3.10');
    if (bootstrap.status !== 'READY' || bootstrap.executable !== python) throw new Error('MINERU_RUNTIME_PYTHON_INVALID');
    const { stdout } = await execute(python, [join(assets, 'install-offline-runtime.py'),
      '--root', home, '--wheelhouse', join(home, 'wheelhouse'), '--archive', join(root, 'runtime/wheelhouse.tar')], {
      timeout: 15 * 60_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, MINERU_TOOLS_CONFIG_JSON: configPath, MINERU_MODEL_SOURCE: 'local', CUDA_VISIBLE_DEVICES: '' },
    });
    const lastLine = stdout.trim().split('\n').at(-1);
    const inspection = JSON.parse(lastLine ?? '{}');
    const executable = join(home, 'venv/bin/mineru');
    if (inspection.status !== 'READY' || inspection.mineru !== '3.4.5' || inspection.backend !== 'pipeline-cpu' || inspection.executable !== executable) {
      throw new Error('MINERU_RUNTIME_INSPECTION_FAILED');
    }
    await Promise.all([access(executable, constants.X_OK), access(configPath, constants.R_OK)]);
    this.configuration = { executable, configPath };
    this.readiness = { ...this.readiness, state: 'READY', stage: null, errorCode: null };
    this.logger.log(`MinerU 3.4.5 CPU environment ready; ${manifest.files.length} deployment files verified.`);
  }
}

function runtimeErrorCode(error: unknown) {
  const value = error as { message?: unknown; code?: unknown; stderr?: unknown } | null;
  const detail = `${typeof value?.message === 'string' ? value.message : ''}\n${typeof value?.stderr === 'string' ? value.stderr.slice(-8192) : ''}`;
  const match = detail.match(/\bMINERU_[A-Z0-9_]+\b/g)?.at(-1);
  if (match) return match;
  if (value?.code === 'ENOSPC') return 'MINERU_RUNTIME_NO_SPACE';
  if (value?.code === 'EACCES') return 'MINERU_RUNTIME_PERMISSION_DENIED';
  return 'MINERU_RUNTIME_PREPARATION_FAILED';
}
